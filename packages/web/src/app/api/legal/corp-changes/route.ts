import type { NextRequest } from 'next/server';
import { forwardGetJson, forwardJson } from '@/lib/forward';

/**
 * 법인변경 목록 — `GET /legal/corp-changes` (Fastify) 로 넘긴다. 조건은 주소 그대로 싣는다.
 *
 * ★ 이 홉은 판정하지 않는다. 운영사 · 회사 모두 부르고, 무엇이 보이는지는 Fastify 쪽
 *   RLS(037)가 단체 ID 로 가른다. 틀린 조건은 Fastify 가 400 으로 돌려준다.
 */
export async function GET(request: NextRequest) {
  const qs = request.nextUrl.searchParams.toString();
  return forwardGetJson(`/legal/corp-changes${qs ? `?${qs}` : ''}`);
}

/**
 * 첫 [저장] = 새 건 — `{ changeType, orgId?, orgCode?, payload, officers[] }`. 성공하면 201 `{ id }`.
 * 하나라도 틀리면 400 + 칸별 오류(`errors[]`)이고 아무것도 만들어지지 않는다.
 * ★ 회사 세션이 남의 단체를 적으면 Fastify 가 403 을 낸다 — 이 홉은 판정하지 않는다.
 * ★ 임원 주민번호 평문은 이 홉을 **지나가기만** 한다 — 기록하지 않는다. 암호화는 Fastify 가 한다.
 */
export async function POST(request: NextRequest) {
  return forwardJson(request, '/legal/corp-changes', 'POST');
}
