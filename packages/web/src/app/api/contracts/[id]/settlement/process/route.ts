import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward';

/**
 * 정산 처리 — `POST /contracts/:id/settlement/process`.
 *
 * ★ 이용료 차액은 해지 달 청구서에 수납으로, 실제 주고받은 금액은 정산 원장에 —
 *   Fastify 가 한 트랜잭션으로 쓴다(023 머리말).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardJson(request, `/contracts/${encodeURIComponent(id)}/settlement/process`, 'POST');
}
