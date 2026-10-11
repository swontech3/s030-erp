import type { NextRequest } from 'next/server';
import { forwardDelete, forwardGetJson, forwardJson } from '@/lib/forward';

/** 법인설립 1건 — 상세(없는 건 · 남의 건은 Fastify 가 둘 다 404). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardGetJson(`/legal/incorporations/${encodeURIComponent(id)}`);
}

/** 설립 정보 저장 `{ info }` — 서류작성중(P)이 아니면 Fastify 가 409. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardJson(request, `/legal/incorporations/${encodeURIComponent(id)}`, 'PATCH');
}

/** 삭제 `?from=` — 운영사 · P/X 만. ★ `from` 만 옮긴다. 성공은 204. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const from = request.nextUrl.searchParams.get('from') ?? '';
  return forwardDelete(request, `/legal/incorporations/${encodeURIComponent(id)}?from=${encodeURIComponent(from)}`);
}
