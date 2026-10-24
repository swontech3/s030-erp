import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward';

/**
 * 임원 추가 — 임원변경 건 · 서류작성중(P)만. 성공하면 201 + 임원(주민번호는 마스킹만).
 * ★ 주민번호 평문은 이 홉을 **지나가기만** 한다 — 기록하지 않는다. 암호화는 Fastify 가 한다.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardJson(request, `/legal/corp-changes/${encodeURIComponent(id)}/officers`, 'POST');
}
