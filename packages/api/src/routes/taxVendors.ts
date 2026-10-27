/**
 * 세무 거래처(s050100020, 세무 S05) — 매입 · 매출로 나누지 않는 한 목록 (1-2, 2026-10-26).
 *
 *   GET   /tax/vendors?month=YYYY-MM          목록 · 그 달 건수 · 모든 달 건수 · 같은 사업자번호 묶음 · 코드
 *   PATCH /tax/vendors/:id { name?, bizNo? }   이름 · 번호 고치기 — 번호는 숫자만, 끝자리 틀림은 경고만(결정 3)
 *   POST  /tax/vendors/type { ids[], tp }      주거래처 / 일반 — 사용자가 정한 구분(tp_set_by_user = true)
 *   POST  /tax/vendors/merge { keepId, ids[] } 합치기 — 계산서를 남길 곳으로 옮기고 합친 곳을 지운다
 *   POST  /tax/vendors/delete { ids[] }        지우기 — 모두 거래 0건(전체 기간)일 때만, 하나라도 걸리면 409 · 아무것도 안 지움
 *
 * ★★★ 운영사 세션도 **자기 단체만** — `org_id = 세션 단체 ID` 를 직접 건다(`db/taxUploads.ts`). 역할로 403 을 내지 않는다.
 * ★ 남의 단체 · 없는 id 는 404 이고 아무것도 쓰지 않는다(둘을 가르지 않는다).
 * ★ 합치기 결과: 하나라도 주거래처면 주거래처, 남길 곳 번호가 비면 합칠 곳 중 먼저 고른 곳의 번호.
 *   사용자가 정한 구분 표시(tp_set_by_user)는 하나라도 사용자가 정했으면 남긴다 — 업로드가 다시 바꾸지 않게.
 */
import type { FastifyInstance } from 'fastify';
import type { ErpSession } from '@swonbiz/shared';
import { TAX_KIND_CATEGORY } from '@swonbiz/shared/domain/tax-settings';
import {
  TAX_INV_DIR_CATEGORY,
  TAX_VENDOR_MAIN,
  TAX_VENDOR_TP_CATEGORY,
  parseMonth,
  parseVendorEdit,
  parseVendorIds,
  parseVendorMerge,
  parseVendorType,
  type TaxFieldWarning,
  type TaxVendorView,
  type TaxVendorsResponse,
  type VendorEdit,
} from '@swonbiz/shared/domain/tax-uploads';
import { requireSession } from '../session/hook.ts';
import { scopeOfSession, withCompanyScope, type ScopedClient } from '../db/withCompanyScope.ts';
import {
  deleteVendors,
  listVendors,
  lockVendors,
  moveInvoicesToVendor,
  setVendorType,
  updateMergedVendor,
  updateVendor,
} from '../db/taxUploads.ts';
import { loadCodeNames, runOp, type TaxOp } from './taxUploads.ts';

const NOT_FOUND = { ok: false as const, status: 404 as const, error: 'not_found', message: '없는 거래처입니다' };
const HAS_INVOICES = {
  ok: false as const, status: 409 as const, error: 'vendor_has_invoices', message: '거래가 있는 거래처는 지울 수 없습니다',
};

/** 같은 사업자번호 거래처 묶음 — 목록 순서(먼저 생긴 순) 그대로. */
export function sameBizNoGroups(vendors: readonly TaxVendorView[]): string[][] {
  const by = new Map<string, string[]>();
  for (const v of vendors) if (v.bizNo) by.set(v.bizNo, [...(by.get(v.bizNo) ?? []), v.id]);
  return [...by.values()].filter((ids) => ids.length > 1);
}

/** 오늘 달 — 고친 뒤 돌려주는 한 줄의 「그 달 건수」 기준. 화면은 목록을 다시 읽는다. */
const thisMonth = (): string => new Date().toISOString().slice(0, 7);

export async function listVendorsOp(client: ScopedClient, orgId: number, month: string): Promise<TaxVendorsResponse> {
  const codes = await loadCodeNames(client, [TAX_VENDOR_TP_CATEGORY, TAX_KIND_CATEGORY, TAX_INV_DIR_CATEGORY]);
  const vendors = await listVendors(client, orgId, month);
  return {
    month,
    vendors,
    sameBizNoGroups: sameBizNoGroups(vendors),
    codes: {
      vendorTps: codes.get(TAX_VENDOR_TP_CATEGORY) ?? [],
      kinds: codes.get(TAX_KIND_CATEGORY) ?? [],
      invDirs: codes.get(TAX_INV_DIR_CATEGORY) ?? [],
    },
  };
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
  const [v] = await listVendors(client, orgId, thisMonth(), [id]);
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

export async function mergeVendorsOp(
  client: ScopedClient,
  orgId: number,
  keepId: string,
  ids: readonly string[],
  actor: string,
): Promise<TaxOp<{ vendor: TaxVendorView; movedRows: number }>> {
  const locked = await lockVendors(client, orgId, [keepId, ...ids]);
  if (locked.length !== ids.length + 1) return NOT_FOUND;
  const keep = locked.find((v) => v.id === keepId)!;
  const others = ids.map((id) => locked.find((v) => v.id === id)!);

  const movedRows = await moveInvoicesToVendor(client, orgId, keepId, ids);
  const all = [keep, ...others];
  await updateMergedVendor(client, orgId, keepId, {
    vendorTp: all.some((v) => v.vendorTp === TAX_VENDOR_MAIN) ? TAX_VENDOR_MAIN : keep.vendorTp,
    tpSetByUser: all.some((v) => v.tpSetByUser),
    bizNo: keep.bizNo ?? others.find((v) => v.bizNo)?.bizNo ?? null,
  }, actor);
  await deleteVendors(client, orgId, ids);
  const [vendor] = await listVendors(client, orgId, thisMonth(), [keepId]);
  return { ok: true, data: { vendor: vendor!, movedRows } };
}

/** 지우기 — 모두 이 단체 것이고 모두 거래 0건(전체 기간)일 때만. 하나라도 걸리면 아무것도 지우지 않는다. */
export async function deleteVendorsOp(
  client: ScopedClient,
  orgId: number,
  ids: readonly string[],
): Promise<TaxOp<{ deleted: number }>> {
  if ((await lockVendors(client, orgId, ids)).length !== ids.length) return NOT_FOUND;
  const vendors = await listVendors(client, orgId, thisMonth(), ids);
  if (vendors.some((v) => v.totalCount > 0)) return HAS_INVOICES;
  return { ok: true, data: { deleted: await deleteVendors(client, orgId, ids) } };
}

/* ── 라우트 ──────────────────────────────────────────────────────────────── */

/** 바꿔 끼울 수 있는 바깥 — 시험이 DB 없이 본문 · 400 · 404 를 본다. */
export interface TaxVendorsDeps {
  /** 본문 검사에 쓰는 살아 있는 구분 코드값(TAX_VENDOR_TP). */
  vendorTps(session: ErpSession): Promise<string[]>;
  list(session: ErpSession, month: string): Promise<TaxVendorsResponse>;
  edit(session: ErpSession, id: string, edit: VendorEdit): Promise<TaxOp<TaxVendorView>>;
  setType(session: ErpSession, ids: string[], tp: string): Promise<TaxOp<{ updated: number }>>;
  merge(session: ErpSession, keepId: string, ids: string[]): Promise<TaxOp<{ vendor: TaxVendorView; movedRows: number }>>;
  remove(session: ErpSession, ids: string[]): Promise<TaxOp<{ deleted: number }>>;
}

const run = <T>(session: ErpSession, fn: (client: ScopedClient) => Promise<T>) =>
  withCompanyScope(scopeOfSession(session), fn);
const actorOf = (session: ErpSession) => String(session.s020MemberId);

const defaultDeps: TaxVendorsDeps = {
  vendorTps: async (session) =>
    ((await run(session, (c) => loadCodeNames(c, [TAX_VENDOR_TP_CATEGORY]))).get(TAX_VENDOR_TP_CATEGORY) ?? []).map((c) => c.code),
  list: (session, month) => run(session, (c) => listVendorsOp(c, session.s020OrgId, month)),
  edit: (session, id, edit) => runOp(session, (c) => editVendorOp(c, session.s020OrgId, id, edit, actorOf(session))),
  setType: (session, ids, tp) => runOp(session, (c) => setVendorTypeOp(c, session.s020OrgId, ids, tp, actorOf(session))),
  merge: (session, keepId, ids) => runOp(session, (c) => mergeVendorsOp(c, session.s020OrgId, keepId, ids, actorOf(session))),
  remove: (session, ids) => runOp(session, (c) => deleteVendorsOp(c, session.s020OrgId, ids)),
};

const invalid = (errors: { field: string; message: string }[]) => ({ error: 'invalid_request', message: errors[0]!.message, errors });

export function registerTaxVendorRoutes(app: FastifyInstance, deps: TaxVendorsDeps = defaultDeps): void {
  app.get<{ Querystring: { month?: string } }>('/tax/vendors', async (req, reply) => {
    const session = requireSession(req);
    reply.header('Cache-Control', 'no-store');
    const month = parseMonth(req.query.month);
    if (!month) return reply.code(400).send(invalid([{ field: 'month', message: '작업할 달은 YYYY-MM 입니다' }]));
    return reply.send(await deps.list(session, month));
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

  app.post<{ Body: unknown }>('/tax/vendors/merge', async (req, reply) => {
    const session = requireSession(req);
    reply.header('Cache-Control', 'no-store');
    const parsed = parseVendorMerge(req.body);
    if (!parsed.ok) return reply.code(400).send(invalid(parsed.errors));
    const r = await deps.merge(session, parsed.value.keepId, parsed.value.ids);
    if (!r.ok) return reply.code(r.status).send({ error: r.error, message: r.message });
    return reply.send(r.data);
  });

  app.post<{ Body: unknown }>('/tax/vendors/delete', async (req, reply) => {
    const session = requireSession(req);
    reply.header('Cache-Control', 'no-store');
    const parsed = parseVendorIds(req.body);
    if (!parsed.ok) return reply.code(400).send(invalid(parsed.errors));
    const r = await deps.remove(session, parsed.value);
    if (!r.ok) return reply.code(r.status).send({ error: r.error, message: r.message });
    return reply.send(r.data);
  });
}
