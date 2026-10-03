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
import {
  bbiyongAcl,
  bbiyongAuth,
  BbiyongAuthError,
  BbiyongOrgSelectRequiredError,
  BbiyongUnavailableError,
} from '../bbiyong/index.ts';
import { createSession, readRefreshToken, revokeSession } from '../session/store.ts';
import { requireRawSid, requireSession } from '../session/hook.ts';

interface LoginBody {
  email?: string;
  password?: string;
}

export function registerAuthRoutes(app: FastifyInstance): void {
  /**
   * POST /auth/login — 로그인.
   *
   * 흐름 (SPEC 요구사항 10):
   *   삐용 로그인 → memberId·orgId·orgTp 추출 → erp_sid 32바이트 생성
   *   → SHA-256 해시만 tb_s080_auth_session 저장 → 원문을 web 에 반환
   *   → 삐용 토큰은 서버에만 암호화 보관
   */
  app.post<{ Body: LoginBody }>('/auth/login', {
    config: { public: true }, // 로그인은 세션 없이 들어온다 — 유일하게 공개된 쓰기 라우트
    // 본문 형식은 스키마가 거른다 — 비문자열 email 이 .trim() 에서 500 을 내지 않게(리뷰 2026-09-07).
    // 길이 상한은 삐용 규격(회신 ⑦)이 오면 맞춘다. 지금은 상식선.
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        additionalProperties: false,
        properties: {
          email: { type: 'string', minLength: 1, maxLength: 254 },
          password: { type: 'string', minLength: 1, maxLength: 128 },
        },
      },
    },
  }, async (req, reply) => {
    const email = req.body?.email?.trim();
    const password = req.body?.password;
    if (!email || !password) {
      return reply.code(400).send({ error: 'invalid_request', message: '이메일과 비밀번호를 입력하세요' });
    }

    let login;
    try {
      login = await bbiyongAuth.signIn(email, password);
    } catch (err) {
      // ★ 겸직 계정 — 자격 증명은 맞았고 단체를 못 고른 것뿐이다. 조용히 실패시키지 않는다.
      //   이 줄이 로그에 찍히면 2단계 로그인 팝업(s030000010p1)을 만들 때가 된 것이다(회신 ⑦ §4).
      if (err instanceof BbiyongOrgSelectRequiredError) {
        req.log.warn(
          { candidateCount: err.candidateCount },
          '겸직 계정 로그인 시도 — needOrgSelect. 2단계 로그인 팝업 s030000010p1 이 필요하다',
        );
        return reply.code(401).send({ error: 'org_select_required', message: err.message });
      }
      if (err instanceof BbiyongAuthError) {
        // 401 이지만 메시지는 계정 존재 여부를 흘리지 않는다(어댑터가 이미 합쳐서 준다).
        return reply.code(401).send({ error: 'invalid_credentials', message: err.message });
      }
      // ★ 삐용에 못 붙은 것은 인증 실패가 아니다. 401 로 내려보내면 삐용 장애가
      //   "비밀번호가 틀렸습니다"로 보이고, 사용자는 멀쩡한 비밀번호를 계속 다시 친다.
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
