/**
 * 공간안내 — 사진 7장 12칸 그리드 + 포함 사항 띠.
 *
 * ★★ 사진은 2026-09-13 2차 인계분에 들어와 있었다(`시안_2/assets/spaces/`).
 *    `design/_ds/swonbiz/assets/` 사본만 갱신이 안 돼서 `doc/DESIGN_QUESTIONS.md` 가
 *    「전달 안 됨」으로 남아 있었다 — 2026-10-01 에 양쪽을 채우고 그 항목을 지웠다.
 *    `public/spaces/*.png` 가 화면이 쓰는 사본이다.
 *
 * ★ 사진 7장이 10MB 다. `next/image` 로 내보낸다 — 보이는 것은 같고 받는 양만 줄어든다.
 *   첫 장(라운지)만 `priority` 다. 나머지는 스크롤해 내려가며 받는다.
 *
 * ★ 서버 컴포넌트다. 시안이 JS 로 하던 hover(사진 확대 · 덮개 · 테두리)는 부모 hover
 *   선택자로 옮겼다 — 인라인 CSS 로는 못 쓰지만 CSS 모듈에서는 된다.
 */
import Image from 'next/image';
import { Icon } from '@/components/ds';
import styles from './landing.module.css';
import { BRANCH, SPACES, SPACE_NOTES, inquiryHref } from './landing-model';

export function SpacesSection() {
  return (
    <section id="spaces" className={`${styles.section} ${styles.plain}`}>
      <div className={styles.spacesTopFade} />
      <div className={styles.container}>
        <div className={styles.headSplit}>
          <div>
            <span className={styles.eyebrow}>OUR SPACE</span>
            <h2 className={styles.h2}>혼자여도, 여섯이어도 맞는 자리가 있습니다</h2>
            <p className={styles.lead} style={{ maxWidth: 520 }}>
              1인실부터 팀 오피스까지. 모든 공간에 회의실·라운지·탕비실 이용이 포함되고, 별도
              관리비는 없습니다.
            </p>
          </div>
          <span className={styles.pill}>
            <Icon name="map-pin" size={16} />
            {BRANCH}
          </span>
        </div>

        <div className={styles.spaceGrid}>
          {SPACES.map((s, i) => (
            <div key={s.file} className={styles.spaceCard} style={{ gridArea: s.area }}>
              <Image
                src={`/spaces/${s.file}.png`}
                alt={s.alt}
                fill
                sizes="(max-width: 767px) 100vw, (max-width: 1279px) 60vw, 700px"
                priority={i === 0}
              />
              <span className={styles.spaceVeil} />
              <span className={styles.spaceBadge}>{s.badge}</span>
              <div className={styles.spaceText}>
                <div
                  className={`${styles.spaceTitle}${s.lead ? ` ${styles.spaceTitleLead}` : ''}`}
                >
                  {s.title}
                </div>
                <div className={styles.spaceNote}>{s.note}</div>
              </div>
            </div>
          ))}
        </div>

        <div className={styles.ribbon}>
          <div className={styles.ribbonItems}>
            {SPACE_NOTES.map((n) => (
              <span key={n} className={`${styles.check} ${styles.checkNowrap}`}>
                <Icon name="circle-check" size={18} className={styles.checkIcon} />
                {n}
              </span>
            ))}
          </div>
          <a className={styles.inlineLink} href={inquiryHref('투어')}>
            공간 투어 예약
            <Icon name="arrow-right" size={16} />
          </a>
        </div>
      </div>
    </section>
  );
}
