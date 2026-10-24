import type { NextRequest } from 'next/server';
import { forwardDelete, forwardGetJson, forwardJson } from '@/lib/forward';

/**
 * 법인변경 1건 — 상세 + 임원 + 기본정보.
 * ★ 없는 건과 남의 건을 구분하지 않는다 — Fastify 가 둘 다 404 로 준다.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardGetJson(`/legal/corp-changes/${encodeURIComponent(id)}`);
}

/** 변경 내용 저장 `{ payload }` — 서류작성중(P)이 아니면 Fastify 가 409. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardJson(request, `/legal/corp-changes/${encodeURIComponent(id)}`, 'PATCH');
}

/**
 * 삭제 `?from=` — 화면이 본 상태를 함께 보낸다(다르면 Fastify 가 409). 운영사 · P/X 만.
 * ★ `from` 만 옮긴다 — 다른 쿼리는 넘기지 않는다. 성공은 204.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const from = request.nextUrl.searchParams.get('from') ?? '';
  return forwardDelete(request, `/legal/corp-changes/${encodeURIComponent(id)}?from=${encodeURIComponent(from)}`);
}
