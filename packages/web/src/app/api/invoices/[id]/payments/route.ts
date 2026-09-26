import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward';

/**
 * 수납 입력 — `POST /invoices/:id/payments`.
 *
 * ★ 금액의 부호를 여기서 보지 않는다. 일반 수납이 양수여야 한다는 것은 화면의 규칙이고,
 *   Fastify 는 환불(음수)도 받는다. 판정을 이 홉에 두면 규칙이 세 곳이 된다.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardJson(request, `/invoices/${encodeURIComponent(id)}/payments`, 'POST');
}
