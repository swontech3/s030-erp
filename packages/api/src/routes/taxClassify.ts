/**
 * 세무 거래 분류(s050300010, 세무 S05) — 1-3 (2026-10-27). 결과서 S05-05.
 *
 *   GET  /tax/classify?month&view&kind&from&to&file   목록 · 확인할 줄 수 · 자료 종류 칩 수 · 항목 코드 · 파일 띠
 *   POST /tax/classify/confirm { rows: [{ kind, id, itemCode }] }   [확정] · [선택한 줄에 붙이기] — 한 트랜잭션, 다시 확정하면 덮음
 *   GET  /tax/classify/export?…(목록과 같은 주소)        「전체」 보기 거르기 결과를 엑셀로(ERP 공통 부품 `lib/xlsxExport.ts`)
 *
 * ★★★ 운영사 세션도 **자기 단체만** — `org_id = 세션 단체 ID` 를 직접 건다(`db/taxClassify.ts`). 역할로 403 을 내지 않는다.
 * ★ 남의 단체 · 없는 줄 · 없는 파일은 404 이고 아무것도 쓰지 않는다(둘을 가르지 않는다).
 * ★ 「확인할 줄」 = 항목이 빈 매입 줄 — 매입 계산서 · 카드 줄 · 현금 매입 줄(1-4). 매출(계산서 · 현금)은 항목이 없다
 *   (코드 TAX_INV_DIR 이름 「매출」로 보인다). 줄은 (kind, id) 로 가리킨다(표가 셋). 삐용 경비 · 은행 칩은 0건(뒤 단계).
 * ★ 거래처 기억은 저장하지 않는다 — 가장 최근 확정 항목을 골라 두기만(그 회사 목록에 있는 항목만).
 *   계산서 · 카드는 같은 거래처(두 표를 함께), 현금은 같은 거래처 글의 현금 줄(결정 8).
 */
import type { FastifyInstance } from 'fastify';
import type { ErpSession } from '@swonbiz/shared';
import { formatBizNumber } from '@swonbiz/shared/domain/tax-number';
import { TAX_BIZ_TP_CATEGORY, TAX_KIND_CATEGORY } from '@swonbiz/shared/domain/tax-settings';
import {
  TAX_CARD_DEDUCT_CATEGORY,
  TAX_PAY_METHOD_CATEGORY,
  TAX_PROOF_CATEGORY,
} from '@swonbiz/shared/domain/tax-card-cash';
import {
  CLASSIFY_KINDS,
  CLASSIFY_ROW_KINDS,
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
  type ClassifyRowKind,
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
  countCardCash,
  countClassify,
  countInvoicesByDirection,
  findUploadFileById,
  listCategoryNames,
  lastItemsOfCashVendors,
  lastItemsOfVendors,
  listClassifyCards,
  listClassifyCash,
  listClassifyInvoices,
  lockClassifyRows,
  setClassifyItems,
} from '../db/taxClassify.ts';
import { buildXlsx, sendXlsx, type XlsxSheet } from '../lib/xlsxExport.ts';
import { loadCodeNames, runOp, type TaxOp, type TaxOpFail } from './taxUploads.ts';

const FILE_NOT_FOUND = { ok: false as const, status: 404 as const, error: 'not_found', message: '없는 파일입니다' };
const ROW_NOT_FOUND = { ok: false as const, status: 404 as const, error: 'not_found', message: '없는 줄입니다' };
const SALES_INVOICE: TaxOpFail = {
  ok: false, status: 400, error: 'sales_invoice', message: '매출 계산서에는 항목을 붙이지 않습니다',
};

/* ── 항목 코드 ───────────────────────────────────────────────────────────── */

/** 그 회사 사업자 유형 파티션의 켜진 항목 — 설정이 없으면 빈 목록. */
export async function loadItems(client: ScopedClient, orgId: number): Promise<{ bizType: string | null; items: TaxItemOption[] }> {
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

/** 날짜 최신순 — 같은 날은 계산서 · 카드 · 현금 순(각 표 안의 순서는 그대로, 안정 정렬). */
const byDateDesc = (rows: TaxClassifyRow[]): TaxClassifyRow[] => rows.sort((a, b) => b.writeDate.localeCompare(a.writeDate));

export async function listClassifyOp(client: ScopedClient, orgId: number, query: ClassifyQuery): Promise<TaxOp<TaxClassifyResponse>> {
  const file = query.fileId ? await findUploadFileById(client, orgId, query.fileId) : null;
  if (query.fileId && !file) return FILE_NOT_FOUND;

  const { bizType, items } = await loadItems(client, orgId);
  const itemNames = await loadItemNames(client, items);
  const names = await loadCodeNames(client, [TAX_INV_DIR_CATEGORY, TAX_BIZ_TP_CATEGORY, TAX_KIND_CATEGORY]);
  const invDirs = names.get(TAX_INV_DIR_CATEGORY) ?? [];
  const kindNames = names.get(TAX_KIND_CATEGORY) ?? [];
  const bizTypeName = (names.get(TAX_BIZ_TP_CATEGORY) ?? []).find((b) => b.code === bizType)?.name ?? null;

  const { left, total } = await countClassify(client, orgId, query.month);
  const base = { range: classifyDateRange(query), fileId: query.fileId, direction: null };
  const byDir = await countInvoicesByDirection(client, orgId, base);
  const cc = await countCardCash(client, orgId, base);
  const kinds = Object.fromEntries(CLASSIFY_KINDS.map((k) => [k, 0])) as Record<ClassifyKind, number>;
  kinds.P = byDir.get(TAX_INV_DIR_PURCHASE) ?? 0;
  kinds.S = byDir.get(TAX_INV_DIR_SALES) ?? 0;
  kinds.CARD = cc.card;
  kinds.CASH = cc.cash;
  kinds.all = kinds.P + kinds.S + kinds.CARD + kinds.CASH;

  let rows: TaxClassifyRow[];
  if (query.view === 'left') {
    // 미지정 건 · 지정 건 — 그 달 매입(계산서 · 카드 · 현금 매입)
    const month = { range: monthRange(query.month), fileId: null, direction: TAX_INV_DIR_PURCHASE };
    rows = byDateDesc([
      ...(await listClassifyInvoices(client, orgId, month)),
      ...(await listClassifyCards(client, orgId, month)),
      ...(await listClassifyCash(client, orgId, month)),
    ]);
  } else if (query.kind === 'all') {
    rows = byDateDesc([
      ...(await listClassifyInvoices(client, orgId, base)),
      ...(await listClassifyCards(client, orgId, base)),
      ...(await listClassifyCash(client, orgId, base)),
    ]);
  } else if (query.kind === TAX_INV_DIR_PURCHASE || query.kind === TAX_INV_DIR_SALES) {
    rows = await listClassifyInvoices(client, orgId, { ...base, direction: query.kind });
  } else if (query.kind === 'CARD') {
    rows = await listClassifyCards(client, orgId, base);
  } else if (query.kind === 'CASH') {
    rows = await listClassifyCash(client, orgId, base);
  } else {
    rows = []; // 삐용 경비 · 은행 — 뒤 단계
  }

  // 지난번 항목 — 계산서 · 카드는 거래처, 현금은 거래처 글. 그 회사 목록에 있는 항목만 골라 둔다
  const owned = new Set(items.map((i) => i.code));
  const need = rows.filter((r) => r.direction === TAX_INV_DIR_PURCHASE && r.itemCode === null);
  const byVendor = await lastItemsOfVendors(client, orgId, [...new Set(need.flatMap((r) => (r.vendorId ? [r.vendorId] : [])))]);
  const cashName = (r: TaxClassifyRow) => (r.kind === 'CASH' ? r.vendorName.trim() : '');
  const byCashName = await lastItemsOfCashVendors(client, orgId, [...new Set(need.map(cashName).filter((n) => n !== ''))]);
  for (const r of need) {
    const s = r.kind === 'CASH' ? (cashName(r) ? byCashName.get(cashName(r)) : undefined) : r.vendorId ? byVendor.get(r.vendorId) : undefined;
    r.suggestedItemCode = s && owned.has(s) ? s : null;
  }

  return {
    ok: true,
    data: { query, bizType, bizTypeName, counts: { left, total, kinds }, rows, file, codes: { items, itemNames, invDirs, kinds: kindNames } },
  };
}

const SALES_OF: Readonly<Record<ClassifyRowKind, TaxOpFail>> = {
  INVOICE: SALES_INVOICE,
  CARD: SALES_INVOICE, // 카드 줄은 늘 매입이라 오지 않는다
  CASH: { ok: false, status: 400, error: 'sales_cash', message: '현금 매출에는 항목을 붙이지 않습니다' },
};

/** 확정 — 자료 종류마다 그 표에서 잠그고, 모두 이 단체의 매입 줄일 때만 쓴다(하나라도 아니면 아무것도 쓰지 않는다). */
export async function confirmClassifyOp(
  client: ScopedClient,
  orgId: number,
  rows: readonly ClassifyConfirmRow[],
  actor: string,
): Promise<TaxOp<{ confirmed: number }>> {
  const groups = CLASSIFY_ROW_KINDS.map((kind) => ({ kind, rows: rows.filter((r) => r.kind === kind) })).filter((g) => g.rows.length > 0);
  const locked = [];
  for (const g of groups) locked.push({ kind: g.kind, rows: await lockClassifyRows(client, orgId, g.kind, g.rows.map((r) => r.id)) });
  if (locked.reduce((n, g) => n + g.rows.length, 0) !== rows.length) return ROW_NOT_FOUND;
  const sales = locked.find((g) => g.rows.some((r) => r.direction !== TAX_INV_DIR_PURCHASE));
  if (sales) return SALES_OF[sales.kind];
  let confirmed = 0;
  for (const g of groups) confirmed += await setClassifyItems(client, orgId, g.kind, g.rows, actor);
  return { ok: true, data: { confirmed } };
}

interface ExportNames {
  invDirs: readonly TaxCodeName[];
  invClasses: readonly TaxCodeName[];
  itemNames: readonly TaxCodeName[];
  /** 시트 이름 — 자료 종류 코드(TAX_KIND INVOICE) 이름. */
  kindName: string;
}

const nameOf = (list: readonly TaxCodeName[], code: string) => list.find((c) => c.code === code)?.name ?? code;
const itemOrNeed = (itemNames: readonly TaxCodeName[], code: string | null) => (code ? nameOf(itemNames, code) : '분류 필요');

/** 계산서 시트 — 표준 양식 칸(명세 07 §1) + 「항목」(결정). 매입에 항목이 없으면 「분류 필요」, 매출은 구분 이름. */
export function invoiceExportSheet(rows: readonly TaxClassifyRow[], names: ExportNames): XlsxSheet<TaxClassifyRow> {
  return {
    name: names.kindName,
    columns: [
      { header: '구분', value: (r) => nameOf(names.invDirs, r.direction) },
      { header: '작성일', value: (r) => r.writeDate },
      { header: '승인번호', value: (r) => r.approvalNo },
      { header: '거래처명', value: (r) => r.vendorName },
      { header: '사업자번호', value: (r) => (r.bizNo ? formatBizNumber(r.bizNo) : null) },
      { header: '공급가액', value: (r) => r.supplyAmount },
      { header: '세액', value: (r) => r.taxAmount },
      { header: '종류', value: (r) => (r.invClass ? nameOf(names.invClasses, r.invClass) : null) },
      {
        header: '항목',
        value: (r) => (r.direction === TAX_INV_DIR_PURCHASE ? itemOrNeed(names.itemNames, r.itemCode) : nameOf(names.invDirs, r.direction)),
      },
    ],
    rows,
  };
}

/** 카드 줄의 「카드」 칸 — 별칭이 있으면 「별칭 · 끝 4821」, 없으면 「끝 4821」. ★ 끝 4자리만. */
export const cardLabelOf = (r: Pick<TaxClassifyRow, 'cardLast4' | 'cardAlias'>): string =>
  r.cardAlias ? `${r.cardAlias} · 끝 ${r.cardLast4}` : `끝 ${r.cardLast4}`;

/** 카드 사용 내역 시트(1-4) — 사용일 · 카드 · 가맹점명 · 사업자번호 · 공급가액 · 세액 · 합계 · 공제 여부 · 항목. */
export function cardExportSheet(
  rows: readonly TaxClassifyRow[],
  names: { kindName: string; itemNames: readonly TaxCodeName[]; deducts: readonly TaxCodeName[] },
): XlsxSheet<TaxClassifyRow> {
  return {
    name: names.kindName,
    columns: [
      { header: '사용일', value: (r) => r.writeDate },
      { header: '카드', value: cardLabelOf },
      { header: '가맹점명', value: (r) => r.vendorName },
      { header: '사업자번호', value: (r) => (r.bizNo ? formatBizNumber(r.bizNo) : null) },
      { header: '공급가액', value: (r) => r.supplyAmount },
      { header: '세액', value: (r) => r.taxAmount },
      { header: '합계', value: (r) => r.totalAmount },
      { header: '공제 여부', value: (r) => (r.vatDeduct ? nameOf(names.deducts, r.vatDeduct) : null) },
      { header: '항목', value: (r) => itemOrNeed(names.itemNames, r.itemCode) },
    ],
    rows,
  };
}

/**
 * 현금 경비 시트(1-4) — 날짜 · 품명 · 거래처 · 구분 · 금액 · 결제방법 · 증빙 · 항목(매출은 구분 이름).
 * ★ 결제방법 · 증빙 칸 이름은 코드 분류(TAX_PAY_METHOD · TAX_PROOF) 이름 — 글자로 박지 않는다(1-4 보완).
 */
export function cashExportSheet(
  rows: readonly TaxClassifyRow[],
  names: {
    kindName: string;
    itemNames: readonly TaxCodeName[];
    invDirs: readonly TaxCodeName[];
    payMethods: readonly TaxCodeName[];
    proofs: readonly TaxCodeName[];
    /** 코드 분류 TAX_PAY_METHOD 이름. */
    payMethodHeader: string;
    /** 코드 분류 TAX_PROOF 이름. */
    proofHeader: string;
  },
): XlsxSheet<TaxClassifyRow> {
  return {
    name: names.kindName,
    columns: [
      { header: '날짜', value: (r) => r.writeDate },
      { header: '품명', value: (r) => r.description },
      { header: '거래처', value: (r) => r.vendorName },
      { header: '구분', value: (r) => nameOf(names.invDirs, r.direction) },
      { header: '금액', value: (r) => r.totalAmount },
      { header: names.payMethodHeader, value: (r) => (r.payMethod ? nameOf(names.payMethods, r.payMethod) : null) },
      { header: names.proofHeader, value: (r) => (r.proof ? nameOf(names.proofs, r.proof) : null) },
      {
        header: '항목',
        value: (r) => (r.direction === TAX_INV_DIR_PURCHASE ? itemOrNeed(names.itemNames, r.itemCode) : nameOf(names.invDirs, r.direction)),
      },
    ],
    rows,
  };
}

/**
 * 엑셀 — 「전체」 보기 거르기 결과. 시트는 자료 종류마다(계산서 · 카드 · 현금, 이름 = 자료 종류 코드 이름).
 * 자료 종류를 걸면 그 시트만(매입 · 매출은 계산서 시트). 삐용 경비 · 은행은 아직 자료가 없어 빈 계산서 시트 하나.
 */
export async function exportClassifyOp(
  client: ScopedClient,
  orgId: number,
  query: ClassifyQuery,
): Promise<TaxOp<{ fileName: string; bytes: Uint8Array }>> {
  const all = { ...query, view: 'all' as const }; // 엑셀은 「전체」 보기 기준(결과서 S05-05)
  const r = await listClassifyOp(client, orgId, all);
  if (!r.ok) return r;
  const codes = await loadCodeNames(client, [TAX_INV_CLASS_CATEGORY, TAX_CARD_DEDUCT_CATEGORY, TAX_PAY_METHOD_CATEGORY, TAX_PROOF_CATEGORY]);
  const kindName = (code: string) => r.data.codes.kinds.find((k) => k.code === code)?.name ?? code;
  const of = (kind: ClassifyRowKind) => r.data.rows.filter((x) => x.kind === kind);
  const { invDirs, itemNames } = r.data.codes;
  const k = query.kind;

  const sheets: XlsxSheet<TaxClassifyRow>[] = [];
  if (k === 'all' || k === TAX_INV_DIR_PURCHASE || k === TAX_INV_DIR_SALES) {
    sheets.push(invoiceExportSheet(of('INVOICE'), {
      invDirs, invClasses: codes.get(TAX_INV_CLASS_CATEGORY) ?? [], itemNames, kindName: kindName(TAX_KIND_INVOICE),
    }));
  }
  if (k === 'all' || k === 'CARD') {
    sheets.push(cardExportSheet(of('CARD'), { kindName: kindName('CARD'), itemNames, deducts: codes.get(TAX_CARD_DEDUCT_CATEGORY) ?? [] }));
  }
  if (k === 'all' || k === 'CASH') {
    const heads = await listCategoryNames(client, [TAX_PAY_METHOD_CATEGORY, TAX_PROOF_CATEGORY]);
    sheets.push(cashExportSheet(of('CASH'), {
      kindName: kindName('CASH'), itemNames, invDirs,
      payMethods: codes.get(TAX_PAY_METHOD_CATEGORY) ?? [], proofs: codes.get(TAX_PROOF_CATEGORY) ?? [],
      payMethodHeader: heads.get(TAX_PAY_METHOD_CATEGORY) ?? TAX_PAY_METHOD_CATEGORY,
      proofHeader: heads.get(TAX_PROOF_CATEGORY) ?? TAX_PROOF_CATEGORY,
    }));
  }
  if (sheets.length === 0) {
    sheets.push(invoiceExportSheet([], {
      invDirs, invClasses: codes.get(TAX_INV_CLASS_CATEGORY) ?? [], itemNames, kindName: kindName(TAX_KIND_INVOICE),
    }));
  }
  return { ok: true, data: { fileName: classifyExportFileName(all), bytes: buildXlsx(sheets) } };
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
