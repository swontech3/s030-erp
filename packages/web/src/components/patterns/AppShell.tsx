'use client';

/**
 * ERP 셸 s030000050 — 원본: design/erp-tenants/ErpTenants.dc.html 의 <aside> + 헤더.
 *
 * ★ erp-dashboard · erp-settings 의 셸은 정적이라 참고하지 않았다. 접기·툴팁·상태 저장이
 *   온전한 것은 erp-tenants 뿐이다(지시서 2-7).
 *
 * 원본에서 옮긴 것
 *   <aside> 마크업 + 토글 버튼 + bindSidebar() / applySidebar() 의 동작
 *
 * 옮기면서 바뀐 것 세 가지 (전부 이유가 있다)
 *
 * 1. **접힘 상태의 저장소가 localStorage → 쿠키다.** 아래 onToggle 주석 참조.
 *    이 컴포넌트는 초기값을 **서버가 준 prop 으로만** 받는다 — 마운트 후에 읽어
 *    고치는 코드가 없어야 깜빡임이 사라진다.
 *
 * 2. **applySidebar() 의 인라인 스타일 조작이 전부 CSS 클래스 하나로 바뀌었다.**
 *    원본은 querySelector 로 DOM 을 직접 만진다. React 에서 그러면 서버가 그린
 *    첫 화면과 어긋나고, 그 어긋남이 곧 깜빡임이다. 상태는 `.collapsed` 하나뿐이고
 *    폭·패딩·라벨·툴팁·토글 위치는 AppShell.module.css 가 판단한다.
 *
 * 3. **항목을 하드코딩하지 않는다.** 원본의 입주사·청구·세무·호실·설정 5개는
 *    템플릿 예시다. 실제 항목은 삐용이 준 화면 목록에서 나온다(ACL-07′) —
 *    ERP 가 역할을 보고 거르지 않는다.
 */

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/ds';
import { UserMenu } from './UserMenu';
import { SIDEBAR_COOKIE, SIDEBAR_COOKIE_MAX_AGE, screenNameForPath, type NavItem } from '@/lib/sidebar';
import styles from './AppShell.module.css';
/* ★ 2026-10-22 — 서로 안에 뜨는 모드 · 로그인 한 번(대표 지시 「2번」) */
import { embeddedNow, startOuterLogin } from '@/lib/embed';

export interface AppShellDisplay {
  memberName: string;
  orgName: string;
}

/** 머리말의 삐용 연동 대기 표시. 숫자와 갈 곳만 — 판정은 서버가 끝냈다. */
export interface AppShellLinkAlert {
  /** 대기 건수(회사 연동 + 직원 연동). */
  total: number;
  /** 그중 **저절로 풀리지 않는** 것. 1건이라도 있으면 문구가 「손봐야 합니다」로 바뀐다. */
  needsHand: number;
  /** [보기] 가 갈 곳. 계약이 있으면 그 계약 폼, 없으면 입주사 목록이다. */
  href: string;
}

export interface AppShellProps {
  /** ★ 서버가 쿠키에서 읽어 넘긴 값. 클라이언트가 다시 읽지 않는다. */
  initialCollapsed: boolean;
  /** 삐용이 준 화면 목록에서 만들어진 항목. 여기서 더 거르지 않는다. */
  items: NavItem[];
  /** 로고를 눌렀을 때 가는 곳. 홈 분기 결과(/dashboard · /booking …)다. */
  homeRoute: string;
  /** 헤더 표시값. **표시 전용** — 이 값으로 메뉴를 열고 닫지 않는다(지시문 1-6). */
  display: AppShellDisplay | null;
  /**
   * 권한 안내 — 「운영 관리자 · 전체 예약 내용 표시」/「입주사 · 타사 예약은 …」.
   *
   * ★ 시안은 이 문구를 **셸 헤더**에 둔다(`room-booking/02-booking.md` §1). 셸은 모든
   *   화면이 함께 쓰므로 **반응형 화면(/booking)에서만** 그린다 — 다른 화면에는 이런
   *   문구가 없다. 1280 미만에서는 자리가 없어 CSS 가 감춘다.
   * ★ 표시 전용이다. 이 문구로 무엇을 열고 닫지 않는다(지시문 1-6).
   */
  roleNote?: string | null;
  /**
   * 삐용 연동 대기 — **어느 화면에서든 보이게** 머리말에 띄운다(036 · 결정 2026-10-05).
   *
   * ★★ 전에는 운영자가 **그 계약 화면을 열어야만** 대기를 알았다. 다른 일 하다 보면
   *    묻히고, 그동안 그 입주사는 삐용에 로그인할 수 없었다. 셸은 모든 화면이 함께
   *    쓰므로 여기 한 줄이면 어디서든 보인다.
   * ★ **조회 + 링크뿐이다.** [다시 시도] 는 계약 폼 하나다(`CLAUDE.md` 한 업무 한 화면).
   * ★ `null` 이면 **아무것도 그리지 않는다** — 0건에도 늘 떠 있으면 아무도 안 본다.
   * ★ 운영사에게만 내려온다(레이아웃이 거른다). 입주사에게는 보이지 않는다.
   */
  linkAlert?: AppShellLinkAlert | null;
  children: React.ReactNode;
}

/** 반응형으로 그리는 화면 — 여기 없는 경로는 1440px 고정 그대로다. */
const RESPONSIVE_ROUTES = new Set(['/booking']);

export function AppShell({ initialCollapsed, items, homeRoute, display, roleNote, linkAlert, children }: AppShellProps) {
  /*
   * ★★ 초기값이 서버가 준 prop 그대로다 — 이것이 깜빡임 없음의 전부다.
   *    useEffect 로 마운트 후에 고치거나, 여기서 document.cookie 를 다시 읽으면
   *    첫 페인트가 한 번 틀렸다가 고쳐지고, 그게 눈에 보이는 깜빡임이 된다.
   */
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const pathname = usePathname();

  /*
   * ★ 2026-10-22 — 다른 화면(삐용) 안에 떠 있으면 사이드바 · 접기 · 상단 띠를 그리지 않는다(바깥 틀이 그린다).
   *   서버는 iframe 인지 모른다 — 마운트 뒤에 안다(한 번 그렸다가 숨긴다).
   * ★ 맨 위에 혼자 열렸으면 내 안에 뜬 삐용 화면이 「준비됨」을 보낼 때 삐용 토큰을 넘긴다(embedBridge).
   */
  const [embedded, setEmbedded] = useState(false);
  useEffect(() => {
    setEmbedded(embeddedNow());
  }, []);
  useEffect(() => startOuterLogin(), []);

  /*
   * ★★★ **반응형은 정해진 화면에서만** 한다 — 회의실 예약·현황판 둘뿐이다
   *    (`doc/SWONBIZ_PROJECT_STRUCTURE.md` §5 · `room-booking/08-responsive.md` §1).
   *
   *    ERP 는 데스크톱 업무 도구라 셸이 `min-width:1440px` 로 고정돼 있다. 그 고정을
   *    전 화면에서 풀면 계약 폼·청구 표가 좁은 창에서 무너진다 — 그래서 **이 경로일 때만**
   *    고정을 풀고 사이드바를 레일(768~1279)·드로어(767 이하)로 바꾼다.
   *    판정은 경로 하나로 한다. 페이지가 클래스를 올려 주는 방식은 첫 페인트가 한 번
   *    틀렸다가 고쳐져 깜빡인다.
   */
  const responsive = RESPONSIVE_ROUTES.has(pathname);
  const [drawer, setDrawer] = useState(false);

  /*
   * ══════════════════════════════════════════════════════════════════════════
   * ★★★ 로그아웃한 뒤 [뒤로] 로 업무 화면이 되살아나지 않게 한다
   * ══════════════════════════════════════════════════════════════════════════
   * 2026-09-30 에 실제로 재현했다: 로그아웃해서 세션이 죽은 뒤 [뒤로] 를 누르면
   * 대시보드가 이름·회사와 함께 그대로 다시 떴다. **네트워크 요청이 한 번도 나가지
   * 않아** 미들웨어(`proxy.ts`)도 서버 컴포넌트도 끼어들 자리가 없었다.
   *
   * 되살아나는 길이 둘이고, 둘 다 막는다.
   *   ① 캐시에서 문서를 새로 만든다 — `navigation.type === 'back_forward'`.
   *      Next 가 붙이는 `no-cache` 는 **[뒤로] 의 재사용을 막지 못한다**(막는 것은
   *      `no-store` 다). 이쪽이 실제로 재현된 경로다
   *   ② bfcache 에서 문서를 통째로 되살린다 — `pageshow` 의 `persisted === true`
   *
   * 어느 쪽이든 **다시 불러온다.** `no-cache` 라 재검증 요청이 나가고, 쿠키가 없으니
   * `/login` 으로 간다. 되돌아온 문서의 `navigation.type` 은 `reload` 라 반복되지 않는다.
   *
   * ★ **화면 안에서 [뒤로] 를 누르는 것은 여기 걸리지 않는다.** 그건 같은 문서 안의
   *   클라이언트 이동이라 이 효과가 다시 돌지 않는다(셸은 레이아웃이라 계속 떠 있다).
   *   걸리는 것은 **문서가 새로 만들어질 때**뿐이고, 로그아웃 → [뒤로] 가 그 경우다.
   *
   * ★ 셸 안(로그인이 필요한 화면)에서만 돈다. 공개 화면(현황판·문의 게시판)은 이
   *   컴포넌트를 쓰지 않는다 — 거기엔 지킬 것이 없다.
   *
   * ★★ `next.config.ts` 의 `no-store` 가 **제대로 된 해법**이고 그것도 같이 넣어 뒀다.
   *    다만 그 설정은 개발 서버를 다시 띄워야 반영된다 — 이 코드는 그와 무관하게
   *    브라우저 쪽에서 한 번 더 막는 안전장치다. 둘 다 있어도 부딪히지 않는다.
   *
   * ★★★ 이것은 편의가 아니라 **안전장치**다. 공용 PC 에서 로그아웃하고 자리를 뜬 뒤
   *      다음 사람이 [뒤로] 를 누르는 것이 이 코드가 막는 상황이다.
   */
  useEffect(() => {
    const [nav] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    if (nav?.type === 'back_forward') {
      window.location.reload();
      return;
    }

    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) window.location.reload();
    }
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  /*
   * 헤더 제목은 경로에서 끌어온다. 서버 컴포넌트인 layout 은 현재 경로를 알 수 없고
   * (usePathname 은 클라이언트 훅이다), 페이지마다 title 을 넘기게 하면 화면 이름이
   * screens.ts 와 페이지 두 곳에 생겨 어긋난다.
   */
  const title = screenNameForPath(pathname);

  function onToggle() {
    const next = !collapsed;
    setCollapsed(next);

    /*
     * ★★ 원본은 localStorage 에 저장한다. App Router 에서는 서버가 localStorage 를
     *    읽지 못해 첫 렌더가 항상 "펼침"으로 나가고, 브라우저가 붙으면서 "접힘"으로
     *    바뀐다 — 새로고침할 때마다 사이드바가 한 번 깜빡인다.
     *    쿠키는 요청에 실려 가므로 서버가 첫 렌더부터 맞게 그린다.
     *
     * ★ HttpOnly 를 걸 수 없다 — 이 줄이 바로 클라이언트가 쓰는 자리다.
     *   세션이 아니라 화면 상태값이라 노출돼도 잃을 것이 없다.
     * ★ SameSite=Lax — 외부 사이트에서 넘어온 요청에는 실리지 않는다. 그래도
     *   최악의 경우가 "사이드바가 펼쳐진 채로 뜬다"라 위험이 없다.
     */
    document.cookie = `${SIDEBAR_COOKIE}=${next ? '1' : '0'}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}; SameSite=Lax`;
  }

  const toggleLabel = collapsed ? '사이드바 펼치기' : '사이드바 접기';

  return (
    <div
      className={
        `${styles.shell}` +
        (collapsed ? ` ${styles.collapsed}` : '') +
        (responsive ? ` ${styles.responsive}` : '') +
        (drawer ? ` ${styles.drawerOpen}` : '')
      }
    >
      {embedded ? null : (
      <aside className={styles.aside}>
        <div className={styles.logoWrap}>
          {/* 원본에서도 로고가 곧 홈 진입점이다(data-nav="dashboard"). */}
          <Link href={homeRoute} className={styles.logo}>
            <Image
              src="/brand/swonbiz-logo.png"
              alt="SwonBiz"
              /* ★ 로고 원본은 32x51 이다. 정사각(24x24)으로 주면 next/image 가 비율이
                 어긋났다고 경고한다 — 원본 비율을 주고 높이만 CSS 로 맞춘다. */
              width={32}
              height={51}
              className={styles.logoImg}
              style={{ height: 24, width: 'auto' }}
              priority
            />
            <span className={`${styles.wordmark} ${styles.label}`}>
              S<span className={styles.wordmarkDot}>·</span>won<span className={styles.wordmarkSuffix}>Biz</span>
            </span>
            <span className={styles.tip}>홈</span>
          </Link>
        </div>

        <nav className={styles.nav}>
          {items.map((item) => {
            // 상세 화면(/tenants/123)에서도 목록 항목이 켜져 있어야 한다.
            const active = pathname === item.route || pathname.startsWith(`${item.route}/`);
            return (
              <Link
                key={item.screenId}
                href={item.route}
                className={`${styles.item}${active ? ` ${styles.itemActive}` : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                <Icon name={item.icon} size={18} />
                <span className={styles.label}>{item.name}</span>
                {/* 접힌 레일에서는 라벨이 없으므로 툴팁이 이름을 대신한다. */}
                <span className={styles.tip}>{item.name}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
      )}

      {/* ★ 767 이하에서 사이드바가 덮개로 뜬다 — 바깥을 누르면 닫힌다 */}
      {responsive ? (
        <div
          className={styles.scrim}
          role="presentation"
          data-scrim="1"
          onClick={() => setDrawer(false)}
        />
      ) : null}

      {embedded ? null : (
      <button type="button" className={styles.toggle} onClick={onToggle} aria-label={toggleLabel}>
        <Icon name={collapsed ? 'chevron-right' : 'chevron-left'} size={14} />
        <span className={styles.toggleTip}>{toggleLabel}</span>
      </button>
      )}

      <div className={styles.column}>
        {embedded ? null : (
        <header className={styles.header}>
          {responsive ? (
            <button
              type="button"
              className={styles.hamburger}
              aria-label="메뉴 열기"
              data-hamburger="1"
              onClick={() => setDrawer((open) => !open)}
            >
              <Icon name="menu" size={20} />
            </button>
          ) : null}
          <div>
            {/* TODO(페이즈 3): 지점명은 기준설정(s030100010)이 생기면 실제 값으로 바꾼다. */}
            <div className={styles.crumb}>{display ? display.orgName : ''}</div>
            <div className={styles.title}>{title}</div>
          </div>
          <div className={styles.spacer} />
          {responsive && roleNote ? (
            <span className={styles.roleNote} data-role-note="1">
              {roleNote}
            </span>
          ) : null}

          {/*
            ══════════════════════════════════════════════════════════════════
            ★★ 삐용 연동 대기 — 어느 화면에서든 보인다 (036)
            ══════════════════════════════════════════════════════════════════
            ★ 0건이면 prop 이 `null` 이라 **이 줄 자체가 없다**. 늘 떠 있는 표시는
              며칠 안에 배경이 되어 아무도 안 본다.
            ★ 문구가 둘이다 — 저절로 다시 보내는 중(「연동 대기」)과 더 보내도 안 되는
              것(「손봐야 합니다」). 판정은 서버가 했고 화면은 `needsHand` 만 본다.
            ★ [보기] 는 **그 계약 폼으로 보낸다** — 처리는 거기서 한다(한 업무 한 화면).
          */}
          {linkAlert ? (
            <Link
              href={linkAlert.href}
              className={styles.linkAlert}
              data-bbiyong-alert={linkAlert.needsHand > 0 ? 'manual' : 'pending'}
            >
              <Icon name="circle-alert" size={14} />
              <span>
                삐용 {linkAlert.needsHand > 0 ? '연동 — 손봐야 합니다' : '연동 대기'} {linkAlert.total}건
              </span>
              <span className={styles.linkAlertGo}>보기</span>
            </Link>
          ) : null}
          {/*
            ★ 도움말(circle-help)·알림(bell) 아이콘 버튼 2개를 **뺐다**(2026-09-30).
              시안 `common/04-shell.md` 「우측: 아이콘 버튼(도움·알림 36px)」에는 있지만
              **아무 일도 하지 않는 버튼**이었다 — 누르면 아무 반응이 없는 것이
              「아직 안 만든 것」인지 「고장난 것」인지 사용자는 구분할 수 없다.
              만들 때 되돌린다. 자리와 이유는 `doc/DESIGN_HANDOFF_DIFF.md` §G 에 적었다.
          */}

          {/*
            ══════════════════════════════════════════════════════════════════
            계정 메뉴 — **화면에서 로그아웃할 유일한 길**
            ══════════════════════════════════════════════════════════════════
            시안의 계정 블록은 표시 전용이다(`04-shell.md`). 그대로 두면 로그인한
            사람이 나갈 길이 없어 주소를 직접 치거나 쿠키를 지워야 한다 — 그래서
            **누를 수 있게** 바꾸고 그 안에 [로그아웃] 을 둔다.

            ★ 접근권한없음 화면(`/no-access`)에도 로그아웃이 있지만 그쪽은 **셸이 없는**
              화면이다(AuthShell). 둘은 서로 닿지 않는 출구다(대표 결정 2026-09-30).
          */}
          <UserMenu display={display} />
        </header>
        )}

        <main className={styles.main}>{children}</main>
      </div>
    </div>
  );
}
