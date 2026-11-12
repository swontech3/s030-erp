import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward';

/** 거래처 고치기 `{ name?, bizNo? }` — 번호는 숫자만 저장, 끝자리 틀림은 경고만(Fastify `PATCH /tax/vendors/:id`). */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardJson(request, `/tax/vendors/${encodeURIComponent(id)}`, 'PATCH');
}
