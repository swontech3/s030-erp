import type { NextRequest } from 'next/server';
import { forwardGetJson, forwardUpload } from '@/lib/forward';

/**
 * 층 첨부 — 층별 도면 목록과 업로드 (s030100010p2 안의 칸).
 *
 * ★ 건물 쪽(`/api/facility/buildings/[id]/files`)과 같은 통로다. 판정은 Fastify 가 한다.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardGetJson(`/facility/floors/${encodeURIComponent(id)}/files`);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardUpload(request, `/facility/floors/${encodeURIComponent(id)}/files`);
}
