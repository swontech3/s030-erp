import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward';

/**
 * 계약 수정 — `PATCH /contracts/:id`(4-3)로 넘긴다.
 *
 * ★ 확정된 계약이면 Fastify 가 409(`contract_locked`)를 낸다. 화면이 미리 막는 것은
 *   편의이고, 실제 잠금은 그쪽이다(CONT-09).
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardJson(request, `/contracts/${encodeURIComponent(id)}`, 'PATCH');
}
