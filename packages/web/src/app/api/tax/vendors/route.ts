import type { NextRequest } from 'next/server';
import { forwardGetJson } from '@/lib/forward';

/**
 * 세무 거래처 — `GET /tax/vendors?month=` (Fastify) 로 넘긴다.
 * ★ 이 홉은 판정하지 않는다. 단체 범위 · 본문 검사는 전부 Fastify 가 본다.
 */
export async function GET(request: NextRequest) {
  const month = request.nextUrl.searchParams.get('month') ?? '';
  return forwardGetJson(`/tax/vendors?month=${encodeURIComponent(month)}`);
}
