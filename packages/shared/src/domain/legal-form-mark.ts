/**
 * 법무 표시 — 표양식 정의(`definition` jsonb)의 `legal` 칸. 「이 양식은 법인변경 서류다」.
 *
 * 법인변경 5단계(서류 출력, 결정 2026-10-10 · 10-11). **마이그레이션 없이** 정의 jsonb 안에 둔다.
 *
 * =============================================================================
 * ★★★ 서류 목록은 코드에 없다 — 양식이 스스로 「어디에 쓰이는지」를 단다
 * =============================================================================
 * 레거시는 구분마다 서류 목록(신청서 · 정관변경안 · 취임승낙서)을 코드에 박았다. 여기서는
 * 표양식 편집기에서 양식에 표시를 붙이면 그 구분의 [서류 출력]에 뜬다. 서류 이름은 **양식 이름**
 * 이다. 양식을 하나 더 만들면 코드를 고치지 않고 서류가 하나 늘어난다(결정 A).
 *
 *   changeTypes  — 어느 변경 구분에서 뜨나. 여럿 고른다(법인변경등록1 은 모든 구분이 같이 쓴다)
 *   companyType  — 전체(ALL) · 주식회사(R) · 유한회사(A). 기본 전체(결정 B).
 *                  회사유형이 2종 밖이면(개인사업자 등) 「전체」 양식만 뜬다
 *   unit         — 건마다 한 장(case) · 임원마다 한 장(officer)
 *   officerKinds — 임원마다 한 장일 때, 어느 임원 구분(취임 · 사임 · 중임)의 임원에게 한 장씩. 여럿 고른다
 *
 * ★ 임원마다 한 장은 임원변경(OFFICER)에서만 뜻이 있다 — 다른 구분에는 임원이 없어 0장이 된다.
 *   그래서 unit=officer 면 changeTypes 는 `['OFFICER']` 여야 한다(정의 검사에서 거절).
 * ★ 표시가 붙은 양식은 표양식 관리에서 [인쇄] 를 막고, 표시를 떼야 지울 수 있다(409, 결정 E).
 */
import {
  CORP_CHANGE_TYPES,
  OFFICER_CHANGE_KINDS,
  isCorpChangeType,
  isOfficerChangeKind,
  type CorpChangeType,
  type OfficerChangeKind,
} from './corp-change.ts';

/** 표시의 업무 — 지금은 법인변경 하나. 법인설립을 붙일 때 늘린다. */
export const LEGAL_MARK_DOMAINS = ['corp-change'] as const;
export type LegalMarkDomain = (typeof LEGAL_MARK_DOMAINS)[number];

/**
 * 양식이 고를 수 있는 회사유형 — 공통코드 `MEMBER_TYPE` 파티션 `002`(주식회사 · 유한회사).
 * ★ 앱이 박아 둔 코드값이라 `code-usage.ts` 의 `PINNED_CODES` 에 올라 있다.
 */
export const LEGAL_FORM_COMPANY_TYPES = ['R', 'A'] as const;
export type LegalFormCompanyType = (typeof LEGAL_FORM_COMPANY_TYPES)[number];
/** 「전체」 — 회사유형을 가리지 않는다. 코드값이 아니다. */
export const LEGAL_FORM_ALL_COMPANIES = 'ALL';

export type LegalMarkUnit = 'case' | 'officer';

export interface LegalFormMark {
  domain: LegalMarkDomain;
  /** 1개 이상 · 중복 없음 · `CORP_CHANGE_TYPES` 순서. */
  changeTypes: CorpChangeType[];
  companyType: typeof LEGAL_FORM_ALL_COMPANIES | LegalFormCompanyType;
  unit: LegalMarkUnit;
  /** unit=officer 일 때만 — 1개 이상 · 중복 없음 · `OFFICER_CHANGE_KINDS` 순서. */
  officerKinds?: OfficerChangeKind[];
}

export function isLegalFormCompanyType(v: unknown): v is LegalFormCompanyType {
  return typeof v === 'string' && (LEGAL_FORM_COMPANY_TYPES as readonly string[]).includes(v);
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** 목록을 정해진 순서 · 중복 없이 고른다. 모르는 값이 하나라도 있으면 null. */
function pickOrdered<T extends string>(raw: unknown, all: readonly T[], is: (v: unknown) => v is T): T[] | null {
  if (!Array.isArray(raw) || !raw.every(is)) return null;
  return all.filter((v) => raw.includes(v));
}

/**
 * 표시를 읽는다 — 틀리면 사람이 읽는 사유. 모르는 키는 버린다(아는 칸만 담은 새 객체).
 */
export function parseLegalMark(raw: unknown): { ok: true; value: LegalFormMark } | { ok: false; message: string } {
  const no = (message: string) => ({ ok: false as const, message });
  if (!isObj(raw)) return no('법무 표시가 객체가 아닙니다');
  if (raw.domain !== 'corp-change') return no('법무 표시의 업무(domain)는 corp-change 여야 합니다');

  const changeTypes = pickOrdered(raw.changeTypes, CORP_CHANGE_TYPES, isCorpChangeType);
  if (!changeTypes || changeTypes.length === 0) return no('법무 표시의 변경 구분을 하나 이상 고르세요');

  const companyType = raw.companyType;
  if (companyType !== LEGAL_FORM_ALL_COMPANIES && !isLegalFormCompanyType(companyType)) {
    return no('법무 표시의 회사유형은 전체 · 주식회사 · 유한회사 중 하나입니다');
  }

  if (raw.unit === 'case') {
    if (raw.officerKinds !== undefined) return no('건마다 한 장인 양식에는 임원 구분을 고르지 않습니다');
    return { ok: true, value: { domain: 'corp-change', changeTypes, companyType, unit: 'case' } };
  }
  if (raw.unit !== 'officer') return no('법무 표시의 출력 단위는 건마다 · 임원마다 중 하나입니다');

  if (changeTypes.length !== 1 || changeTypes[0] !== 'OFFICER') {
    return no('임원마다 한 장인 양식은 임원변경에만 붙일 수 있습니다');
  }
  const officerKinds = pickOrdered(raw.officerKinds, OFFICER_CHANGE_KINDS, isOfficerChangeKind);
  if (!officerKinds || officerKinds.length === 0) return no('임원마다 한 장인 양식은 임원 구분(취임 · 사임 · 중임)을 하나 이상 고르세요');
  return { ok: true, value: { domain: 'corp-change', changeTypes, companyType, unit: 'officer', officerKinds } };
}

/**
 * 이 건의 [서류 출력]에 뜨는 양식인가.
 *
 * @param memberType 회사유형 코드(스냅샷). R · A 가 아니면(개인사업자 · 미입력 등) 「전체」 양식만 뜬다(결정 B).
 */
export function markAppliesTo(mark: LegalFormMark, changeType: string, memberType: string | null): boolean {
  if (!isCorpChangeType(changeType) || !mark.changeTypes.includes(changeType)) return false;
  return mark.companyType === LEGAL_FORM_ALL_COMPANIES || mark.companyType === memberType;
}

/** 임원마다 한 장 양식이 몇 장 나오나 — 표시의 임원 구분에 드는 임원만, 목록 순서대로. */
export function officersForMark<T extends { changeKind: string }>(mark: LegalFormMark, officers: readonly T[]): T[] {
  if (mark.unit !== 'officer') return [];
  const kinds: readonly string[] = mark.officerKinds ?? [];
  return officers.filter((o) => kinds.includes(o.changeKind));
}
