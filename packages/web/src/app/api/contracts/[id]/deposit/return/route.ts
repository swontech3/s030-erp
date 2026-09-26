import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward';

/**
 * 예치금 반환 — 정산서 없이(기간 만료로 끝난 계약). `POST /contracts/:id/deposit/return`.
 * ★ 중도해지 정산이 처리 전이면 Fastify 가 409 로 막는다.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardJson(request, `/contracts/${encodeURIComponent(id)}/deposit/return`, 'POST');
}
