import { forwardPublicGetJson } from '@/lib/forward';

/**
 * 문의 유형·상태 코드 (QU_TP · QU_ST) — **인증 없음**.
 *
 * ★ 화면에 「입주문의」·「접수」 같은 문자열을 박지 않는다. 버튼·뱃지·검색 Select 가
 *   전부 이 응답으로 그려진다 — 코드 마스터에서 이름을 고치면 화면이 따라간다.
 */
export async function GET() {
  return forwardPublicGetJson('/inquiries/codes');
}
