'use client';

/**
 * 이용안내 — [방문 상담 | 비대면 신청] 탭 + 단계(5개 / 3개) + 가등록 안내 + 큰 CTA 짝.
 *
 * ★ 'use client' 가 필요한 이유: 탭 하나다(시안 `bindProcessTabs`).
 *   시안은 두 패널을 둘 다 그려 두고 `display` 를 바꾼다. 여기서는 고른 것만 그린다 —
 *   보이는 것은 같고 DOM 이 절반이다.
 *
 * ★★ [온라인 신청하기] 는 **온라인 신청 폼(`s030500020`)이 아니라 문의하기로 간다.**
 *    그 화면은 아직 없다(보류). 생기면 `landing-model` 의 `inquiryHref` 한 곳만
 *    고치면 된다 — 2026-10-01 결정, `doc/DESIGN_HANDOFF_DIFF.md` §P-1.
 * ★ 「방문 상담 / 비대면 신청」 구분은 문의 유형으로 나누지 않는다. 손님이 본문에 적는다.
 */
import { useState } from 'react';
import { Icon } from '@/components/ds';
import styles from './landing.module.css';
import {
  HOURS,
  HOURS_NOTE,
  PROCESS_PREREG,
  PROCESS_TABS,
  TEL_HREF,
  TEL_LABEL,
  inquiryHref,
} from './landing-model';

export function ProcessSection() {
  const [tab, setTab] = useState<'1' | '2'>('1');
  const current = PROCESS_TABS.find((t) => t.key === tab) ?? PROCESS_TABS[0]!;

  return (
    <section id="process" className={`${styles.section} ${styles.plain}`}>
      <div className={styles.container}>
        <div className={styles.headCenter}>
          <span className={styles.eyebrow}>HOW IT WORKS</span>
          <h2 className={styles.h2}>계약 후 바로 입주 가능합니다</h2>
          <p className={styles.lead} style={{ maxWidth: 620 }}>
            사업자등록 전이어도 시작할 수 있습니다. 대표자 신분증만 있으면 가등록으로 먼저
            진행합니다.
          </p>
        </div>

        <div>
          <div className={styles.tabsRow}>
            <div className={styles.tabs} role="tablist" aria-label="입주 절차">
              {PROCESS_TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.key}
                  className={`${styles.tab}${tab === t.key ? ` ${styles.tabOn}` : ''}`}
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.tabNote}>{current.note}</div>

          <div
            className={`${styles.steps} ${
              current.steps.length === 5 ? styles.steps5 : styles.steps3
            }`}
          >
            {current.steps.map((s, i) => (
              <div key={s.no} className={styles.step}>
                {/* 연결선은 마지막 칸에 없다 */}
                {i < current.steps.length - 1 ? <span className={styles.stepLine} /> : null}
                <span
                  className={`${styles.stepNo}${
                    i === current.steps.length - 1 ? ` ${styles.stepNoLast}` : ''
                  }`}
                >
                  {s.no}
                </span>
                <div className={styles.stepTitle}>{s.title}</div>
                <p className={styles.stepBody}>{s.body}</p>
                <span className={styles.stepWhen}>
                  <Icon name="clock" size={12} />
                  {s.when}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── 가등록 안내 ── */}
        <div className={styles.prereg}>
          <span className={styles.labEdge} />
          <div>
            <div className={styles.preregTitle}>{PROCESS_PREREG.title}</div>
            <p className={styles.preregBody}>{PROCESS_PREREG.body}</p>
          </div>
          <div className={styles.preregSide}>
            <span className={styles.preregLabel}>필요 서류</span>
            <div className={styles.preregDocs}>
              {PROCESS_PREREG.docs.map((d) => (
                <span key={d} className={styles.check}>
                  <Icon name="check" size={16} className={styles.checkIcon} />
                  {d}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ── 큰 CTA 짝 ── */}
        <div className={styles.bigCtas}>
          <a className={styles.bigBtn} href={inquiryHref('비대면 신청')}>
            온라인 신청하기
            <Icon name="arrow-right" size={18} />
          </a>
          <a className={styles.telBtn} href={TEL_HREF}>
            <span className={styles.telIcon}>
              <Icon name="phone" size={18} />
            </span>
            <span className={styles.telStack}>
              <span className={styles.telLabel}>전화 상담</span>
              <span className={styles.telNo}>{TEL_LABEL}</span>
            </span>
          </a>
        </div>

        <div className={styles.centerRow}>
          <span className={styles.hours}>
            <Icon name="clock" size={12} />
            {HOURS} · <span className={styles.hoursStrong}>{HOURS_NOTE}</span>
          </span>
        </div>
      </div>
    </section>
  );
}
