import type { NextRequest } from 'next/server';
import { forwardGetJson, forwardJson } from '@/lib/forward';

/**
 * 법인설립 목록 `?status=&includeCancelled=` · 첫 [저장](새 건) — Fastify `/legal/incorporations` 로 넘긴다.
 * ★ 이 홉은 판정하지 않는다. 운영사 · 회사 모두 부르고, 무엇이 보이는지는 Fastify 쪽 RLS(042)가 단체 ID 로 가른다.
 * ★ 사람의 주민번호 평문은 이 홉을 **지나가기만** 한다 — 기록하지 않는다. 암호화는 Fastify 가 한다.
 */
export async function GET(request: NextRequest) {
  const qs = request.nextUrl.searchParams.toString();
  return forwardGetJson(`/legal/incorporations${qs ? `?${qs}` : ''}`);
}

export async function POST(request: NextRequest) {
  return forwardJson(request, '/legal/incorporations', 'POST');
}
