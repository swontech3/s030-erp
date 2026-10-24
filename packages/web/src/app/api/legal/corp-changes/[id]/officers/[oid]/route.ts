import type { NextRequest } from 'next/server';
import { forwardDelete, forwardJson } from '@/lib/forward';

type Params = { params: Promise<{ id: string; oid: string }> };

const path = (id: string, oid: string) =>
  `/legal/corp-changes/${encodeURIComponent(id)}/officers/${encodeURIComponent(oid)}`;

/**
 * 임원 수정 — 주민번호 칸을 비워 보내면 그대로 둔다.
 * ★ 다른 건의 임원 ID 면 Fastify 가 404 를 낸다(건 ID 를 함께 건다).
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id, oid } = await params;
  return forwardJson(request, path(id, oid), 'PATCH');
}

/** 임원 삭제 — 성공은 204(본문 없음). */
export async function DELETE(request: NextRequest, { params }: Params) {
  const { id, oid } = await params;
  return forwardDelete(request, path(id, oid));
}
