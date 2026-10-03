'use client';

/**
 * FAQ — 좌 머리말 + 전화 카드, 우 아코디언 9문항.
 *
 * ★ 시안대로 **한 번에 하나만** 열리고, 첫 항목이 처음부터 열려 있다(`bindFaq`).
 *   열린 항목을 다시 누르면 시안은 그대로 열려 있다 — 같게 뒀다(닫으면 아코디언이
 *   전부 닫힌 상태가 생기고, 시안에 그 상태가 없다).
 */
import { useState } from 'react';
import { Icon } from '@/components/ds';
import styles from './landing.module.css';
import { FAQS, HOURS, TEL_HREF, TEL_LABEL } from './landing-model';

export function FaqSection() {
  const [open, setOpen] = useState(0);

  return (
    <section id="faq" className={`${styles.section} ${styles.alt}`}>
      <div className={styles.faqGrid}>
        <div>
          <span className={styles.eyebrow}>FAQ</span>
          <h2 className={styles.h2}>
            궁금한 점,
            <br />
            미리 정리했습니다
          </h2>
          <p className={styles.faqLead}>
            여기에 없는 내용은 전화나 온라인으로 편하게 물어보세요.
          </p>
          <div className={styles.faqAsk}>
            <div className={styles.faqAskTitle}>바로 문의하기</div>
            <a className={styles.faqAskTel} href={TEL_HREF}>
              <Icon name="phone" size={16} />
              {TEL_LABEL}
            </a>
            <div className={styles.faqAskHours}>{HOURS} · 야간·주말 가능</div>
          </div>
        </div>

        <div className={styles.faqList}>
          {FAQS.map((f, i) => {
            const on = open === i;
            return (
              <div
                key={f.q}
                className={`${styles.faqItem}${on ? ` ${styles.faqItemOn}` : ''}`}
              >
                <button
                  type="button"
                  className={styles.faqQ}
                  aria-expanded={on}
                  onClick={() => setOpen(i)}
                >
                  {f.q}
                  <span className={styles.faqChev}>
                    <Icon name="chevron-down" size={20} />
                  </span>
                </button>
                {on ? (
                  <div>
                    <span className={styles.faqARule} />
                    {f.a.map((para, k) =>
                      /* 두 단락짜리 항목의 둘째 줄은 ※ 로 시작하는 회색 주석이다 */
                      k === 0 ? (
                        <p
                          key={k}
                          className={`${styles.faqA}${
                            f.a.length > 1 ? ` ${styles.faqAFirst}` : ''
                          }`}
                        >
                          {para}
                        </p>
                      ) : (
                        <p key={k} className={styles.faqANote}>
                          <span className={styles.faqANoteMark}>※</span>
                          {para.replace(/^※/, '')}
                        </p>
                      ),
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
