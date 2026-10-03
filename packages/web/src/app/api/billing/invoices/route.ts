import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { forwardGetJson } from '@/lib/forward';

/**
 * 월별 청구 (s030200070) — `GET /billing/invoices?yearMonth=` 로 넘긴다.
 *
 * ★ 운영사 전용이다. 입주사 세션이면 Fastify 가 403 을 낸다 — 이 홉은 판정하지 않는다.
 */
export async function GET(request: NextRequest) {
  const yearMonth = request.nextUrl.searchParams.get('yearMonth') ?? '';
  // 모양만 본다. 틀린 월은 그대로 넘기면 Fastify 가 400 으로 말해 준다 — 여기서는 주소 조립만 막는다.
  if (!/^[0-9-]{0,7}$/.test(yearMonth)) {
    return NextResponse.json({ message: '청구 월은 YYYY-MM 이어야 합니다' }, { status: 400 });
  }
  return forwardGetJson(`/billing/invoices?yearMonth=${encodeURIComponent(yearMonth)}`);
}
