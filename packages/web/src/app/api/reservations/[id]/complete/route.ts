import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward';

/**
 * 예약 종료 처리 — `POST /reservations/:id/complete`. **운영사만**이고 자동 배치는 없다.
 *
 * ★ 시간이 지난 예약을 시스템이 닫지 않는다 — 기간 만료 계약과 같은 규칙이다.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardJson(request, `/reservations/${encodeURIComponent(id)}/complete`, 'POST');
}
