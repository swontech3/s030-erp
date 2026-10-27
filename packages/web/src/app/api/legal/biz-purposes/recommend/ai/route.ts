import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward';

/**
 * 사업목적 「추천」 탭의 [AI 추천] `{ q }` — `POST /legal/biz-purposes/recommend/ai` (Fastify) 로 넘긴다(2026-10-27).
 * ★ 이 홉은 판정하지 않는다. 로그인한 모든 사용자가 부른다(고르기 팝업). 쓰기는 없다.
 * ★ 상한은 Fastify 의 AI 상한(`AI_TIMEOUT_MS` 20초)보다 길게 — AI 가 늦으면 Fastify 가 먼저 일반 추천으로 답한다.
 */
const AI_HOP_TIMEOUT_MS = 30_000;

export async function POST(request: NextRequest) {
  return forwardJson(request, '/legal/biz-purposes/recommend/ai', 'POST', AI_HOP_TIMEOUT_MS);
}
