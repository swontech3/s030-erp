/** @screen s030200090 내 청구서 · 020 입주사관리 — 입주사 보기 전용 · 앱 1단계 7-나 */

/**
 * 내 청구서 — 보기 전용 (대표 지시 2026-11-08).
 *
 * ★★ 입주사 화면이다. `requireScreen` 이 막는다 — 운영사 계정에는 이 화면 코드가 없어 /no-access 로 간다
 *    (운영사는 청구 화면 /billing 에서 본다). 보호 경로는 `proxy.ts` 의 `/billing/:path*` 가 이미 덮는다.
 * ★★ 처리 버튼이 없다 — 청구 · 수납 처리는 운영사 /billing 한 곳(CLAUDE.md 「한 업무는 한 화면에서」).
 *    카드 결제는 2단계다.
 * ★ 앱 웹뷰 안이면 셸이 감춰진다(5-나 레이아웃 `inApp`) — 앱 홈 「청구서」(S0221A3030)가 이 경로를 연다.
 */
import { requireScreen } from '@/lib/session';
import { MyInvoicesView } from '@/features/billing/MyInvoicesView';

export default async function MyInvoicesPage() {
  await requireScreen('s030200090', '/billing/mine');
  return <MyInvoicesView />;
}
