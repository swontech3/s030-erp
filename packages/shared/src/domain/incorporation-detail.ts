/**
 * 법인설립 상세(s040100020) — 첫 저장 · 설립 정보 · 사람의 **입력 읽기** · 응답 모양 · 상호 합치기. 순수 함수
 * (10-3, 2026-10-11).
 *
 * 법인변경(`corp-change-detail.ts`)과 같은 규칙이다:
 *   · 건은 상세의 첫 [저장] 때 생긴다 — 건 + 설립 정보 + 사람 전부를 한 요청 · 한 트랜잭션으로(`parseIncorpFirstSave`)
 *   · 저장할 때 내용 검증은 하지 않는다(작성 중 임시 저장) — 필수 · 정합 검사는 P→E 때 `validateIncorporation`
 *   · 거절하는 것은 **모양이 틀린 것**뿐이다 — 글자 자리에 숫자, 숫자 자리에 글자, 정의에 없는 키
 *   · 예외: 주민번호 형식(암호화하면 아무도 모른다) · 날짜 칸(DB 칸이 timestamp 다 — 설립예정일 · 취임일)
 *   · 거절은 칸별 오류(`errors[]`)로, 틀린 칸을 다 모은다
 *
 * ★ 회사 세션은 자기 단체로만(`parseOrgTarget` — 남의 단체는 403).
 * ★ 상호는 「순수 상호 + 회사유형 + 위치(앞 F / 뒤 B)」를 합친다(결정 2026-10-11, `composeIncorporationName`).
 *   위치 선택지는 코드표 `NAME_POSITION`, 기본값은 앞(F).
 */
import type { ScopeRole } from '../session.ts';
import { parseDay } from './day.ts';
import { validateRrn, type CorpChangeFieldError, type CorpChangeStatus } from './corp-change.ts';
import { maskRrn, normalizeRrn, parseOrgTarget, type OrgTarget, type Parsed } from './corp-change-detail.ts';
import type { CodeOption } from './corp-change-list.ts';
import { INCORP_FIELD_DEFS, INCORP_INT_MAX, type IncorporationInfo } from './incorporation.ts';

export { maskRrn };

/** 상호 표기위치 — 공통코드 `NAME_POSITION`/000(F 앞 · B 뒤, 014). */
export const NAME_POSITION_CATEGORY = 'NAME_POSITION';
export const NAME_POSITION_USE_TP = '000';
/** 위치 기본값 — 앞(결정 2026-10-11). */
export const DEFAULT_NAME_POSITION = 'F';
/** 회사유형 이름 — 주식회사만이라 고정이다(코드표 `MEMBER_TYPE` R 의 이름과 같다). */
export const INCORP_ENTITY_NAME = '주식회사';

type Bad = { ok: false; status: 400; message: string; errors: CorpChangeFieldError[] };
const badAt = (errors: CorpChangeFieldError[]): Bad => ({
  ok: false,
  status: 400,
  message: errors[0]?.message ?? '요청 형식이 올바르지 않습니다',
  errors,
});
const bad = (field: string, message: string): Bad => badAt([{ field, message }]);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 글자 칸 — 없거나 비면 null, 글자가 아니면 undefined(= 모양이 틀림). */
function textOrNull(v: unknown): string | null | undefined {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t === '' ? null : t;
}

/** 숫자 칸 — 없거나 비면 null, 0 이상 정수가 아니면 undefined. 화면은 숫자로 보낸다. */
function countOrNull(v: unknown): number | null | undefined {
  if (v === undefined || v === null || v === '') return null;
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= INCORP_INT_MAX ? v : undefined;
}

// =============================================================================
// 상호
// =============================================================================

/**
 * 서류의 상호 — 순수 상호 + 「주식회사」를 위치대로. F 「주식회사 한가람」 · B 「한가람 주식회사」.
 * 위치가 F · B 가 아니면 기본값(F). 순수 상호가 비면 빈 글자(서류는 빈칸).
 */
export function composeIncorporationName(nameKo: string | null | undefined, position: string | null | undefined): string {
  const name = (nameKo ?? '').trim();
  if (name === '') return '';
  const pos = position === 'B' || position === 'F' ? position : DEFAULT_NAME_POSITION;
  return pos === 'F' ? `${INCORP_ENTITY_NAME} ${name}` : `${name} ${INCORP_ENTITY_NAME}`;
}

// =============================================================================
// 단체 · 설립 정보 · 사람
// =============================================================================

/** 단체 고르기 — 법인변경과 같다. 남의 단체 문구만 설립 말로 바꾼다. */
export function parseIncorpOrgTarget(
  rawOrgId: unknown,
  rawOrgCode: unknown,
  session: { role: ScopeRole; s020OrgId: number },
): Parsed<OrgTarget> {
  const r = parseOrgTarget(rawOrgId, rawOrgCode, session);
  return !r.ok && r.status === 403 ? { ...r, message: '자기 회사의 법인설립만 다룰 수 있습니다' } : r;
}

/** 저장되는 설립 정보 — 정의 칸 + 위치. 빈 칸은 null. */
export type IncorpInfoFields = { [K in keyof IncorporationInfo]-?: Exclude<IncorporationInfo[K], undefined> };
export interface IncorpInfoInput extends IncorpInfoFields {
  /** 상호 표기위치 F · B. 코드표에 있는지는 서버가 본다. */
  companyTypePosition: string | null;
}

const ADDRESS_KEYS = ['zipCode', 'address', 'addressDetail'] as const;

/**
 * 설립 정보 `{ nameKo, …, companyTypePosition }` — **통째로 바꾼다**(화면은 칸 전체를 보낸다).
 * 정의(`INCORP_FIELD_DEFS`)에 없는 키는 거절한다.
 */
export function parseIncorpInfo(raw: unknown, at = 'info'): Parsed<IncorpInfoInput> {
  if (!isObj(raw)) return bad(at, '설립 정보 형식이 올바르지 않습니다');
  const known = new Set<string>([...INCORP_FIELD_DEFS.map((d) => d.name), 'companyTypePosition']);
  const errors: CorpChangeFieldError[] = Object.keys(raw)
    .filter((k) => !known.has(k))
    .map((k) => ({ field: k, message: `설립 정보에 없는 칸입니다: ${k}` }));

  const out: Record<string, unknown> = {};
  for (const def of INCORP_FIELD_DEFS) {
    const v = raw[def.name];
    switch (def.type) {
      case 'address': {
        if (v === undefined || v === null) {
          out[def.name] = null;
          break;
        }
        const notAddress = { field: def.name, message: `${def.label}이(가) 주소 형식이 아닙니다` };
        if (!isObj(v) || Object.keys(v).some((k) => !(ADDRESS_KEYS as readonly string[]).includes(k))) {
          errors.push(notAddress);
          break;
        }
        const addr: Record<string, string | null> = {};
        let broken = false;
        for (const key of ADDRESS_KEYS) {
          const t = textOrNull(v[key]);
          if (t === undefined) broken = true;
          else addr[key] = t;
        }
        if (broken) errors.push(notAddress);
        else out[def.name] = ADDRESS_KEYS.every((k) => addr[k] === null) ? null : addr;
        break;
      }
      case 'amount':
      case 'count': {
        const n = countOrNull(v);
        if (n === undefined) errors.push({ field: def.name, message: `${def.label}은(는) 0 이상의 정수로 입력하세요` });
        else out[def.name] = n;
        break;
      }
      case 'date': {
        const t = textOrNull(v);
        // ★ DB 칸이 timestamp 다 — 날짜가 아니면 넣을 수 없으니 저장 때 거절한다(머리말 예외)
        if (t === undefined || (t !== null && parseDay(t) === null)) {
          errors.push({ field: def.name, message: `${def.label}은(는) 날짜(YYYY-MM-DD)로 입력하세요` });
        } else out[def.name] = t;
        break;
      }
      default: {
        // text · textarea · monthDay — 글자. 사업목적은 줄바꿈을 지킨다(앞뒤 공백만 뗀다)
        const t = textOrNull(v);
        if (t === undefined) errors.push({ field: def.name, message: `${def.label}은(는) 글자로 입력하세요` });
        else out[def.name] = t;
      }
    }
  }
  const pos = textOrNull(raw.companyTypePosition);
  if (pos === undefined) errors.push({ field: 'companyTypePosition', message: '상호 표기위치가 올바르지 않습니다' });
  else out.companyTypePosition = pos;

  return errors.length > 0 ? badAt(errors) : { ok: true, value: out as unknown as IncorpInfoInput };
}

export interface IncorpPersonInput {
  /** 성명 — 임시 저장이라 빈 글자도 받는다(DB 칸이 NOT NULL 이라 null 대신 ''). */
  name: string;
  isFounder: boolean;
  isDirector: boolean;
  isAuditor: boolean;
  isRepresentative: boolean;
  unitsSubscribed: number;
  /** `YYYY-MM-DD` 또는 null. */
  appointmentDate: string | null;
  zipCode: string | null;
  address: string | null;
  addressDetail: string | null;
  /** 주민번호 숫자 13자리. `undefined` = 안 바꾼다(수정) · 없음(새로) — 법인변경 임원과 같다. */
  rrn: string | undefined;
}

/** 사람 본문. @param at 오류 자리 앞머리 — 첫 저장의 목록이면 `persons.{i}`. */
export function parseIncorpPersonBody(raw: unknown, at?: string): Parsed<IncorpPersonInput> {
  const fieldOf = (key: string) => (at ? `${at}.${key}` : key);
  if (!isObj(raw)) return bad(at ?? 'body', '사람 정보 형식이 올바르지 않습니다');
  const errors: CorpChangeFieldError[] = [];

  const text = (key: string, label: string): string | null => {
    const t = textOrNull(raw[key]);
    if (t === undefined) {
      errors.push({ field: fieldOf(key), message: `${label}은(는) 글자로 입력하세요` });
      return null;
    }
    return t;
  };
  const flag = (key: string, label: string): boolean => {
    const v = raw[key];
    if (v === undefined || v === null) return false;
    if (typeof v !== 'boolean') {
      errors.push({ field: fieldOf(key), message: `${label} 체크가 올바르지 않습니다` });
      return false;
    }
    return v;
  };

  const name = text('name', '성명');
  const zipCode = text('zipCode', '우편번호');
  const address = text('address', '주소');
  const addressDetail = text('addressDetail', '상세주소');
  const isFounder = flag('isFounder', '발기인');
  const isDirector = flag('isDirector', '이사');
  const isAuditor = flag('isAuditor', '감사');
  const isRepresentative = flag('isRepresentative', '대표이사');

  const units = countOrNull(raw.unitsSubscribed);
  if (units === undefined) errors.push({ field: fieldOf('unitsSubscribed'), message: '인수 주식 수는 0 이상의 정수로 입력하세요' });

  const appointmentDate = textOrNull(raw.appointmentDate);
  if (appointmentDate === undefined || (appointmentDate !== null && parseDay(appointmentDate) === null)) {
    errors.push({ field: fieldOf('appointmentDate'), message: '취임일은 날짜(YYYY-MM-DD)로 입력하세요' });
  }

  let rrn: string | undefined;
  const rawRrn = textOrNull(raw.rrn);
  if (rawRrn === undefined) errors.push({ field: fieldOf('rrn'), message: '주민등록번호는 숫자 13자리로 입력하세요' });
  else if (rawRrn !== null) {
    const err = validateRrn(rawRrn, fieldOf('rrn'));
    if (err) errors.push(err);
    else rrn = normalizeRrn(rawRrn) ?? undefined;
  }

  if (errors.length > 0) return badAt(errors);
  return {
    ok: true,
    value: {
      name: name ?? '',
      isFounder,
      isDirector,
      isAuditor,
      isRepresentative,
      unitsSubscribed: units ?? 0,
      appointmentDate: appointmentDate ?? null,
      zipCode,
      address,
      addressDetail,
      rrn,
    },
  };
}

export interface IncorpFirstSaveInput extends OrgTarget {
  info: IncorpInfoInput;
  persons: IncorpPersonInput[];
}

/**
 * 첫 [저장] 본문 `{ orgId?, orgCode?, info, persons[] }` — 하나라도 틀리면 아무것도 만들지 않는다.
 * 남의 단체(403)가 먼저다.
 */
export function parseIncorpFirstSave(
  body: unknown,
  session: { role: ScopeRole; s020OrgId: number },
): Parsed<IncorpFirstSaveInput> {
  if (!isObj(body)) return bad('body', '요청 형식이 올바르지 않습니다');
  const org = parseIncorpOrgTarget(body.orgId, body.orgCode, session);
  if (!org.ok) return org;

  const errors: CorpChangeFieldError[] = [];
  const info = parseIncorpInfo(body.info ?? {});
  if (!info.ok) errors.push(...(info.errors ?? [{ field: 'info', message: info.message }]));

  const rawPersons = body.persons ?? [];
  const persons: IncorpPersonInput[] = [];
  if (!Array.isArray(rawPersons)) errors.push({ field: 'persons', message: '사람 목록 형식이 올바르지 않습니다' });
  else {
    rawPersons.forEach((p, i) => {
      const parsed = parseIncorpPersonBody(p, `persons.${i}`);
      if (parsed.ok) persons.push(parsed.value);
      else errors.push(...(parsed.errors ?? [{ field: `persons.${i}`, message: parsed.message }]));
    });
  }
  if (errors.length > 0 || !info.ok) return badAt(errors);
  return { ok: true, value: { ...org.value, info: info.value, persons } };
}

// =============================================================================
// 응답 모양
// =============================================================================

/** 화면에 보이는 사람 한 명 — 주민번호는 마스킹뿐이다. */
export interface IncorpPersonView {
  id: string;
  name: string;
  isFounder: boolean;
  isDirector: boolean;
  isAuditor: boolean;
  isRepresentative: boolean;
  unitsSubscribed: number;
  appointmentDate: string | null;
  zipCode: string | null;
  address: string | null;
  addressDetail: string | null;
  rrnMasked: string | null;
  sortOrder: number;
}

/** 임시 모드(건 없음) 응답 — 단체 · 상태 · 선택지. */
export interface IncorporationDraftResponse {
  orgId: number;
  orgCode: string | null;
  status: CorpChangeStatus;
  statusName: string;
  /** 머리에 보일 회사 이름 — 합친 상호, 없으면 단체코드 → 「단체 {ID}」. */
  displayName: string;
  /** 상호 표기위치 선택지(코드표 `NAME_POSITION`). */
  namePositions: CodeOption[];
  /** 위치 기본값(F). */
  defaultNamePosition: string;
}

export interface IncorporationDetailResponse extends IncorporationDraftResponse {
  id: string;
  info: IncorpInfoInput;
  /** 서류에 들어갈 상호(합친 것). 순수 상호가 비면 ''. */
  composedName: string;
  persons: IncorpPersonView[];
  /** `YYYY-MM-DD`. */
  createdOn: string;
  editable: boolean;
  availableTransitions: CorpChangeStatus[];
  canDelete: boolean;
  statusBeforeCancel: CorpChangeStatus | null;
  statusBeforeCancelName: string | null;
  cancelReason: string | null;
  writtenOn: string | null;
  completedOn: string | null;
  /** 막지 않는 경고(`incorporationWarnings`). */
  warnings: string[];
}

/** 머리의 회사 이름 — 합친 상호 → 단체코드 → 「단체 {ID}」. */
export function incorporationDisplayName(composed: string, org: { orgId: number; orgCode: string | null }): string {
  if (composed !== '') return composed;
  if (org.orgCode) return org.orgCode;
  return `단체 ${org.orgId}`;
}

// =============================================================================
// 작성완료 스냅샷 — 서류가 이 값으로 그린다(법인변경 `submit_snapshot` 과 같은 뜻)
// =============================================================================

/** ★ 주민번호는 넣지 않는다 — 출력 응답을 만들 때만 DB 암호문에서 꺼낸다(법인변경 Q4 와 같다). */
export interface IncorporationSnapshot {
  version: 1;
  composedName: string;
  companyTypePosition: string;
  info: IncorpInfoInput;
  persons: IncorpSnapshotPerson[];
}
/** 스냅샷의 사람 — 화면 모양에서 id · 마스킹 주민번호 · 순서를 뺀 것(순서는 배열 순서다). */
export type IncorpSnapshotPerson = Omit<IncorpPersonView, 'id' | 'rrnMasked' | 'sortOrder'>;

/** 작성완료 스냅샷 — 사람은 목록 순서 그대로(주민번호 · 마스킹 없음). */
export function buildIncorporationSnapshot(info: IncorpInfoInput, persons: readonly IncorpPersonView[]): IncorporationSnapshot {
  const position = info.companyTypePosition === 'B' ? 'B' : DEFAULT_NAME_POSITION;
  return {
    version: 1,
    composedName: composeIncorporationName(info.nameKo, position),
    companyTypePosition: position,
    info: { ...info, companyTypePosition: position },
    persons: persons.map(({ id: _id, rrnMasked: _m, sortOrder: _s, ...rest }) => rest),
  };
}

// =============================================================================
// 목록(s040100010)
// =============================================================================

export interface IncorporationListItem {
  id: string;
  orgId: number;
  orgCode: string | null;
  /** 합친 상호 — 순수 상호가 비면 null(화면은 단체코드 → 「단체 {ID}」). */
  composedName: string | null;
  status: string;
  /** `YYYY-MM-DD`. */
  createdOn: string;
  plannedDate: string | null;
}

/**
 * 목록 응답 — 줄 + 상태 선택지 · 이름(법인변경 목록과 같은 모양, 코드표 `CORP_CHANGE_STATUS` 를 `pickCorpChangeOptions` 로 거른 것).
 * ★ 화면은 상태 코드 · 이름을 적지 않는다(10-4, 2026-10-11).
 */
export interface IncorporationListResponse {
  items: IncorporationListItem[];
  /** 상태 필터 선택지 — P · E · C. */
  statuses: CodeOption[];
  /** 상태 이름 — 취소(X)까지. */
  statusNames: Record<string, string>;
}

export interface IncorporationListFilter {
  /** P · E · C 중 하나. 취소(X)는 `includeCancelled` 로만. */
  status: 'P' | 'E' | 'C' | null;
  includeCancelled: boolean;
}

/** 목록 조건 `?status=&includeCancelled=1`. 모르는 상태는 거절한다. */
export function parseIncorporationListQuery(query: Record<string, unknown>): Parsed<IncorporationListFilter> {
  const s = query.status;
  if (s !== undefined && s !== '' && s !== 'P' && s !== 'E' && s !== 'C') return bad('status', '진행상태가 올바르지 않습니다');
  const inc = query.includeCancelled === '1' || query.includeCancelled === 'true';
  return { ok: true, value: { status: s === undefined || s === '' ? null : (s as 'P' | 'E' | 'C'), includeCancelled: inc } };
}
