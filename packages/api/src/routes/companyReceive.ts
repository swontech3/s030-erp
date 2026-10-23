/**
 * 입주사 회사 · 직원 「받기」 — 삐용이 회사 · 직원 정보를 고쳤을 때 부른다(결정 2026-10-23).
 *
 *   POST /companies/bbiyong/org-changed      { orgId, orgCode?, orgName?, bizNumber?, corpNumber?, businessType?, businessItem? }
 *   POST /companies/bbiyong/member-changed   { memberId, orgId?, orgCode?, memberName?, email?, hpNo? }
 *                                            Authorization: Bearer <삐용 accessToken>
 *
 * ★★ ERP 세션(쿠키)이 없는 호출이다 — `config.public` 이고, 부르는 쪽 확인은 실어 온 삐용 토큰으로
 *    한다(`bbiyong/receiveCaller.ts`). 판정은 `companies/companyReceive.ts` · `companies/memberReceive.ts`
 *    가 하고, 이 파일은 넘기고 돌려줄 뿐이다.
 * ★★ 받은 값을 삐용에 다시 보내지 않는다 — `pushCompanyOrg` · `syncMembersForCompany` 를 부르지 않는다.
 * ★ 경로가 `/companies/:id/bbiyong-link` 와 겹치지 않는다 — 둘째 칸이 고정 문자열(`bbiyong`)이라
 *   find-my-way 가 `:id` 보다 먼저 고른다.
 * 삐용 팀에 넘기는 규격: `doc/연동규격_입주사_회사정보_받기.md` · `doc/연동규격_입주사_직원정보_받기.md`.
 */
import type { FastifyInstance } from 'fastify';
import type { CompanyScope } from '../db/withCompanyScope.ts';
import { bbiyongAuth } from '../bbiyong/index.ts';
import { findCompanyIdByOrgId, patchCompanyFromBbiyong } from '../db/companies.ts';
import { withCompanyScope } from '../db/withCompanyScope.ts';
import { receiveCompany, type CompanyReceiveDeps } from '../companies/companyReceive.ts';

/** `updated_by` 에 남기는 값 — 삐용이 보낸 줄이라는 표시(회원번호는 내 메뉴가 주지 않는다). */
export const RECEIVE_ACTOR = 'bbiyong';

/** 운영사 스코프 — 회사 표 쓰기는 운영사만 된다(006 RLS). */
export const RECEIVE_SCOPE: CompanyScope = { role: 'operator', companyId: null };

/** Postgres 의 UNIQUE 위반(`23505`)인가 — 문구가 아니라 코드로 본다(`routes/companies.ts` 와 같다). */
const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505';

const defaultCompanyDeps: CompanyReceiveDeps = {
  myMenus: (token) => bbiyongAuth.myMenus(token),
  // ★★ try/catch 가 트랜잭션 **밖**이어야 한다 — 안에서 삼키면 abort 된 트랜잭션에 COMMIT 을 부른다.
  apply: async (orgId, fields) => {
    try {
      return await withCompanyScope(RECEIVE_SCOPE, async (client) => {
        const companyId = await findCompanyIdByOrgId(client, orgId);
        if (companyId === null) return 'not_found' as const;
        const n = await patchCompanyFromBbiyong(client, { companyId, fields, actor: RECEIVE_ACTOR });
        return n > 0 ? ('applied' as const) : ('not_found' as const);
      });
    } catch (err) {
      if (isUniqueViolation(err)) return 'duplicate';
      throw err;
    }
  },
};

export function registerCompanyReceiveRoutes(
  app: FastifyInstance,
  deps: { company: CompanyReceiveDeps } = { company: defaultCompanyDeps },
): void {
  app.post('/companies/bbiyong/org-changed', { config: { public: true } }, async (req, reply) => {
    const out = await receiveCompany(req.headers.authorization, req.body, deps.company);
    return reply.code(out.status).send(out.body);
  });
}
