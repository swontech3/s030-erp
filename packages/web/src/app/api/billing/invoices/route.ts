import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { forwardGetJson } from '@/lib/forward';

/**
 * 청구 (s030200070) — `GET /billing/invoices?dueFrom=&dueTo=` 로 넘긴다(납부기한 기간, 2026-11-15).
 *
 * ★ 운영사 전용이다. 입주사 세션이면 Fastify 가 403 을 낸다 — 이 홉은 판정하지 않는다.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const dueFrom = sp.get('dueFrom') ?? '';
  const dueTo = sp.get('dueTo') ?? '';
  // 모양만 본다. 틀린 날은 그대로 넘기면 Fastify 가 400 으로 말해 준다 — 여기서는 주소 조립만 막는다.
  if (!/^[0-9-]{0,10}$/.test(dueFrom) || !/^[0-9-]{0,10}$/.test(dueTo)) {
    return NextResponse.json({ message: '납부기한은 YYYY-MM-DD 이어야 합니다' }, { status: 400 });
  }
  const qs = new URLSearchParams({ dueFrom, dueTo });
  return forwardGetJson(`/billing/invoices?${qs.toString()}`);
}
