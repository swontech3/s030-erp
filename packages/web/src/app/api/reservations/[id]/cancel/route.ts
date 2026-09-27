import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward';

/**
 * 예약 취소 — `POST /reservations/:id/cancel`. **소프트 취소**(사유를 남긴다).
 *
 * ★ 남의 회사 예약은 Fastify 가 404 로 막는다(RLS 가 아예 보여 주지 않는다).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardJson(request, `/reservations/${encodeURIComponent(id)}/cancel`, 'POST');
}
