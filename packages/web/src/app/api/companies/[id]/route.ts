import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward';

/**
 * 입주사 수정 — `PATCH /companies/:id`(3-4)로 넘긴다. 계약 폼 섹션 1 이 여기로 저장된다.
 *
 * ★ 운영사 전용이다. 입주사 세션이면 Fastify 가 403 을 낸다 — 이 홉은 판정하지 않는다.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardJson(request, `/companies/${encodeURIComponent(id)}`, 'PATCH');
}
