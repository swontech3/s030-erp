/**
 * 법인변경 상세(s040200011) — 첫 저장(새 건) · 변경 내용 · 임원 · 법무 회사 정보의 **입력 읽기**. 순수 함수.
 *
 * 3단계(2026-10-10). 규칙은 1단계(`corp-change.ts`)를 그대로 쓴다.
 *
 * =============================================================================
 * ★★★ 건은 상세의 첫 [저장] 때 생긴다 (결정 2026-10-10)
 * =============================================================================
 * [새 건] 대화상자는 DB 에 아무것도 쓰지 않는다 — 상세의 **임시 모드**로 보낼 뿐이다. 임시
 * 모드에서 적은 변경 내용 · 임원은 화면만 들고 있다가, 첫 [저장] 한 번에 **건 + 변경 내용 +
 * 임원 전부**가 한 요청 · 한 트랜잭션으로 들어간다(`parseFirstSave`). 하나라도 모양이 틀리면
 * 아무것도 만들지 않는다(400, 칸별 오류). 빈 건을 만드는 길은 없다 — 쓰레기 건 방지.
 *
 * =============================================================================
 * ★★★ 저장할 때 검증하지 않는다 — 작성 중 임시 저장이다
 * =============================================================================
 * 필수 칸 · 주소 필수 · 사업목적 한 줄 같은 **내용 검증은 P→E(4단계) 때** `validateCorpChange`
 * 가 한다. 여기서 거절하는 것은 **모양이 틀린 것**뿐이다 — 글자 자리에 숫자, 칸 정의에 없는
 * 키, 고를 수 없는 구분 같은 것(화면이 정상이면 생기지 않는다).
 *
 * 예외 둘(결정 2026-10-10):
 *   · 주민번호 — 형식(숫자 13자리)이 틀리면 **저장을 거절한다**(`validateRrn`). 암호화해 두면
 *     나중에 아무도 틀린 줄 모른다
 *   · 임원 효력일 — DB 칸이 날짜(timestamp)라 날짜가 아니면 넣을 수 없다. 그래서 거절한다
 *   변경 내용(payload)의 날짜는 jsonb 라 그대로 둔다 — 형식 안내는 화면이 칸 옆에 한다.
 *
 * ★ 거절은 **칸별 오류**(`errors[]`, `CorpChangeFieldError`)로 돌려준다 — 첫 칸에서 멈추지 않고
 *   틀린 칸을 다 모은다. 자리는 `newName` · `newHqAddress` · `officers.1.rrn` 처럼 점으로 잇는다.
 * ★ 회사 정보(`tb_s080_legal_orgs`)는 칸 길이가 DB 에 있다(037 · 038). 넘으면 DB 가 던져
 *   500 이 되므로 여기서 400 으로 먼저 거절한다 — 길이는 DB 의 것을 그대로 옮겼다.
 */
import type { ScopeRole } from '../session.ts';
import { parseDay } from './day.ts';
import {
  CHANGE_TYPE_DEFS,
  isCorpChangeType,
  isOfficerChangeKind,
  isRrnShape,
  validateRrn,
  type CorpChangeFieldError,
  type CorpChangeStatus,
  type CorpChangeType,
  type OfficerChangeKind,
} from './corp-change.ts';
import type { CodeOption } from './corp-change-list.ts';
import { DIGIT_MASK_RULE, isDigitMaskComplete, maskValue, type DigitMaskKind } from './masked-caret.ts';

/**
 * 비입주사 회사유형 — 공통코드 `MEMBER_TYPE` 파티션 `002`(주식회사 · 유한회사, 결정 2026-10-10).
 *
 * ★ 입주사의 회사유형은 ERP `tb_s080_companies.member_type`(파티션 `000`)이다. 법무는 그 값을
 *   **이름만 보여 주고 고치지 않는다**(ERP 가 주인). 2종이 아닌 입주사(개인사업자 등)를 서류에서
 *   어떻게 할지는 서류 출력(5단계) 때 정한다.
 */
export const LEGAL_MEMBER_TYPE_CATEGORY = 'MEMBER_TYPE';
export const LEGAL_MEMBER_TYPE_USE_TP = '002';
/** 입주사 회원구분의 파티션 — 입주사 값의 **이름**을 읽을 때만 쓴다(`code-usage.ts` 의 선언과 같다). */
export const TENANT_MEMBER_TYPE_USE_TP = '000';

/** 읽기 결과 — 400(모양이 틀림, 칸별 오류) · 403(남의 단체). */
export type Parsed<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 403; message: string; errors?: CorpChangeFieldError[] };

type Bad = { ok: false; status: 400; message: string; errors: CorpChangeFieldError[] };

/** 칸별 오류 묶음 → 400. 첫 오류 문구를 대표 문구로 쓴다. */
const badAt = (errors: CorpChangeFieldError[]): Bad => ({
  ok: false,
  status: 400,
  message: errors[0]?.message ?? '요청 형식이 올바르지 않습니다',
  errors,
});
const bad = (field: string, message: string): Bad => badAt([{ field, message }]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 글자 칸 — 없거나 비면 null, 글자가 아니면 undefined(= 모양이 틀림). */
function textOrNull(v: unknown): string | null | undefined {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t === '' ? null : t;
}

// =============================================================================
// 단체 — 누구의 회사인가
// =============================================================================

export interface OrgTarget {
  orgId: number;
  /** 운영사가 팝업에서 고른 단체코드(표시용). 회사 세션은 null — 서버가 ERP 에서 읽는다. */
  orgCode: string | null;
}

/**
 * 단체코드 모양 — **표시용이라 형식만 본다**(1~3자 영문 · 숫자). 권한 판정에 쓰지 않는다
 * (판정은 단체 ID · RLS). 결정 2026-10-10.
 */
const ORG_CODE_SHAPE = /^[A-Za-z0-9]{1,3}$/;

/**
 * 단체 고르기 — 새 건 · 임시 모드 읽기 · 법무 회사 정보 저장이 같이 쓴다.
 *
 * ★★ 회사 세션은 **자기 단체로만**. 생략하면 세션 단체이고, 다른 단체를 적으면 403 이다 —
 *    조용히 세션 단체로 바꾸지 않는다(남의 회사를 노린 요청이다). DB 의 RLS 가 한 번 더 막는다.
 *    회사 세션이 보낸 단체코드는 쓰지 않는다(입주사면 서버가 ERP 에서 읽는다).
 * ★ 운영사는 단체 ID 가 필수다(공용 회사 조회 팝업이 준 것).
 * ★ 단체 ID 는 숫자 또는 숫자 글자(주소의 `?orgId=`)를 받는다.
 */
export function parseOrgTarget(
  rawOrgId: unknown,
  rawOrgCode: unknown,
  session: { role: ScopeRole; s020OrgId: number },
): Parsed<OrgTarget> {
  const hasOrg = rawOrgId !== undefined && rawOrgId !== null && rawOrgId !== '';
  const orgId =
    typeof rawOrgId === 'number' ? rawOrgId : typeof rawOrgId === 'string' && /^\d+$/.test(rawOrgId) ? Number(rawOrgId) : Number.NaN;
  if (hasOrg && !(Number.isSafeInteger(orgId) && orgId > 0)) return bad('orgId', '회사(단체 ID)가 올바르지 않습니다');

  if (session.role !== 'operator') {
    if (hasOrg && orgId !== session.s020OrgId) {
      return { ok: false, status: 403, message: '자기 회사의 법인변경만 다룰 수 있습니다' };
    }
    return { ok: true, value: { orgId: session.s020OrgId, orgCode: null } };
  }

  if (!hasOrg) return bad('orgId', '회사를 고르세요');
  const orgCode = textOrNull(rawOrgCode);
  if (orgCode === undefined || (orgCode !== null && !ORG_CODE_SHAPE.test(orgCode))) {
    return bad('orgCode', '단체코드가 올바르지 않습니다');
  }
  return { ok: true, value: { orgId, orgCode } };
}

// =============================================================================
// 새 건의 머리 — 구분 + 단체
// =============================================================================

export interface CorpChangeCreateInput extends OrgTarget {
  changeType: CorpChangeType;
}

/**
 * 새 건의 머리 `{ changeType, orgId?, orgCode? }` — 첫 저장(`parseFirstSave`)과 임시 모드
 * 읽기(주소의 조건)가 같이 쓴다. 변경 구분은 앱이 아는 5종만 — `CEO_CHG` 는 거절한다.
 * ★ 403(남의 단체)이 400 보다 먼저다 — 남의 회사를 노린 요청에 「구분을 고르세요」를 답하지 않는다.
 */
export function parseCreateBody(
  body: unknown,
  session: { role: ScopeRole; s020OrgId: number },
): Parsed<CorpChangeCreateInput> {
  if (!isPlainObject(body)) return bad('body', '요청 형식이 올바르지 않습니다');
  const org = parseOrgTarget(body.orgId, body.orgCode, session);
  if (!org.ok && org.status === 403) return org;
  if (!isCorpChangeType(body.changeType)) return bad('changeType', '변경 구분을 고르세요');
  if (!org.ok) return org;
  return { ok: true, value: { changeType: body.changeType, ...org.value } };
}

// =============================================================================
// 변경 내용(payload)
// =============================================================================

const ADDRESS_KEYS = ['zipCode', 'address', 'addressDetail'] as const;

/**
 * 변경 내용 `{ payload }` 의 payload — 그 구분의 칸 정의(`CHANGE_TYPE_DEFS`)대로 읽는다.
 *
 * ★ **통째로 바꾼다.** 화면은 칸 전체를 보낸다. 빈 칸은 null 로 남긴다.
 * ★ 칸 정의에 없는 키는 **거절한다** — 조용히 버리면 보낸 쪽은 저장된 줄 안다.
 * ★ 사업목적(textarea)은 줄바꿈을 지킨다 — 앞뒤 공백만 뗀다.
 * ★ 틀린 칸을 **다 모은다**. 오류 자리는 칸 이름 그대로다(`newHqAddress`).
 */
export function parsePayload(changeType: CorpChangeType, raw: unknown): Parsed<Record<string, unknown>> {
  if (!isPlainObject(raw)) return bad('payload', '변경 내용 형식이 올바르지 않습니다');
  const defs = CHANGE_TYPE_DEFS[changeType].fields;
  const known = new Set(defs.map((d) => d.name));
  const errors: CorpChangeFieldError[] = Object.keys(raw)
    .filter((k) => !known.has(k))
    .map((k) => ({ field: k, message: `이 변경 구분에 없는 칸입니다: ${k}` }));

  const out: Record<string, unknown> = {};
  for (const def of defs) {
    const v = raw[def.name];
    if (def.type === 'address') {
      if (v === undefined || v === null) {
        out[def.name] = null;
        continue;
      }
      const notAddress = { field: def.name, message: `${def.label}이(가) 주소 형식이 아닙니다` };
      if (!isPlainObject(v) || Object.keys(v).some((k) => !(ADDRESS_KEYS as readonly string[]).includes(k))) {
        errors.push(notAddress);
        continue;
      }
      const addr: Record<string, string | null> = {};
      let broken = false;
      for (const key of ADDRESS_KEYS) {
        const t = textOrNull(v[key]);
        if (t === undefined) broken = true;
        else addr[key] = t;
      }
      if (broken) {
        errors.push(notAddress);
        continue;
      }
      out[def.name] = ADDRESS_KEYS.every((k) => addr[k] === null) ? null : addr;
      continue;
    }
    const t = textOrNull(v);
    if (t === undefined) {
      errors.push({ field: def.name, message: `${def.label}은(는) 글자로 입력하세요` });
      continue;
    }
    out[def.name] = t;
  }
  return errors.length > 0 ? badAt(errors) : { ok: true, value: out };
}

// =============================================================================
// 임원
// =============================================================================

export interface OfficerInput {
  /** 성명 — 임시 저장이라 빈 글자도 받는다(DB 칸은 NOT NULL 이라 null 대신 ''). */
  name: string;
  changeKind: OfficerChangeKind;
  position: string | null;
  /** `YYYY-MM-DD` 또는 null. */
  effectiveDate: string | null;
  zipCode: string | null;
  address: string | null;
  addressDetail: string | null;
  /** 사임사유 — 구분이 사임일 때 화면이 보여 준다. 선택. ★ 사임이 아니면 늘 null 이다(받아도 버린다). */
  resignReason: string | null;
  /**
   * 주민번호 숫자 13자리(하이픈 없음).
   *   · `undefined` — **안 바꾼다**(수정 때 칸을 비워 보냈다). 새로 만들 때는 「없음」이다
   *   · 지우는 동작은 없다(결정 2026-10-10 — 필요하면 그때 따로 정한다)
   */
  rrn: string | undefined;
}

/** 주민번호 → 숫자 13자리. 모양이 아니면 null. */
export function normalizeRrn(raw: string): string | null {
  return isRrnShape(raw) ? raw.trim().replace('-', '') : null;
}

/**
 * 화면에 보이는 주민번호 — **앞 7자리 + ******`(`900101-1******`). 레거시와 같은 모양이다.
 * ★ 서버는 평문을 브라우저로 돌려주지 않는다. 화면은 이 값만 받는다. 임시 모드에서 사람이 막
 *   적은 번호도 표에는 이 모양으로만 보인다.
 */
export function maskRrn(digits: string): string {
  return `${digits.slice(0, 6)}-${digits.slice(6, 7)}******`;
}

/**
 * 임원 본문. 저장할 때 내용 검증(성명 · 직위 필수 등)은 하지 않는다 — 머리말.
 * 구분(취임 · 사임 · 중임)은 고르는 칸이라 틀리면 거절한다. 비우면 취임으로 둔다.
 *
 * @param at 오류 자리의 앞머리 — 첫 저장의 임원 목록이면 `officers.{i}`. 없으면 칸 이름만.
 */
export function parseOfficerBody(raw: unknown, at?: string): Parsed<OfficerInput> {
  const fieldOf = (key: string) => (at ? `${at}.${key}` : key);
  if (!isPlainObject(raw)) return bad(at ?? 'body', '임원 정보 형식이 올바르지 않습니다');
  const errors: CorpChangeFieldError[] = [];

  const text = (key: string, label: string): string | null => {
    const t = textOrNull(raw[key]);
    if (t === undefined) {
      errors.push({ field: fieldOf(key), message: `${label}은(는) 글자로 입력하세요` });
      return null;
    }
    return t;
  };
  const name = text('name', '성명');
  const position = text('position', '직위');
  const zipCode = text('zipCode', '우편번호');
  const address = text('address', '주소');
  const addressDetail = text('addressDetail', '상세주소');
  const resignReason = text('resignReason', '사임사유');

  const kind = raw.changeKind ?? 'APPOINT';
  if (!isOfficerChangeKind(kind)) {
    errors.push({ field: fieldOf('changeKind'), message: '구분은 취임 · 사임 · 중임 중에서 고르세요' });
  }

  const effectiveDate = textOrNull(raw.effectiveDate);
  if (effectiveDate === undefined || (effectiveDate !== null && parseDay(effectiveDate) === null)) {
    errors.push({ field: fieldOf('effectiveDate'), message: '효력일은 날짜(YYYY-MM-DD)로 입력하세요' });
  }

  let rrn: string | undefined;
  const rawRrn = textOrNull(raw.rrn);
  if (rawRrn === undefined) {
    errors.push({ field: fieldOf('rrn'), message: '주민등록번호는 숫자 13자리로 입력하세요' });
  } else if (rawRrn !== null) {
    const err = validateRrn(rawRrn, fieldOf('rrn'));
    if (err) errors.push(err);
    else rrn = normalizeRrn(rawRrn) ?? undefined;
  }

  if (errors.length > 0) return badAt(errors);
  return {
    ok: true,
    value: {
      name: name ?? '',
      changeKind: kind as OfficerChangeKind,
      position,
      effectiveDate: effectiveDate ?? null,
      zipCode,
      address,
      addressDetail,
      // 사임이 아니면 비워 저장한다(2026-10-14)
      resignReason: kind === 'RESIGN' ? resignReason : null,
      rrn,
    },
  };
}

// =============================================================================
// 첫 저장 — 건 + 변경 내용 + 임원 한 번에
// =============================================================================

export interface FirstSaveInput extends CorpChangeCreateInput {
  payload: Record<string, unknown>;
  /** 임원변경(OFFICER)만. 다른 구분은 빈 배열. 주민번호 `undefined` = 없음. */
  officers: OfficerInput[];
  /** 비입주사 법무 회사 정보 — 실려 오면 같은 트랜잭션에서 저장한다. 안 실으면 null(안 건드림). */
  company: LegalOrgInput | null;
}

/**
 * 저장 본문의 `company` — 없거나 null 이면 「안 건드림」(null). 오류 자리는 `company.{칸}`.
 * 첫 저장(`parseFirstSave`)과 변경 내용 저장(PATCH)이 같이 쓴다(결정 2026-10-10 — 저장 버튼 하나).
 */
export function parseCompanyPart(raw: unknown): Parsed<LegalOrgInput | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  return parseLegalOrgBody(raw, 'company');
}

/**
 * 첫 [저장] 본문 `{ changeType, orgId?, orgCode?, payload, officers[] }`.
 *
 * ★★ 하나라도 틀리면 **아무것도 만들지 않는다** — 그래서 저장 전에 전부 읽고, 틀린 칸을 다 모아
 *    400 하나로 돌려준다. 남의 단체(403)는 그보다 먼저다.
 * ★ 임원은 임원변경 건만 받는다. 다른 구분에 임원이 오면 거절한다(조용히 버리지 않는다).
 */
export function parseFirstSave(
  body: unknown,
  session: { role: ScopeRole; s020OrgId: number },
): Parsed<FirstSaveInput> {
  const head = parseCreateBody(body, session);
  if (!head.ok) return head;
  const raw = body as Record<string, unknown>;

  const errors: CorpChangeFieldError[] = [];
  const payload = parsePayload(head.value.changeType, raw.payload ?? {});
  if (!payload.ok) errors.push(...(payload.errors ?? [{ field: 'payload', message: payload.message }]));

  const rawOfficers = raw.officers ?? [];
  const officers: OfficerInput[] = [];
  if (!Array.isArray(rawOfficers)) {
    errors.push({ field: 'officers', message: '임원 목록 형식이 올바르지 않습니다' });
  } else if (rawOfficers.length > 0 && !CHANGE_TYPE_DEFS[head.value.changeType].usesOfficers) {
    errors.push({ field: 'officers', message: '임원변경 건에만 임원을 넣을 수 있습니다' });
  } else {
    rawOfficers.forEach((o, i) => {
      const parsed = parseOfficerBody(o, `officers.${i}`);
      if (parsed.ok) officers.push(parsed.value);
      else errors.push(...(parsed.errors ?? [{ field: `officers.${i}`, message: parsed.message }]));
    });
  }

  const company = parseCompanyPart(raw.company);
  if (!company.ok) errors.push(...(company.errors ?? [{ field: 'company', message: company.message }]));

  if (errors.length > 0) return badAt(errors);
  return {
    ok: true,
    value: { ...head.value, payload: payload.ok ? payload.value : {}, officers, company: company.ok ? company.value : null },
  };
}

// =============================================================================
// 비입주사 법무 회사 정보(tb_s080_legal_orgs)
// =============================================================================

export interface LegalOrgInput {
  legalName: string | null;
  corpNumber: string | null;
  bizNumber: string | null;
  ceoName: string | null;
  tel: string | null;
  headZipCode: string | null;
  headAddress: string | null;
  headAddressDetail: string | null;
  ceoZipCode: string | null;
  ceoAddress: string | null;
  ceoAddressDetail: string | null;
  /** `MEMBER_TYPE` 002 코드값. 코드표에 있는지는 서버가 코드표를 읽어 본다. */
  memberType: string | null;
}

/**
 * 법무 회사 정보 저장 뒤 삐용 반영 결과(결정 2026-10-22) — 저장 응답(첫 저장 · PATCH)에만 싣는다.
 * ★ **DB 에 남기지 않는다.** 실패해도 저장은 그대로이고, 화면이 배너로만 알린다.
 *   null = 보내지 않았다(회사 정보를 안 실었거나 · 보낼 값이 하나도 없다).
 */
export type LegalOrgSyncResult = { kind: 'ok' } | { kind: 'failed'; reason: string };

/** 칸 → [이름, DB 길이(null = text)]. 길이는 037 · 038 그대로다. */
const LEGAL_ORG_FIELDS: Readonly<Record<keyof LegalOrgInput, readonly [string, number | null]>> = {
  legalName: ['등기상 상호', 200],
  corpNumber: ['법인등록번호', 20],
  bizNumber: ['사업자등록번호', 20],
  ceoName: ['대표자', 50],
  tel: ['전화', 30],
  headZipCode: ['본점 우편번호', 10],
  headAddress: ['본점 주소', null],
  headAddressDetail: ['본점 상세주소', 200],
  ceoZipCode: ['대표자 자택 우편번호', 10],
  ceoAddress: ['대표자 자택 주소', null],
  ceoAddressDetail: ['대표자 자택 상세주소', 200],
  memberType: ['회사유형', 10],
};

/**
 * 숫자 칸의 형식(`masked-caret.ts` — 계약 폼과 같은 함수). 자릿수가 틀리면 400(칸별 오류),
 * 맞으면 하이픈을 넣은 모양으로 저장한다(ERP 입주사 칸과 같다).
 */
const LEGAL_ORG_DIGIT_KINDS: Readonly<Partial<Record<keyof LegalOrgInput, DigitMaskKind>>> = {
  corpNumber: 'corpno',
  bizNumber: 'bizno',
  tel: 'phone',
};

/**
 * 법무 회사 정보 본문 — 칸 전체를 보낸다(통째로 바꾼다). 이 함수는 회사 칸만 본다.
 * 저장 본문 안에서는 `company` 로 실려 온다(`parseCompanyPart`).
 *
 * @param at 오류 자리의 앞머리 — 저장 본문의 `company` 면 `company.legalName` 처럼 붙는다.
 */
export function parseLegalOrgBody(raw: unknown, at?: string): Parsed<LegalOrgInput> {
  const fieldOf = (key: string) => (at ? `${at}.${key}` : key);
  if (!isPlainObject(raw)) return bad(at ?? 'body', '회사 정보 형식이 올바르지 않습니다');
  const out = {} as Record<keyof LegalOrgInput, string | null>;
  const errors: CorpChangeFieldError[] = [];
  for (const key of Object.keys(LEGAL_ORG_FIELDS) as (keyof LegalOrgInput)[]) {
    const [label, max] = LEGAL_ORG_FIELDS[key];
    const t = textOrNull(raw[key]);
    const digitKind = LEGAL_ORG_DIGIT_KINDS[key];
    if (t === undefined) errors.push({ field: fieldOf(key), message: `${label}은(는) 글자로 입력하세요` });
    else if (t !== null && digitKind && !isDigitMaskComplete(digitKind, t)) {
      errors.push({ field: fieldOf(key), message: `${label}은(는) ${DIGIT_MASK_RULE[digitKind]}로 입력하세요` });
    } else if (t !== null && max !== null && t.length > max) errors.push({ field: fieldOf(key), message: `${label}은(는) ${max}자 이내로 입력하세요` });
    // ★ 숫자 칸은 하이픈을 넣어 저장한다 — ERP 입주사 칸(`tb_s080_companies`)과 같은 모양(2026-10-10 실측).
    else out[key] = t !== null && digitKind ? maskValue(digitKind, t) : t;
  }
  return errors.length > 0 ? badAt(errors) : { ok: true, value: out };
}

// =============================================================================
// 응답 모양
// =============================================================================

export interface CorpChangeAddressView {
  zipCode: string | null;
  address: string | null;
  addressDetail: string | null;
}

/**
 * 기본정보 카드 — **읽어서** 보여 준다(복사해 두지 않는다).
 *   · 입주사 = ERP 입주사 정보(`tb_s080_companies`). 고치지 않는다 — 「입주사 화면에서 입력」 링크
 *   · 비입주사 = 법무 회사 정보(`tb_s080_legal_orgs`). 이 화면의 [저장] 이 변경 내용과 함께 저장한다.
 *     빈 칸은 삐용 값으로 채워 보여 준다(`applyCompanyDefaults`)
 */
export interface CorpChangeCompanyInfo {
  isTenant: boolean;
  /** 입주사 번호 — 「입주사 화면에서 입력」 링크가 쓴다. 비입주사는 null. */
  tenantCompanyId: string | null;
  /** 화면에 보이는 회사명 — `corpChangeCompanyName` 으로 만든 것. */
  displayName: string;
  /** 입주사 = ERP 회사명, 비입주사 = 등기상 상호. 없으면 null. */
  legalName: string | null;
  corpNumber: string | null;
  bizNumber: string | null;
  ceoName: string | null;
  tel: string | null;
  head: CorpChangeAddressView;
  /** 대표자 자택 — 대표주소 변경의 「변경 전 주소」 기본값이다(사업장 주소가 아니다). */
  ceo: CorpChangeAddressView;
  memberType: string | null;
  /** 코드표 이름. 코드표에 없으면 코드값. */
  memberTypeName: string | null;
  /** 비입주사 법무 회사 정보 줄이 있는가(없으면 첫 저장이 만든다). */
  hasLegalOrg: boolean;
  /**
   * 삐용 값으로 **채워 보여 준** 칸(`applyCompanyDefaults`) — 아직 저장되지 않았다. 입주사는 늘 빈 배열.
   * 화면은 이 칸에 「저장 전」 표시를 붙이고, [저장] 하면 회사 정보로 남긴다.
   */
  defaultedFields: CompanyDefaultField[];
}

// =============================================================================
// 비입주사 회사 정보의 기본값 — 삐용 단체 정보 (결정 2026-10-10)
// =============================================================================

/**
 * 삐용이 주는 회사 정보 — 지금은 회사명 · 대표자명.
 *   · 운영사: 단체 단건 조회(`getOrg`)의 `orgName` · `repName`
 *   · 회사 사용자(비입주사): 로그인 프로필의 `orgName` 만(단체 조회 권한이 없다)
 *     ★ 다음 단계 — 삐용이 로그인 응답에 대표자명을 더하면 `repName` 으로 붙인다
 */
export interface BbiyongCompanyDefaults {
  orgName?: string | null;
  repName?: string | null;
}

/** 기본값을 받을 수 있는 회사 칸. */
export type CompanyDefaultField = 'legalName' | 'corpNumber' | 'bizNumber' | 'ceoName' | 'tel' | 'memberType';

/**
 * ★★ 삐용 칸 → 법무 회사 정보 칸의 짝 — **이 한 곳에서만** 정한다. 삐용이 칸을 더 주면
 *    `BbiyongCompanyDefaults` 에 칸을 더하고 여기에 한 줄을 더한다(대응하는 칸이 있을 때만).
 */
export const COMPANY_DEFAULT_PAIRS: readonly { from: keyof BbiyongCompanyDefaults; to: Exclude<CompanyDefaultField, 'memberType'> }[] = [
  { from: 'orgName', to: 'legalName' },
  { from: 'repName', to: 'ceoName' },
];

/**
 * ★★ 등기상 상호 → 회사유형 **이름** 추정(결정 2026-10-10). 이 표 한 곳에서만 정한다.
 *    코드값을 박지 않는다 — 이름으로 `MEMBER_TYPE` 002 코드표에서 찾는다(`guessMemberType`).
 *    앞의 것이 먼저다. 어느 표시도 없으면 추정하지 않는다(비운다).
 */
export const MEMBER_TYPE_NAME_HINTS: readonly { name: string; marks: readonly string[] }[] = [
  { name: '주식회사', marks: ['주식회사', '(주)'] },
  { name: '유한회사', marks: ['유한회사', '(유)'] },
];

/** 상호로 회사유형 코드를 추정한다 — 이름이 같은 코드표 줄의 코드값. 모르면 null. */
export function guessMemberType(legalName: string | null, memberTypes: readonly CodeOption[]): CodeOption | null {
  const name = legalName?.trim();
  if (!name) return null;
  const hint = MEMBER_TYPE_NAME_HINTS.find((h) => h.marks.some((m) => name.includes(m)));
  return hint ? (memberTypes.find((t) => t.name === hint.name) ?? null) : null;
}

/**
 * 비입주사 회사 정보의 **빈 칸만** 기본값으로 채워 보여 준다 — 저장된 값이 우선이다.
 *   · 삐용 값(`COMPANY_DEFAULT_PAIRS`) — 회사명 · 대표자명
 *   · 회사유형 — 등기상 상호(저장된 값이든 위에서 채운 값이든)에서 추정(`guessMemberType`)
 *
 * ★ 복사해 두지 않는다 — 응답에만 채운다. 사람이 [저장] 해야 법무 회사 정보에 남는다.
 * ★ 입주사는 건드리지 않는다(ERP 값 그대로 · 읽기 전용). 삐용 값이 없으면(조회 실패 ·
 *   unsupported) 그 칸은 그대로 둔다 — 회사명은 `corpChangeCompanyName` 이 단체코드로 보여 준다.
 *
 * @param memberTypes 비입주사 회사유형 선택지(`MEMBER_TYPE` 002) — 응답의 `memberTypes`.
 */
export function applyCompanyDefaults(
  company: CorpChangeCompanyInfo,
  source: BbiyongCompanyDefaults | null,
  org: { orgCode: string | null; orgId: number },
  memberTypes: readonly CodeOption[],
): CorpChangeCompanyInfo {
  if (company.isTenant) return company;
  const next: CorpChangeCompanyInfo = { ...company, defaultedFields: [...company.defaultedFields] };
  for (const { from, to } of COMPANY_DEFAULT_PAIRS) {
    const value = source?.[from]?.trim();
    if (!value || next[to]?.trim()) continue;
    next[to] = value;
    next.defaultedFields.push(to);
  }
  if (!next.memberType) {
    const guessed = guessMemberType(next.legalName, memberTypes);
    if (guessed) {
      next.memberType = guessed.code;
      next.memberTypeName = guessed.name;
      next.defaultedFields.push('memberType');
    }
  }
  next.displayName = corpChangeCompanyName(next.legalName, org);
  return next;
}

export interface CorpChangeOfficerView {
  id: string;
  name: string;
  changeKind: string;
  position: string | null;
  effectiveDate: string | null;
  zipCode: string | null;
  address: string | null;
  addressDetail: string | null;
  resignReason: string | null;
  /** ★ 마스킹된 것뿐이다. 평문 · 암호문은 내려가지 않는다. */
  rrnMasked: string | null;
  sortOrder: number;
}

/**
 * 임시 모드(`/legal/corp-changes/new`) — 건이 아직 없다. DB 의 건을 읽지 않고, 기본정보만
 * 읽어서 보여 준다. 저장된 건의 상세(`CorpChangeDetailResponse`)는 이것에 건의 값을 더한 것이다.
 */
export interface CorpChangeDraftResponse {
  orgId: number;
  orgCode: string | null;
  changeType: CorpChangeType;
  changeTypeName: string;
  status: string;
  statusName: string;
  company: CorpChangeCompanyInfo;
  /** 비입주사 회사유형 선택지 — MEMBER_TYPE 002(코드표 순서 · 이름). */
  memberTypes: CodeOption[];
  /**
   * 이 세션이 비입주사 회사 정보를 고칠 수 있는가 — 운영사 또는 수정 권한이 있는 그 회사 사용자(2026-10-25).
   * 입주사면 늘 false. 화면은 **이 값으로만** 회사 칸을 연다 — 서버가 저장을 받을 때와 같은 판정이다.
   */
  canEditCompany: boolean;
}

export interface CorpChangeDetailResponse extends CorpChangeDraftResponse {
  id: string;
  payload: Record<string, unknown>;
  createdOn: string;
  /** 변경 내용 · 임원을 고칠 수 있는가 — 서류작성중(P)일 때만(`canEditCorpChange`). */
  editable: boolean;
  /** 임원변경(OFFICER)만 채운다. 다른 구분은 빈 배열. */
  officers: CorpChangeOfficerView[];

  // ── 4단계 — 상태 전이 · 삭제(2026-10-10) ──────────────────────────────────
  /**
   * 이 세션의 역할로 지금 갈 수 있는 상태(`availableTransitions`). 화면은 **이 값으로만** 버튼을
   * 그린다 — 서버가 전이를 받을 때 쓰는 `checkTransition` 과 같은 표다.
   */
  availableTransitions: CorpChangeStatus[];
  /** 지금 지울 수 있는가(`checkDelete` — 운영사 · P/X). */
  canDelete: boolean;
  /** 취소 직전 상태 — 취소(X)일 때만. 복원은 이 상태로만 간다. */
  statusBeforeCancel: CorpChangeStatus | null;
  /** 그 상태의 코드표 이름. */
  statusBeforeCancelName: string | null;
  /** 취소 사유 — 취소(X)일 때만. 회사 사용자도 본다. */
  cancelReason: string | null;
  /** 작성완료일 `YYYY-MM-DD`(written_at) — 서류수정(E→P) 뒤에도 남는다(다시 작성완료하면 바뀐다). */
  writtenOn: string | null;
  /** 완료일 `YYYY-MM-DD`. */
  completedOn: string | null;
}

/**
 * 회사명 — 입주사 = ERP 회사명, 비입주사 = 등기상 상호 → 단체코드 → 「단체 {ID}」.
 * ★ 목록의 `corpChangeCompanyLabel` 과 같은 순서다(그쪽은 서버가 상호를 회사명 자리에 넣어 준다).
 */
export function corpChangeCompanyName(
  name: string | null,
  org: { orgCode: string | null; orgId: number },
): string {
  const n = name?.trim();
  if (n) return n;
  const code = org.orgCode?.trim();
  if (code) return code;
  return `단체 ${org.orgId}`;
}

/**
 * 상세 머리의 날짜 줄 — 상태에 맞는 날짜만(결정 2026-10-10). **표시만** 고른다. DB 값은 그대로 둔다.
 * 서류수정(E→P) 뒤에도 written_at 이 남고, 완료 취소(C→E)는 completed_at 을 비우지만, 그 남은 값을
 * 지금 상태가 쓰지 않으면 보이지 않는다.
 *
 *   P = 등록 / E = 등록 · 작성완료 / C = 등록 · 작성완료 · 완료 / X = 취소 직전 상태 기준
 *
 * 값이 없는 날짜는 뺀다(작성완료 전에 만든 옛 건 등).
 */
export function corpChangeDateLine(row: {
  status: string;
  statusBeforeCancel: CorpChangeStatus | null;
  createdOn: string;
  writtenOn: string | null;
  completedOn: string | null;
}): { label: string; day: string }[] {
  const basis = row.status === 'X' ? row.statusBeforeCancel : row.status;
  const line: { label: string; day: string | null }[] = [{ label: '등록', day: row.createdOn }];
  if (basis === 'E' || basis === 'C') line.push({ label: '작성완료', day: row.writtenOn });
  if (basis === 'C') line.push({ label: '완료', day: row.completedOn });
  return line.filter((d): d is { label: string; day: string } => !!d.day);
}
