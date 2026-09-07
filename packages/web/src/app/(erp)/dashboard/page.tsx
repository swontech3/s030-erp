/** @screen s0300000060 대시보드 · 000 공통 · 1차 */

/**
 * 대시보드 — **이번 페이즈에서는 빈 화면이다**(지시서 2-9·2-7 4항).
 * 화면 이관은 design/erp-dashboard/ 를 기준으로 페이즈 3에서 한다.
 *
 * 셸(s0300000050)과 세션 게이트는 (erp)/layout.tsx 가 맡는다. 여기 남은 것은
 * 화면 접근 기록 한 줄과 내용뿐이다.
 */
import { verifyScreen } from '@/lib/session';

export default async function DashboardPage() {
  // 1단계 shadow — 통과시키되 목록에 없으면 tb_s080_acl_shadow_log 에 DENY 로 남는다.
  await verifyScreen('s0300000060', '/dashboard');

  return (
    <div>
      <h2 style={{ margin: 0, fontSize: 'var(--text-h3-size)', color: 'var(--text-heading)' }}>대시보드</h2>
      <p style={{ marginTop: 6, fontSize: 14, color: 'var(--text-muted)' }}>
        화면 이관은 페이즈 3에서 한다 (design/erp-dashboard).
      </p>
    </div>
  );
}
