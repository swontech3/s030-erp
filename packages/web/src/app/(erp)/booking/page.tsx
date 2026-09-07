/** @screen s0300600010 예약 현황 · 060 공간운영 · 1차 */

/**
 * 예약 현황 — **이번 페이즈에서는 빈 화면이어도 된다**(지시서 2-9).
 * 화면 이관은 design/erp-booking/ 을 기준으로 페이즈 5에서 한다.
 */
import { redirect } from 'next/navigation';
import { getMe, verifyScreen } from '@/lib/session';

export default async function BookingPage() {
  const me = await getMe();
  if (!me) redirect('/login');

  await verifyScreen('s0300600010', '/booking');

  return (
    <main style={{ padding: 32 }}>
      <h1 style={{ fontSize: 'var(--text-h2-size)', color: 'var(--text-heading)' }}>예약 현황</h1>
      <p style={{ color: 'var(--text-muted)' }}>화면 이관은 페이즈 5에서 한다 (design/erp-booking).</p>
    </main>
  );
}
