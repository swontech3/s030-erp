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
import { bizCheckLine, type BizCheckResult } from '@swonbiz/shared/domain/biz-number-check';
import { Icon } from '@/components/ds';
import { useKakaoPostcode } from '@/lib/useKakaoPostcode';
import styles from './contract-form.module.css';
import {
  DOMAIN_CUSTOM,
  DOMAIN_PLACEHOLDER,
  NOT_SAVEABLE_BADGE,
  NOT_SAVEABLE_NOTICE,
  isCorpMemberType,
  maskEmailId,
  maskValue,
  type CodeOption,
  type CompanyState,
  type RequiredKey,
} from './form-model';

/**
 * 사업자번호 확인 결과.
 *
 * =============================================================================
 * ★★ 한 버튼에 **성격이 다른 두 가지**가 들어 있다
 * =============================================================================
 *   국세청 상태  바깥 사실이다. 알려 줄 뿐 **아무것도 막지 않는다** — 폐업자와도
 *                계약할 수 있고 그 판단은 운영자가 한다. 국세청이 죽어도 계약
 *                등록은 그대로 된다(`unavailable`).
 *   ERP 중복     우리 규칙이다. **「종료」인 입주사는 중복이 아니다** — 퇴실 후
 *                재입주라, 막는 대신 기존 입주사로 계약할 수 있다고 알려 준다.
 *   회사명 중복  **막지 않는다.** 같은 상호는 법적으로 가능하고, 사업자번호가 다르면
 *                다른 회사다. 「혹시 같은 곳 아닙니까」라는 귀띔이다.
 *
 * 판정은 여기 없다. `@swonbiz/shared/domain/biz-number-check` 가 갖고, 서버가
 * 같은 함수를 쓴다 — 두 벌이면 조용히 갈린다.
 *
 * ★ `idle` 은 「아직 확인 안 함」이다. 사업자번호가 바뀌면(사람이 고치든 OCR 이 덮든)
 *   반드시 여기로 돌아간다 — 앞 번호로 받은 판정이 새 번호에 남으면, 아무도 확인한
 *   적 없는 번호가 확인된 것으로 보인다.
 */
type BizCheck =
  | { kind: 'idle' }
  | { kind: 'format' }
  | { kind: 'checking' }
  | { kind: 'done'; result: BizCheckResult };

interface Props {
  value: CompanyState;
  onChange: (patch: Partial<CompanyState>) => void;
  /** `terminated`·`cancelled` — 계약이 끝나 읽기 전용. */
  disabled: boolean;
  /** ★ 저장 경로가 없어 잠근 상태인가. 있으면 읽기 전용 + 안내다. */
  notSaveable: boolean;
  /** 도메인 Select 목록. 코드 테이블에서 온다(016). */
  emailDomains: readonly string[];
  /** 회원구분 Select 목록. 코드 `MEMBER_TYPE` / `use_tp='000'`. */
  memberTypes: readonly CodeOption[];
  invalid: readonly RequiredKey[];
  bizCheck: BizCheck;
  onBizCheck: () => void;
  onStub: (message: string) => void;
}

export function SectionCompany({
  value,
  onChange,
  disabled: ended,
  notSaveable,
  emailDomains,
  memberTypes,
  invalid,
  bizCheck,
  onBizCheck,
  onStub,
}: Props) {
  // ★ 저장할 곳이 없으면 입력도 받지 않는다 — 받으면 «저장된다»로 읽힌다.
  const disabled = ended || notSaveable;
  const bad = (key: RequiredKey) => invalid.includes(key);
  const cls = (key: RequiredKey) => `${styles.input}${bad(key) ? ` ${styles.isInvalid}` : ''}`;
  const corpEnabled = isCorpMemberType(value.memberType) && !disabled;
  // 스크립트를 못 받았을 때만 부른다. 이 화면의 안내 경로가 `onStub` 토스트다.
  const postcode = useKakaoPostcode(onStub);

  /*
   * ★ 사업자등록증 판독(OCR)은 **여기 없다.** 섹션 4 에서 사업자등록증을 올리면
   *   그 업로드가 첨부와 판독을 같이 하고, 결과가 이 섹션의 칸으로 돌아온다
   *   (`SectionDocs` → `ContractForm.applyBizReg` → 이 컴포넌트의 `onChange`).
   *
   *   예전에는 이 섹션에도 파일 입력과 [사업자등록증 인식] 버튼이 따로 있었다.
   *   그러면 **같은 파일을 두 번 올리게 되고**, 더 나쁜 것은 섹션 1 에서 고른 파일과
   *   섹션 4 에 첨부한 파일이 서로 다를 수 있다는 것이다.
   */

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div className={styles.titleWithBadge}>
          <h2>회사 기본정보</h2>
          {notSaveable ? (
            <span className={styles.lockBadge}>
              <Icon name="lock" size={12} />
              {NOT_SAVEABLE_BADGE}
            </span>
          ) : null}
        </div>

      </div>
      <div className={styles.sectionRule} />
      {notSaveable ? <p className={styles.sectionNote}>{NOT_SAVEABLE_NOTICE}</p> : null}

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
              disabled={disabled || bizCheck.kind === 'checking'}
              onClick={onBizCheck}
            >
              {bizCheck.kind === 'checking' ? '확인 중' : '확인'}
            </button>
            {bizCheck.kind === 'format' ? (
              <span style={{ display: 'flex', flex: '0 0 auto', color: 'var(--color-warning)' }} title="형식이 올바르지 않습니다">
                <Icon name="circle-alert" size={20} />
              </span>
            ) : null}
          </div>
          {bizCheck.kind === 'format' ? (
            <span className={styles.err}>사업자등록번호 10자리를 입력해 주세요</span>
          ) : null}
          {bizCheck.kind === 'done' ? <BizCheckLine result={bizCheck.result} /> : null}
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
              {/* ★ 값은 코드(R·A·C·S·P), 표시는 이름이다. 저장되는 것은 코드다. */}
              <option value="">선택</option>
              {memberTypes.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.name}
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
              // ★ 한글·공백·@ 는 들어오는 즉시 떨어진다(`maskEmailId`). 저장 직전에
              //   막으면 이미 여러 칸을 채운 뒤라 되돌리기가 번거롭다.
              onChange={(e) => onChange({ emailId: maskEmailId(e.target.value) })}
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
                {/* placeholder 는 코드가 아니라 Select 의 조작 장치다 — 화면이 붙인다 */}
                <option value="">{DOMAIN_PLACEHOLDER}</option>
                {emailDomains.map((d) => (
                  <option key={d} value={d}>
                    {d}
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
            {/*
              카카오 우편번호 팝업. ★ 상세주소(`addr2`)는 건드리지 않는다 — 팝업이 주는
              것은 우편번호와 기본주소뿐이고, 사람이 적어 둔 동·호수를 지울 이유가 없다.
            */}
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              style={{ width: 100, height: 44 }}
              disabled={disabled}
              onClick={() => postcode.open((r) => onChange({ zip: r.zipCode, addr1: r.address }))}
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

/**
 * 확인 결과 — **한 줄**이다.
 *
 * ★ 예전에는 국세청과 중복이 두 줄이었는데 서로 붙어 읽혔다. 문장을 만드는 일은
 *   `bizCheckLine` 이 한다 — 어느 것을 말하고 어느 것을 감출지가 규칙이라서
 *   화면이 아니라 도메인에 있다(사업자번호가 걸리면 회사명은 말하지 않는다).
 *
 * ★ **링크가 없다.** 회사명만 괄호로 보여준다. 확인은 「지금 무엇이 걸렸는지」를
 *   알려 주는 자리이지 다른 화면으로 보내는 자리가 아니다 —
 *   운영자는 대개 그 자리에서 번호를 다시 본다.
 *   (`/tenants/contracts?companyId=` 딥링크 자체는 살아 있다. 다른 데서 쓴다.)
 *
 * ★ 색으로 「막혔다」를 말하지 않는다. 휴업·폐업도 중복도 **경고이지 금지가 아니다** —
 *   운영자가 보고 판단한다. 그래서 빨강(위험)이 아니라 주의색을 쓴다.
 */
function BizCheckLine({ result }: { result: BizCheckResult }) {
  // 하나라도 걸린 것이 있으면 주의색으로 — 국세청이 계속사업자여도 중복이면 봐야 한다.
  const flagged =
    result.duplicate.kind !== 'none' ||
    result.nameDuplicate.found ||
    (result.nts.kind !== 'active' && result.nts.kind !== 'unavailable');

  const tone = flagged
    ? 'var(--color-warning)'
    : result.nts.kind === 'unavailable'
      ? 'var(--text-muted)'
      : 'var(--color-success, green)';

  return (
    <span className={styles.hint} style={{ color: tone }}>
      {bizCheckLine(result)}
    </span>
  );
}

/** 사업자등록번호 형식 — `000-00-00000`. 빈 값은 「사업자등록 전」이라 형식 오류가 아니다. */
export function isBiznoFormatOk(bizno: string): boolean {
  const digits = bizno.replace(/\D/g, '');
  return digits.length === 0 || digits.length === 10;
}

export type { BizCheck };
