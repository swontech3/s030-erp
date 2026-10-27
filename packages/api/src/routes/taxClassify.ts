/**
 * 세무 거래 분류(s050300010, 세무 S05) — 1-3 (2026-10-27). 결과서 S05-05.
 *
 *   GET  /tax/classify?month&view&kind&from&to&file   목록 · 확인할 줄 수 · 자료 종류 칩 수 · 항목 코드 · 파일 띠
 *   POST /tax/classify/confirm { rows: [{ id, itemCode }] }   [확정] · [선택한 줄에 붙이기] — 한 트랜잭션, 다시 확정하면 덮음
 *   GET  /tax/classify/export?…(목록과 같은 주소)        「전체」 보기 거르기 결과를 엑셀로(ERP 공통 부품 `lib/xlsxExport.ts`)
 *
 * ★★★ 운영사 세션도 **자기 단체만** — `org_id = 세션 단체 ID` 를 직접 건다(`db/taxClassify.ts`). 역할로 403 을 내지 않는다.
 * ★ 남의 단체 · 없는 줄 · 없는 파일은 404 이고 아무것도 쓰지 않는다(둘을 가르지 않는다).
 * ★ 지금은 계산서뿐 — 「확인할 줄」 = 항목이 빈 매입 계산서. 매출은 항목이 없다(코드 TAX_INV_DIR 이름 「매출」로 보인다).
 *   카드 · 현금 · 삐용 경비 · 은행 칩은 0건(뒤 단계).
 * ★ 거래처 기억은 저장하지 않는다 — 그 거래처의 가장 최근 확정 항목을 골라 두기만(그 회사 목록에 있는 항목만).
 */
import type { FastifyInstance } from 'fastify';
import type { ErpSession } from '@swonbiz/shared';
import { formatBizNumber } from '@swonbiz/shared/domain/tax-number';
import { TAX_BIZ_TP_CATEGORY, TAX_KIND_CATEGORY } from '@swonbiz/shared/domain/tax-settings';
import {
  CLASSIFY_KINDS,
  TAX_ITEM_OUT_CATEGORY,
  TAX_ITEM_PARTITIONS,
  classifyDateRange,
  classifyExportFileName,
  itemPartitionOf,
  parseClassifyConfirm,
  parseClassifyQuery,
  type ClassifyConfirmRow,
  type ClassifyKind,
  type ClassifyQuery,
  type TaxClassifyResponse,
  type TaxClassifyRow,
  type TaxItemOption,
} from '@swonbiz/shared/domain/tax-classify';
import {
  TAX_INV_CLASS_CATEGORY,
  TAX_INV_DIR_CATEGORY,
  TAX_INV_DIR_PURCHASE,
  TAX_INV_DIR_SALES,
  TAX_KIND_INVOICE,
  type TaxCodeName,
} from '@swonbiz/shared/domain/tax-uploads';
import { requireSession } from '../session/hook.ts';
import { scopeOfSession, withCompanyScope, type ScopedClient } from '../db/withCompanyScope.ts';
import { listCodes } from '../db/lookups.ts';
import { listCodeDescriptions, readTaxSettingsRow } from '../db/taxSettings.ts';
import { monthRange } from '../db/taxUploads.ts';
import {
  countClassify,
  countInvoicesByDirection,
  findUploadFileById,
  lastItemsOfVendors,
  listClassifyInvoices,
  lockInvoices,
  setInvoiceItems,
} from '../db/taxClassify.ts';
import { buildXlsx, sendXlsx, type XlsxSheet } from '../lib/xlsxExport.ts';
import { loadCodeNames, runOp, type TaxOp } from './taxUploads.ts';

const FILE_NOT_FOUND = { ok: false as const, status: 404 as const, error: 'not_found', message: '없는 파일입니다' };
const ROW_NOT_FOUND = { ok: false as const, status: 404 as const, error: 'not_found', message: '없는 계산서입니다' };
const SALES_INVOICE = {
  ok: false as const, status: 400 as const, error: 'sales_invoice', message: '매출 계산서에는 항목을 붙이지 않습니다',
};

/* ── 항목 코드 ───────────────────────────────────────────────────────────── */

/** 그 회사 사업자 유형 파티션의 켜진 항목 — 설정이 없으면 빈 목록. */
async function loadItems(client: ScopedClient, orgId: number): Promise<{ bizType: string | null; items: TaxItemOption[] }> {
  const settings = await readTaxSettingsRow(client, orgId);
  const bizType = settings?.bizType ?? null;
  const partition = itemPartitionOf(bizType);
  if (!partition) return { bizType, items: [] };
  const rows = await listCodes(client, [{ category: TAX_ITEM_OUT_CATEGORY, useTp: partition }]);
  const descs = await listCodeDescriptions(client, [TAX_ITEM_OUT_CATEGORY], partition);
  return {
    bizType,
    items: rows.map((r) => ({ code: r.code, name: r.name, description: descs.find((d) => d.code === r.code)?.description ?? null })),
  };
}

/** 항목 이름 — 두 파티션 모두(사업자 유형을 바꾼 회사). 같은 코드값이면 그 회사 파티션 이름이 먼저. */
async function loadItemNames(client: ScopedClient, own: readonly TaxItemOption[]): Promise<TaxCodeName[]> {
  const rows = await listCodes(client, TAX_ITEM_PARTITIONS.map((useTp) => ({ category: TAX_ITEM_OUT_CATEGORY, useTp })));
  const by = new Map<string, string>(own.map((i) => [i.code, i.name]));
  for (const r of rows) if (!by.has(r.code)) by.set(r.code, r.name);
  return [...by.entries()].map(([code, name]) => ({ code, name }));
}

/* ── 처리 ────────────────────────────────────────────────────────────────── */

export async function listClassifyOp(client: ScopedClient, orgId: number, query: ClassifyQuery): Promise<TaxOp<TaxClassifyResponse>> {
  const file = query.fileId ? await findUploadFileById(client, orgId, query.fileId) : null;
  if (query.fileId && !file) return FILE_NOT_FOUND;

  const { bizType, items } = await loadItems(client, orgId);
  const itemNames = await loadItemNames(client, items);
  const names = await loadCodeNames(client, [TAX_INV_DIR_CATEGORY, TAX_BIZ_TP_CATEGORY]);
  const invDirs = names.get(TAX_INV_DIR_CATEGORY) ?? [];
  const bizTypeName = (names.get(TAX_BIZ_TP_CATEGORY) ?? []).find((b) => b.code === bizType)?.name ?? null;

  const { left, total } = await countClassify(client, orgId, query.month);
  const base = { range: classifyDateRange(query), fileId: query.fileId };
  const byDir = await countInvoicesByDirection(client, orgId, { ...base, direction: null });
  const kinds = Object.fromEntries(CLASSIFY_KINDS.map((k) => [k, 0])) as Record<ClassifyKind, number>;
  kinds.P = byDir.get(TAX_INV_DIR_PURCHASE) ?? 0;
  kinds.S = byDir.get(TAX_INV_DIR_SALES) ?? 0;
  kinds.all = kinds.P + kinds.S;

  let rows: TaxClassifyRow[];
  if (query.view === 'left') {
    rows = await listClassifyInvoices(client, orgId, { range: monthRange(query.month), fileId: null, direction: TAX_INV_DIR_PURCHASE });
  } else if (query.kind === 'all' || query.kind === TAX_INV_DIR_PURCHASE || query.kind === TAX_INV_DIR_SALES) {
    rows = await listClassifyInvoices(client, orgId, { ...base, direction: query.kind === 'all' ? null : query.kind });
  } else {
    rows = []; // 카드 · 현금 · 삐용 경비 · 은행 — 뒤 단계
  }

  const owned = new Set(items.map((i) => i.code));
  const need = rows.filter((r) => r.direction === TAX_INV_DIR_PURCHASE && r.itemCode === null);
  const last = await lastItemsOfVendors(client, orgId, [...new Set(need.map((r) => r.vendorId))]);
  for (const r of need) {
    const s = last.get(r.vendorId);
    r.suggestedItemCode = s && owned.has(s) ? s : null;
  }

  return {
    ok: true,
    data: { query, bizType, bizTypeName, counts: { left, total, kinds }, rows, file, codes: { items, itemNames, invDirs } },
  };
}

export async function confirmClassifyOp(
  client: ScopedClient,
  orgId: number,
  rows: readonly ClassifyConfirmRow[],
  actor: string,
): Promise<TaxOp<{ confirmed: number }>> {
  const locked = await lockInvoices(client, orgId, rows.map((r) => r.id));
  if (locked.length !== rows.length) return ROW_NOT_FOUND;
  if (locked.some((r) => r.direction !== TAX_INV_DIR_PURCHASE)) return SALES_INVOICE;
  return { ok: true, data: { confirmed: await setInvoiceItems(client, orgId, rows, actor) } };
}

interface ExportNames {
  invDirs: readonly TaxCodeName[];
  invClasses: readonly TaxCodeName[];
  itemNames: readonly TaxCodeName[];
  /** 시트 이름 — 자료 종류 코드(TAX_KIND INVOICE) 이름. */
  kindName: string;
}

/** 계산서 시트 — 표준 양식 칸(명세 07 §1) + 「항목」(결정). 매입에 항목이 없으면 「분류 필요」, 매출은 구분 이름. */
export function invoiceExportSheet(rows: readonly TaxClassifyRow[], names: ExportNames): XlsxSheet<TaxClassifyRow> {
  const nameOf = (list: readonly TaxCodeName[], code: string) => list.find((c) => c.code === code)?.name ?? code;
  return {
    name: names.kindName,
    columns: [
      { header: '구분', value: (r) => nameOf(names.invDirs, r.direction) },
      { header: '작성일', value: (r) => r.writeDate },
      { header: '승인번호', value: (r) => r.approvalNo },
      { header: '거래처명', value: (r) => r.vendorName },
      { header: '사업자번호', value: (r) => formatBizNumber(r.bizNo) },
      { header: '공급가액', value: (r) => r.supplyAmount },
      { header: '세액', value: (r) => r.taxAmount },
      { header: '종류', value: (r) => nameOf(names.invClasses, r.invClass) },
      {
        header: '항목',
        value: (r) =>
          r.direction === TAX_INV_DIR_PURCHASE ? (r.itemCode ? nameOf(names.itemNames, r.itemCode) : '분류 필요') : nameOf(names.invDirs, r.direction),
      },
    ],
    rows,
  };
}

export async function exportClassifyOp(
  client: ScopedClient,
  orgId: number,
  query: ClassifyQuery,
): Promise<TaxOp<{ fileName: string; bytes: Uint8Array }>> {
  const all = { ...query, view: 'all' as const }; // 엑셀은 「전체」 보기 기준(결과서 S05-05)
  const r = await listClassifyOp(client, orgId, all);
  if (!r.ok) return r;
  const codes = await loadCodeNames(client, [TAX_INV_CLASS_CATEGORY, TAX_KIND_CATEGORY]);
  const kindName = (codes.get(TAX_KIND_CATEGORY) ?? []).find((k) => k.code === TAX_KIND_INVOICE)?.name ?? TAX_KIND_INVOICE;
  const sheet = invoiceExportSheet(r.data.rows, {
    invDirs: r.data.codes.invDirs,
    invClasses: codes.get(TAX_INV_CLASS_CATEGORY) ?? [],
    itemNames: r.data.codes.itemNames,
    kindName,
  });
  return { ok: true, data: { fileName: classifyExportFileName(all), bytes: buildXlsx([sheet]) } };
}

/* ── 라우트 ──────────────────────────────────────────────────────────────── */

/** 바꿔 끼울 수 있는 바깥 — 시험이 DB 없이 주소 · 본문 · 400 · 404 를 본다. */
export interface TaxClassifyDeps {
  /** 본문 검사에 쓰는 그 회사 파티션의 켜진 항목 코드값 — 세무 설정이 없으면 빈 목록. */
  itemCodes(session: ErpSession): Promise<string[]>;
  list(session: ErpSession, query: ClassifyQuery): Promise<TaxOp<TaxClassifyResponse>>;
  confirm(session: ErpSession, rows: ClassifyConfirmRow[]): Promise<TaxOp<{ confirmed: number }>>;
  exportFile(session: ErpSession, query: ClassifyQuery): Promise<TaxOp<{ fileName: string; bytes: Uint8Array }>>;
}

const run = <T>(session: ErpSession, fn: (client: ScopedClient) => Promise<T>) =>
  withCompanyScope(scopeOfSession(session), fn);

const defaultDeps: TaxClassifyDeps = {
  itemCodes: async (session) => (await run(session, (c) => loadItems(c, session.s020OrgId))).items.map((i) => i.code),
  list: (session, query) => runOp(session, (c) => listClassifyOp(c, session.s020OrgId, query)),
  confirm: (session, rows) => runOp(session, (c) => confirmClassifyOp(c, session.s020OrgId, rows, String(session.s020MemberId))),
  exportFile: (session, query) => runOp(session, (c) => exportClassifyOp(c, session.s020OrgId, query)),
};

const invalid = (errors: { field: string; message: string }[]) => ({ error: 'invalid_request', message: errors[0]!.message, errors });

export function registerTaxClassifyRoutes(app: FastifyInstance, deps: TaxClassifyDeps = defaultDeps): void {
  app.get<{ Querystring: Record<string, unknown> }>('/tax/classify', async (req, reply) => {
    const session = requireSession(req);
    reply.header('Cache-Control', 'no-store');
    const parsed = parseClassifyQuery(req.query);
    if (!parsed.ok) return reply.code(400).send(invalid(parsed.errors));
    const r = await deps.list(session, parsed.value);
    if (!r.ok) return reply.code(r.status).send({ error: r.error, message: r.message });
    return reply.send(r.data);
  });

  app.post<{ Body: unknown }>('/tax/classify/confirm', async (req, reply) => {
    const session = requireSession(req);
    reply.header('Cache-Control', 'no-store');
    const parsed = parseClassifyConfirm(req.body, await deps.itemCodes(session));
    if (!parsed.ok) return reply.code(400).send(invalid(parsed.errors));
    const r = await deps.confirm(session, parsed.value);
    if (!r.ok) return reply.code(r.status).send({ error: r.error, message: r.message });
    return reply.send(r.data);
  });

  app.get<{ Querystring: Record<string, unknown> }>('/tax/classify/export', async (req, reply) => {
    const session = requireSession(req);
    reply.header('Cache-Control', 'no-store');
    const parsed = parseClassifyQuery(req.query);
    if (!parsed.ok) return reply.code(400).send(invalid(parsed.errors));
    const r = await deps.exportFile(session, parsed.value);
    if (!r.ok) return reply.code(r.status).send({ error: r.error, message: r.message });
    return sendXlsx(reply, r.data.fileName, r.data.bytes);
  });
}
