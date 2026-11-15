import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { forwardGetJson } from '@/lib/forward';

/**
 * 정산 탭 — 처리 대기(중도해지 정산 · 예치금 반환)와 처리 완료.
 * ★ 2026-11-15 — `?from=&to=` 정산 기준일 기간을 그대로 넘긴다(검사는 Fastify — 6개월 상한 포함).
 * ★ 목록이라 계좌번호는 Fastify 가 가려서 준다.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  // 모양만 본다. 틀린 날은 그대로 넘기면 Fastify 가 400 으로 말해 준다 — 여기서는 주소 조립만 막는다.
  if (!/^[0-9-]{0,10}$/.test(from) || !/^[0-9-]{0,10}$/.test(to)) {
    return NextResponse.json({ message: '정산 기준일은 YYYY-MM-DD 이어야 합니다' }, { status: 400 });
  }
  const qs = new URLSearchParams({ from, to });
  return forwardGetJson(`/billing/settlements?${qs.toString()}`);
}
