import type { NextRequest } from 'next/server';
import { forwardDelete, forwardJson } from '@/lib/forward';

/** 층 수정 — s030100010p2. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardJson(request, `/facility/floors/${encodeURIComponent(id)}`, 'PATCH');
}

/** 층 삭제 — s030100010p5. ★ 호실·회의실이 남아 있으면 API 가 409 로 막는다. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardDelete(request, `/facility/floors/${encodeURIComponent(id)}`);
}
