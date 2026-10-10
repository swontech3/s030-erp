/**
 * 법인변경(s040200010 · s040200011) — 변경 구분 · 입력 칸 · 검증 · 상태 전이 · 신청기한. 순수 함수.
 *
 * 레거시 `S-WonERP/src/lib/corp-change-registry.ts` · `corp-change-validate.ts` ·
 * `corp-change-transitions.ts` · `corp-change-deadline.ts` 를 옮겼다(2026-10-10, 법인변경 1단계).
 * 화면·API·DB 는 아직 이 파일을 쓰지 않는다 — 2단계부터 붙는다.
 *
 * =============================================================================
 * ★★★ 전이 판정은 여기 한 곳이다 — 화면과 API 가 같은 함수를 쓴다
 * =============================================================================
 * 레거시는 **역할을 전혀 보지 않았다.** 회사 사용자도 완료·취소·삭제를 누를 수 있었다.
 * 그리고 화면(`CorpChangeDetail`)과 라우트가 버튼 노출과 전이 검사를 따로 들고 있었다.
 * 두 벌로 두면 어긋나고, 어긋나는 쪽은 늘 화면이라 뚫린 줄도 모른다(`contract-status.ts` 와
 * 같은 이유). 그래서 `checkTransition` 이 역할을 받아 **거절 사유**까지 돌려준다 —
 * 화면은 그 사유로 버튼을 끄고, API 는 같은 사유로 거절한다.
 *
 * =============================================================================
 * ★★ 검증은 **저장될 값**을 인자로 받는다
 * =============================================================================
 * 레거시는 내용과 상태(P→E)를 한 요청에 보내면, 검증이 DB 에 있던 **저장 전** 값을 읽었다.
 * 그래서 방금 채운 칸이 「비었다」고 거절되거나, 방금 지운 칸이 통과했다. 여기서는 DB 를
 * 모른다 — 부르는 쪽이 「이번에 저장될 값」을 넘긴다.
 *
 * =============================================================================
 * ★ 레거시보다 엄격해진 것 (결정 2026-10-09)
 * =============================================================================
 *   · 주소 묶음은 「한 칸이라도 있으면 통과」가 아니라 **우편번호 · 기본주소가 둘 다** 있어야 한다
 *     (상세주소는 선택 — 결정 2026-10-10)
 *   · 날짜 칸(결의일 · 전입일 · 효력일)은 `YYYY-MM-DD` 이고 **있는 날짜**여야 한다(`day.ts`)
 *   · 임원은 인원수만 세지 않는다 — 성명 · 직위가 비면, 구분이 취임·사임·중임이 아니면 거절
 *   · 사업목적은 빈 줄을 뺀 뒤 1줄 이상
 *   · 오류는 **칸별 목록**이다 — 화면이 칸 옆에 붙일 수 있게
 *   · 모르는 변경 구분은 거절한다. 레거시는 「등기 설정으로 출력하는 구분」이라며 그냥 통과시켰다
 *
 * ★ 이번에 가져오지 않은 것: 서류 목록 · 양식 번호 · 「등기할 사항」 문구 · 첨부서면(서류 코드와
 *   등기 설정의 몫이다 — 레거시는 여기 박힌 값이 설정을 이겼다. 「다음 단계」), 암호화, DB.
 *
 * ★ 코드값은 `code-usage.ts` 의 `PINNED_CODES` 에 올라 있다 — 코드 관리에서 바꾸거나 지우지 못한다.
 */
import type { ScopeRole } from '../session.ts';
import { parseDay } from './day.ts';

// =============================================================================
// 코드 어휘
// =============================================================================

/** 변경 구분 코드 — 공통코드 `LAW_CNG_TP` / `000`. */
export const CORP_CHANGE_TYPE_CATEGORY = 'LAW_CNG_TP';
/** 진행 상태 코드 — 공통코드 `LAW_PROG_ST` / `000`. */
export const CORP_CHANGE_STATUS_CATEGORY = 'LAW_PROG_ST';
export const CORP_CHANGE_CODE_USE_TP = '000';

/**
 * 변경 구분 5종. **이 목록에 없으면 거절한다.**
 *
 * ★ 개발 DB 코드표에는 `CEO_CHG`(대표이사변경)도 있다 — **구현 없음, 나중.** 레거시에도
 *   입력 칸 정의가 없었다(결정 2026-10-09). 넣을 때 여기와 `CHANGE_TYPE_DEFS` 에 함께 넣는다.
 */
export const CORP_CHANGE_TYPES = ['NAME', 'HQ', 'PURPOSE', 'OFFICER', 'CEO_ADDR'] as const;
export type CorpChangeType = (typeof CORP_CHANGE_TYPES)[number];

/**
 * 진행 상태 4종 — 서류작성중(P) → 작성완료(E) → 완료(C), 그리고 취소(X).
 *
 *   P 서류작성중 · E 서류작성완료 · C 완료 · X 취소
 *
 * ★ 코드표의 `S`(준비중)는 쓰지 않는다 — 새 건은 `P` 로 시작한다(레거시와 같다).
 * ★★ 「제출(A)」은 뺐다(결정 2026-10-10) — 제출은 상대 회사 연락이 없으면 확정할 수 없다.
 *    코드표 `LAW_PROG_ST` 의 `A` 는 지우지 않는다 — 앱이 이 목록으로 걸러낸다. 개발 DB 의 A 1건은
 *    일회용 정리 파일로 지웠다(`scripts/oneoff/2026-10-10-drop-status-a-corp-change.sql`).
 */
export const CORP_CHANGE_STATUSES = ['P', 'E', 'C', 'X'] as const;
export type CorpChangeStatus = (typeof CORP_CHANGE_STATUSES)[number];

/** 새 건의 상태. 운영사 · 회사 모두 새 건을 만들 수 있다. */
export const INITIAL_CORP_CHANGE_STATUS: CorpChangeStatus = 'P';

/**
 * 임원 변경 종류 — 취임 · 사임 · 중임.
 * ★ 공통코드가 아니다. 레거시가 앱에 박아 둔 값을 그대로 옮겼다(`OfficersCard` 의 `KIND_LABEL`).
 */
export const OFFICER_CHANGE_KINDS = ['APPOINT', 'RESIGN', 'REELECT'] as const;
export type OfficerChangeKind = (typeof OFFICER_CHANGE_KINDS)[number];
export const OFFICER_CHANGE_KIND_LABEL: Readonly<Record<OfficerChangeKind, string>> = {
  APPOINT: '취임',
  RESIGN: '사임',
  REELECT: '중임',
};

export function isCorpChangeType(value: unknown): value is CorpChangeType {
  return typeof value === 'string' && (CORP_CHANGE_TYPES as readonly string[]).includes(value);
}

export function isCorpChangeStatus(value: unknown): value is CorpChangeStatus {
  return typeof value === 'string' && (CORP_CHANGE_STATUSES as readonly string[]).includes(value);
}

export function isOfficerChangeKind(value: unknown): value is OfficerChangeKind {
  return typeof value === 'string' && (OFFICER_CHANGE_KINDS as readonly string[]).includes(value);
}

// =============================================================================
// 구분별 입력 칸 — 레거시 레지스트리 그대로
// =============================================================================

export type CorpChangeFieldType = 'text' | 'textarea' | 'date' | 'address';

export interface CorpChangeFieldDef {
  /** `payload` 의 키. */
  name: string;
  /** 칸 이름 — 오류 문구에도 쓴다. */
  label: string;
  type: CorpChangeFieldType;
  required: boolean;
}

export interface CorpChangeTypeDef {
  fields: readonly CorpChangeFieldDef[];
  /** 임원 목록을 쓰는가(임원변경). */
  usesOfficers: boolean;
  /** 임원별 효력일이 작성완료 때 필수인가(임원변경 — 결정 2026-10-10). 임원을 안 쓰는 구분은 false. */
  officerEffectiveDateRequired: boolean;
  /**
   * 기본정보의 대표자 자택 주소(우편번호 · 기본주소)가 작성완료 때 필수인가 — 대표주소 변경의
   * 「변경 전 주소」가 이 값이다(결정 2026-10-10 — 변경 내용에 따로 두지 않는다).
   */
  requiresCeoHome: boolean;
}

/**
 * 구분별 입력 칸. 필수 여부는 레거시 레지스트리에 **날짜 필수**를 더했다(결정 2026-10-10 —
 * 등기 기준일이 없으면 신청기한을 셀 수 없다):
 *   상호 · 목적 · 임원 · 본점 = 결의일 필수 · 본점 = 「이전일」 칸을 더했다(등기 기준일) ·
 *   임원 = 임원별 효력일 필수(`officerEffectiveDateRequired`) · 대표주소 = 전입일 필수(전부터)
 * ★ 필수 표시(`required`)는 **여기 한 곳**이다 — 검증(`validateCorpChange`)과 화면의 `*` 가 이 값을 읽는다.
 *   저장 때는 검증하지 않는다(작성 중 임시 저장) — 작성완료(P→E) 때만.
 *
 * ★ 구분의 **이름**은 여기 두지 않는다 — 화면은 코드표(`LAW_CNG_TP`)의 이름을 읽는다.
 *   코드 관리에서 이름을 고치면 바로 반영돼야 한다(`code-usage.ts` 머리말 「허용한다」).
 */
export const CHANGE_TYPE_DEFS: Readonly<Record<CorpChangeType, CorpChangeTypeDef>> = {
  NAME: {
    usesOfficers: false,
    officerEffectiveDateRequired: false,
    requiresCeoHome: false,
    fields: [
      { name: 'newName', label: '신규 상호', type: 'text', required: true },
      { name: 'newNameEn', label: '신규 영문상호', type: 'text', required: false },
      { name: 'resolutionDate', label: '결의일', type: 'date', required: true },
    ],
  },
  HQ: {
    usesOfficers: false,
    officerEffectiveDateRequired: false,
    requiresCeoHome: false,
    fields: [
      { name: 'newHqAddress', label: '신규 본점주소', type: 'address', required: true },
      { name: 'resolutionDate', label: '결의일', type: 'date', required: true },
      { name: 'relocationDate', label: '이전일', type: 'date', required: true },
    ],
  },
  PURPOSE: {
    usesOfficers: false,
    officerEffectiveDateRequired: false,
    requiresCeoHome: false,
    fields: [
      { name: 'purposes', label: '사업목적', type: 'textarea', required: true },
      { name: 'resolutionDate', label: '결의일', type: 'date', required: true },
    ],
  },
  OFFICER: {
    usesOfficers: true,
    officerEffectiveDateRequired: true,
    requiresCeoHome: false,
    fields: [{ name: 'resolutionDate', label: '결의일', type: 'date', required: true }],
  },
  CEO_ADDR: {
    usesOfficers: false,
    officerEffectiveDateRequired: false,
    // ★ 「변경 전 주소」 칸은 없다(2026-10-10) — 기본정보의 대표자 자택 주소를 쓴다(입주사 = ERP, 비입주사 =
    //   법무 회사 정보). 옛 건 payload 에 남은 `oldCeoAddress` 는 읽지 않는다.
    requiresCeoHome: true,
    fields: [
      { name: 'newCeoAddress', label: '변경 후 대표자 주소', type: 'address', required: true },
      { name: 'moveInDate', label: '전입일', type: 'date', required: true },
    ],
  },
};

/** 그 구분의 정의. 모르는 구분이면 null. */
export function changeTypeDef(changeType: string): CorpChangeTypeDef | null {
  return isCorpChangeType(changeType) ? CHANGE_TYPE_DEFS[changeType] : null;
}

// =============================================================================
// 검증 — 서류작성완료(P→E) 때
// =============================================================================

/**
 * 칸 하나의 오류.
 *
 * `field` 는 칸의 자리다 — `newName` · `newHqAddress.zipCode` · `officers` ·
 * `officers.0.name` 처럼 점으로 잇는다. 화면이 이 값으로 칸을 찾아 옆에 문구를 붙인다.
 */
export interface CorpChangeFieldError {
  field: string;
  message: string;
}

/** 주소 묶음 — `{ zipCode, address, addressDetail }`. 상세주소는 선택이다. */
export interface CorpChangeAddress {
  zipCode?: string | null;
  address?: string | null;
  addressDetail?: string | null;
}

/** 주소 묶음에서 필수인 칸(결정 2026-10-10). */
const ADDRESS_REQUIRED: readonly { key: 'zipCode' | 'address'; label: string }[] = [
  { key: 'zipCode', label: '우편번호' },
  { key: 'address', label: '기본주소' },
];

/**
 * 임원 한 명 — 검증에 넘기는 모양.
 *
 * ★ `rrn` 은 **평문이 손에 있을 때만**(새로 입력했을 때) 넘긴다. 저장된 주민번호는 암호문이라
 *   P→E 때 서버도 평문을 모른다 — 그래서 주민번호 검사는 입력 시점의 일이다(`validateRrn`).
 */
export interface CorpChangeOfficerInput {
  name?: string | null;
  changeKind?: string | null;
  position?: string | null;
  /** 효력일 `YYYY-MM-DD`. 선택. */
  effectiveDate?: string | null;
  rrn?: string | null;
}

/** 검증에 넘기는 내용 — 이번에 **저장될** 값이다(머리말 ★★). */
export interface CorpChangeContent {
  changeType: string;
  payload: unknown;
  officers: readonly CorpChangeOfficerInput[];
  /**
   * 기본정보의 대표자 자택 — 구분이 `requiresCeoHome` 일 때 본다. 없으면 「비어 있다」로 거절한다
   * (검증 없이 통과시키지 않는다). 입주사면 문구가 입주사 화면으로 보낸다.
   */
  company?: { isTenant: boolean; ceoZipCode: string | null; ceoAddress: string | null };
}

/** 대표자 자택 주소가 비었을 때의 자리 — 기본정보 카드의 그 칸 옆에 붙는다. */
export const CEO_HOME_ERROR_FIELD = 'company.ceo';

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 사업목적 — 줄바꿈으로 나누고, 앞뒤 공백을 떼고, 빈 줄을 뺀다. */
export function purposeLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '');
}

/** 주민번호 모양 — 숫자 13자리. 앞 6자리 뒤 하이픈 하나는 허용한다. */
export function isRrnShape(raw: string): boolean {
  return /^\d{6}-?\d{7}$/.test(raw.trim());
}

/**
 * 주민번호 검사 — **입력할 때** 부른다. 비었으면 통과(주민번호는 선택 칸이다).
 * ★ 체크섬은 보지 않는다 — 2020-10 이후 발급분은 체크섬이 맞지 않는다.
 */
export function validateRrn(raw: unknown, field = 'rrn'): CorpChangeFieldError | null {
  if (isBlank(raw)) return null;
  if (typeof raw !== 'string' || !isRrnShape(raw)) {
    return { field, message: '주민등록번호는 숫자 13자리로 입력하세요' };
  }
  return null;
}

function checkDate(value: unknown, field: string, label: string, required: boolean): CorpChangeFieldError | null {
  if (isBlank(value)) return required ? { field, message: `${label}을(를) 입력하세요` } : null;
  if (typeof value !== 'string' || parseDay(value) === null) {
    return { field, message: `${label}은(는) 날짜(YYYY-MM-DD)로 입력하세요` };
  }
  return null;
}

function checkField(def: CorpChangeFieldDef, value: unknown): CorpChangeFieldError[] {
  const { name, label, type, required } = def;

  if (type === 'date') {
    const e = checkDate(value, name, label, required);
    return e ? [e] : [];
  }

  if (type === 'address') {
    if (value === null || value === undefined) {
      return required ? ADDRESS_REQUIRED.map((r) => ({ field: `${name}.${r.key}`, message: `${label}의 ${r.label}을(를) 입력하세요` })) : [];
    }
    if (!isPlainObject(value)) return [{ field: name, message: `${label}이(가) 주소 형식이 아닙니다` }];
    const errors: CorpChangeFieldError[] = [];
    for (const key of ['zipCode', 'address', 'addressDetail'] as const) {
      const v = value[key];
      if (v !== undefined && v !== null && typeof v !== 'string') {
        errors.push({ field: `${name}.${key}`, message: `${label}이(가) 주소 형식이 아닙니다` });
      }
    }
    if (errors.length > 0) return errors;
    if (!required) return [];
    return ADDRESS_REQUIRED.filter((r) => isBlank(value[r.key])).map((r) => ({
      field: `${name}.${r.key}`,
      message: `${label}의 ${r.label}을(를) 입력하세요`,
    }));
  }

  // text · textarea — 글자여야 한다
  if (isBlank(value)) return required ? [{ field: name, message: `${label}을(를) 입력하세요` }] : [];
  if (typeof value !== 'string') return [{ field: name, message: `${label}은(는) 글자로 입력하세요` }];
  if (name === 'purposes' && purposeLines(value).length === 0) {
    return [{ field: name, message: `${label}을(를) 한 줄 이상 입력하세요` }];
  }
  return [];
}

/**
 * 임원 한 명 검증. `index` 는 오류 자리(`officers.{index}.name`)에 들어간다.
 * @param effectiveDateRequired 효력일 필수 — 구분 정의의 `officerEffectiveDateRequired` 를 넘긴다.
 */
export function validateOfficer(o: CorpChangeOfficerInput, index: number, effectiveDateRequired = false): CorpChangeFieldError[] {
  const at = (key: string) => `officers.${index}.${key}`;
  const errors: CorpChangeFieldError[] = [];
  if (isBlank(o.name)) errors.push({ field: at('name'), message: '성명을 입력하세요' });
  if (!isOfficerChangeKind(o.changeKind)) {
    errors.push({ field: at('changeKind'), message: '구분은 취임 · 사임 · 중임 중에서 고르세요' });
  }
  if (isBlank(o.position)) errors.push({ field: at('position'), message: '직위를 입력하세요' });
  const date = checkDate(o.effectiveDate, at('effectiveDate'), '효력일', effectiveDateRequired);
  if (date) errors.push(date);
  const rrn = validateRrn(o.rrn, at('rrn'));
  if (rrn) errors.push(rrn);
  return errors;
}

/**
 * 서류작성완료(P→E) 검증. 오류가 없으면 빈 배열.
 *
 * ★ 칸 정의에 없는 `payload` 키는 보지 않는다(거절하지도 않는다).
 * ★ 임원을 쓰지 않는 구분에 임원이 딸려 와도 보지 않는다.
 */
export function validateCorpChange(content: CorpChangeContent): CorpChangeFieldError[] {
  const def = changeTypeDef(content.changeType);
  if (!def) return [{ field: 'changeType', message: '변경 구분이 올바르지 않습니다' }];

  const payload = content.payload ?? {};
  if (!isPlainObject(payload)) return [{ field: 'payload', message: '변경 내용 형식이 올바르지 않습니다' }];

  const errors = def.fields.flatMap((f) => checkField(f, payload[f.name]));

  if (def.usesOfficers) {
    if (content.officers.length === 0) {
      errors.push({ field: 'officers', message: '임원을 1명 이상 등록하세요' });
    }
    content.officers.forEach((o, i) => errors.push(...validateOfficer(o, i, def.officerEffectiveDateRequired)));
  }

  if (def.requiresCeoHome) {
    const c = content.company;
    if (!c || isBlank(c.ceoZipCode) || isBlank(c.ceoAddress)) {
      errors.push({
        field: CEO_HOME_ERROR_FIELD,
        message: c?.isTenant
          ? '대표자 자택 주소(변경 전 주소)가 비어 있습니다 — 입주사 화면에서 입력하세요'
          : '대표자 자택 주소(변경 전 주소)의 우편번호 · 기본주소를 입력하세요',
      });
    }
  }
  return errors;
}

// =============================================================================
// 상태 전이 — 역할별
// =============================================================================

/**
 * 허용되는 전이와 **누를 수 있는 역할**. 이 표에 없으면 막힌다(화이트리스트). 결정 2026-10-10.
 *
 *   P→E 작성완료(검증) · E→P 서류수정 · E→C 완료   — 회사 · 운영사
 *   C→E 완료 취소                                  — 운영사만
 *   P/E/C→X 취소 · X→취소 직전 상태 복원           — 운영사만 (삭제는 `checkDelete`)
 *
 * ★ `tenant` 는 「회사 사용자」다 — 비입주사 회사도 세션 역할은 `tenant` 다.
 * ★ 완료(E→C)는 상대 회사 연락이 없어도 진행한다 — 제출(A) 단계는 없앴다.
 * ★ X→P/E/C 는 **복원**이고 취소 직전 상태로만 간다(`checkTransition`).
 */
const TRANSITIONS: readonly { from: CorpChangeStatus; to: CorpChangeStatus; roles: readonly ScopeRole[] }[] = [
  { from: 'P', to: 'E', roles: ['operator', 'tenant'] },
  { from: 'P', to: 'X', roles: ['operator'] },
  { from: 'E', to: 'P', roles: ['operator', 'tenant'] },
  { from: 'E', to: 'C', roles: ['operator', 'tenant'] },
  { from: 'E', to: 'X', roles: ['operator'] },
  { from: 'C', to: 'E', roles: ['operator'] },
  { from: 'C', to: 'X', roles: ['operator'] },
  { from: 'X', to: 'P', roles: ['operator'] },
  { from: 'X', to: 'E', roles: ['operator'] },
  { from: 'X', to: 'C', roles: ['operator'] },
];

export interface TransitionRequest {
  from: string;
  to: string;
  role: ScopeRole;
  /** 취소 직전 상태 — 복원(X→?) 때만 본다. */
  statusBeforeCancel?: string | null;
  /** P→E 때 **저장될** 내용. 없으면 P→E 는 거절한다(검증 없이 통과시키지 않는다). */
  content?: CorpChangeContent;
}

export type TransitionRefusal =
  /** 모르는 상태값. */
  | 'unknown_status'
  /** 표에 없는 전이. */
  | 'not_allowed'
  /** 이 역할은 누를 수 없다. */
  | 'forbidden'
  /** 복원 대상이 취소 직전 상태가 아니다. */
  | 'restore_target'
  /** P→E 검증 실패 — `errors` 에 칸별 오류. */
  | 'invalid';

export type TransitionCheck =
  | { ok: true }
  | { ok: false; code: TransitionRefusal; reason: string; errors?: CorpChangeFieldError[] };

/**
 * 이 전이를 이 역할이 할 수 있는가 — 거절이면 **사유**를 돌려준다.
 *
 * 순서: 상태값 → 전이표 → 역할 → 복원 대상 → (P→E) 검증. 역할을 검증보다 먼저 본다 —
 * 누를 수 없는 사람에게 칸 오류를 보여 줄 이유가 없다.
 */
export function checkTransition(req: TransitionRequest): TransitionCheck {
  const { from, to, role } = req;
  if (!isCorpChangeStatus(from) || !isCorpChangeStatus(to)) {
    return { ok: false, code: 'unknown_status', reason: `알 수 없는 상태입니다 (${from}→${to})` };
  }
  const row = TRANSITIONS.find((t) => t.from === from && t.to === to);
  if (!row) return { ok: false, code: 'not_allowed', reason: `허용되지 않은 상태 전이입니다 (${from}→${to})` };
  if (!row.roles.includes(role)) {
    return { ok: false, code: 'forbidden', reason: FORBIDDEN_REASON[`${from}${to}`] ?? '이 처리는 운영사만 할 수 있습니다' };
  }
  if (from === 'X' && to !== req.statusBeforeCancel) {
    return { ok: false, code: 'restore_target', reason: '취소 직전 상태로만 복원할 수 있습니다' };
  }
  if (from === 'P' && to === 'E') {
    if (!req.content) {
      return { ok: false, code: 'invalid', reason: '검증할 내용이 없어 서류작성완료로 바꿀 수 없습니다', errors: [] };
    }
    const errors = validateCorpChange(req.content);
    if (errors.length > 0) return { ok: false, code: 'invalid', reason: '입력 내용을 확인하세요', errors };
  }
  return { ok: true };
}

/** 회사가 누를 수 없는 전이의 문구 — 무엇을 해야 하는지까지 적는다. */
const FORBIDDEN_REASON: Readonly<Record<string, string>> = {
  CE: '완료 취소는 운영사만 할 수 있습니다',
  PX: '취소는 운영사만 할 수 있습니다',
  EX: '취소는 운영사만 할 수 있습니다',
  CX: '취소는 운영사만 할 수 있습니다',
  XP: '복원은 운영사만 할 수 있습니다',
  XE: '복원은 운영사만 할 수 있습니다',
  XC: '복원은 운영사만 할 수 있습니다',
};

/**
 * 지금 이 역할이 갈 수 있는 상태들 — 화면이 버튼을 고를 때 쓴다.
 * ★ P→E 의 검증은 여기서 보지 않는다(버튼은 보이고, 누르면 칸 오류가 뜬다).
 */
export function availableTransitions(
  from: string,
  role: ScopeRole,
  statusBeforeCancel?: string | null,
): CorpChangeStatus[] {
  if (!isCorpChangeStatus(from)) return [];
  return TRANSITIONS.filter(
    (t) => t.from === from && t.roles.includes(role) && (from !== 'X' || t.to === statusBeforeCancel),
  ).map((t) => t.to);
}

/** 내용(변경 칸 · 임원)을 고칠 수 있는가 — P 뿐. 모르는 값은 잠근다. */
export function canEditCorpChange(status: string): boolean {
  return status === 'P';
}

/** 서류를 출력할 수 있는가 — E · C(레거시와 같다). 제출(A)은 없앴다(2026-10-10). */
export function canPrintCorpChange(status: string): boolean {
  return status === 'E' || status === 'C';
}

/**
 * 물리 삭제 — **운영사만**, P(잘못 만든 건) · X(취소 건 정리)에서만.
 * 진행 중인 건은 취소한 뒤에 지운다.
 */
export function checkDelete(status: string, role: ScopeRole): TransitionCheck {
  if (role !== 'operator') return { ok: false, code: 'forbidden', reason: '삭제는 운영사만 할 수 있습니다' };
  if (status !== 'P' && status !== 'X') {
    return { ok: false, code: 'not_allowed', reason: '진행 중인 건은 취소한 뒤에 삭제할 수 있습니다' };
  }
  return { ok: true };
}

// =============================================================================
// 신청기한 — 모든 구분 (결정 2026-10-10)
// =============================================================================

/**
 * 변경등기 신청기한(일) — 등기 기준일로부터 2주. **구분별로 다르지 않다**(2026-10-10 확인):
 * 상호 · 목적 · 임원 · 대표이사 주소 = 상법 제183조(제317조 제4항 준용) 「2주일 내」,
 * 본점이전 = 상법 제182조 「2주일 내」.
 */
export const REGISTRATION_DEADLINE_DAYS = 14;

/**
 * 구분별 등기 기준일 — 이 표 한 곳에서 정한다.
 *   상호 · 목적 = 결의일 · 본점 = 이전일 · 대표주소 = 전입일 · 임원 = 임원 효력일 중 **가장 이른 날**
 */
export const DEADLINE_BASIS: Readonly<Record<CorpChangeType, { label: string; field: string | null }>> = {
  NAME: { label: '결의일', field: 'resolutionDate' },
  PURPOSE: { label: '결의일', field: 'resolutionDate' },
  HQ: { label: '이전일', field: 'relocationDate' },
  CEO_ADDR: { label: '전입일', field: 'moveInDate' },
  OFFICER: { label: '효력일', field: null }, // 임원별 효력일 중 가장 이른 날
};

export interface RegistrationDeadline {
  /** 기준일 이름 — 「결의일」 · 「이전일」 · 「전입일」 · 「효력일」. 화면 문구에 쓴다. */
  basisLabel: string;
  /** 기준일 `YYYY-MM-DD`. */
  basisDay: string;
  /** 기준일부터 오늘(baseDay)까지 지난 날수. 기준일이 미래면 음수. */
  elapsedDays: number;
  /** 기한 초과 — 지난 날수가 14 **초과**. 14일째 되는 날까지는 기한 안이다. */
  overdue: boolean;
}

/**
 * 신청기한 경과 — 구분별 기준일(`DEADLINE_BASIS`)로 센다. 기준일이 없거나 틀리면 null.
 *
 * ★ 기준일은 `YYYY-MM-DD` 로 받는다 — 「오늘」을 안에서 만들지 않는다. 시험할 수 있어야 하고,
 *   부르는 쪽이 로컬 날짜로 바꿔서 넘겨야 하루가 밀리지 않는다(`day.ts` 머리말 ★★).
 * ★ 임원변경은 임원 목록의 효력일 중 가장 이른 날이다 — 틀린 날짜는 건너뛴다.
 */
export function registrationDeadline(
  changeType: string,
  payload: unknown,
  baseDay: string,
  officers: readonly { effectiveDate?: string | null }[] = [],
): RegistrationDeadline | null {
  if (!isCorpChangeType(changeType) || !isPlainObject(payload)) return null;
  const basis = DEADLINE_BASIS[changeType];
  const candidates = basis.field === null ? officers.map((o) => o.effectiveDate) : [payload[basis.field]];
  const days = candidates
    .filter((v): v is string => typeof v === 'string' && parseDay(v) !== null)
    .sort();
  const basisDay = days[0];
  const base = parseDay(baseDay);
  if (basisDay === undefined || base === null) return null;
  const from = parseDay(basisDay)!;
  const elapsedDays = Math.round((base.getTime() - from.getTime()) / 86_400_000);
  return { basisLabel: basis.label, basisDay, elapsedDays, overdue: elapsedDays > REGISTRATION_DEADLINE_DAYS };
}
