import { type NextRequest } from 'next/server';
import { forwardPublicGetJson, forwardPublicJson } from '@/lib/forward';

/**
 * 문의 목록·등록 (s030500070 · p1) — **인증 없음**.
 *
 * ★ 목록 응답에는 유형 · 가린 이름 · 날짜 · 상태뿐이다. 이름을 가리는 것도, 무엇을
 *   고를지도 서버가 정한다(`api/src/routes/inquiry.ts`) — 이 홉은 그대로 넘긴다.
 */
export async function GET(request: NextRequest) {
  const allowed = ['page', 'from', 'to', 'status', 'type'];
  const qs = new URLSearchParams();
  for (const key of allowed) {
    const value = request.nextUrl.searchParams.get(key);
    if (value) qs.set(key, value);
  }
  const query = qs.toString();
  return forwardPublicGetJson(`/inquiries${query ? `?${query}` : ''}`);
}

export async function POST(request: NextRequest) {
  return forwardPublicJson(request, '/inquiries', 'POST');
}
