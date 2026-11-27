import type { NextRequest } from 'next/server';
import { forwardGetJson } from '@/lib/forward';

/**
 * 공용 회사 조회 — 목록. `GET /org-lookup?q=` (Fastify) 로 넘긴다.
 *
 * ★ 운영사 전용이다. 회사 세션이면 Fastify 가 403 을 낸다 — 이 홉은 판정하지 않는다.
 * ★ 브라우저는 삐용을 직접 부르지 않는다. 삐용 토큰은 서버에만 있다.
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q') ?? '';
  // ★ 2026-11-27 — 법무 [새 건]만 `moduleCode` 를 싣는다. 있을 때만 넘긴다(판정은 Fastify)
  const moduleCode = request.nextUrl.searchParams.get('moduleCode');
  const extra = moduleCode ? `&moduleCode=${encodeURIComponent(moduleCode)}` : '';
  return forwardGetJson(`/org-lookup?q=${encodeURIComponent(q)}${extra}`);
}
