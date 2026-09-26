import type { NextRequest } from 'next/server';
import { forwardDelete, forwardJson } from '@/lib/forward';

/** 수납 수정 — `PATCH /payments/:id`. Fastify 가 같은 트랜잭션에서 청구 상태를 다시 센다. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardJson(request, `/payments/${encodeURIComponent(id)}`, 'PATCH');
}

/** 수납 삭제 — `DELETE /payments/:id`. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardDelete(request, `/payments/${encodeURIComponent(id)}`);
}
