import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward';

/**
 * 구성원 전체 교체 — `PUT /companies/:id/members`(3-4). 계약 폼 섹션 3 이 여기로 저장된다.
 *
 * ★ 20명 상한과 대표자 정규화는 Fastify 쪽 `buildMemberWrites` 가 한다.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardJson(request, `/companies/${encodeURIComponent(id)}/members`, 'PUT');
}
