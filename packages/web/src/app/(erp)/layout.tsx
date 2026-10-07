/** @screen s030000050 ERP 셸 · 000 공통 · 1차 — 라우트 없음(레이아웃) */

/**
 * (erp) 그룹의 셸. 인증이 필요한 화면(000·010·020·030·040·060)이 전부 이 안에 들어간다.
 *
 * 서버 컴포넌트인 이유가 둘 있고, 둘 다 중요하다.
 *
 * 1. **접힘 상태 쿠키를 첫 렌더에 읽어야 한다.** 클라이언트에서 읽으면 첫 페인트가
 *    항상 "펼침"으로 나갔다가 고쳐진다 — 그게 깜빡임이다(지시서 2-7-1).
 * 2. **화면 목록을 서버에서 받아야 한다.** 브라우저는 Fastify 에 직접 붙지 않는다.
 *
 * ★ 여기서 하는 것은 UX 게이트와 조립뿐이다. 실제 차단은 Fastify 가 한다.
 */
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { AppShell } from '@/components/patterns/AppShell';
import { getMe, getBbiyongPending } from '@/lib/session';
import { buildNavItems, SIDEBAR_COOKIE } from '@/lib/sidebar';

export default async function ErpLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();

  // 쿠키는 있는데 세션이 죽은 경우(만료·폐기). proxy.ts 는 쿠키 존재만 보므로 여기서 걸린다.
  if (!me) redirect('/login');

  // 접근 가능 화면이 0건이면 셸을 그릴 것이 없다 — 안내 화면으로 보낸다(AUTH-13).
  if (me.screens.length === 0) redirect('/no-access');

  /*
   * ★★ 삐용 연동 대기 — **운영사에게만** 읽는다(결정 2026-10-05). 입주사 요청에서는
   *    부르지도 않는다: 남의 회사 연동 상태를 보는 자리가 되어서는 안 된다.
   * ★ 실패해도 셸은 그린다(`getBbiyongPending` 이 null 을 돌려준다) — 이 표시 하나
   *   때문에 전 화면이 못 뜨면 그게 더 나쁘다.
   */
  const linkAlert = me.role === 'operator' ? await getBbiyongPending() : null;

  const store = await cookies();
  const initialCollapsed = store.get(SIDEBAR_COOKIE)?.value === '1';

  return (
    <AppShell
      initialCollapsed={initialCollapsed}
      /* ★ 삐용이 준 목록만 넘긴다. 역할로 거르는 코드는 이 경로 어디에도 없다(ACL-07′). */
      items={buildNavItems(me.screens)}
      linkAlert={linkAlert}
      homeRoute={me.home}
      display={me.display}
      /*
       * ★ 권한 안내 문구 — **회의실 예약 화면에서만** 헤더에 뜬다(시안 02-booking.md §1).
       *   역할은 서버가 안다. 셸은 이 문구를 그리기만 하고 판정에 쓰지 않는다.
       */
      roleNote={
        me.role === 'operator'
          ? '운영 관리자 · 전체 예약 내용 표시'
          : '입주사 · 타사 예약은 「예약됨」으로만 표시됩니다'
      }
    >
      {children}
    </AppShell>
  );
}
