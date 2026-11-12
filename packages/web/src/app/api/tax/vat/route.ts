import type { NextRequest } from 'next/server';
import { forwardGetJson } from '@/lib/forward';

/**
 * 부가세 조회 — `GET /tax/vat?month&period` (Fastify) 로 주소를 그대로 넘긴다.
 * ★ 이 홉은 판정하지 않는다. 주소 해석 · 단체 범위는 전부 Fastify 가 본다.
 */
export async function GET(request: NextRequest) {
  return forwardGetJson(`/tax/vat${request.nextUrl.search}`);
}
