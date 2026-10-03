import type { NextRequest } from 'next/server';
import { forwardDelete, forwardJson } from '@/lib/forward';

/** 건물 수정 — s030100010p1. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardJson(request, `/facility/buildings/${encodeURIComponent(id)}`, 'PATCH');
}

/** 건물 삭제 — s030100010p5. ★ 층·입주사·계약이 달려 있으면 API 가 409 로 막는다. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardDelete(request, `/facility/buildings/${encodeURIComponent(id)}`);
}
