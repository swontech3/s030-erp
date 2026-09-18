import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward';

/**
 * 상태 전이 — `POST /contracts/:id/status`(4-3)로 넘긴다.
 *
 * ★ 허용되는 전이는 화이트리스트로 Fastify 가 판정한다(`assertTransition`, CONT-08).
 *   화면의 버튼 구성과 무관하게 막힌 전이는 400 으로 돌아온다.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardJson(request, `/contracts/${encodeURIComponent(id)}/status`, 'POST');
}
