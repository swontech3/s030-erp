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
import { bbiyongAcl, bbiyongAuth, BbiyongAuthError } from '../bbiyong/index.ts';
import { createSession, readRefreshToken, revokeSession } from '../session/store.ts';
import { requireSession } from '../session/hook.ts';

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
  app.post<{ Body: LoginBody }>('/auth/login', async (req, reply) => {
    const email = req.body?.email?.trim();
    const password = req.body?.password;
    if (!email || !password) {
      return reply.code(400).send({ error: 'invalid_request', message: '이메일과 비밀번호를 입력하세요' });
    }

    let login;
    try {
      login = await bbiyongAuth.signIn(email, password);
    } catch (err) {
      if (err instanceof BbiyongAuthError) {
        // 401 이지만 메시지는 계정 존재 여부를 흘리지 않는다(어댑터가 이미 합쳐서 준다).
        return reply.code(401).send({ error: 'invalid_credentials', message: err.message });
      }
      throw err;
    }

    const { rawSid, session } = await createSession(login);

    // 화면 목록은 삐용이 준 것만 쓴다. ERP 가 역할로 거르지 않는다(ACL-07′).
    const screens = await bbiyongAcl.listScreens({
      s020MemberId: session.s020MemberId,
      s020OrgId: session.s020OrgId,
      orgTp: session.orgTp,
    });

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
    const rawSid = req.rawSid;
    if (!rawSid) return reply.code(401).send({ error: 'unauthenticated' });

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
   * ★ TODO(2-7): 헤더의 "홍길동 (에스원테크)" 표시값이 여기 없다. 이름은 삐용 로그인
   *   응답에만 있고 tb_s080_auth_session 에 컬럼이 없다 — 저장하면 삐용 회원정보의
   *   사본을 ERP 가 갖게 되고 그건 변경 추적이 안 된다. 회신 ⑦(로그인 API 규격)에
   *   회원 조회가 포함되는지 확인한 뒤, 없으면 그때 캐시 방식을 정한다.
   */
  app.get('/auth/me', async (req, reply) => {
    const session = requireSession(req);
    const subject = {
      s020MemberId: session.s020MemberId,
      s020OrgId: session.s020OrgId,
      orgTp: session.orgTp,
    };
    const screens = await bbiyongAcl.listScreens(subject);
    return reply.send({
      screens,
      home: homeRouteFor(screens),
      companyId: session.companyId,
      role: session.role,
      orgTp: session.orgTp,
      expiresAt: session.expiresAt.toISOString(),
    });
  });
}
