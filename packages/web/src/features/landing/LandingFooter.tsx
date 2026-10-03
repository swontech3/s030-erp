/**
 * 랜딩 바닥 — 다크 4열(브랜드 · SERVICE · SUPPORT · CONTACT) + 사업자 정보 줄.
 *
 * ★ 사업자 정보·주소·전화는 **문의상담 푸터와 같은 값**이다. 실제 값이라 지어내지 않는다.
 * ★ 시안과 달라진 자리 둘 (`doc/DESIGN_HANDOFF_DIFF.md` §P-2·§P-3):
 *     · 「이용약관」·「개인정보처리방침」 **지웠다** — 문서가 없고, 누르면 아무 일도
 *       일어나지 않는 링크를 공개 화면에 두지 않는다. 운영 전 필수 항목이다
 *     · 「문의상담」 한 줄을 **더했다** — 시안에 목록으로 가는 길이 없었다
 */
import Link from 'next/link';
import { Icon } from '@/components/ds';
import styles from './landing.module.css';
import {
  ADDRESS_LINES,
  BIZ_LINES,
  BRANCH,
  COPYRIGHT,
  FAX_LABEL,
  FOOTER_BLURB,
  FOOTER_BRAND_NOTE,
  FOOTER_SERVICE,
  FOOTER_SUPPORT,
  HOURS,
  MAIL_HREF,
  MAIL_LABEL,
  TEL_HREF,
  TEL_LABEL,
} from './landing-model';

export function LandingFooter() {
  return (
    <footer className={styles.foot}>
      <div className={styles.container}>
        <div className={styles.footGrid}>
          {/* ── 브랜드 ── */}
          <div>
            <span className={styles.footBrand}>
              {/* eslint-disable-next-line @next/next/no-img-element -- 고정 크기 워드마크 하나 */}
              <img src="/brand/swonbiz-logo.png" alt="SwonBiz" />
              <span className={styles.footMark}>
                S<span className={styles.dot}>·</span>wonBiz
              </span>
            </span>
            <p className={styles.footBlurb}>{FOOTER_BLURB}</p>
            <p className={styles.footBrandNote}>{FOOTER_BRAND_NOTE}</p>
            <span className={styles.footBranch}>
              <Icon name="map-pin" size={12} />
              {BRANCH}
            </span>
          </div>

          {/* ── SERVICE ── */}
          <div>
            <span className={styles.footLabel}>SERVICE</span>
            <div className={styles.footLinks}>
              {FOOTER_SERVICE.map((l) => (
                <a key={l.label} className={styles.footLink} href={l.href}>
                  {l.label}
                </a>
              ))}
            </div>
          </div>

          {/* ── SUPPORT ── */}
          <div>
            <span className={styles.footLabel}>SUPPORT</span>
            <div className={styles.footLinks}>
              {FOOTER_SUPPORT.map((l) =>
                l.href.startsWith('#') ? (
                  <a key={l.label} className={styles.footLink} href={l.href}>
                    {l.label}
                  </a>
                ) : (
                  <Link key={l.label} className={styles.footLink} href={l.href}>
                    {l.label}
                  </Link>
                ),
              )}
            </div>
          </div>

          {/* ── CONTACT ── */}
          <div>
            <span className={styles.footLabel}>CONTACT</span>
            <a className={styles.footTel} href={TEL_HREF}>
              <Icon name="phone" size={16} />
              {TEL_LABEL}
            </a>
            <div className={styles.footHours}>{HOURS} · 야간·주말 가능</div>
            <div className={styles.footFax}>
              <Icon name="printer" size={16} />
              {FAX_LABEL}
            </div>
            <a className={styles.footMail} href={MAIL_HREF}>
              <Icon name="mail" size={16} />
              {MAIL_LABEL}
            </a>
            <div className={styles.footAddr}>
              <span className={styles.footAddrIcon}>
                <Icon name="map-pin" size={16} />
              </span>
              <span>
                {ADDRESS_LINES[0]}
                <br />
                {ADDRESS_LINES[1]}
              </span>
            </div>
          </div>
        </div>

        <div className={styles.footBottom}>
          <div className={styles.footBiz}>
            {BIZ_LINES.map((l) => (
              <div key={l}>{l}</div>
            ))}
            <div className={styles.footCopy}>{COPYRIGHT}</div>
          </div>
        </div>
      </div>
    </footer>
  );
}
