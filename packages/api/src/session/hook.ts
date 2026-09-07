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
}

/**
 * 인증을 요구하지 않는 경로.
 * ★ 화이트리스트다 — 새 라우트는 기본이 "인증 필요"여야 한다. 블랙리스트로 두면
 *   라우트를 추가하면서 인증을 빠뜨리는 사고가 조용히 난다.
 */
const PUBLIC_PATHS = new Set(['/health', '/auth/login']);

export function registerSessionHook(app: FastifyInstance): void {
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const path = req.url.split('?')[0] ?? '';
    if (PUBLIC_PATHS.has(path)) return;

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
 * 반드시 있다 — 없으면 그건 화이트리스트에 라우트를 잘못 넣은 것이다.
 */
export function requireSession(req: FastifyRequest): ErpSession {
  if (!req.session) {
    throw new Error(`세션 없이 보호 라우트에 도달했다: ${req.url} — PUBLIC_PATHS 를 확인할 것`);
  }
  return req.session;
}
