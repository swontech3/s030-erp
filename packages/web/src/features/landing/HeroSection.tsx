'use client';

/**
 * 히어로 — 좌 카피·CTA, 우 「법인설립 서류 생성」 문서 장면.
 *
 * ★★ 문서 장면의 타이밍은 시안 스크립트(`playHeroMockup`) **그대로**다:
 *      300ms 선행(머리글을 먼저 읽게) → 600ms 간격으로 한 줄씩 등장
 *      등장 +80ms 점 깜박임 → +300ms 「작성중」 알약이 사라지고 → +180ms 「완료」
 *      진행바 = i/5 · 카운트 = 「i / 5」 · 아이콘이 60ms 번쩍
 *      마지막 +200ms 에 요약 줄
 *    ★ 6000ms 안전망도 그대로 뒀다 — 어딘가 멈추면 최종 상태로 밀어 넣는다.
 *    ★ 움직임을 줄이라고 한 사람에게는 **바로 최종 상태**로 둔다(시안도 그렇다).
 */
import { useEffect, useRef, useState } from 'react';
import { Button, Icon } from '@/components/ds';
import styles from './landing.module.css';
import {
  HERO_DOCS,
  HERO_DOCS_DONE,
  HERO_PROOF,
  inquiryHref,
} from './landing-model';

const TOTAL = HERO_DOCS.length;

interface Scene {
  /** 1..visible 번째 줄이 떠 있다. */
  visible: number;
  /** 1..done 번째 줄이 완료됐다. 진행바·카운트가 이 값에서 나온다. */
  done: number;
  /** 「작성중」 알약이 사라지는 중인 줄. */
  fading: number | null;
  /** 점이 깜박이는 줄. */
  pulsing: number | null;
  /** 아이콘이 번쩍이는 줄. */
  flashing: number | null;
  summary: boolean;
}

const START: Scene = {
  visible: 0,
  done: 0,
  fading: null,
  pulsing: null,
  flashing: null,
  summary: false,
};

const FINISHED: Scene = {
  visible: TOTAL,
  done: TOTAL,
  fading: null,
  pulsing: null,
  flashing: null,
  summary: true,
};

export function HeroSection() {
  const [scene, setScene] = useState<Scene>(START);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const at = (ms: number, fn: () => void) => {
      timers.current.push(setTimeout(fn, ms));
    };
    const patch = (p: Partial<Scene>) => setScene((s) => ({ ...s, ...p }));

    const reduce =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduce) {
      setScene(FINISHED);
      return;
    }

    /* 안전망 — 어딘가 멈추면 최종 상태로. 시안의 6000ms 그대로 */
    at(6000, () => setScene(FINISHED));

    for (let i = 1; i <= TOTAL; i++) {
      const t = 300 + (i - 1) * 600;
      at(t, () => patch({ visible: i }));
      at(t + 80, () => patch({ pulsing: i }));
      at(t + 380, () => patch({ fading: i }));
      at(t + 560, () => {
        patch({ done: i, pulsing: null, fading: null, flashing: i });
        at(60, () => patch({ flashing: null }));
      });
    }
    at(300 + TOTAL * 600 + 200, () => patch({ summary: true }));

    const running = timers.current;
    return () => {
      running.forEach(clearTimeout);
      timers.current = [];
    };
  }, []);

  return (
    <div className={styles.hero} id="top">
      <div className={styles.blobA} />
      <div className={styles.blobB} />
      <div className={styles.dots} />

      <div className={styles.heroGrid}>
        {/* ── 좌: 카피 ── */}
        <div>
          <span className={styles.heroBadge}>
            <Icon name="sparkles" size={16} />
            AI 기반 법무·세무 자동화
          </span>
          <h1 className={styles.h1}>
            법인설립부터 세무까지
            <br />
            <span className={styles.h1Accent}>AI가</span> 함께하는 공유오피스
          </h1>
          <p className={styles.heroLead}>
            등기 서류 작성, 세금계산서 발행, 경비 관리까지. 입주와 동시에 켜지는 비즈니스 운영
            시스템을 제공합니다.
          </p>
          <div className={styles.heroCtas}>
            <Button
              as="a"
              href={inquiryHref('상담')}
              iconRight={<Icon name="arrow-right" size={18} />}
            >
              무료 상담 신청
            </Button>
            <Button as="a" variant="ghost" href="#spaces" iconLeft={<Icon name="play" size={18} />}>
              공간 둘러보기
            </Button>
          </div>
          <div className={styles.heroProof}>
            {HERO_PROOF.map((p) => (
              <span
                key={p.text}
                className={`${styles.proofItem}${p.strong ? ` ${styles.proofStrong}` : ''}`}
              >
                <Icon name={p.icon} size={16} style={{ color: 'var(--color-primary)' }} />
                {p.text}
              </span>
            ))}
          </div>
        </div>

        {/* ── 우: 문서 장면 ── */}
        <div className={styles.heroMock}>
          <div className={styles.heroMockGlow} />
          <div className={styles.docCard}>
            <div className={styles.docHead}>
              <span className={styles.docSpark}>
                <Icon name="sparkles" size={18} />
              </span>
              <span className={styles.docTitle}>법인설립 서류 생성</span>
              <span className={styles.docCount}>
                {scene.done} / {TOTAL}
              </span>
            </div>

            <div className={styles.docBarWrap}>
              <span
                className={styles.docBar}
                style={{ width: `${Math.round((scene.done / TOTAL) * 100)}%` }}
              />
            </div>

            <div className={styles.docList}>
              {HERO_DOCS.map((d, idx) => {
                const n = idx + 1;
                const shown = scene.visible >= n;
                const done = scene.done >= n;
                return (
                  <div
                    key={d.title}
                    className={`${styles.docRow}${shown ? ` ${styles.docRowOn}` : ''}`}
                  >
                    <span
                      className={`${styles.docIcon}${
                        scene.flashing === n ? ` ${styles.docIconFlash}` : ''
                      }`}
                    >
                      <Icon name={d.icon} size={18} />
                    </span>
                    <div className={styles.docBody}>
                      <div className={styles.docName}>
                        <span>{d.title}</span>
                        {d.badge ? <span className={styles.docAi}>{d.badge}</span> : null}
                      </div>
                      <div className={styles.docNote}>{d.note}</div>
                    </div>
                    <span className={styles.docState}>
                      {done ? (
                        <span className={`${styles.docDone} ${styles.docDoneOn}`}>
                          <Icon name="check" size={12} />
                          완료
                        </span>
                      ) : (
                        <span
                          className={`${styles.docBusy}${
                            scene.fading === n ? ` ${styles.docBusyOut}` : ''
                          }`}
                        >
                          <span
                            className={`${styles.docDot}${
                              scene.pulsing === n ? ` ${styles.docDotOn}` : ''
                            }`}
                          />
                          {d.busy}
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>

            <div
              className={`${styles.docSummary}${scene.summary ? ` ${styles.docSummaryOn}` : ''}`}
            >
              <span className={styles.docSummaryIcon}>
                <Icon name="circle-check" size={18} />
              </span>
              <span className={styles.docSummaryText}>{HERO_DOCS_DONE}</span>
            </div>
          </div>
          <div className={styles.mockCaption}>* AI 서류 생성 화면 예시</div>
        </div>
      </div>

      <div className={styles.heroFade} />
    </div>
  );
}
