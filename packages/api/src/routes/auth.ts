/**
 * 인증 라우트 — 로그인 · 로그아웃 · 세션 조회.
 *
 * ★ 쿠키를 굽는 것은 이 서버가 아니라 web(Next.js route handler)이다.
 *   브라우저는 Fastify 에 직접 붙지 않는다 — web 이 서버끼리 이 API 를 부르고,
 *   자기 오리진으로 `erp_sid` 쿠키를 내린다. 그래서 CORS 도, 크로스 오리진
 *   쿠키(SameSite=None)도 필요 없다. 여기서는 원문 sid 를 응답 **본문**으로 준다.
 *
 * ★★ 그래서 이 서버는 절대 외부에 노출하지 않는다. 로그인 응답에 원문 sid 가
 *    들어 있으므로 공개되면 세션을 아무나 받아갈 수 있다.
 */
import type { FastifyInstance } from 'fastify';
import { homeRouteFor } from '@swonbiz/shared';
import { bbiyongAcl, bbiyongAuth, BbiyongAuthError, BbiyongUnavailableError } from '../bbiyong/index.ts';
import { createSession, readRefreshToken, revokeSession } from '../session/store.ts';
import { requireRawSid, requireSession } from '../session/hook.ts';

/** 브라우저가 삐용 로그인에서 받은 토큰 둘. ★ 비밀번호는 받지 않는다(규격서 Q6 · 2026-10-22). */
interface LoginBody {
  accessToken: string;
  refreshToken: string;
}

export function registerAuthRoutes(app: FastifyInstance): void {
  /**
   * POST /auth/login — 삐용 토큰 → ERP 세션 (규격서 Q6 · 2026-10-22).
   *
   * 흐름 :
   *   브라우저가 삐용 sign-in 을 직접 부른다(ERP 서버는 비밀번호를 받지 않는다)
   *   → 받은 토큰 둘을 web 이 이리로 넘긴다
   *   → **삐용에 물어 확인**(my-orgs) — 확인된 회원 · 회사만 쓴다. 확인이 안 되면 세션을 만들지 않는다
   *   → erp_sid 32바이트 생성 → SHA-256 해시만 tb_s080_auth_session 저장 → 원문을 web 에 반환
   *   → 삐용 토큰은 서버에만 암호화 보관
   * ★ 로그인 길은 이것 하나다 — 「삐용 안에 뜬 ERP」도 이 자리를 쓴다(대표 결정 2026-10-22).
   */
  app.post<{ Body: LoginBody }>('/auth/login', {
    config: { public: true }, // 로그인은 세션 없이 들어온다 — 유일하게 공개된 쓰기 라우트
    // 본문 형식은 스키마가 거른다 — 이메일 · 비밀번호 등 다른 칸이 섞이면 400 이다.
    schema: {
      body: {
        type: 'object',
        required: ['accessToken', 'refreshToken'],
        additionalProperties: false,
        properties: {
          accessToken: { type: 'string', minLength: 1, maxLength: 4096 },
          refreshToken: { type: 'string', minLength: 1, maxLength: 4096 },
        },
      },
    },
  }, async (req, reply) => {
    let login;
    try {
      login = await bbiyongAuth.verifySession(req.body.accessToken, req.body.refreshToken);
    } catch (err) {
      if (err instanceof BbiyongAuthError) {
        return reply.code(401).send({ error: 'invalid_token', message: err.message });
      }
      // ★ 삐용에 못 붙은 것은 인증 실패가 아니다. 401 로 내려보내면 삐용 장애가
      //   "다시 로그인하세요"로 보이고, 사용자는 멀쩡한 계정으로 계속 다시 로그인한다.
      //   (web 은 5xx 문구를 자기 문구로 가린다 — 여기 문구는 로그·개발용이다.)
      if (err instanceof BbiyongUnavailableError) {
        req.log.error({ err }, '삐용 인증 서버 연결 실패');
        return reply.code(503).send({ error: 'bbiyong_unavailable', message: '인증 서버에 연결할 수 없습니다' });
      }
      throw err;
    }

    const { rawSid, session } = await createSession(login);

    // 화면 목록은 삐용이 준 것만 쓴다. ERP 가 역할로 거르지 않는다(ACL-07′).
    // ErpSession 은 AclSubject(memberId·orgId)의 상위집합이라 그대로 넘긴다.
    const screens = await bbiyongAcl.listScreens(session);

    return reply.send({
      erpSid: rawSid,
      expiresAt: session.expiresAt.toISOString(),
      /** 홈 분기 — org_tp 가 아니라 화면 권한으로 정한다(지시문 1-6). */
      home: homeRouteFor(screens),
      screens,
      /** ★ 표시 전용. 이 값으로 메뉴를 열고 닫지 않는다. */
      display: {
        memberName: login.memberName,
        orgName: login.orgName,
        orgTp: login.orgTp,
      },
      /** 스코프 확인용(개발 편의). 값 자체는 서버 판정에만 쓰인다. */
      companyId: session.companyId,
    });
  });

  /**
   * POST /auth/logout — 로그아웃.
   *
   * 세 단계 중 1·3 은 반드시, 2 는 최선노력이다(ORG §3-5).
   *   1. revoked_at = now()                 ← 즉시 무효. 캐시도 같이 버린다
   *   2. 삐용 sign-out                       ← 실패해도 계속 간다
   *   3. 쿠키 삭제                            ← web 쪽에서 한다
   */
  app.post('/auth/logout', async (req, reply) => {
    const rawSid = requireRawSid(req); // 훅이 이미 401 을 냈으므로 여기서는 불변식 검사만

    const refresh = await readRefreshToken(rawSid);
    await revokeSession(rawSid); // ① 먼저 끊는다. 삐용 호출이 느려도 ERP 세션은 이미 죽는다

    if (refresh) {
      try {
        await bbiyongAuth.signOut(refresh); // ②
      } catch (err) {
        // 끊는 쪽으로 실패한다 — 삐용 세션이 남아도 ERP 는 이미 로그아웃이다.
        req.log.warn({ err }, '삐용 sign-out 실패 — ERP 세션은 폐기됨');
      }
    }

    return reply.send({ ok: true });
  });

  /**
   * GET /auth/me — 현재 세션 + 접근 가능 화면 목록.
   * 셸(2-7)의 사이드바가 이 응답만 보고 그린다.
   *
   * ★ display(헤더의 "홍길동 (에스원테크)")는 어댑터의 getProfile 로 매번 가져온다.
   *   세션 테이블에 이름을 복사해 두지 않는다 — 삐용에서 이름이 바뀌면 ERP 만 옛
   *   이름을 들고 있게 되고, 그 어긋남은 추적이 안 된다. **표시 전용 값이다.**
   */
  app.get('/auth/me', async (req, reply) => {
    const session = requireSession(req);
    const [screens, profile] = await Promise.all([
      bbiyongAcl.listScreens(session),
      bbiyongAuth.getProfile(session.s020MemberId),
    ]);
    return reply.send({
      screens,
      home: homeRouteFor(screens),
      /** ★ 표시 전용. 사이드바·메뉴 판정에 쓰지 않는다. */
      display: profile,
      companyId: session.companyId,
      role: session.role,
      // ★ 최상위 orgTp 는 내려보내지 않는다(회신 2026-09-12 §4). web 에서 읽는 코드가 0건이었고
      //   판정 유혹만 남는 필드였다. 표시가 필요하면 display(삐용 getProfile)에 있다.
      expiresAt: session.expiresAt.toISOString(),
    });
  });
}
