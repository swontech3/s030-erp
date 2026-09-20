import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward';

/**
 * 입주사 등록 — `POST /companies`(Fastify)로 넘긴다.
 *
 * 계약 폼을 `companyId` 없이(`/contracts/new`) 열었을 때의 첫 저장이 여기로 온다.
 * ★ 삐용 호출은 이 경로에 **아직 없다** — 3-2 에서 Fastify 쪽에 얹는다.
 */
export async function POST(request: NextRequest) {
  return forwardJson(request, '/companies', 'POST');
}
