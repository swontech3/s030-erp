/**
 * 서비스 — 카드 3장(공간·법무·세무) + 기업부설연구소 띠 + AI 활용 지원 줄 + 상담 유도.
 *
 * ★ 서버 컴포넌트다. 시안의 hover(카드 2px 들림 · 테두리 색)는 CSS `:hover` 로 옮겼다 —
 *   `style-hover` 는 디자인 도구 전용 속성이라 브라우저가 무시한다(handoff 주의사항 8).
 */
import { Icon } from '@/components/ds';
import styles from './landing.module.css';
import { LAB_BENEFITS, SERVICES, inquiryHref } from './landing-model';

export function ServicesSection() {
  return (
    <section id="services" className={`${styles.section} ${styles.sectionTight} ${styles.alt}`}>
      <div className={styles.topFadeWhite} />
      <div className={styles.container}>
        {/* ★ 이 섹션만 머리말 간격이 16px 다 — `headCenterGap` 머리말 참고 */}
        <div className={`${styles.headCenter} ${styles.headCenterGap}`}>
          <span className={styles.eyebrow}>WHAT WE PROVIDE</span>
          <h2 className={styles.h2}>
            공간을 빌리면, <span className={styles.h1Accent}>AI가</span> 법무·세무를 처리합니다
          </h2>
          <p className={styles.lead} style={{ maxWidth: 600 }}>
            담당자를 뽑거나 세무사를 따로 두지 않아도 됩니다. 가장 막히는 사업목적·업종·업태부터
            정관과 의사록, 증빙 분류까지 AI가 관련 법령을 찾아 작성하고, 모든 플랜에 포함되어
            있습니다.
          </p>
        </div>

        <div className={styles.svcGrid}>
          {SERVICES.map((s) => (
            <div key={s.title} className={styles.svcCard}>
              <span
                className={`${styles.svcRule}${
                  s.gradientRule ? ` ${styles.svcRuleGradient}` : ''
                }`}
              />
              <div className={styles.svcIn}>
                <span className={styles.svcIcon}>
                  <Icon name={s.icon} size={24} />
                </span>
                <h3 className={styles.h3}>{s.title}</h3>
                <p className={styles.svcLead}>{s.lead}</p>
                <p className={styles.svcBody}>{s.body}</p>
                <div className={styles.svcPoints}>
                  {s.points.map((p) => (
                    <span key={p.text} className={styles.check}>
                      <Icon name="check" size={16} className={styles.checkIcon} />
                      <span className={p.strong ? styles.pointStrong : undefined}>{p.text}</span>
                      {p.badge ? <span className={styles.tag}>{p.badge}</span> : null}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* ── 기업부설연구소 ── */}
        <div className={styles.lab}>
          <span className={styles.labEdge} />
          <div>
            <span className={styles.eyebrow}>ONLY AT SWONBIZ</span>
            <h3 className={styles.labH3}>기업부설연구소, 설립부터 인정까지</h3>
            <p className={styles.labLead}>
              연구원 인원과 연구비 규모에 따라 R&amp;D 세액공제를 받을 수 있습니다. 신청 서류
              작성부터 한국산업기술진흥협회 인정까지 지원합니다.
            </p>
          </div>
          <div className={styles.labSide}>
            <div className={styles.labList}>
              {LAB_BENEFITS.map((b) => (
                <span key={b} className={styles.check}>
                  <Icon name="circle-check" size={18} className={styles.checkIcon} />
                  {b}
                </span>
              ))}
            </div>
            {/*
              ★ 시안은 상담 모달을 열었다. 모달을 만들지 않고 문의하기로 보낸다 —
                이 줄만 문의 유형이 「연구소설립문의」(R)다(`landing-model` 의 TYPE_OF).
            */}
            <a className={`${styles.inlineLink} ${styles.labLink}`} href={inquiryHref('연구소')}>
              연구소 설립 상담
              <Icon name="arrow-right" size={16} />
            </a>
          </div>
        </div>

        {/* ── AI 활용 지원 ── */}
        <div className={styles.aiNote}>
          <span className={styles.aiNoteIcon}>
            <Icon name="sparkles" size={18} />
          </span>
          <div className={styles.aiNoteBody}>
            <span className={styles.aiNoteStrong}>AI 활용 지원</span>
            <span>
              {' '}
              · 업무 자동화 AI 에이전트를 직접 개발하며, 입주사에는 AI 활용과 바이브 코딩 실무
              교육을 지원합니다.
            </span>
          </div>
        </div>

        <div className={styles.svcAsk}>
          <span className={styles.svcAskText}>어떤 서비스가 필요한지 모르시겠다면</span>
          <a
            className={`${styles.inlineLink} ${styles.inlineLinkLg}`}
            href={inquiryHref('상담')}
          >
            10분 무료 상담 받기
            <Icon name="arrow-right" size={16} />
          </a>
        </div>
      </div>
    </section>
  );
}
