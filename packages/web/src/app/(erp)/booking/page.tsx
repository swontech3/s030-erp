/** @screen s0300600010 회의실 예약 · 060 공간운영 */

/**
 * 회의실 예약 — 사이드바 「예약」.
 *
 * 원본: design/erp-booking/ErpBooking.dc.html (주간 그리드 + 등록 모달)
 * 모양: design/handoff (표·버튼·뱃지) ← 청구 화면과 같은 규칙
 *
 * =============================================================================
 * ★★ 이 화면은 **입주사도 본다** — 운영사 전용이 아니다
 * =============================================================================
 * 예약은 입주사가 직접 잡는 업무다. 그래서 `requireScreen`(운영사 전용 잠금)이 아니라
 * `verifyScreen` 을 쓴다 — 청구 화면(`/billing`)과 반대다. 입주사 세션에서는
 *   · 자기 회사 예약만 상세로 보인다(RLS · 003) — 남의 예약은 **자리만** 보인다
 *     (026 의 `erp_busy_slots` 가 시각만 준다. 「예약됨」으로 잠긴다)
 *   · 지난 시각·4주·하루 2시간 한도가 걸린다
 *   · 종료 처리를 할 수 없다(취소는 자기 예약이면 된다)
 * 운영자는 셋 다 예외다. 그 갈림은 `role` 하나로 내려간다.
 *
 * ★★ 한 업무는 한 화면에서(CLAUDE.md) — 예약 만들기·취소·종료는 여기에만 있다.
 * ★ 이번 범위 밖 — 외부 온라인 예약 · 키오스크(design/erp-booking-kiosk) · 월간 보기.
 *
 * 데이터는 클라이언트가 받는다 — 주를 넘길 때마다 서버 렌더를 다시 돌리지 않으려고.
 */
import { redirect } from 'next/navigation';
import { getMe, verifyScreen } from '@/lib/session';
import { BookingView } from '@/features/booking/BookingView';

export default async function BookingPage() {
  await verifyScreen('s0300600010', '/booking');
  const me = await getMe();
  if (!me) redirect('/login');

  return (
    <BookingView
      operator={me.role === 'operator'}
      companyId={me.companyId}
      // ★ 예약자 정보 블록의 기본값 — 표시 전용이다(판정에 쓰지 않는다).
      me={{ memberName: me.display?.memberName ?? '', orgName: me.display?.orgName ?? '' }}
    />
  );
}
