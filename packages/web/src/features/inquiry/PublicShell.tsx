/**
 * 공개 영역 틀 — 헤더 · 본문 800px · 푸터.
 *
 * ★★ **ERP 셸이 아니다.** 사이드바도 세션도 없다. 문의상담 세 화면(s0300500070 ·
 *    p1 · p2)이 이 틀 하나를 함께 쓴다.
 * ★ 푸터의 사업자 정보는 **실제 값**이다(02-screens.md §1) — 시안에서 그대로 옮겼다.
 */
import { Icon } from '@/components/ds';
import styles from './inquiry.module.css';
import { TEL_HREF, TEL_LABEL } from './inquiry-model';

export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div className={styles.headIn}>
          <a className={styles.logo} href="/inquiry">
            {/* eslint-disable-next-line @next/next/no-img-element -- 고정 크기 워드마크 하나 */}
            <img src="/brand/swonbiz-logo.png" alt="SwonBiz" />
            <span className={styles.wordmark}>
              S<span className={styles.wordmarkDot}>·</span>won
              <span className={styles.wordmarkSuffix}>Biz</span>
            </span>
          </a>
          {/* 44px 터치 영역 — 모바일에서 바로 걸 수 있어야 한다 */}
          <a className={styles.tel} href={TEL_HREF}>
            <Icon name="phone" size={16} />
            {TEL_LABEL}
          </a>
        </div>
      </header>

      <main className={styles.main}>{children}</main>

      <footer className={styles.foot}>
        <div className={styles.footIn}>
          <div>
            <span className={styles.footMark}>
              S<span style={{ opacity: 0.55 }}>·</span>wonBiz
            </span>
            <div className={styles.biz}>
              주식회사 에스원테크 · 대표 최현수 · 사업자등록번호 105-87-68698
              <br />
              서울특별시 강남구 봉은사로55길 19, 3층 (삼성동, 우리빌딩)
            </div>
          </div>
          <div className={styles.footTel}>
            <span className={styles.footTelNo}>{TEL_LABEL}</span>
            <span className={styles.footHours}>평일 09:00 - 18:00</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
