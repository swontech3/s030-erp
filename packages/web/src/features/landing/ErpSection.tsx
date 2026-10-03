'use client';

/**
 * 운영 시스템(다크) — 기능 4줄 + ERP 화면 목업 + 지표 4개.
 *
 * ★★ 시안의 등장 연출을 그대로 옮겼다(`start` · `countUp`):
 *      기능 목록이 **절반쯤 보이면** 시작한다
 *      네 줄이 340ms 간격으로 순서대로 뜨고, 왼쪽 세로선이 1100ms 동안 채워진다
 *      그 뒤 「경비 증빙 n/42」가 0 → 39 로 1600ms 동안 센다(ease-out-cubic)
 *    ★ 시안은 **120ms setInterval** 로 보이는지 감시한다. 그 주석이 이유를 적어 뒀는데
 *      「이 미리보기 문서는 숨겨질 수 있다(프레임도 스크롤 이벤트도 없다)」다 —
 *      실제 페이지에는 해당되지 않으므로 `IntersectionObserver` 로 썼다. 보이는 결과는
 *      같다(`doc/DESIGN_HANDOFF_DIFF.md` §P-5).
 *    ★ 움직임을 줄이라고 한 사람에게는 바로 최종 상태로 둔다(시안의 `instantReveal`).
 */
import { useEffect, useRef, useState } from 'react';
import { Button, Icon } from '@/components/ds';
import styles from './landing.module.css';
import {
  ERP_CLASSIFIED_OF,
  ERP_CLASSIFIED_TO,
  ERP_FEATURES,
  ERP_MOCK_NAV,
  ERP_MOCK_NAV_ON,
  ERP_MOCK_ROWS,
  ERP_STATS,
} from './landing-model';

/** 시안의 `3 * 340 + 640 + 240` — 네 줄이 다 뜨고 나서 숫자가 돈다. */
const COUNT_DELAY = 3 * 340 + 640 + 240;
const COUNT_MS = 1600;

type Phase = 'idle' | 'run' | 'instant';

export function ErpSection() {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [count, setCount] = useState(0);

  /* ── 절반쯤 보이면 시작 ── */
  useEffect(() => {
    const reduce =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setPhase('instant');
      setCount(ERP_CLASSIFIED_TO);
      return;
    }

    const el = listRef.current;
    if (!el) return;

    /* IntersectionObserver 가 없는 환경(아주 오래된 브라우저)에서는 바로 보여 준다 */
    if (typeof IntersectionObserver !== 'function') {
      setPhase('run');
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setPhase('run');
          io.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  /* ── 0 → 39 ── */
  useEffect(() => {
    if (phase !== 'run') return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = setTimeout(() => {
      const t0 = Date.now();
      timer = setInterval(() => {
        const p = Math.min(1, (Date.now() - t0) / COUNT_MS);
        setCount(Math.round(ERP_CLASSIFIED_TO * (1 - Math.pow(1 - p, 3))));
        if (p >= 1 && timer) {
          clearInterval(timer);
          timer = null;
        }
      }, 40);
    }, COUNT_DELAY);
    return () => {
      clearTimeout(start);
      if (timer) clearInterval(timer);
    };
  }, [phase]);

  const runCls =
    phase === 'run' ? ` ${styles.erpRun}` : phase === 'instant' ? ` ${styles.erpInstant}` : '';

  return (
    <section id="erp" className={`${styles.section} ${styles.erp}`}>
      <div className={styles.erpBg}>
        <div className={styles.erpBlobA} />
        <div className={styles.erpBlobB} />
        <div className={styles.erpDots} />
        <div className={styles.erpTopFade} />
      </div>

      <div className={styles.container}>
        <span className={styles.erpBadge}>
          <Icon name="sparkles" size={14} />
          입주사 전용 · 추가 비용 없음
        </span>
        <h2 className={styles.h2Inverse}>입주와 동시에, 경영 시스템이 켜집니다</h2>
        <p className={styles.erpLead}>
          12년간 공유오피스를 운영하며 입주사들이 겪은 문제를 직접 보아왔습니다. 그 경험으로 만든
          시스템이 입주 당일부터 청구·세무·경비를 대신 처리합니다.
        </p>

        <div className={`${styles.erpGrid}${runCls}`}>
          {/* ── 좌: 기능 4줄 ── */}
          <div>
            <div className={styles.erpList} ref={listRef}>
              <span className={styles.erpTrack} />
              <span
                className={`${styles.erpTrackFill}${
                  phase === 'idle' ? '' : ` ${styles.erpTrackFillOn}`
                }`}
              />
              {ERP_FEATURES.map((f, i) => (
                <div
                  key={f.title}
                  className={styles.erpItem}
                  style={{ animationDelay: `${i * 340}ms` }}
                >
                  <span
                    className={styles.erpItemIcon}
                    style={{ animationDelay: `${i * 340}ms, ${i * 340}ms` }}
                  >
                    <Icon name={f.icon} size={20} />
                  </span>
                  <div>
                    <div className={styles.erpItemTitle}>{f.title}</div>
                    <p className={styles.erpItemBody}>{f.body}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className={styles.erpCta}>
              {/*
                ★ 시안의 [운영 시스템 미리보기] 는 **아무 동작이 없다** — href 도
                  data-inquiry 도 없다. 시안대로 그대로 뒀다. 어디로 보낼지는 ERP
                  소개 화면이 생길 때 정한다(`doc/DESIGN_HANDOFF_DIFF.md` §P-6).
              */}
              <Button
                variant="inverse"
                iconRight={<Icon name="arrow-right" size={18} />}
                aria-disabled="true"
              >
                운영 시스템 미리보기
              </Button>
            </div>
          </div>

          {/* ── 우: ERP 목업 ── */}
          <div className={styles.erpMock}>
            <div className={styles.erpMockGlow} />
            <div className={styles.erpWindow}>
              <div className={styles.erpChrome}>
                <span className={styles.erpLights}>
                  <span />
                  <span />
                  <span />
                </span>
                <span className={styles.erpUrl}>erp.swonbiz.com</span>
              </div>

              <div className={styles.erpWindowScroll}>
                <div className={styles.erpPane}>
                  <div className={styles.erpSide}>
                    <span className={styles.erpSideBrand}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- 목업 안의 16px 워드마크 */}
                      <img src="/brand/swonbiz-logo-white.png" alt="" />
                      <span className={styles.erpSideMark}>
                        S<span style={{ opacity: 0.55 }}>·</span>wonBiz
                      </span>
                    </span>
                    {ERP_MOCK_NAV.map((n) => (
                      <span
                        key={n}
                        className={`${styles.erpSideItem}${
                          n === ERP_MOCK_NAV_ON ? ` ${styles.erpSideOn}` : ''
                        }`}
                      >
                        {n}
                      </span>
                    ))}
                  </div>

                  <div className={styles.erpMain}>
                    <div className={styles.erpMainHead}>
                      <span className={styles.erpMainTitle}>세무 · 2026년 8월</span>
                      <span className={styles.erpSeg}>
                        <span className={styles.erpSegOn}>월</span>
                        <span>분기</span>
                        <span>연</span>
                      </span>
                    </div>

                    <div className={styles.erpAiCard}>
                      <div className={styles.erpAiHead}>
                        <span className={styles.erpAiSpark}>
                          <Icon name="sparkles" size={14} />
                        </span>
                        <span className={styles.erpAiLabel}>
                          경비 증빙 {count}/{ERP_CLASSIFIED_OF} 자동 분류
                        </span>
                        <span className={styles.erpAiChip}>AI 처리중</span>
                      </div>
                      <div className={styles.erpAiBarWrap}>
                        <span className={styles.erpAiBar} />
                      </div>
                      <div className={styles.erpAiFoot}>
                        <span>검토 필요 3건</span>
                        <span>부가세 예상 ₩3,120,000</span>
                      </div>
                    </div>

                    <div className={styles.erpTable}>
                      <div className={styles.erpTh}>
                        <span className={styles.colFile}>증빙</span>
                        <span className={styles.colAcct}>계정과목</span>
                        <span className={styles.colAmt}>금액</span>
                        <span className={styles.colState}>분류</span>
                      </div>
                      {ERP_MOCK_ROWS.map((r) => (
                        <div key={r.file} className={styles.erpTr}>
                          <span className={styles.colFile}>{r.file}</span>
                          <span className={styles.colAcct}>{r.account}</span>
                          <span className={styles.colAmt}>{r.amount}</span>
                          <span
                            className={`${styles.erpChip} ${
                              r.state === '자동'
                                ? styles.erpChipAuto
                                : r.state === 'AI 분류중'
                                  ? styles.erpChipAi
                                  : styles.erpChipNeed
                            }`}
                          >
                            {r.state === 'AI 분류중' ? <span className={styles.erpPulse} /> : null}
                            {r.state}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className={styles.mockCaptionInverse}>* 운영 시스템 화면 예시</div>
          </div>
        </div>

        {/* ── 지표 4개 ── */}
        <div className={styles.erpStats}>
          {ERP_STATS.map((s) => (
            <div key={s.title} className={styles.erpStat}>
              <span className={styles.erpStatIcon}>
                <Icon name={s.icon} size={24} />
              </span>
              <div
                className={`${styles.erpStatTitle}${
                  s.accent ? ` ${styles.erpStatTitleAccent}` : ''
                }`}
              >
                {s.title}
              </div>
              <div className={styles.erpStatNote}>{s.note}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
