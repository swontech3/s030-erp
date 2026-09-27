import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { forwardGetJson, forwardJson } from '@/lib/forward';

/**
 * 예약 목록 (s0300600010) — `GET /reservations?facilityId=&from=&to=`.
 *
 * ★ **보이는 범위는 Fastify 의 RLS 가 정한다.** 이 홉은 주소만 조립한다 — 입주사 세션은
 *   자기 회사 예약만, 운영사는 전부 본다(003 의 `erp_company_scope`).
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? from;
  const facilityId = sp.get('facilityId') ?? '';
  // 모양만 본다. 틀린 날짜는 Fastify 가 400 으로 말해 준다.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ message: '기간은 YYYY-MM-DD 이어야 합니다' }, { status: 400 });
  }
  const q = new URLSearchParams({ from, to });
  if (facilityId) q.set('facilityId', facilityId);
  return forwardGetJson(`/reservations?${q.toString()}`);
}

/**
 * 예약 만들기 — `POST /reservations`.
 *
 * ★ 규칙(30분 단위·운영시간·최소·최대·지난 시각·4주·하루 한도)과 겹침은 **Fastify 와 DB** 가
 *   본다. 화면 검사는 친절이고 서버 검사가 규칙이다.
 */
export async function POST(request: NextRequest) {
  return forwardJson(request, '/reservations', 'POST');
}
