import type { NextRequest } from 'next/server';
import { forwardGetJson, forwardJson } from '@/lib/forward';

/**
 * 세무 설정 — `GET /tax/settings` (Fastify) 로 넘긴다.
 * ★ 이 홉은 판정하지 않는다. 단체 범위 · 본문 검사는 전부 Fastify 가 본다.
 */
export async function GET() {
  return forwardGetJson('/tax/settings');
}

/** [저장] 한 번 = 한 트랜잭션. 틀린 칸은 400 `{ errors[] }`, 성공은 GET 과 같은 모양. */
export async function PUT(request: NextRequest) {
  return forwardJson(request, '/tax/settings', 'PUT');
}
