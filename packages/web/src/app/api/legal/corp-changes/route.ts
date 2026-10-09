import type { NextRequest } from 'next/server';
import { forwardGetJson } from '@/lib/forward';

/**
 * 법인변경 목록 — `GET /legal/corp-changes` (Fastify) 로 넘긴다. 조건은 주소 그대로 싣는다.
 *
 * ★ 이 홉은 판정하지 않는다. 운영사 · 회사 모두 부르고, 무엇이 보이는지는 Fastify 쪽
 *   RLS(037)가 단체 ID 로 가른다. 틀린 조건은 Fastify 가 400 으로 돌려준다.
 */
export async function GET(request: NextRequest) {
  const qs = request.nextUrl.searchParams.toString();
  return forwardGetJson(`/legal/corp-changes${qs ? `?${qs}` : ''}`);
}
