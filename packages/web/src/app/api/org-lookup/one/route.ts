import type { NextRequest } from 'next/server';
import { forwardGetJson } from '@/lib/forward';

/**
 * 공용 회사 조회 — 단건. `GET /org-lookup/one?orgId=` 또는 `?orgCode=` (Fastify) 로 넘긴다.
 *
 * ★ 운영사 전용이다. 키 형식 검사도 Fastify 가 한다(400) — 이 홉은 주소만 조립한다.
 */
export async function GET(request: NextRequest) {
  const from = request.nextUrl.searchParams;
  const params = new URLSearchParams();
  for (const key of ['orgId', 'orgCode']) {
    const value = from.get(key);
    if (value !== null) params.set(key, value);
  }
  return forwardGetJson(`/org-lookup/one?${params.toString()}`);
}
