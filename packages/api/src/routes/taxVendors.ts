/**
 * 세무 거래처(s050100020, 세무 S05) — 매입 · 매출로 나누지 않는 한 목록 (1-2, 2026-10-26 · 2026-11-07 대표 수정 ③).
 *
 *   GET   /tax/vendors                            목록 전부(종료 여부 · 첫 거래월) · 구분 코드 — 거르기는 화면이 shared `filterVendors` 로
 *   GET   /tax/vendors/export?q&tp&closed         지금 걸린 검색 조건 결과를 엑셀로(목록과 같은 칸, 「거래처_YYYY-MM-DD.xlsx」)
 *   PATCH /tax/vendors/:id { name?, bizNo?, closed? }  이름 · 번호 · 거래 중/종료 — 번호는 숫자만, 끝자리 틀림은 경고만(결정 3)
 *   POST  /tax/vendors/type { ids[], tp }         주거래처 / 일반 — 사용자가 정한 구분(tp_set_by_user = true)
 *   POST  /tax/vendors/close { ids[] }            [거래종료] — 종료로 바꾼다(지우지 않음)
 *
 * ★★★ 운영사 세션도 **자기 단체만** — `org_id = 세션 단체 ID` 를 직접 건다(`db/taxUploads.ts`). 역할로 403 을 내지 않는다.
 * ★ 남의 단체 · 없는 id 는 404 이고 아무것도 쓰지 않는다(둘을 가르지 않는다).
 * ★ 합치기 · 지우기는 없앴다(2026-11-07 대표 결정) — 주소 · 처리 · DB 함수를 함께 지웠다.
 * ★ 종료 여부는 표시 · 거르기만 — 자료 올리기의 거래처 자동 등록 · 연결 규칙은 이 값을 보지 않는다(220).
 */
import type { FastifyInstance } from 'fastify';
import type { ErpSession } from '@swonbiz/shared';
import { formatBizNumber } from '@swonbiz/shared/domain/tax-number';
import {
  TAX_VENDOR_TP_CATEGORY,
  filterVendors,
  parseVendorClose,
  parseVendorEdit,
  parseVendorQuery,
  parseVendorType,
  vendorsExportFileName,
  type TaxCodeName,
  type TaxFieldWarning,
  type TaxVendorView,
  type TaxVendorsResponse,
  type VendorEdit,
  type VendorQuery,
} from '@swonbiz/shared/domain/tax-uploads';
import { requireSession } from '../session/hook.ts';
import { scopeOfSession, withCompanyScope, type ScopedClient } from '../db/withCompanyScope.ts';
import { closeVendors, listVendors, lockVendors, setVendorType, updateVendor } from '../db/taxUploads.ts';
import { buildXlsx, sendXlsx, type XlsxSheet } from '../lib/xlsxExport.ts';
import { loadCodeNames, runOp, type TaxOp } from './taxUploads.ts';

const NOT_FOUND = { ok: false as const, status: 404 as const, error: 'not_found', message: '없는 거래처입니다' };

/** 종료여부 글자 — 화면 목록 · 엑셀이 같은 글자를 쓴다. */
export const vendorClosedLabel = (closed: boolean): string => (closed ? '종료' : '거래 중');

export async function listVendorsOp(client: ScopedClient, orgId: number): Promise<TaxVendorsResponse> {
  const codes = await loadCodeNames(client, [TAX_VENDOR_TP_CATEGORY]);
  return { vendors: await listVendors(client, orgId), codes: { vendorTps: codes.get(TAX_VENDOR_TP_CATEGORY) ?? [] } };
}

export async function editVendorOp(
  client: ScopedClient,
  orgId: number,
  id: string,
  edit: VendorEdit,
  actor: string,
): Promise<TaxOp<TaxVendorView>> {
  if ((await lockVendors(client, orgId, [id])).length !== 1) return NOT_FOUND;
  await updateVendor(client, orgId, id, edit, actor);
  const [v] = await listVendors(client, orgId, [id]);
  return { ok: true, data: v! };
}

export async function setVendorTypeOp(
  client: ScopedClient,
  orgId: number,
  ids: readonly string[],
  tp: string,
  actor: string,
): Promise<TaxOp<{ updated: number }>> {
  if ((await lockVendors(client, orgId, ids)).length !== ids.length) return NOT_FOUND;
  return { ok: true, data: { updated: await setVendorType(client, orgId, ids, tp, actor) } };
}

/** [거래종료] — 모두 이 단체 것일 때만. 하나라도 아니면 아무것도 바꾸지 않는다. */
export async function closeVendorsOp(
  client: ScopedClient,
  orgId: number,
  ids: readonly string[],
  actor: string,
): Promise<TaxOp<{ closed: number }>> {
  if ((await lockVendors(client, orgId, ids)).length !== ids.length) return NOT_FOUND;
  return { ok: true, data: { closed: await closeVendors(client, orgId, ids, actor) } };
}

/** 엑셀 시트 — 목록과 같은 칸: 거래처명 · 사업자번호 · 구분 · 종료여부 · 첫 거래월(없으면 「—」). */
export function vendorsExportSheet(vendors: readonly TaxVendorView[], vendorTps: readonly TaxCodeName[]): XlsxSheet<TaxVendorView> {
  return {
    name: '거래처',
    columns: [
      { header: '거래처명', value: (v) => v.name },
      { header: '사업자번호', value: (v) => (v.bizNo ? formatBizNumber(v.bizNo) : null) },
      { header: '구분', value: (v) => vendorTps.find((c) => c.code === v.vendorTp)?.name ?? v.vendorTp },
      { header: '종료여부', value: (v) => vendorClosedLabel(v.closed) },
      { header: '첫 거래월', value: (v) => v.firstMonth ?? '—' },
    ],
    rows: vendors,
  };
}

/** 오늘 `YYYY-MM-DD` — 서버 시간대의 날짜(파일 이름). */
const today = (d = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** 엑셀 — 지금 걸린 검색 조건 결과(화면과 같은 `filterVendors`). */
export async function exportVendorsOp(
  client: ScopedClient,
  orgId: number,
  query: VendorQuery,
  day: string = today(),
): Promise<TaxOp<{ fileName: string; bytes: Uint8Array }>> {
  const r = await listVendorsOp(client, orgId);
  const bytes = buildXlsx([vendorsExportSheet(filterVendors(r.vendors, query), r.codes.vendorTps)]);
  return { ok: true, data: { fileName: vendorsExportFileName(day), bytes } };
}

/* ── 라우트 ──────────────────────────────────────────────────────────────── */

/** 바꿔 끼울 수 있는 바깥 — 시험이 DB 없이 본문 · 400 · 404 를 본다. */
export interface TaxVendorsDeps {
  /** 본문 검사에 쓰는 살아 있는 구분 코드값(TAX_VENDOR_TP). */
  vendorTps(session: ErpSession): Promise<string[]>;
  list(session: ErpSession): Promise<TaxVendorsResponse>;
  edit(session: ErpSession, id: string, edit: VendorEdit): Promise<TaxOp<TaxVendorView>>;
  setType(session: ErpSession, ids: string[], tp: string): Promise<TaxOp<{ updated: number }>>;
  close(session: ErpSession, ids: string[]): Promise<TaxOp<{ closed: number }>>;
  exportFile(session: ErpSession, query: VendorQuery): Promise<TaxOp<{ fileName: string; bytes: Uint8Array }>>;
}

const run = <T>(session: ErpSession, fn: (client: ScopedClient) => Promise<T>) =>
  withCompanyScope(scopeOfSession(session), fn);
const actorOf = (session: ErpSession) => String(session.s020MemberId);

const defaultDeps: TaxVendorsDeps = {
  vendorTps: async (session) =>
    ((await run(session, (c) => loadCodeNames(c, [TAX_VENDOR_TP_CATEGORY]))).get(TAX_VENDOR_TP_CATEGORY) ?? []).map((c) => c.code),
  list: (session) => run(session, (c) => listVendorsOp(c, session.s020OrgId)),
  edit: (session, id, edit) => runOp(session, (c) => editVendorOp(c, session.s020OrgId, id, edit, actorOf(session))),
  setType: (session, ids, tp) => runOp(session, (c) => setVendorTypeOp(c, session.s020OrgId, ids, tp, actorOf(session))),
  close: (session, ids) => runOp(session, (c) => closeVendorsOp(c, session.s020OrgId, ids, actorOf(session))),
  exportFile: (session, query) => runOp(session, (c) => exportVendorsOp(c, session.s020OrgId, query)),
};

const invalid = (errors: { field: string; message: string }[]) => ({ error: 'invalid_request', message: errors[0]!.message, errors });

export function registerTaxVendorRoutes(app: FastifyInstance, deps: TaxVendorsDeps = defaultDeps): void {
  app.get('/tax/vendors', async (req, reply) => {
    const session = requireSession(req);
    reply.header('Cache-Control', 'no-store');
    return reply.send(await deps.list(session));
  });

  app.get<{ Querystring: Record<string, unknown> }>('/tax/vendors/export', async (req, reply) => {
    const session = requireSession(req);
    reply.header('Cache-Control', 'no-store');
    const r = await deps.exportFile(session, parseVendorQuery(req.query));
    if (!r.ok) return reply.code(r.status).send({ error: r.error, message: r.message });
    return sendXlsx(reply, r.data.fileName, r.data.bytes);
  });

  app.patch<{ Params: { id: string }; Body: unknown }>('/tax/vendors/:id', async (req, reply) => {
    const session = requireSession(req);
    reply.header('Cache-Control', 'no-store');
    const parsed = parseVendorEdit(req.body);
    if (!parsed.ok) return reply.code(400).send(invalid(parsed.errors));
    const r = await deps.edit(session, req.params.id, parsed.value);
    if (!r.ok) return reply.code(r.status).send({ error: r.error, message: r.message });
    const warnings: TaxFieldWarning[] = parsed.warnings;
    return reply.send({ vendor: r.data, warnings });
  });

  app.post<{ Body: unknown }>('/tax/vendors/type', async (req, reply) => {
    const session = requireSession(req);
    reply.header('Cache-Control', 'no-store');
    const parsed = parseVendorType(req.body, await deps.vendorTps(session));
    if (!parsed.ok) return reply.code(400).send(invalid(parsed.errors));
    const r = await deps.setType(session, parsed.value.ids, parsed.value.tp);
    if (!r.ok) return reply.code(r.status).send({ error: r.error, message: r.message });
    return reply.send(r.data);
  });

  app.post<{ Body: unknown }>('/tax/vendors/close', async (req, reply) => {
    const session = requireSession(req);
    reply.header('Cache-Control', 'no-store');
    const parsed = parseVendorClose(req.body);
    if (!parsed.ok) return reply.code(400).send(invalid(parsed.errors));
    const r = await deps.close(session, parsed.value);
    if (!r.ok) return reply.code(r.status).send({ error: r.error, message: r.message });
    return reply.send(r.data);
  });
}
