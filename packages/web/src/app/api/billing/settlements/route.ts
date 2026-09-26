import { forwardGetJson } from '@/lib/forward';

/**
 * 정산 탭 — 처리 대기(중도해지 정산 · 예치금 반환)와 최근 처리 완료.
 * ★ 목록이라 계좌번호는 Fastify 가 가려서 준다.
 */
export async function GET() {
  return forwardGetJson('/billing/settlements');
}
