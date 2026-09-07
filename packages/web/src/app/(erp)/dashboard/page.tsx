/** @screen s0300000060 대시보드 · 000 공통 · 1차 */

/**
 * 대시보드 — **이번 페이즈에서는 빈 화면이어도 된다**(지시서 2-9).
 * 화면 이관은 design/erp-dashboard/ 를 기준으로 페이즈 3에서 한다.
 *
 * 지금 여기 있는 것은 세션 게이트 하나다. 셸(s0300000050)은 2-7 에서 붙고,
 * 그때 이 파일의 <main> 만 셸 안으로 들어간다.
 */
import { redirect } from 'next/navigation';
import { getMe, verifyScreen } from '@/lib/session';

export default async function DashboardPage() {
  const me = await getMe();
  // 쿠키는 있는데 세션이 죽은 경우. proxy.ts 는 쿠키 존재만 보므로 여기서 걸린다.
  if (!me) redirect('/login');

  // 1단계 shadow — 통과시키되 목록에 없으면 tb_s080_acl_shadow_log 에 DENY 로 남는다.
  await verifyScreen('s0300000060', '/dashboard');

  return (
    <main style={{ padding: 32 }}>
      <h1 style={{ fontSize: 'var(--text-h2-size)', color: 'var(--text-heading)' }}>대시보드</h1>
      <p style={{ color: 'var(--text-muted)' }}>화면 이관은 페이즈 3에서 한다 (design/erp-dashboard).</p>
    </main>
  );
}
