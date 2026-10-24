import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward';

/**
 * 사업목적 1줄 고치기 `{ text?, active? }` — 운영사만(회사는 Fastify 가 403). 같은 문구는 409, 없는 줄은 404.
 * ★ 지우기는 없다 — 사용 끄기(`active: false`)만.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardJson(request, `/legal/biz-purposes/${encodeURIComponent(id)}`, 'PATCH');
}
