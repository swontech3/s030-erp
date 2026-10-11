/**
 * 법인설립(s040100010 · s040100020) — 입력 칸 · 검증 · 상태 전이. 순수 함수(10-1, 2026-10-11).
 *
 * 레거시 `S-WonERP/src/lib/incorp-validate.ts` · `incorp-transitions.ts` · `incorp-targets.ts` 를 바탕으로
 * 결정(2026-10-11)에 맞춰 다시 짰다.
 *
 * =============================================================================
 * ★★ 범위 (결정 2026-10-11)
 * =============================================================================
 *   · **주식회사 · 발기설립만**(`R_PROMOTER`). 유한회사 · 모집설립은 나중
 *   · 사람은 발기인 · 이사 · 감사 · 대표이사 체크(겹쳐 체크 가능) + 인수수량 + 취임일
 *   · 사업목적은 텍스트 칸 하나(한 줄에 하나 — 법인변경과 같은 `purposeLines`), 고르기 팝업을 쓴다
 *   · 정관이 고정 배치라 **사업목적 최대 20줄 · 발기인 최대 5명** — 넘으면 작성완료(P→E) 때 거절
 *
 * =============================================================================
 * ★★ 상태 흐름은 법인변경과 하나다 — P → E → C, 그리고 X (S · A 없음)
 * =============================================================================
 * 전이표 · 역할 · 복원 · 삭제 규칙은 `corp-change.ts` 의 것을 그대로 쓴다(`checkLegalTransition` ·
 * `availableTransitions` · `checkDelete` · `canEditCorpChange` · `canPrintCorpChange`). 여기에는 P→E 의
 * 검증(`validateIncorporation`)만 있다.
 *
 * =============================================================================
 * ★ 레거시와 달라진 것
 * =============================================================================
 *   · 인수수량 합은 **발기인**의 합 = 설립 때 발행 수(결정 2). 레거시 코드는 이사의 합으로 셌다(설계와 어긋남)
 *   · 자본금 · 1주 금액 · 주식 수가 비어 있으면 레거시는 정합 검사를 건너뛰었다 — 여기서는 작성완료 때 필수다
 *     (서류에 찍히는 값이다). 필수 표시는 `INCORP_FIELD_DEFS` 한 곳이다
 *   · 경고(1주 100원 미만 · 자본금 10억 이상인데 감사 없음)는 막지 않고 따로 돌려준다(`incorporationWarnings`)
 */
import type { ScopeRole } from '../session.ts';
import { parseDay } from './day.ts';
import {
  checkLegalTransition,
  purposeLines,
  validateRrn,
  type CorpChangeAddress,
  type CorpChangeFieldError,
  type TransitionCheck,
} from './corp-change.ts';

/** 회사유형 — 주식회사만(공통코드 `MEMBER_TYPE` 의 R). */
export const INCORP_ENTITY_TYPE = 'R';
/** 설립 구분 — 공통코드 `LAW_EST_TP` 의 「주식회사 발기설립」. 등기 설정(`tb_s080_doc_form_settings`)의 줄 키이기도 하다. */
export const INCORP_METHOD = 'R_PROMOTER';
export const INCORP_METHOD_CATEGORY = 'LAW_EST_TP';

/** 정관 고정 배치의 한도(결정 3). */
export const INCORP_PURPOSE_MAX = 20;
export const INCORP_FOUNDER_MAX = 5;

/** DB 칸이 `integer` 다(레거시 그대로) — 이보다 큰 금액 · 수는 받지 않는다. */
export const INCORP_INT_MAX = 2_147_483_647;

// =============================================================================
// 입력 칸
// =============================================================================

export type IncorpFieldType = 'text' | 'textarea' | 'address' | 'amount' | 'count' | 'monthDay' | 'date';

export interface IncorpFieldDef {
  /** 내용(`IncorporationInfo`)의 키. */
  name: keyof IncorporationInfo;
  label: string;
  type: IncorpFieldType;
  /** 작성완료(P→E) 때 필수인가. ★ 필수 표시는 여기 한 곳이다 — 검증과 화면의 `*` 가 이 값을 읽는다. */
  required: boolean;
  /** 칸 아래 안내. */
  hint?: string;
}

/**
 * 설립 건의 회사 · 자본 · 설립 정보 칸. 순서가 화면 순서다.
 * ★ 상호 · 본점은 설립 건에 둔다(결정 7). 입주 예정사의 본점은 ERP 계약 호실 주소가 기본값이다(화면 · API 몫).
 */
export const INCORP_FIELD_DEFS: readonly IncorpFieldDef[] = [
  { name: 'nameKo', label: '상호(국문)', type: 'text', required: true, hint: '「주식회사」를 빼고 적습니다' },
  { name: 'nameEn', label: '상호(영문)', type: 'text', required: false, hint: '비우면 정관에 영문 상호 문장이 빠집니다' },
  { name: 'hq', label: '본점', type: 'address', required: true },
  { name: 'capitalAmount', label: '자본금', type: 'amount', required: true },
  { name: 'parValue', label: '1주의 금액', type: 'amount', required: true },
  { name: 'unitsAuthorized', label: '발행할 주식의 총수', type: 'count', required: true },
  { name: 'unitsIssued', label: '설립 때 발행하는 주식의 총수', type: 'count', required: true },
  { name: 'publicNoticeMethod', label: '공고방법', type: 'text', required: false, hint: '비우면 「회사의 인터넷 홈페이지」' },
  { name: 'fiscalStart', label: '사업연도 시작', type: 'monthDay', required: true, hint: 'MM-DD (예: 01-01)' },
  { name: 'fiscalEnd', label: '사업연도 끝', type: 'monthDay', required: true, hint: 'MM-DD (예: 12-31)' },
  { name: 'plannedDate', label: '설립예정일', type: 'date', required: true },
  {
    name: 'purposes',
    label: '사업목적',
    type: 'textarea',
    required: true,
    hint: `한 줄에 하나씩 적습니다(최대 ${INCORP_PURPOSE_MAX}줄). 「위 각 호에 부대되는 일체의 사업」은 서류가 붙입니다`,
  },
];

/** 회사 · 자본 · 설립 정보 — 검증에 넘기는 모양(이번에 **저장될** 값). 숫자 칸은 숫자 또는 null. */
export interface IncorporationInfo {
  nameKo?: string | null;
  nameEn?: string | null;
  hq?: CorpChangeAddress | null;
  capitalAmount?: number | null;
  parValue?: number | null;
  unitsAuthorized?: number | null;
  unitsIssued?: number | null;
  publicNoticeMethod?: string | null;
  fiscalStart?: string | null;
  fiscalEnd?: string | null;
  plannedDate?: string | null;
  purposes?: string | null;
}

/**
 * 사람 한 명 — 발기인 · 이사 · 감사 · 대표이사(겹쳐 체크 가능).
 * ★ `rrn` 은 평문이 손에 있을 때만(새로 입력했을 때) 넘긴다 — 법인변경 임원과 같다.
 */
export interface IncorporationPersonInput {
  name?: string | null;
  isFounder?: boolean;
  isDirector?: boolean;
  isAuditor?: boolean;
  isRepresentative?: boolean;
  /** 인수 주식 수 — 0 이상 정수. 발기인의 합이 설립 때 발행 수와 같아야 한다. */
  unitsSubscribed?: number | null;
  /** 취임일 `YYYY-MM-DD`. 선택. */
  appointmentDate?: string | null;
  rrn?: string | null;
}

export interface IncorporationContent {
  info: IncorporationInfo;
  persons: readonly IncorporationPersonInput[];
}

// =============================================================================
// 검증 — 서류작성완료(P→E) 때
// =============================================================================

const isBlank = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= INCORP_INT_MAX;

/** `MM-DD` — 있는 날짜인가(2월 29일은 받는다). */
export function isMonthDay(raw: string): boolean {
  const m = /^(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return false;
  const mm = Number(m[1]);
  const dd = Number(m[2]);
  if (mm < 1 || mm > 12 || dd < 1) return false;
  return dd <= new Date(Date.UTC(2000, mm, 0)).getUTCDate(); // 2000 은 윤년
}

function checkInfoField(def: IncorpFieldDef, value: unknown): CorpChangeFieldError[] {
  const { name, label, type, required } = def;
  const blank =
    type === 'address'
      ? value === null || value === undefined || (typeof value === 'object' && isBlank((value as CorpChangeAddress).zipCode) && isBlank((value as CorpChangeAddress).address))
      : isBlank(value);
  if (blank) return required ? [{ field: name, message: `${label}을(를) 입력하세요` }] : [];

  switch (type) {
    case 'text':
    case 'textarea':
      return typeof value === 'string' ? [] : [{ field: name, message: `${label}은(는) 글자로 입력하세요` }];
    case 'amount':
    case 'count':
      return isCount(value) && value > 0 ? [] : [{ field: name, message: `${label}은(는) 1 이상 ${INCORP_INT_MAX.toLocaleString('ko-KR')} 이하의 정수로 입력하세요` }];
    case 'monthDay':
      return typeof value === 'string' && isMonthDay(value) ? [] : [{ field: name, message: `${label}은(는) MM-DD(예: 01-01)로 입력하세요` }];
    case 'date':
      return typeof value === 'string' && parseDay(value) !== null ? [] : [{ field: name, message: `${label}은(는) 날짜(YYYY-MM-DD)로 입력하세요` }];
    case 'address': {
      const a = value as CorpChangeAddress;
      const errors: CorpChangeFieldError[] = [];
      if (isBlank(a.zipCode)) errors.push({ field: `${name}.zipCode`, message: `${label}의 우편번호를 입력하세요` });
      if (isBlank(a.address)) errors.push({ field: `${name}.address`, message: `${label}의 기본주소를 입력하세요` });
      return errors;
    }
  }
}

/** 사람 한 명 검증. `index` 는 오류 자리(`persons.{index}.name`)에 들어간다. */
export function validateIncorporationPerson(p: IncorporationPersonInput, index: number): CorpChangeFieldError[] {
  const at = (key: string) => `persons.${index}.${key}`;
  const errors: CorpChangeFieldError[] = [];
  if (isBlank(p.name)) errors.push({ field: at('name'), message: '성명을 입력하세요' });
  if (!p.isFounder && !p.isDirector && !p.isAuditor && !p.isRepresentative) {
    errors.push({ field: at('roles'), message: '발기인 · 이사 · 감사 · 대표이사 중 하나 이상 체크하세요' });
  }
  if (p.unitsSubscribed !== null && p.unitsSubscribed !== undefined && !isCount(p.unitsSubscribed)) {
    errors.push({ field: at('unitsSubscribed'), message: '인수 주식 수는 0 이상의 정수로 입력하세요' });
  }
  if (!isBlank(p.appointmentDate) && (typeof p.appointmentDate !== 'string' || parseDay(p.appointmentDate) === null)) {
    errors.push({ field: at('appointmentDate'), message: '취임일은 날짜(YYYY-MM-DD)로 입력하세요' });
  }
  const rrn = validateRrn(p.rrn, at('rrn'));
  if (rrn) errors.push(rrn);
  return errors;
}

/**
 * 서류작성완료(P→E) 검증. 오류가 없으면 빈 배열.
 * 칸 → 사람 → 서로 맞물리는 값(자본금 · 주식 수 · 인수수량 합 · 한도) 순으로 본다.
 */
export function validateIncorporation(content: IncorporationContent): CorpChangeFieldError[] {
  const { info, persons } = content;
  const errors = INCORP_FIELD_DEFS.flatMap((d) => checkInfoField(d, info[d.name]));

  // 사업목적 — 한 줄 이상 · 최대 20줄(정관 고정 배치)
  if (typeof info.purposes === 'string' && !isBlank(info.purposes)) {
    const n = purposeLines(info.purposes).length;
    if (n > INCORP_PURPOSE_MAX) {
      errors.push({ field: 'purposes', message: `사업목적은 ${INCORP_PURPOSE_MAX}줄까지입니다(지금 ${n}줄) — 정관에 들어가는 줄 수입니다` });
    }
  }

  // 사람
  persons.forEach((p, i) => errors.push(...validateIncorporationPerson(p, i)));
  const founders = persons.filter((p) => p.isFounder);
  if (founders.length === 0) errors.push({ field: 'persons', message: '발기인을 1명 이상 등록하세요' });
  if (founders.length > INCORP_FOUNDER_MAX) {
    errors.push({ field: 'persons', message: `발기인은 ${INCORP_FOUNDER_MAX}명까지입니다(지금 ${founders.length}명) — 정관에 들어가는 사람 수입니다` });
  }
  if (!persons.some((p) => p.isRepresentative)) errors.push({ field: 'persons', message: '대표이사를 1명 이상 등록하세요' });

  // 서로 맞물리는 값 — 각 칸이 제대로 들어왔을 때만 센다(칸 오류와 겹쳐 말하지 않는다)
  const { capitalAmount, parValue, unitsAuthorized, unitsIssued } = info;
  if (isCount(capitalAmount) && isCount(parValue) && isCount(unitsIssued) && capitalAmount !== parValue * unitsIssued) {
    errors.push({ field: 'capitalAmount', message: '자본금은 1주의 금액 × 설립 때 발행하는 주식의 총수와 같아야 합니다' });
  }
  if (isCount(unitsAuthorized) && isCount(unitsIssued) && unitsIssued > unitsAuthorized) {
    errors.push({ field: 'unitsIssued', message: '설립 때 발행하는 주식은 발행할 주식의 총수를 넘을 수 없습니다' });
  }
  if (isCount(unitsIssued) && founders.length > 0 && founders.every((p) => isCount(p.unitsSubscribed ?? 0))) {
    const sum = founders.reduce((s, p) => s + (p.unitsSubscribed ?? 0), 0);
    if (sum !== unitsIssued) {
      errors.push({ field: 'persons', message: `발기인의 인수 주식 수 합(${sum.toLocaleString('ko-KR')})이 설립 때 발행하는 주식의 총수(${unitsIssued.toLocaleString('ko-KR')})와 같아야 합니다` });
    }
  }
  return errors;
}

/**
 * 경고 — **막지 않는다.** 레거시의 두 가지를 그대로 옮겼다.
 *   · 1주의 금액이 100원 미만
 *   · 자본금이 10억 원 이상인데 감사가 없다
 */
export function incorporationWarnings(content: IncorporationContent): string[] {
  const { info, persons } = content;
  const out: string[] = [];
  if (isCount(info.parValue) && info.parValue > 0 && info.parValue < 100) out.push('1주의 금액이 100원 미만입니다');
  if (isCount(info.capitalAmount) && info.capitalAmount >= 1_000_000_000 && !persons.some((p) => p.isAuditor)) {
    out.push('자본금이 10억 원 이상인데 감사가 없습니다');
  }
  return out;
}

// =============================================================================
// 상태 전이 — 법인변경과 같은 규칙(머리말 ★★)
// =============================================================================

/** 설립 건의 상태 전이 판정 — P→E 때 `content`(저장될 값)로 검증한다. */
export function checkIncorporationTransition(req: {
  from: string;
  to: string;
  role: ScopeRole;
  statusBeforeCancel?: string | null;
  content?: IncorporationContent;
}): TransitionCheck {
  const { content, ...rest } = req;
  return checkLegalTransition({ ...rest, validate: content ? () => validateIncorporation(content) : undefined });
}
