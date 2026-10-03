'use client';

/**
 * 랜딩 머리 — 72px sticky · 로고 + 섹션 네비 5 + [로그인] + [무료 상담].
 *
 * ★★ **문의상담의 `PublicShell` 과 다른 머리다**(2026-10-01 결정). 그쪽은 64px 에
 *    로고와 전화번호뿐이고 본문이 800px 다. 랜딩에는 섹션 네비와 로그인·상담 버튼이
 *    있어야 해서 시안대로 따로 뒀다.
 *    ★ 다만 **로고 이미지와 워드마크는 같은 것**을 쓴다(`/brand/swonbiz-logo.png`) —
 *      랜딩에서 문의상담으로 넘어갔을 때 다른 사이트로 보이면 안 된다.
 *
 * ★ 'use client' 가 필요한 이유: 767 이하의 덮개 드로어(열림 상태) 하나뿐이다.
 *   네비는 그냥 앵커라서 서버에서 그려도 되지만, 드로어와 같은 마크업을 쓴다.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, Icon } from '@/components/ds';
import styles from './landing.module.css';
import { NAV, inquiryHref } from './landing-model';

export function LandingHeader() {
  const [open, setOpen] = useState(false);

  /**
   * 폭이 md 이상으로 넓어지면 드로어를 닫는다.
   *
   * ★ 닫지 않으면 드로어가 `display:none` 으로 사라진 채 **열린 상태로 남는다**.
   *   그 상태에서 다시 좁히면 아무도 누르지 않았는데 메뉴가 펼쳐져 있다.
   */
  useEffect(() => {
    if (!open) return;
    const mq = window.matchMedia('(min-width: 768px)');
    const close = () => setOpen(false);
    if (mq.matches) close();
    mq.addEventListener('change', close);
    return () => mq.removeEventListener('change', close);
  }, [open]);

  /* 드로어가 열린 동안 뒤 본문이 스크롤되지 않게 한다 */
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <header className={styles.head}>
      <div className={styles.headIn}>
        {/* 로고는 랜딩 맨 위로 — 시안의 href="#" 자리다 */}
        <a className={styles.brand} href="#top">
          {/* eslint-disable-next-line @next/next/no-img-element -- 고정 크기 워드마크 하나(PublicShell 과 같은 이유) */}
          <img src="/brand/swonbiz-logo.png" alt="SwonBiz" />
          <span className={styles.wordmark}>
            S<span className={styles.dot}>·</span>won<span className={styles.biz}>Biz</span>
          </span>
        </a>

        <nav className={styles.nav}>
          {NAV.map((n) => (
            <a key={n.href} className={styles.navLink} href={n.href}>
              {n.label}
            </a>
          ))}
        </nav>

        <div className={styles.headRight}>
          {/* 시안은 href="#" 다. 로그인 화면이 하나뿐이라 거기로 잇는다 */}
          <Link className={styles.login} href="/login">
            로그인
          </Link>
          <Button as="a" size="sm" href={inquiryHref('상담')}>
            무료 상담
          </Button>
        </div>

        {/* 767 이하 — AppShell 과 같은 방식(햄버거 → 덮개) */}
        <button
          type="button"
          className={styles.burger}
          aria-label={open ? '메뉴 닫기' : '메뉴 열기'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name={open ? 'x' : 'menu'} size={20} />
        </button>
      </div>

      {open ? (
        <>
          <div
            className={styles.drawerVeil}
            role="presentation"
            onClick={() => setOpen(false)}
          />
          <div className={styles.drawer}>
            {NAV.map((n) => (
              <a
                key={n.href}
                className={styles.navLink}
                href={n.href}
                onClick={() => setOpen(false)}
              >
                {n.label}
              </a>
            ))}
            <Link className={styles.login} href="/login" onClick={() => setOpen(false)}>
              로그인
            </Link>
            <div className={styles.drawerCta}>
              <Button as="a" fullWidth href={inquiryHref('상담')}>
                무료 상담
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </header>
  );
}
