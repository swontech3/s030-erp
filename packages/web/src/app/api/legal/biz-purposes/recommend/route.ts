import type { NextRequest } from 'next/server';
import { forwardGetJson } from '@/lib/forward';

/**
 * 사업목적 「추천」 탭의 업종 후보 — `GET /legal/biz-purposes/recommend?q=` (Fastify) 로 넘긴다.
 * ★ 이 홉은 판정하지 않는다. 로그인한 모든 사용자가 부른다(고르기 팝업). 읽기 전용이다.
 */
export async function GET(request: NextRequest) {
  const qs = request.nextUrl.searchParams.toString();
  return forwardGetJson(`/legal/biz-purposes/recommend${qs ? `?${qs}` : ''}`);
}
