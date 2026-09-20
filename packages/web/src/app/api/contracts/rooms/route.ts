import { forwardGetJson } from '@/lib/forward';

/**
 * 계약호실 목록 — `GET /contracts/rooms`(Fastify)로 넘긴다. 조회 팝업(`s0300200040p3`)이 쓴다.
 *
 * ★ 운영사 전용이다. 이 목록은 **어느 회사가 어느 호실을 쓰는지**를 통째로 내려
 *   주므로 입주사가 볼 것이 아니다 — 판정은 Fastify 가 한다.
 */
export async function GET() {
  return forwardGetJson('/contracts/rooms');
}
