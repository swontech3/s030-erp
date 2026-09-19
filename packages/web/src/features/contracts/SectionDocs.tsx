'use client';

/** @screen s0300200040 계약 폼 · 섹션 4 첨부 서류 · 020 입주사관리 · 1차 */

/**
 * 섹션 4 — 첨부 서류.
 *
 * 원본: design/handoff/prototypes/s0300200040.html 668~686행 · 렌더는 1160~1215행
 * 명세: design/handoff/tenant-contract/03-contract-form.md 「섹션 4」
 *
 * 회원구분이 **필수 여부와 표시 여부**를 정한다.
 *   대표자 신분증    프리랜서 필수 · 개인사업자 필수 · 법인 필수
 *   사업자등록증     프리랜서 선택 · 개인사업자 필수 · 법인 필수
 *   법인등기부등본   프리랜서·개인사업자는 **카드 자체를 숨긴다** · 법인 선택
 *
 * ★★ **파일을 아직 올릴 수 없다.** 첨부는 CONT-17(로드맵 페이즈 4 작업 11)이고 이 작업의
 *    범위가 아니다 — `tb_cm_file` polymorphic 패턴을 재사용하되 부모 경유 검증을 강제해야
 *    해서 따로 세운 항목이다. 여기서는 **화면만** 만든다. 명세도 「미리보기·삭제 동작은
 *    미구현 (UI만)」이라고 적고 있다.
 *    그래서 등록 건수는 항상 `0 / N` 이고, 사업자등록증 미등록 안내는 회원구분이
 *    개인사업자·법인이면 늘 뜬다 — **틀린 표시가 아니라 실제로 아직 0건이다.**
 */
import { Icon } from '@/components/ds';
import styles from './contract-form.module.css';
import { isCorpMemberType, NOT_SAVEABLE_BADGE, NOT_SAVEABLE_NOTICE } from './form-model';

const DOC_DEFS = [
  { key: 'id', name: '대표자 신분증', desc: '주민등록증 또는 운전면허증 사본' },
  { key: 'biz', name: '사업자등록증', desc: '사업자등록 전이면 발급 후 제출해 주세요' },
  { key: 'corp', name: '법인등기부등본', desc: '최근 3개월 이내 발급본' },
] as const;

/**
 * 회원구분이 표시 여부와 필수 여부를 정한다. **`memberType` 은 코드다**(`R`·`P`…).
 *
 * ★ 사업자등록증 필수 조건이 2026-09-19 에 바뀌었다. 예전엔 「프리랜서가 아니면 필수」
 *   였는데, 코드 체계(`MEMBER_TYPE 000`)에 **프리랜서가 없다.** 개인(`P`) 안에
 *   프리랜서와 개인사업자가 섞여 있어 갈라낼 수 없다. 그래서 **법인이면 필수**로 둔다 —
 *   개인을 필수로 묶으면 사업자등록 전인 프리랜서가 막힌다(사업자번호 칸의 안내도
 *   「사업자등록 전이면 비워두세요」다).
 */
function docRule(key: (typeof DOC_DEFS)[number]['key'], memberType: string) {
  if (key === 'id') return { show: true, required: true };
  if (key === 'biz') return { show: true, required: isCorpMemberType(memberType) };
  return { show: isCorpMemberType(memberType), required: false };
}

interface Props {
  memberType: string;
  disabled: boolean;
  /** ★ 저장 경로가 없어 잠근 상태인가. 첨부는 CONT-17 까지 계속 그렇다. */
  notSaveable: boolean;
  onStub: (message: string) => void;
}

export function SectionDocs({ memberType, disabled: ended, notSaveable, onStub }: Props) {
  const disabled = ended || notSaveable;
  const shown = DOC_DEFS.filter((d) => docRule(d.key, memberType).show);
  // 올릴 수 없으므로 등록 건수는 0 이다. 지어내지 않는다.
  const done = 0;
  const bizMissing = isCorpMemberType(memberType);

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div className={styles.titleWithBadge}>
          <h2>첨부 서류</h2>
          {notSaveable ? (
            <span className={styles.lockBadge}>
              <Icon name="lock" size={12} />
              {NOT_SAVEABLE_BADGE}
            </span>
          ) : null}
        </div>
        <span className={styles.sectionCount}>
          {done} / {shown.length} 등록
        </span>
      </div>
      <div className={styles.sectionRule} />
      {notSaveable ? <p className={styles.sectionNote}>{NOT_SAVEABLE_NOTICE}</p> : null}

      <div className={styles.docList}>
        {shown.map((def) => {
          const rule = docRule(def.key, memberType);
          return (
            <div className={styles.docCard} key={def.key}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span className={styles.docName}>{def.name}</span>
                  <span className={`${styles.badge} ${rule.required ? styles.badgeDanger : styles.badgeNeutral}`}>
                    {rule.required ? '필수' : '선택'}
                  </span>
                </div>
                <div className={styles.docDesc}>{def.desc}</div>
              </div>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnGhost}`}
                disabled={disabled}
                onClick={() => onStub('첨부 서류 등록은 아직 연결되지 않았습니다')}
              >
                <Icon name="upload" size={16} />
                파일 선택
              </button>
            </div>
          );
        })}
      </div>

      <div className={styles.docFoot}>JPG, PNG, PDF 형식 · 파일당 최대 10MB</div>

      {bizMissing ? (
        <div className={`${styles.notice} ${styles.noticeWarning}`}>
          <span className={styles.noticeIcon}>
            <Icon name="circle-alert" size={16} />
          </span>
          <span>사업자등록증이 없으면 가등록 상태로 계약이 진행됩니다. 발급 후 반드시 제출해 주세요.</span>
        </div>
      ) : null}
    </section>
  );
}
