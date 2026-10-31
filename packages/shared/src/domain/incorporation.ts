/**
 * 법인설립(s040100010 · s040100020) — 입력 칸 · 검증 · 상태 전이. 순수 함수(10-1, 2026-10-11).
 *
 * 레거시 `S-WonERP/src/lib/incorp-validate.ts` · `incorp-transitions.ts` · `incorp-targets.ts` 를 바탕으로
 * 결정(2026-10-11)에 맞춰 다시 짰다.
 *
 * =============================================================================
 * ★★ 범위 (결정 2026-10-11)
 * =============================================================================
 *   · **주식회사 · 발기설립**(`R_PROMOTER`) — 모집설립은 나중
 *   · **유한회사 설립**(`U_P`, 결정 2026-10-31) — 자본금 10억 미만 · 사원 1~2명. 칸은 새로 만들지 않고 기존 칸의
 *     이름표만 바꿔 쓴다: 발기인 → 사원 · 인수 주식 수 → 출자좌수 · 1주의 금액 → 1좌의 금액(`incorpTermsOf` ·
 *     `incorpFieldDefsOf`). 수권 · 발행 주식 수 · 공고방법 칸은 유한회사에 없어 보이지 않는다(정관 36조에 자리가 없다)
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

/**
 * 회사 형태 — 공통코드 `MEMBER_TYPE` 파티션 `001`(법인설립용) 중 앱이 다루는 둘(결정 2026-10-31).
 * 이름은 코드표에서 읽는다. ★ 앱이 박아 둔 코드값이라 `code-usage.ts` 의 `PINNED_CODES` 에 올라 있다.
 */
export const INCORP_ENTITY_TYPES = ['R', 'A'] as const;
export type IncorpEntityType = (typeof INCORP_ENTITY_TYPES)[number];
export const INCORP_ENTITY_CATEGORY = 'MEMBER_TYPE';
export const INCORP_ENTITY_USE_TP = '001';
/** 회사 형태 기본값 — 주식회사(R). 형태를 보내지 않은 첫 저장 · 형태가 없던 스냅샷도 R 이다. */
export const INCORP_ENTITY_TYPE: IncorpEntityType = 'R';
/** 유한회사(A). */
export const INCORP_LTD_ENTITY_TYPE: IncorpEntityType = 'A';

export function isIncorpEntityType(v: unknown): v is IncorpEntityType {
  return typeof v === 'string' && (INCORP_ENTITY_TYPES as readonly string[]).includes(v);
}

/** 설립 구분 — 공통코드 `LAW_EST_TP` 의 「주식회사 발기설립」. 등기 설정(`tb_s080_doc_form_settings`)의 줄 키이기도 하다. */
export const INCORP_METHOD = 'R_PROMOTER';
/** 설립 구분 — 「유한회사 발기설립」(`LAW_EST_TP` U_P, 결정 2026-10-31). */
export const INCORP_LTD_METHOD = 'U_P';
export const INCORP_METHOD_CATEGORY = 'LAW_EST_TP';
export const INCORP_METHOD_USE_TP = '000';

/** 회사 형태 → 설립 구분 코드(등기 설정의 줄 키 · 등기의 목적 이름). */
export function incorpMethodOf(entity: IncorpEntityType): string {
  return entity === INCORP_LTD_ENTITY_TYPE ? INCORP_LTD_METHOD : INCORP_METHOD;
}

/** 정관 고정 배치의 한도(결정 3). */
export const INCORP_PURPOSE_MAX = 20;
export const INCORP_FOUNDER_MAX = 5;
/** 유한회사 사원 한도 — 대상이 사원 1~2명이다(결정 2026-10-31). 정관(유한회사)의 표 · 서명란도 2명으로 높이를 잡았다. */
export const INCORP_LTD_MEMBER_MAX = 2;
/** 유한회사 정관은 자본금 10억 원 미만(공증 면제) 기준이다(결정 2026-10-31) — 넘으면 경고만. */
export const INCORP_LTD_CAPITAL_LIMIT = 1_000_000_000;

/**
 * 금액 · 주식 수의 상한. DB 칸은 bigint 다(042, 결정 2026-10-11) — 앱은 JS 가 정확히 셀 수 있는
 * 정수까지만 받는다(그 위는 bigint 라도 숫자로 오가며 값이 바뀐다).
 */
export const INCORP_INT_MAX = Number.MAX_SAFE_INTEGER;

// =============================================================================
// 입력 칸
// =============================================================================

export type IncorpFieldType = 'text' | 'textarea' | 'address' | 'amount' | 'count' | 'monthDay' | 'date' | 'time' | 'check';

/** 개회시간 기본값 — 새 건의 화면이 채워 둔다(2026-10-14). 비우면 서류 시각은 빈칸이다. */
export const DEFAULT_MEETING_TIME = '10:00';
/** 폐회시간 = 개회시간 + 이 분(2026-10-14). */
export const CLOSING_AFTER_MINUTES = 30;

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
    name: 'meetingTime',
    label: '개회시간',
    type: 'time',
    required: false,
    hint: `발기인총회 의사록의 시각입니다. 폐회시간은 ${CLOSING_AFTER_MINUTES}분 뒤로 찍힙니다`,
  },
  { name: 'paymentBank', label: '납입은행(지점)', type: 'text', required: false, hint: '조사보고서 · 주식인수증의 납입기관입니다' },
  { name: 'ceoPhone', label: '대표이사 전화', type: 'text', required: false, hint: '설립등기신청서 서명란의 전화입니다' },
  {
    name: 'metroSurcharge',
    label: '대도시 중과',
    type: 'check',
    required: false,
    hint: '등록면허세를 3배로 계산합니다. 본점이 서울이면 기본으로 체크됩니다',
  },
  {
    name: 'purposes',
    label: '사업목적',
    type: 'textarea',
    required: true,
    hint: `설립 때 목적 전체를 한 줄에 하나씩 적습니다(최대 ${INCORP_PURPOSE_MAX}줄). 「위 각 호에 부대되는 일체의 사업」은 서류가 붙입니다`,
  },
];

// =============================================================================
// 회사 형태별 이름표 — 칸은 같고 이름만 바뀐다(결정 2026-10-31)
// =============================================================================

export interface IncorpTerms {
  /** 발기인 · 사원 — 사람의 역할 이름. */
  founder: string;
  /** 인수 주식 수 · 출자좌수 — 사람의 수 칸. */
  units: string;
  /** 주 · 좌 — 수 뒤에 붙는 말. */
  unitWord: string;
  /** 자본·주식 · 자본·출자 — 화면 묶음 이름. */
  capitalSection: string;
}

const STOCK_TERMS: IncorpTerms = { founder: '발기인', units: '인수 주식 수', unitWord: '주', capitalSection: '자본·주식' };
const LTD_TERMS: IncorpTerms = { founder: '사원', units: '출자좌수', unitWord: '좌', capitalSection: '자본·출자' };

export function incorpTermsOf(entity: IncorpEntityType = INCORP_ENTITY_TYPE): IncorpTerms {
  return entity === INCORP_LTD_ENTITY_TYPE ? LTD_TERMS : STOCK_TERMS;
}

/** 유한회사에 없는 칸 — 수권 · 발행 주식 수 · 공고방법(정관 36조에 자리가 없다, 결정 2026-10-31). */
const LTD_HIDDEN: ReadonlySet<string> = new Set(['unitsAuthorized', 'unitsIssued', 'publicNoticeMethod']);

const LTD_FIELD_DEFS: readonly IncorpFieldDef[] = INCORP_FIELD_DEFS.filter((d) => !LTD_HIDDEN.has(d.name)).map((d) =>
  d.name === 'nameKo'
    ? { ...d, hint: '입력한 그대로 서류에 씁니다 — 「유한회사」를 넣어 적습니다' }
    : d.name === 'parValue'
      ? { ...d, label: '1좌의 금액' }
      : d,
);

/**
 * 회사 형태의 칸 — 주식회사는 `INCORP_FIELD_DEFS` 그대로(같은 배열), 유한회사는 없는 칸을 빼고 이름표를 바꾼 것.
 * ★ 저장 모양(`parseIncorpInfo`)은 형태와 상관없이 `INCORP_FIELD_DEFS` 전체다 — 안 보이는 칸은 null 로 오간다.
 */
export function incorpFieldDefsOf(entity: IncorpEntityType = INCORP_ENTITY_TYPE): readonly IncorpFieldDef[] {
  return entity === INCORP_LTD_ENTITY_TYPE ? LTD_FIELD_DEFS : INCORP_FIELD_DEFS;
}

/** 유한회사 상호에 「유한회사」가 없을 때의 안내 — 막지 않는다(결정 2026-10-31). 있거나 비면 null. */
export function ltdNameNotice(nameKo: string | null | undefined): string | null {
  const name = (nameKo ?? '').trim();
  return name !== '' && !name.includes('유한회사') ? '상호에 「유한회사」가 없습니다 — 입력한 그대로 서류에 쓰입니다' : null;
}

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
  /** 개회시간 `HH:MM`. 선택. */
  meetingTime?: string | null;
  /** 납입은행(지점). 선택. */
  paymentBank?: string | null;
  /** 대표이사 전화 — 설립등기신청서 서명란. 선택. */
  ceoPhone?: string | null;
  /**
   * 대도시 중과 — 사람이 고친 값. null 이면 본점 시·도로 정한다(서울이면 중과, `metroSurchargeOf`).
   */
  metroSurcharge?: boolean | null;
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

/** `HH:MM`(00:00 ~ 23:59)인가. */
export function isTimeOfDay(raw: string): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(raw.trim());
  return m !== null && Number(m[1]) <= 23 && Number(m[2]) <= 59;
}

/** 폐회시간 — 개회시간 + 30분(자정을 넘으면 다음 날 시각). 개회시간이 비었거나 시각이 아니면 null. */
export function closingTimeOf(meetingTime: string | null | undefined): string | null {
  if (!meetingTime || !isTimeOfDay(meetingTime)) return null;
  const [h, m] = meetingTime.trim().split(':').map(Number) as [number, number];
  const total = (h * 60 + m + CLOSING_AFTER_MINUTES) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
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
      return isCount(value) && value > 0 ? [] : [{ field: name, message: `${label}은(는) 1 이상의 정수로 입력하세요` }];
    case 'monthDay':
      return typeof value === 'string' && isMonthDay(value) ? [] : [{ field: name, message: `${label}은(는) MM-DD(예: 01-01)로 입력하세요` }];
    case 'date':
      return typeof value === 'string' && parseDay(value) !== null ? [] : [{ field: name, message: `${label}은(는) 날짜(YYYY-MM-DD)로 입력하세요` }];
    case 'check':
      return typeof value === 'boolean' ? [] : [{ field: name, message: `${label}은(는) 체크로 고르세요` }];
    case 'time':
      return typeof value === 'string' && isTimeOfDay(value) ? [] : [{ field: name, message: `${label}은(는) 시각(HH:MM)으로 입력하세요` }];
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
export function validateIncorporationPerson(
  p: IncorporationPersonInput,
  index: number,
  entity: IncorpEntityType = INCORP_ENTITY_TYPE,
): CorpChangeFieldError[] {
  const t = incorpTermsOf(entity);
  const at = (key: string) => `persons.${index}.${key}`;
  const errors: CorpChangeFieldError[] = [];
  if (isBlank(p.name)) errors.push({ field: at('name'), message: '성명을 입력하세요' });
  if (!p.isFounder && !p.isDirector && !p.isAuditor && !p.isRepresentative) {
    errors.push({ field: at('roles'), message: `${t.founder} · 이사 · 감사 · 대표이사 중 하나 이상 체크하세요` });
  }
  if (p.unitsSubscribed !== null && p.unitsSubscribed !== undefined && !isCount(p.unitsSubscribed)) {
    errors.push({ field: at('unitsSubscribed'), message: `${t.units}는 0 이상의 정수로 입력하세요` });
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
 * 유한회사(`entity` A)는 `validateLtdIncorporation` — 칸 · 이름표 · 한도 · 자본금 맞추기가 다르다.
 */
export function validateIncorporation(content: IncorporationContent, entity: IncorpEntityType = INCORP_ENTITY_TYPE): CorpChangeFieldError[] {
  if (entity === INCORP_LTD_ENTITY_TYPE) return validateLtdIncorporation(content);
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

/** 사원 출자좌수 합(사원 = `isFounder`). 수가 아닌 값은 0 으로 센다. */
const memberUnits = (persons: readonly IncorporationPersonInput[]) =>
  persons.filter((p) => p.isFounder).reduce((s, p) => s + (isCount(p.unitsSubscribed) ? p.unitsSubscribed : 0), 0);

/**
 * 유한회사 작성완료 검증(결정 2026-10-31) — 주식회사와 다른 곳:
 *   · 칸은 `incorpFieldDefsOf('A')`(수권 · 발행 주식 수 · 공고방법 없음)
 *   · 사원 1명 이상 · 2명까지(대상 1~2명 · 정관 표 높이)
 *   · 자본금 = 1좌의 금액 × 사원 출자좌수 합(정관 제4조 · 제5조 · 제6조가 맞물린다)
 */
function validateLtdIncorporation(content: IncorporationContent): CorpChangeFieldError[] {
  const { info, persons } = content;
  const errors = LTD_FIELD_DEFS.flatMap((d) => checkInfoField(d, info[d.name]));

  if (typeof info.purposes === 'string' && !isBlank(info.purposes)) {
    const n = purposeLines(info.purposes).length;
    if (n > INCORP_PURPOSE_MAX) {
      errors.push({ field: 'purposes', message: `사업목적은 ${INCORP_PURPOSE_MAX}줄까지입니다(지금 ${n}줄) — 정관에 들어가는 줄 수입니다` });
    }
  }

  persons.forEach((p, i) => errors.push(...validateIncorporationPerson(p, i, INCORP_LTD_ENTITY_TYPE)));
  const members = persons.filter((p) => p.isFounder);
  if (members.length === 0) errors.push({ field: 'persons', message: '사원을 1명 이상 등록하세요' });
  if (members.length > INCORP_LTD_MEMBER_MAX) {
    errors.push({ field: 'persons', message: `사원은 ${INCORP_LTD_MEMBER_MAX}명까지입니다(지금 ${members.length}명) — 유한회사 설립은 사원 1~2명이 대상입니다` });
  }
  if (!persons.some((p) => p.isRepresentative)) errors.push({ field: 'persons', message: '대표이사를 1명 이상 등록하세요' });

  const { capitalAmount, parValue } = info;
  if (isCount(capitalAmount) && isCount(parValue) && members.length > 0 && members.every((p) => isCount(p.unitsSubscribed ?? 0))) {
    const units = memberUnits(persons);
    if (capitalAmount !== parValue * units) {
      errors.push({ field: 'capitalAmount', message: ltdCapitalMismatch(capitalAmount, parValue, units) });
    }
  }
  return errors;
}

const won = (n: number) => n.toLocaleString('ko-KR');
const ltdCapitalMismatch = (capital: number, par: number, units: number) =>
  `자본금(${won(capital)}원)이 1좌의 금액 × 사원 출자좌수 합(${won(par)}원 × ${won(units)}좌 = ${won(par * units)}원)과 다릅니다`;

/**
 * 경고 — **막지 않는다.** 레거시의 두 가지를 그대로 옮겼다.
 *   · 1주의 금액이 100원 미만
 *   · 자본금이 10억 원 이상인데 감사가 없다
 * 유한회사(A, 결정 2026-10-31) — 저장할 때 알린다:
 *   · 1좌의 금액이 100원 미만(상법 제546조)
 *   · 자본금 ≠ 1좌의 금액 × 사원 출자좌수 합(작성완료 때는 거절)
 *   · 자본금 10억 원 이상(정관이 공증 면제 기준). 감사 경고는 없다(감사는 기본 없음)
 */
export function incorporationWarnings(content: IncorporationContent, entity: IncorpEntityType = INCORP_ENTITY_TYPE): string[] {
  const { info, persons } = content;
  if (entity === INCORP_LTD_ENTITY_TYPE) {
    const out: string[] = [];
    if (isCount(info.parValue) && info.parValue > 0 && info.parValue < 100) out.push('1좌의 금액이 100원 미만입니다');
    if (isCount(info.capitalAmount) && isCount(info.parValue) && persons.some((p) => p.isFounder)) {
      const units = memberUnits(persons);
      if (info.capitalAmount !== info.parValue * units) out.push(ltdCapitalMismatch(info.capitalAmount, info.parValue, units));
    }
    if (isCount(info.capitalAmount) && info.capitalAmount >= INCORP_LTD_CAPITAL_LIMIT) {
      out.push('자본금이 10억 원 이상입니다 — 유한회사 정관은 10억 원 미만(공증 면제) 기준입니다');
    }
    return out;
  }
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
  /** 회사 형태 — 없으면 주식회사. */
  entityType?: IncorpEntityType;
}): TransitionCheck {
  const { content, entityType, ...rest } = req;
  return checkLegalTransition({ ...rest, validate: content ? () => validateIncorporation(content, entityType) : undefined });
}
