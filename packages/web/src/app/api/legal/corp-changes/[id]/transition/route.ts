import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward';

/**
 * 상태 전이 `{ from, to, cancelReason? }` — 판정은 Fastify 가 한다(`checkTransition`).
 * 성공하면 새 상세를 돌려준다. 400 검증 실패(칸별 오류) · 403 역할 · 409 상태가 바뀜 등.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardJson(request, `/legal/corp-changes/${encodeURIComponent(id)}/transition`, 'POST');
}
