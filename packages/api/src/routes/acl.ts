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
import { ACL_ACTIONS, bbiyongAcl, type AclAction } from '../bbiyong/index.ts';
import { requireSession } from '../session/hook.ts';

/**
 * ERP 화면코드 형식 — `s03` + 3자리 업무구분 + 4자리 순번 [+ `p{n}`] = **10자리**.
 *
 * ★★ 2026-10-02 에 11자리(`s030` + 7자리)에서 10자리로 줄였다 — 삐용이 `s02`+`120`+`0010`
 *    으로 10자리를 쓰는데 우리만 시스템코드가 4자리였다(`SWONBIZ_SCREEN_LIST.md` §1).
 *    ★ 이 정규식은 그때 **놓쳤다.** 코드 문자열이 아니라 패턴이라 일괄 치환에 걸리지 않았고,
 *      그래서 모든 `/acl/verify` 호출이 400 「화면코드 형식이 올바르지 않습니다」가 됐다
 *      (verify-2-8 의 A8 이 이것을 잡았다). 자리수를 바꿀 때 **여기도 같이 본다.**
 */
const SCREEN_CODE = /^s03\d{7}(p\d{1,2})?$/;
/** shadow 로그의 route 컬럼 상한. 클라이언트가 보낸 문자열이라 길이를 자른다. */
const ROUTE_MAX = 200;

interface VerifyBody {
  screenCode?: string;
  action?: string;
  route?: string;
}

export function registerAclRoutes(app: FastifyInstance): void {
  app.post<{ Body: VerifyBody }>('/acl/verify', async (req, reply) => {
    const session = requireSession(req);
    const screenCode = req.body?.screenCode;
    // ★ 로그 테이블에 그대로 들어가는 값이다. 형식이 아니면 받지 않는다 —
    //   임의 문자열이 tb_s080_acl_shadow_log 에 쌓이면 "마스터에 없는 화면" 집계가 오염된다.
    if (!screenCode || !SCREEN_CODE.test(screenCode)) {
      return reply.code(400).send({ error: 'invalid_request', message: '화면코드 형식이 올바르지 않습니다' });
    }
    const route = typeof req.body?.route === 'string' ? req.body.route.slice(0, ROUTE_MAX) : undefined;
    const action = (req.body?.action ?? 'VIEW') as AclAction;
    if (!ACL_ACTIONS.includes(action)) {
      return reply.code(400).send({ error: 'invalid_request', message: `알 수 없는 action: ${action}` });
    }

    const allowed = await bbiyongAcl.canAccess(
      screenCode,
      action,
      session, // ErpSession ⊇ AclSubject
      // httpMethod 는 이 요청(POST)이 아니라 검증 대상인 **화면 진입**의 방식이다 — 페이지 조회라 GET.
      { route, httpMethod: 'GET' },
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
    // 쿼리스트링은 남기지 않는다 — 나중 페이즈의 필터 값(개인정보)이 보존 기간 없는 로그에 쌓인다(리뷰 L7).
    await bbiyongAcl.canAccess(screenCode, action, session, { route: req.url.split('?')[0], httpMethod: req.method });
    // 1단계 shadow — canAccess 는 항상 true 라 여기서 막지 않는다.
    // 3단계에서 이 자리에 `if (!allowed) reply.code(403)` 이 들어간다.
  };
}
