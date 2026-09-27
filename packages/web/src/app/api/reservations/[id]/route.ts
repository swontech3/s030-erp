import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward';

/**
 * 예약 수정 — `PATCH /reservations/:id`.
 *
 * ★ 보낸 칸만 바뀐다. 규칙(30분·운영시간·최소·최대·겹침·지난 시각·4주·하루 한도)은
 *   Fastify 가 **등록과 같은 함수로** 다시 본다.
 * ★ 예약 조직은 바꾸지 못한다(400). 남의 회사 예약은 404 — RLS 가 아예 보여 주지 않는다.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardJson(request, `/reservations/${encodeURIComponent(id)}`, 'PATCH');
}
