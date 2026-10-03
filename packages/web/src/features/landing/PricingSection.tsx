/**
 * 요금제 — 카드 3장(비상주 · 개인 오피스 · 팀 오피스) + 공통 조건 띠.
 *
 * ★ 금액이 없다. 셋 다 「상담 후 안내」다 — 시안 그대로다. 숫자를 지어내지 않는다.
 * ★ 「가장 인기」는 개인 오피스 하나다(2px 테두리 · 8px 올림 · 그라디언트 띠 · 알약).
 */
import { Button, Icon } from '@/components/ds';
import styles from './landing.module.css';
import { PLANS, PLAN_NOTES, PLAN_PRICE, inquiryHref } from './landing-model';

export function PricingSection() {
  return (
    <section id="pricing" className={`${styles.section} ${styles.alt}`}>
      <div className={styles.container}>
        <div className={styles.headCenter}>
          <span className={styles.eyebrow}>PLANS</span>
          <h2 className={styles.h2}>필요한 만큼만, 언제든 옮겨가며</h2>
          <p className={styles.lead} style={{ maxWidth: 620 }}>
            비상주로 시작해 개인 오피스로, 팀이 커지면 팀 오피스로. 플랜 변경에 위약금이나 재계약
            절차가 없습니다.
          </p>
        </div>

        <div className={styles.planGrid}>
          {PLANS.map((p) => {
            const body = (
              <div className={styles.planIn}>
                <h3 className={styles.planTitle}>{p.title}</h3>
                <p className={styles.planLead}>{p.lead}</p>
                <p className={styles.planPrice}>{PLAN_PRICE}</p>
                <span className={styles.planRule} />
                <div className={styles.planPoints}>
                  {p.points.map((t) => (
                    <span key={t} className={styles.check}>
                      <Icon name="check" size={16} className={styles.checkIcon} />
                      {t}
                    </span>
                  ))}
                </div>
                <div className={styles.planCta}>
                  <Button
                    as="a"
                    href={inquiryHref(p.kind)}
                    fullWidth
                    variant={p.featured ? 'primary' : 'ghost'}
                    iconRight={p.featured ? <Icon name="arrow-right" size={18} /> : undefined}
                  >
                    {p.cta}
                  </Button>
                </div>
              </div>
            );

            if (!p.featured) {
              return (
                <div key={p.title} className={styles.plan}>
                  {body}
                </div>
              );
            }
            return (
              <div key={p.title} className={`${styles.plan} ${styles.planFeatured}`}>
                <span className={styles.planFeaturedRule} />
                <span className={styles.planFeaturedBadge}>가장 인기</span>
                {body}
              </div>
            );
          })}
        </div>

        <div className={`${styles.ribbon} ${styles.ribbonPlain}`} style={{ marginTop: 40 }}>
          <div className={`${styles.ribbonItems} ${styles.ribbonItemsTight}`}>
            {PLAN_NOTES.map((n) => (
              <span key={n} className={`${styles.check} ${styles.checkNowrap}`}>
                <Icon name="circle-check" size={18} className={styles.checkIcon} />
                {n}
              </span>
            ))}
          </div>
          <a className={styles.inlineLink} href={inquiryHref('요금')}>
            요금 안내 받기
            <Icon name="arrow-right" size={16} />
          </a>
        </div>
      </div>
    </section>
  );
}
