/**
 * 마지막 CTA — 밝은 바탕 위에 올린 다크 카드.
 *
 * ★ 서버 컴포넌트다. 시안이 JS 로 하던 전화 버튼 hover 반전(흰 배경 · 어두운 글자 ·
 *   아이콘 인디고)은 `.telBtnInverse:hover .telNo` 처럼 자손 선택자로 옮겼다 —
 *   시안은 인라인 스타일이라 자식 색을 못 바꿔서 `bindCtaPhone` 을 썼다.
 */
import { Icon } from '@/components/ds';
import styles from './landing.module.css';
import {
  FINAL_CTA_NOTES,
  HOURS,
  HOURS_NOTE,
  TEL_HREF,
  TEL_LABEL,
  inquiryHref,
} from './landing-model';

export function FinalCta() {
  return (
    <section className={styles.finalWrap}>
      <div className={styles.container}>
        <div className={styles.final}>
          <div className={styles.finalBlobA} />
          <div className={styles.finalBlobB} />
          <div className={styles.finalDots} />

          <div className={styles.finalIn}>
            <span className={styles.eyebrowInverse}>GET STARTED</span>
            {/* ★ 위 여백만 14px 다 — erp 섹션의 같은 h2 는 16px 이다(시안 그대로) */}
            <h2 className={`${styles.h2Inverse} ${styles.finalH2}`}>
              사업자등록 전이어도, 오늘 시작할 수 있습니다
            </h2>
            <p className={styles.finalLead}>
              대표자 신분증만 준비하세요. 공간 배정부터 법인설립 서류, 세무 자동화까지 한 번에
              안내해 드립니다.
            </p>

            <div className={styles.finalCtas}>
              <a
                className={`${styles.bigBtn} ${styles.bigBtnWide}`}
                href={inquiryHref('상담')}
              >
                무료 상담 신청
                <Icon name="arrow-right" size={18} />
              </a>
              <a className={styles.telBtnInverse} href={TEL_HREF}>
                <span className={styles.telIcon}>
                  <Icon name="phone" size={18} />
                </span>
                <span className={styles.telStack}>
                  <span className={styles.telLabel}>전화 상담</span>
                  <span className={styles.telNo}>{TEL_LABEL}</span>
                </span>
              </a>
            </div>

            <span className={`${styles.hours} ${styles.finalHours}`}>
              <Icon name="clock" size={12} />
              {HOURS} · <span className={styles.finalHoursStrong}>{HOURS_NOTE}</span>
            </span>

            <div className={styles.finalNotes}>
              {FINAL_CTA_NOTES.map((n) => (
                <span key={n} className={styles.finalNote}>
                  <Icon name="circle-check" size={16} className={styles.finalNoteIcon} />
                  {n}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
