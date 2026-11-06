/**
 * 세무 월별 손익(s050400010, 세무 S05) — 1-8 (2026-11-05). 읽기만.
 *
 *   GET /tax/pl?month    작업할 달 해의 막대(1~12월) + 그 달 내역(매출 · 비용 · 사업과 무관 · 미지정 건) + 올해 누적
 *
 * ★★★ 운영사 세션도 **자기 단체만** — `org_id = 세션 단체 ID` 를 직접 건다(`db/taxPl.ts`). 역할로 403 을 내지 않는다.
 * ★ 계산은 shared `tax-pl.ts`(`buildPl`) 한 곳. 항목 이름은 그 회사 사업자 유형의 출금 항목 코드 이름, 비용이 아닌 세목은 코드 이름으로 견준다.
 * ★ 손익 엑셀은 시안에 없어 만들지 않는다(1-8 설계 5).
 */
import type { FastifyInstance } from 'fastify';
import type { ErpSession } from '@swonbiz/shared';
import { TAX_BIZ_TP_CATEGORY } from '@swonbiz/shared/domain/tax-settings';
import { TAX_TAX_NOEXP_CATEGORY } from '@swonbiz/shared/domain/tax-pay-social-loan';
import { buildPl, type TaxPlResponse } from '@swonbiz/shared/domain/tax-pl';
import { parseMonth } from '@swonbiz/shared/domain/tax-uploads';
import { requireSession } from '../session/hook.ts';
import type { ScopedClient } from '../db/withCompanyScope.ts';
import { readPlSources } from '../db/taxPl.ts';
import { loadItems } from './taxClassify.ts';
import { loadCodeNames, runOp, type TaxOp } from './taxUploads.ts';

export async function plOp(client: ScopedClient, orgId: number, month: string): Promise<TaxOp<TaxPlResponse>> {
  const year = month.slice(0, 4);
  const src = await readPlSources(client, orgId, [`${year}-01-01`, `${Number(year) + 1}-01-01`]);
  const { bizType, items } = await loadItems(client, orgId);
  const names = await loadCodeNames(client, [TAX_TAX_NOEXP_CATEGORY, TAX_BIZ_TP_CATEGORY]);
  const noExpNames = (names.get(TAX_TAX_NOEXP_CATEGORY) ?? []).map((c) => c.name);
  const bizTypeName = (names.get(TAX_BIZ_TP_CATEGORY) ?? []).find((b) => b.code === bizType)?.name ?? null;
  return { ok: true, data: { month, bizTypeName, pl: buildPl(src, { month, items, noExpNames }) } };
}

/** 바꿔 끼울 수 있는 바깥 — 시험이 DB 없이 주소 · 400 을 본다. */
export interface TaxPlDeps {
  get(session: ErpSession, month: string): Promise<TaxOp<TaxPlResponse>>;
}

const defaultDeps: TaxPlDeps = {
  get: (session, month) => runOp(session, (c) => plOp(c, session.s020OrgId, month)),
};

export function registerTaxPlRoutes(app: FastifyInstance, deps: TaxPlDeps = defaultDeps): void {
  app.get<{ Querystring: Record<string, unknown> }>('/tax/pl', async (req, reply) => {
    const session = requireSession(req);
    reply.header('Cache-Control', 'no-store');
    const month = parseMonth(req.query.month);
    if (!month) {
      const errors = [{ field: 'month', message: '작업할 달은 YYYY-MM 입니다' }];
      return reply.code(400).send({ error: 'invalid_request', message: errors[0]!.message, errors });
    }
    const r = await deps.get(session, month);
    if (!r.ok) return reply.code(r.status).send({ error: r.error, message: r.message });
    return reply.send(r.data);
  });
}
