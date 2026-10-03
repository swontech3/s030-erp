import type { NextRequest } from 'next/server';
import { forwardDelete, forwardJson } from '@/lib/forward';

/** 회의실 수정 — s030100010p4. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardJson(request, `/facility/facilities/${encodeURIComponent(id)}`, 'PATCH');
}

/** 회의실 삭제 — s030100010p5. ★ 취소되지 않은 예약이 있으면 API 가 409 로 막는다. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardDelete(request, `/facility/facilities/${encodeURIComponent(id)}`);
}
