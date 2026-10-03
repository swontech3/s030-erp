'use client';

/**
 * 찾아오시는 길 — 지도 자리(네이버지도로 나간다) + 주소·지하철·주차 카드 + 전화·번호 복사.
 *
 * ★ 지도는 실제 지도가 아니다. 시안의 「지도 자리」 그대로고, 누르면 네이버지도가
 *   새 창으로 열린다. 지도 SDK 를 붙이는 것은 시안에 없는 일이라 하지 않았다.
 * ★ 'use client' 가 필요한 이유: [번호 복사] 하나다(시안 `bindCopyButtons`).
 */
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/ds';
import styles from './landing.module.css';
import {
  BRANCH,
  HOURS,
  HOURS_NOTE,
  MAP_PLACEHOLDER,
  MAP_WALK,
  NAVER_MAP_HREF,
  TEL_HREF,
  TEL_LABEL,
  VISIT_ROWS,
} from './landing-model';

export function LocationSection() {
  const [copied, setCopied] = useState(false);
  const back = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (back.current) clearTimeout(back.current);
  }, []);

  /**
   * 번호를 클립보드로.
   *
   * ★ `navigator.clipboard` 는 보안 컨텍스트에서만 있다. 없거나 거부되면 시안처럼
   *   숨은 textarea + `execCommand('copy')` 로 떨어진다 — 실패해도 화면은 「복사되었습니다」
   *   라고 말하지 않는다.
   */
  const copy = async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(TEL_LABEL);
      ok = true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = TEL_LABEL;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    if (!ok) return;
    setCopied(true);
    if (back.current) clearTimeout(back.current);
    back.current = setTimeout(() => setCopied(false), 1600);
  };

  return (
    <section id="location" className={`${styles.section} ${styles.plain}`}>
      <div className={styles.container}>
        <div className={styles.headSplit}>
          <div>
            <span className={styles.eyebrow}>VISIT US</span>
            <h2 className={styles.h2}>찾아오시는 길</h2>
            <p className={styles.lead} style={{ maxWidth: 520 }}>
              선정릉역에서 걸어서 3분입니다. 방문 상담은 예약제로 운영하니 오시기 전에 연락
              주세요.
            </p>
          </div>
          <span className={styles.pill}>
            <Icon name="map-pin" size={16} />
            {BRANCH}
          </span>
        </div>

        <div className={styles.visitGrid}>
          <a className={styles.map} href={NAVER_MAP_HREF} target="_blank" rel="noopener">
            <span className={styles.mapDots} />
            <span className={styles.mapPin}>
              <span className={styles.mapPinChip}>
                <Icon name="map-pin" size={14} />
                SwonBiz
              </span>
              <span className={styles.mapPinStem} />
            </span>
            <span className={styles.mapNote}>{MAP_PLACEHOLDER}</span>
            <span className={styles.mapFoot}>
              <span className={styles.mapWalk}>{MAP_WALK}</span>
              <span className={styles.mapGo}>
                네이버지도로 길찾기
                <Icon name="arrow-up-right" size={16} />
              </span>
            </span>
          </a>

          <div className={styles.visitCard}>
            {VISIT_ROWS.map((r) => (
              <div key={r.label} className={styles.visitRow}>
                <span className={styles.visitIcon}>
                  <Icon name={r.icon} size={18} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className={styles.visitLabel}>{r.label}</div>
                  <div className={styles.visitLines}>
                    {r.lines.map((l, i) => (
                      <span key={l}>
                        {i > 0 ? <br /> : null}
                        {l}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}

            <div className={styles.visitActions}>
              <a className={styles.visitCall} href={TEL_HREF}>
                <Icon name="phone" size={18} />
                {TEL_LABEL}
              </a>
              <button
                type="button"
                className={`${styles.copyBtn}${copied ? ` ${styles.copyBtnDone}` : ''}`}
                onClick={() => void copy()}
              >
                <Icon name="copy" size={16} />
                <span>{copied ? '복사되었습니다' : '번호 복사'}</span>
              </button>
              <span className={`${styles.hours} ${styles.visitHours}`}>
                <Icon name="clock" size={12} />
                {HOURS} · <span className={styles.hoursStrong}>{HOURS_NOTE}</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
