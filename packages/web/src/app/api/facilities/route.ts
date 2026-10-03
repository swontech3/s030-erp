import { forwardGetJson } from '@/lib/forward';

/**
 * 회의실 목록 (s030600010) — `GET /facilities`.
 *
 * ★ 운영시간·최소·최대·30분 요금이 **회의실마다 데이터로** 내려온다. 화면은 그 값으로
 *   슬롯을 그리고 같은 값으로 미리 막는다 — 상수를 두지 않는다(`reservation-rules.ts`).
 * ★ 조회는 입주사도 한다 — 자기가 예약할 방을 봐야 한다.
 */
export async function GET() {
  return forwardGetJson('/facilities');
}
