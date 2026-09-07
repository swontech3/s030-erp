/**
 * 화면 접근 검증 — shadow 모드의 실제 동작 지점.
 *
 * ★ 왜 API 가 필요한가. Next.js 의 `proxy.ts` 는 UX 게이트일 뿐이라(CVE-2025-29927)
 *   화면 접근을 그것만으로 판정할 수 없다. 그렇다고 web 이 스스로 판정하면
 *   "ERP 자체 권한 판정 모듈"이 되어 지시문 2-1·3장 위반이다. 그래서 web 의 서버
 *   컴포넌트가 이 엔드포인트에 물어보고, 판정과 기록은 전부 삐용 어댑터가 한다.
 *
 * 1단계 shadow 라 응답은 항상 `allowed: true` 다. 목록에 없으면 통과시키되
 * `tb_s080_acl_shadow_log` 에 DENY 로 남는다. 3단계에서 어댑터의 return 만 바뀌면
 * 이 라우트는 그대로 두고 차단이 켜진다.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { bbiyongAcl, type AclAction } from '../bbiyong/index.ts';
import { requireSession } from '../session/hook.ts';

const ACTIONS: readonly AclAction[] = ['VIEW', 'CREATE', 'UPDATE', 'DELETE'];

interface VerifyBody {
  screenCode?: string;
  action?: string;
  route?: string;
}

export function registerAclRoutes(app: FastifyInstance): void {
  app.post<{ Body: VerifyBody }>('/acl/verify', async (req, reply) => {
    const session = requireSession(req);
    const screenCode = req.body?.screenCode;
    if (!screenCode) {
      return reply.code(400).send({ error: 'invalid_request', message: 'screenCode 가 필요합니다' });
    }
    const action = (req.body?.action ?? 'VIEW') as AclAction;
    if (!ACTIONS.includes(action)) {
      return reply.code(400).send({ error: 'invalid_request', message: `알 수 없는 action: ${action}` });
    }

    const allowed = await bbiyongAcl.canAccess(
      screenCode,
      action,
      { s020MemberId: session.s020MemberId, s020OrgId: session.s020OrgId, orgTp: session.orgTp },
      { route: req.body?.route, httpMethod: 'GET' },
    );

    // ★ enforced 는 응답에도 담는다 — 3단계로 올릴 때 web 이 "차단이 켜졌다"는 것을
    //   응답만 보고 알 수 있어야 한다. 지금은 항상 false 다.
    return reply.send({ allowed, enforced: false });
  });
}

/**
 * 데이터 라우트용 가드 — **페이즈 2 이후 라우트가 생기면 여기에 붙인다.**
 * (ORG_ARCHITECTURE.md §7 "requireScreen 훅 골격")
 *
 * ★ 이 가드는 화면 접근만 본다. 데이터 스코프(company_id)는 shadow 대상이 아니므로
 *   `withCompanyScope()` 가 별도로, 항상 건다. 둘을 하나로 합치지 않는다 —
 *   합치면 shadow 를 끄고 켜는 순간 스코프까지 같이 흔들린다.
 */
export function requireScreen(screenCode: string, action: AclAction = 'VIEW') {
  return async function guard(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const session = requireSession(req);
    await bbiyongAcl.canAccess(
      screenCode,
      action,
      { s020MemberId: session.s020MemberId, s020OrgId: session.s020OrgId, orgTp: session.orgTp },
      { route: req.url, httpMethod: req.method },
    );
    // 1단계 shadow — canAccess 는 항상 true 라 여기서 막지 않는다.
    // 3단계에서 이 자리에 `if (!allowed) reply.code(403)` 이 들어간다.
  };
}
