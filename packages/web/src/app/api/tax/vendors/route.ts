import { forwardGetJson } from '@/lib/forward';

/**
 * 세무 거래처 — `GET /tax/vendors` (Fastify) 로 넘긴다. 목록 전부 — 거르기는 화면이 한다(2026-11-07 달 · 「N월 거래」 뺌).
 * ★ 이 홉은 판정하지 않는다. 단체 범위 · 본문 검사는 전부 Fastify 가 본다.
 */
export async function GET() {
  return forwardGetJson('/tax/vendors');
}
