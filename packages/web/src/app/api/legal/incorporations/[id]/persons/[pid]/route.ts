import type { NextRequest } from 'next/server';
import { forwardDelete, forwardJson } from '@/lib/forward';

type Params = { params: Promise<{ id: string; pid: string }> };

const path = (id: string, pid: string) => `/legal/incorporations/${encodeURIComponent(id)}/persons/${encodeURIComponent(pid)}`;

/** 사람 수정 — 다른 건의 사람이면 Fastify 가 404. */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id, pid } = await params;
  return forwardJson(request, path(id, pid), 'PATCH');
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id, pid } = await params;
  return forwardDelete(request, path(id, pid));
}
