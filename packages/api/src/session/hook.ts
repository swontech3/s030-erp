/**
 * 세션 미들웨어 (Fastify `onRequest`) — SPEC 요구사항 14.
 *
 * ★★ 여기가 진짜 차단선이다. Next.js 의 `proxy.ts` 는 UX 게이트일 뿐이고
 *    (CVE-2025-29927 — 헤더 하나로 우회된 전례가 있다), 실제 거절은 이 훅이 한다.
 *
 * ★ 인증 실패는 **401 이지 리다이렉트가 아니다**(지시서 3장 완료 기준).
 *   API 가 302 로 로그인 페이지 HTML 을 주면 클라이언트는 그걸 데이터로 파싱한다.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SESSION_COOKIE, type ErpSession } from '@swonbiz/shared';
import { lookupSession } from './store.ts';
import { readCookie } from './cookie.ts';

declare module 'fastify' {
  interface FastifyRequest {
    /** 인증이 필요한 라우트에서는 항상 채워져 있다(없으면 훅이 401 로 끝냈다). */
    session?: ErpSession;
    /** 쿠키 원문. 로그아웃이 삐용 토큰을 꺼낼 때 필요하다. DB 에는 해시만 있다. */
    rawSid?: string;
  }
  interface FastifyContextConfig {
    /**
     * 인증을 요구하지 않는 라우트. **기본은 false** — 라우트를 추가하면서 인증을
     * 빠뜨리는 사고가 조용히 나지 않게, 공개는 라우트 자신이 명시한다.
     *
     * (리뷰 2026-09-07: 경로 문자열 집합 매칭에서 라우트 설정으로 바꿨다. 문자열 매칭은
     *  등록되지 않은 경로까지 401 로 뭉개서, 오타 난 URL 이 "세션 만료"로 보였다.)
     */
    public?: boolean;
  }
}

export function registerSessionHook(app: FastifyInstance): void {
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    // 등록되지 않은 경로(404)는 인증보다 먼저다 — 잘못된 URL 을 세션 문제로 오해하게 두지 않는다.
    // routeOptions.url 은 매칭된 라우트가 없으면 undefined 다.
    if (!req.routeOptions.url) return;
    if (req.routeOptions.config.public) return;

    const rawSid = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (!rawSid) {
      return reply.code(401).send({ error: 'unauthenticated', message: '세션이 없습니다' });
    }

    const session = await lookupSession(rawSid);
    if (!session) {
      // 만료·폐기·위조를 구분해서 알려주지 않는다 — 세션 ID 탐색의 단서가 된다.
      return reply.code(401).send({ error: 'unauthenticated', message: '세션이 만료되었습니다' });
    }

    req.session = session;
    req.rawSid = rawSid;
  });
}

/**
 * 라우트 안에서 세션을 꺼낼 때 쓴다. 훅이 이미 401 로 걸렀으므로 여기 도달하면
 * 반드시 있다 — 없으면 그건 라우트에 `config.public` 을 잘못 붙인 것이다.
 */
export function requireSession(req: FastifyRequest): ErpSession {
  if (!req.session) {
    throw new Error(`세션 없이 보호 라우트에 도달했다: ${req.url} — 라우트의 config.public 을 확인할 것`);
  }
  return req.session;
}

/** 로그아웃처럼 쿠키 원문이 필요한 라우트용. 세션과 같은 불변식이다. */
export function requireRawSid(req: FastifyRequest): string {
  requireSession(req);
  if (!req.rawSid) throw new Error(`세션은 있는데 rawSid 가 없다: ${req.url}`);
  return req.rawSid;
}
