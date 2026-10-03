import { type NextRequest } from 'next/server';
import { forwardGetJson } from '@/lib/forward';

/**
 * 문의 관리 목록 (s030200080) — `GET /admin/inquiries` 로 넘긴다.
 *
 * ★★ **운영사 전용이다.** 이 홉은 판정하지 않는다 — 입주사 세션이면 Fastify 가 403 을
 *    낸다(`routes/inquiryAdmin.ts`). 공개 문의 라우트(`/api/inquiries`)와 달리
 *    `forwardPublicGetJson` 을 쓰지 않는다: 세션을 넘겨야 하고, 넘기지 않으면 401 이다.
 * ★ 넘길 조건만 고른다 — 상태 · 유형 · 검색어 · 페이지. 나머지는 버린다.
 */
export async function GET(request: NextRequest) {
  const qs = new URLSearchParams();
  for (const key of ['page', 'status', 'type', 'q']) {
    const value = request.nextUrl.searchParams.get(key);
    if (value) qs.set(key, value);
  }
  const query = qs.toString();
  return forwardGetJson(`/admin/inquiries${query ? `?${query}` : ''}`);
}
