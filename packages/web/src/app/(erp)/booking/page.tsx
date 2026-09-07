/** @screen s0300600010 예약 현황 · 060 공간운영 · 1차 */

/**
 * 예약 현황 — **이번 페이즈에서는 빈 화면이다**(지시서 2-9·2-7 4항).
 * 화면 이관은 design/erp-booking/ 을 기준으로 페이즈 5에서 한다.
 */
import { verifyScreen } from '@/lib/session';

export default async function BookingPage() {
  await verifyScreen('s0300600010', '/booking');

  return (
    <div>
      <h2 style={{ margin: 0, fontSize: 'var(--text-h3-size)', color: 'var(--text-heading)' }}>예약 현황</h2>
      <p style={{ marginTop: 6, fontSize: 14, color: 'var(--text-muted)' }}>
        화면 이관은 페이즈 5에서 한다 (design/erp-booking).
      </p>
    </div>
  );
}
