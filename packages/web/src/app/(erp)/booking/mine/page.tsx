/** @screen s030600010 회의실 예약 · 060 공간운영 — 내 예약(보기 전용) · 앱 1단계 6-나 */

/**
 * 내 예약 — 보기 전용 (대표 지시 2026-11-07).
 *
 * ★★ 화면 코드 · 보호 경로는 예약 화면(/booking)과 **같다** — 새 화면 코드를 만들지 않는다.
 *    보호 경로는 `proxy.ts` 의 `/booking/:path*` 가 이미 덮는다. 입장 검사도 예약 화면과 같은
 *    `verifyScreen`(1단계 shadow — 기록만)이다. 보이는 범위는 서버 RLS 가 정한다(자기 회사 예약만).
 * ★★ 처리 버튼이 없다 — 예약 · 수정 · 취소는 /booking 한 곳(CLAUDE.md 「한 업무는 한 화면에서」).
 * ★ 앱 웹뷰 안이면 셸이 감춰진다(5-나 레이아웃 `inApp`) — 화면 모양에만 쓴다.
 */
import { redirect } from 'next/navigation';
import { getMe, verifyScreen } from '@/lib/session';
import { MyBookingsView } from '@/features/booking/MyBookingsView';

export default async function MyBookingsPage() {
  await verifyScreen('s030600010', '/booking/mine');
  const me = await getMe();
  if (!me) redirect('/login');

  return <MyBookingsView />;
}
