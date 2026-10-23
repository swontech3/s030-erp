/**
 * 법무 회사 정보 「받기」 — 삐용이 회사 정보를 고쳤을 때 부른다(2026-10-23).
 *
 *   POST /legal/bbiyong/org-changed     { orgId, orgCode?, zipCode?, address?, detailAddress?, bizNumber?, corpNumber? }
 *                                       Authorization: Bearer <삐용 accessToken>
 *
 * ★★ ERP 세션(쿠키)이 없는 호출이다 — `config.public` 이고, 부르는 쪽 확인은 실어 온 삐용 토큰으로
 *    한다(`legal/legalOrgReceive.ts` 머리말). 판정은 그 파일이 하고, 이 파일은 넘기고 돌려줄 뿐이다.
 * ★★ 받은 값을 삐용에 다시 보내지 않는다 — `pushLegalOrg` 를 부르지 않는다(되돌아가기 방지).
 * 삐용 팀에 넘기는 규격: `doc/연동규격_법무_회사정보_받기.md`.
 */
import type { FastifyInstance } from 'fastify';
import { bbiyongAuth } from '../bbiyong/index.ts';
import { isTenantOrg, patchLegalOrgFromBbiyong } from '../db/corpChanges.ts';
import { withCompanyScope } from '../db/withCompanyScope.ts';
import { receiveLegalOrg, type ReceiveDeps } from '../legal/legalOrgReceive.ts';

/** `updated_by` 에 남기는 값 — 삐용이 보낸 줄이라는 표시(회원번호는 내 메뉴가 주지 않는다). */
const RECEIVE_ACTOR = 'bbiyong';

const defaultDeps: ReceiveDeps = {
  myMenus: (token) => bbiyongAuth.myMenus(token),
  // ★ 운영사 스코프 — 법무 회사 정보는 운영사가 전부 본다(037 RLS).
  apply: (orgId, fields) =>
    withCompanyScope({ role: 'operator', companyId: null, orgId: null }, async (client) => {
      if (await isTenantOrg(client, orgId)) return 'tenant';
      const n = await patchLegalOrgFromBbiyong(client, { orgId, fields, actor: RECEIVE_ACTOR });
      return n > 0 ? 'applied' : 'not_found';
    }),
};

export function registerLegalOrgReceiveRoutes(app: FastifyInstance, deps: ReceiveDeps = defaultDeps): void {
  app.post('/legal/bbiyong/org-changed', { config: { public: true } }, async (req, reply) => {
    const out = await receiveLegalOrg(req.headers.authorization, req.body, deps);
    return reply.code(out.status).send(out.body);
  });
}
