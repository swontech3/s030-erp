'use client';

/**
 * 계정 메뉴 — 머리 오른쪽의 이름·회사를 누르면 열리고, 그 안에 [로그아웃] 이 있다.
 *
 * =============================================================================
 * ★★★ 이것이 화면에서 **로그아웃할 유일한 길**이다
 * =============================================================================
 * 이 메뉴가 생기기 전에는 로그인한 사람이 나갈 길이 없었다 — 주소를 직접 치거나
 * 브라우저에서 쿠키를 지워야 했다. 그래서 이 컴포넌트가 고장나면 사용자가 갇힌다.
 * (셸이 없는 접근권한없음 화면 `/no-access` 에는 자기 로그아웃이 따로 있다.)
 *
 * =============================================================================
 * ★★ 로그아웃은 **form POST 다** — 링크가 아니다
 * =============================================================================
 * `<a href="/api/auth/logout">` 로 두면 브라우저·확장의 **프리페치만으로 로그아웃된다.**
 * 그리고 POST 만으로도 부족하다: 다른 사이트의 자동 제출 폼도 POST 라, 서버가 출처를
 * 본다(`lib/csrf.ts`). 같은 오리진에서 온 이 폼은 통과한다.
 *
 * ★ 자바스크립트 없이도 동작한다. 메뉴를 여는 것만 JS 이고, 누르는 순간은 순수 폼
 *   제출이다 — `/no-access` 의 로그아웃과 같은 방식이다.
 *
 * ★★ 서버가 하는 일은 이미 다 있다(3장): `revoked_at` 설정 → 삐용 sign-out →
 *    쿠키 삭제 → 303 `/login`. 여기서 다시 하지 않는다.
 */

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/ds';
import styles from './AppShell.module.css';

export interface UserMenuDisplay {
  memberName: string;
  orgName: string;
}

export function UserMenu({ display }: { display: UserMenuDisplay | null }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();

  /*
   * 화면을 옮기면 닫는다. 메뉴가 열린 채로 다른 화면에 남아 있으면 그 화면의 첫
   * 클릭이 「메뉴 닫기」로 먹힌다.
   */
  useEffect(() => setOpen(false), [pathname]);

  /*
   * 바깥 클릭 · Esc 로 닫는다.
   *
   * ★ 열려 있을 때만 듣는다. 항상 걸어 두면 모든 화면의 모든 클릭이 이 핸들러를 거친다.
   * ★ `pointerdown` 이다 — `click` 으로 들으면 메뉴 안의 버튼을 누를 때 먼저 닫혀서
   *   대상이 사라지고, 브라우저에 따라 제출이 취소된다.
   */
  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      setOpen(false);
      // ★ 포커스를 되돌린다. 안 되돌리면 키보드 사용자가 문서 맨 위로 떨어진다.
      buttonRef.current?.focus();
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.userWrap} ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`${styles.user}${open ? ` ${styles.userOpen}` : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        /* ★ 이름이 비어 있을 수 있다(삐용 표시정보를 못 받은 세션). 그래도 **버튼은 있다** —
             이름이 없다고 로그아웃할 길까지 사라지면 안 된다. */
        aria-label={display ? `${display.memberName} 계정 메뉴` : '계정 메뉴'}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.avatar} aria-hidden="true">
          {display?.memberName.slice(0, 1) ?? ''}
        </span>
        <span className={styles.userText}>
          <span className={styles.userName}>{display?.memberName ?? ''}</span>
          <span className={styles.userOrg}>{display?.orgName ?? ''}</span>
        </span>
        <Icon name="chevron-down" size={16} className={styles.userCaret} />
      </button>

      {open ? (
        <div className={styles.userMenu} role="menu">
          {/*
            ★ 이름·회사를 메뉴 안에도 적는다. 좁은 화면(`.responsive`)에서는 헤더의
              `.userText` 가 감춰져 아바타만 남으므로, 여기가 **누구로 로그인했는지**
              확인할 수 있는 유일한 자리가 된다.
          */}
          <div className={styles.userMenuHead}>
            <div className={styles.userMenuName}>{display?.memberName ?? ''}</div>
            <div className={styles.userMenuOrg}>{display?.orgName ?? ''}</div>
          </div>

          {/* ★ 링크가 아니라 폼이다 — 위 머리말 참조. */}
          <form action="/api/auth/logout" method="post">
            <button type="submit" className={styles.userMenuItem} role="menuitem">
              <Icon name="door-open" size={16} />
              로그아웃
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
