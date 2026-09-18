'use client';

/** @screen s0300200040 계약 폼 · 섹션 1 회사 기본정보 · 020 입주사관리 · 1차 */

/**
 * 섹션 1 — 회사 기본정보.
 *
 * 원본: design/handoff/prototypes/s0300200040.html 461~540행
 * 명세: design/handoff/tenant-contract/03-contract-form.md 「섹션 1」
 *
 * 4열 그리드 · 5행. 항목과 순서는 명세 표 그대로다.
 *   1행  회사명* | 사업자등록번호*(span2) | 회원구분*
 *   2행  법인등록번호 | 업종 | 업태 | 대표자*
 *   3행  연락처* | 이메일*(span2) | (빈 칸)
 *   4행  대표자 주소(span4)
 *   5행  특기사항(span4)
 *
 * ★ 「대표자 주소」는 **대표자 자택 주소**다. 회사 주소가 아니고 삐용에 보내지 않는다
 *   (`packages/shared/src/tenant-registration.ts` 주소 3칸 주석 · `doc/CONTRACT_DATA_MODEL.md` §C-2 ⑦).
 *
 * ★ `confirmed` 에서도 이 섹션은 열려 있다. 잠기는 것은 계약 조건(섹션 2)뿐이다.
 *   `terminated`·`cancelled` 에서만 전체가 읽기 전용이다 — 판정은 `editableSections()` 가 한다.
 */
import { Icon } from '@/components/ds';
import styles from './contract-form.module.css';
import {
  DOMAIN_CUSTOM,
  DOMAIN_PLACEHOLDER,
  EMAIL_DOMAINS,
  MEMBER_TYPES,
  MEMBER_TYPE_CORP,
  maskValue,
  type CompanyState,
  type RequiredKey,
} from './form-model';

/**
 * 사업자번호 확인 결과.
 *
 * ★ 명세는 성공·중복·무효 3종인데 **형식 오류 하나만 띄운다.** 중복은 입주사 조회 API 가,
 *   국세청 유효성은 외부 연동이 **아직 없기 때문**이다(명세도 「국세청 API 실연동 여부 TBD —
 *   미연동 시 형식 검증만」이라고 적고 있다). 없는 판정을 초록불로 보여주면 운영자가
 *   «확인했다»고 믿는다 — 그게 가장 나쁜 실패다.
 */
type BizCheck = 'none' | 'format';

interface Props {
  value: CompanyState;
  onChange: (patch: Partial<CompanyState>) => void;
  disabled: boolean;
  invalid: readonly RequiredKey[];
  bizCheck: BizCheck;
  onBizCheck: () => void;
  onStub: (message: string) => void;
}

export function SectionCompany({ value, onChange, disabled, invalid, bizCheck, onBizCheck, onStub }: Props) {
  const bad = (key: RequiredKey) => invalid.includes(key);
  const cls = (key: RequiredKey) => `${styles.input}${bad(key) ? ` ${styles.isInvalid}` : ''}`;
  const corpEnabled = value.memberType === MEMBER_TYPE_CORP && !disabled;

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h2>회사 기본정보</h2>
      </div>
      <div className={styles.sectionRule} />

      <div className={styles.grid4}>
        {/* ── 1행 ── */}
        <label className={styles.field}>
          <span className={styles.label}>
            회사명 <span className={styles.req}>*</span>
          </span>
          <input
            className={cls('company')}
            value={value.company}
            disabled={disabled}
            onChange={(e) => onChange({ company: e.target.value })}
          />
          {bad('company') ? <span className={styles.fieldError}>필수 입력 항목입니다</span> : null}
        </label>

        <div className={`${styles.field} ${styles.span2}`}>
          <span className={styles.label}>
            사업자등록번호 <span className={styles.req}>*</span>
          </span>
          <div className={styles.inlineRow}>
            <input
              className={`${cls('bizno')} ${styles.flex1}`}
              placeholder="000-00-00000 (사업자등록 전이면 비워두세요)"
              value={value.bizno}
              disabled={disabled}
              onChange={(e) => onChange({ bizno: maskValue('bizno', e.target.value) })}
            />
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              style={{ width: 72, height: 44 }}
              disabled={disabled}
              onClick={onBizCheck}
            >
              확인
            </button>
            {bizCheck === 'format' ? (
              <span style={{ display: 'flex', flex: '0 0 auto', color: 'var(--color-warning)' }} title="형식이 올바르지 않습니다">
                <Icon name="circle-alert" size={20} />
              </span>
            ) : null}
          </div>
          {bizCheck === 'format' ? <span className={styles.err}>형식이 올바르지 않습니다</span> : null}
          {bad('bizno') ? <span className={styles.fieldError}>필수 입력 항목입니다</span> : null}
        </div>

        <label className={styles.field}>
          <span className={styles.label}>
            회원구분 <span className={styles.req}>*</span>
          </span>
          <span className={styles.selectWrap}>
            <select
              className={styles.select}
              value={value.memberType}
              disabled={disabled}
              onChange={(e) => onChange({ memberType: e.target.value })}
            >
              {MEMBER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </span>
        </label>

        {/* ── 2행 ── */}
        <label className={styles.field}>
          <span className={styles.label}>법인등록번호</span>
          {/* 회원구분이 법인일 때만 활성이다. 꺼질 때 값을 비운다 — 남겨 두면
              개인사업자로 바꾼 뒤에도 법인번호가 저장 대상으로 남는다. */}
          <input
            className={styles.input}
            placeholder="000000-0000000"
            value={corpEnabled ? value.corpno : ''}
            disabled={!corpEnabled}
            onChange={(e) => onChange({ corpno: maskValue('corpno', e.target.value) })}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>업종</span>
          <input
            className={styles.input}
            value={value.industry}
            disabled={disabled}
            onChange={(e) => onChange({ industry: e.target.value })}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>업태</span>
          <input
            className={styles.input}
            value={value.bizKind}
            disabled={disabled}
            onChange={(e) => onChange({ bizKind: e.target.value })}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>
            대표자 <span className={styles.req}>*</span>
          </span>
          {/* ★ 섹션 3 의 1행이 이 값을 실시간으로 따라간다. */}
          <input
            className={cls('ceo')}
            value={value.ceo}
            disabled={disabled}
            onChange={(e) => onChange({ ceo: e.target.value })}
          />
          {bad('ceo') ? <span className={styles.fieldError}>필수 입력 항목입니다</span> : null}
        </label>

        {/* ── 3행 ── */}
        <label className={styles.field}>
          <span className={styles.label}>
            연락처 <span className={styles.req}>*</span>
          </span>
          <input
            className={`${cls('phone')} ${styles.tabular}`}
            placeholder="010-0000-0000"
            value={value.phone}
            disabled={disabled}
            onChange={(e) => onChange({ phone: maskValue('phone', e.target.value) })}
          />
          {bad('phone') ? <span className={styles.fieldError}>필수 입력 항목입니다</span> : null}
        </label>

        <div className={`${styles.field} ${styles.span2}`}>
          <span className={styles.label}>
            이메일 <span className={styles.req}>*</span>
          </span>
          <div className={styles.inlineRow}>
            <input
              className={`${cls('emailId')} ${styles.flex1}`}
              value={value.emailId}
              disabled={disabled}
              onChange={(e) => onChange({ emailId: e.target.value })}
            />
            <span style={{ flex: '0 0 auto', color: 'var(--text-muted)' }}>@</span>
            {/* ★ Select 를 숨기지 않는다. 직접입력 인풋의 표시 여부를 매 렌더마다
                Select 값에서 파생시킨다 — 숨기면 직접입력에서 되돌아올 수 없다. */}
            <span className={styles.selectWrap} style={{ width: 160, flex: '0 0 auto' }}>
              <select
                className={styles.select}
                value={value.emailDomain}
                disabled={disabled}
                onChange={(e) => onChange({ emailDomain: e.target.value })}
              >
                {EMAIL_DOMAINS.map((d) => (
                  <option key={d || 'blank'} value={d}>
                    {d === '' ? DOMAIN_PLACEHOLDER : d}
                  </option>
                ))}
                {/* 「직접입력」은 목록 맨 뒤 — 옵트인이다 */}
                <option value={DOMAIN_CUSTOM}>직접입력</option>
              </select>
            </span>
            {value.emailDomain === DOMAIN_CUSTOM ? (
              <input
                className={styles.input}
                placeholder="도메인 직접입력"
                style={{ width: 160, flex: '0 0 auto' }}
                value={value.emailDomainCustom}
                disabled={disabled}
                onChange={(e) => onChange({ emailDomainCustom: e.target.value })}
              />
            ) : null}
          </div>
          {bad('emailId') ? <span className={styles.fieldError}>필수 입력 항목입니다</span> : null}
        </div>

        {/* 명세의 3행 4번째 칸은 빈 칸이다 — 그리드 자리를 채운다 */}
        <div />

        {/* ── 4행 ── 우편번호 140 + [주소 검색] 100 + 기본주소 flex + 상세주소 320 ── */}
        <div className={`${styles.field} ${styles.span4}`}>
          <span className={styles.label}>대표자 주소</span>
          <span className={styles.hint}>계약서에 인쇄되는 대표자 주소입니다</span>
          <div className={styles.inlineRow}>
            <input
              className={`${styles.input} ${styles.tabular}`}
              readOnly
              style={{ width: 140, flex: '0 0 auto' }}
              value={value.zip}
            />
            {/* 카카오 우편번호 API 연동 지점 — 명세도 「현재 미구현」이다 */}
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              style={{ width: 100, height: 44 }}
              disabled={disabled}
              onClick={() => onStub('주소 검색은 아직 연결되지 않았습니다')}
            >
              주소 검색
            </button>
            <input className={`${styles.input} ${styles.flex1}`} readOnly value={value.addr1} />
            <input
              className={styles.input}
              placeholder="동·호수 등"
              style={{ width: 320, flex: '0 0 auto' }}
              value={value.addr2}
              disabled={disabled}
              onChange={(e) => onChange({ addr2: e.target.value })}
            />
          </div>
        </div>

        {/* ── 5행 ── */}
        <label className={`${styles.field} ${styles.span4}`}>
          <span className={styles.label}>특기사항</span>
          <textarea
            className={styles.textarea}
            rows={2}
            value={value.note1}
            disabled={disabled}
            onChange={(e) => onChange({ note1: e.target.value })}
          />
        </label>
      </div>
    </section>
  );
}

/** 사업자등록번호 형식 — `000-00-00000`. 빈 값은 「사업자등록 전」이라 형식 오류가 아니다. */
export function isBiznoFormatOk(bizno: string): boolean {
  const digits = bizno.replace(/\D/g, '');
  return digits.length === 0 || digits.length === 10;
}

export type { BizCheck };
