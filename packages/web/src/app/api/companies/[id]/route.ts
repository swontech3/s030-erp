import type { NextRequest } from 'next/server';
import { forwardGetJson, forwardJson } from '@/lib/forward';

/**
 * 입주사 1건 — 계약 목록까지 함께 온다. s0300200030 이 카드를 고를 때 부른다.
 *
 * ★ 운영사 전용이다. 입주사 세션이면 Fastify 가 403 을 낸다 — 이 홉은 판정하지 않는다.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardGetJson(`/companies/${encodeURIComponent(id)}`);
}

/**
 * 입주사 수정 — `PATCH /companies/:id`(3-4). 계약 폼 섹션 1 이 여기로 저장된다.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardJson(request, `/companies/${encodeURIComponent(id)}`, 'PATCH');
}
