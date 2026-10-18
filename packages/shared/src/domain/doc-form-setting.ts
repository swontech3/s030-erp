/**
 * 등기 설정(s040900010, 법무 090) — 목록 모양 · 저장 본문 검사 · 지우기 키 검사. 순수 함수.
 *
 * 표는 레거시 `tb_s080_doc_form_settings` 그대로다(새 표 · 마이그레이션 없음). 출력이 읽는 규칙
 * (기본 줄 ⊕ 회사유형 줄, 빈칸은 빈칸)은 `corp-change-print.ts` 의 `pickDocFormSetting` 에 있다.
 *
 * =============================================================================
 * ★★ 저장 규칙 (조사 보고 1~8 · 결정 2026-10-18)
 * =============================================================================
 *   1. 한 번에 한 줄. `(operator_id, domain, reg_type_key, company_type)` 로 upsert. id · 수정 시각 · 수정자는 서버
 *   2. 구분은 그 분류(LAW_CNG_TP · LAW_EST_TP)의 살아 있는 코드여야 한다(API 가 센다). 회사유형은
 *      법인변경 = 기본('') · R · A, **설립 = 기본만**(결정 3 — 설립에는 회사유형 탭이 없다)
 *   3. 기본 줄은 표시명 필수. 회사유형 줄의 빈칸 = 「기본 줄 값을 씀」 — 글 칸은 NULL, 표시명은 ''
 *   4. 첨부서면은 `{ name, copies }` 한 모양으로 저장. 통수 0 이상 정수(0 = 이름만 찍힌다). 이름이 빈 행은 버린다
 *   5. 세금 — 법인변경은 고정 세 칸(0 이상 정수, 셋 다 비면 null). 설립은 세율 · 최소액 · 배수 · 교육세율 ·
 *      수수료 다섯 칸(결정 1) — **모두 넣거나 모두 비운다**(일부만 있으면 거절). 비면 서류의 세금 칸은 빈칸
 *   6. 줄바꿈은 실제 줄바꿈으로 저장한다. 옛 값의 `\n` 글자는 출력할 때 바뀌므로 화면이 고치지 않는다
 *   7. 회사유형 줄만 지운다(= 기본 줄 값을 쓰게 된다). **기본 줄은 지우지 않고 「사용 끔」**(결정 2).
 *      그래서 사용 여부는 기본 줄의 칸이다 — 회사유형 줄은 언제나 사용(true)으로 저장한다
 *   8. 코드는 읽기만 한다 — 줄이 없는 코드는 「미설정」이고, 저장하면 줄이 새로 생긴다
 *
 * ★ 목적변경(PURPOSE)은 상호 줄(NAME)을 같이 쓴다(결정 F, `settingKeyFor`) — PURPOSE 키로는 저장하지 않는다.
 * ★ 화면에 없는 칸 — `custom_tokens` · `form_template_id` · `sort_order` 는 읽지도 쓰지도 않는다.
 *   `tax_mode` 는 새 줄을 넣을 때만 구분으로 정한다(법인변경 fixed · 설립 computed).
 * ★ 설립 줄의 등기할 사항(`matter` · `matter_body`)은 출력이 읽지 않는다 — 받지도 고치지도 않는다.
 */
import { settingKeyFor, type DocFormAttachment, type DocFormSettingRow, type DocFormTaxes } from './corp-change-print.ts';
import { INCORP_TAX_KEYS, readIncorpTaxSetting, type IncorpTaxSetting } from './incorporation-tax.ts';
import { LEGAL_FORM_COMPANY_TYPES } from './legal-form-mark.ts';

export type DocFormDomain = 'corp-change' | 'incorporation';

/** 구분 → 코드 분류. 목록 왼쪽의 묶음 순서이기도 하다. */
export const DOC_FORM_DOMAINS: readonly { domain: DocFormDomain; name: string; category: string; useTp: string }[] = [
  { domain: 'corp-change', name: '법인변경', category: 'LAW_CNG_TP', useTp: '000' },
  { domain: 'incorporation', name: '법인설립', category: 'LAW_EST_TP', useTp: '000' },
];

/** 회사유형 탭 이름 — 공통코드 `MEMBER_TYPE` 파티션 `002`(양식 법무 표시와 같은 곳). */
export const DOC_FORM_COMPANY_TYPE_CODES = { category: 'MEMBER_TYPE', useTp: '002' } as const;

export const DOC_FORM_LABEL_MAX = 200;
export const DOC_FORM_TEXT_MAX = 2000;
export const DOC_FORM_ATTACHMENTS_MAX = 50;
export const DOC_FORM_COPIES_MAX = 99;

export function isDocFormDomain(v: unknown): v is DocFormDomain {
  return v === 'corp-change' || v === 'incorporation';
}

/** 이 구분이 갖는 줄 — 기본('') + 법인변경만 회사유형 R · A(결정 3). */
export function companyTypesOf(domain: DocFormDomain): readonly string[] {
  return domain === 'corp-change' ? ['', ...LEGAL_FORM_COMPANY_TYPES] : [''];
}

// =============================================================================
// 목록 모양 — GET 응답
// =============================================================================

/** 설정 줄 하나(화면이 보는 모양). 글 칸은 저장된 그대로다(`\n` 글자도 그대로 — 규칙 6). */
export interface DocFormSettingView {
  /** '' = 기본 줄 · 'R' · 'A'. */
  companyType: string;
  label: string;
  formNo: string | null;
  matter: string | null;
  matterBody: string | null;
  regPurpose: string | null;
  regReason: string | null;
  isActive: boolean;
  /** 법인변경 고정 세금. 설립 줄이면 null. */
  taxes: DocFormTaxes | null;
  /** 설립 세금 설정. 법인변경 줄이면 null. */
  incorpTax: IncorpTaxSetting | null;
  attachments: DocFormAttachment[];
  /** `YYYY-MM-DD HH:mm`. */
  updatedAt: string;
}

/** 목록 한 줄 = 코드 하나. */
export interface DocFormSettingItem {
  code: string;
  name: string;
  /** 다른 코드의 줄을 같이 쓰면 그 코드(목적변경 → NAME). 이때 `rows` 는 비어 있고 고칠 수 없다. */
  sharedWith: string | null;
  /** 기본 줄 · 회사유형 줄(있는 것만). */
  rows: DocFormSettingView[];
}

export interface DocFormSettingGroup {
  domain: DocFormDomain;
  name: string;
  items: DocFormSettingItem[];
}

export interface DocFormSettingsResponse {
  groups: DocFormSettingGroup[];
  /** 회사유형 탭 — 법인변경에만 쓴다. */
  companyTypes: { code: string; name: string }[];
}

/**
 * 코드(순서 그대로) 에 설정 줄을 붙인다. 같은 코드가 두 번 오면 처음 것만. 코드에 없는 줄은 버린다(규칙 8).
 * 회사유형이 이 구분의 것이 아닌 줄(설립의 R 줄 등)도 버린다 — 화면이 그 줄을 고칠 수 없기 때문이다.
 */
export function buildDocFormItems(
  domain: DocFormDomain,
  codes: readonly { code: string; name: string }[],
  rows: readonly (DocFormSettingView & { regTypeKey: string })[],
): DocFormSettingItem[] {
  const allowed = companyTypesOf(domain);
  const seen = new Set<string>();
  const items: DocFormSettingItem[] = [];
  for (const c of codes) {
    if (seen.has(c.code)) continue;
    seen.add(c.code);
    const key = domain === 'corp-change' ? settingKeyFor(c.code) : c.code;
    const sharedWith = key === c.code ? null : key;
    const mine = sharedWith
      ? []
      : rows
          .filter((r) => r.regTypeKey === c.code && allowed.includes(r.companyType))
          .sort((a, b) => allowed.indexOf(a.companyType) - allowed.indexOf(b.companyType))
          .map(({ regTypeKey: _k, ...view }) => view);
    items.push({ code: c.code, name: c.name, sharedWith, rows: mine });
  }
  return items;
}

/**
 * 설립 세금 설정 — 그 설립 구분의 **기본 줄**(사용 중)의 `taxes`. 없거나 끈 줄이거나 다섯 칸이 다 차 있지
 * 않으면 null(서류의 세금 칸은 빈칸 — 결정 1). 설립에는 회사유형 줄이 없다(결정 3).
 */
export function incorpTaxSettingOf(rows: readonly DocFormSettingRow[], regTypeKey: string): IncorpTaxSetting | null {
  const base = rows.find((r) => r.regTypeKey === regTypeKey && r.companyType === '' && r.isActive);
  return base ? readIncorpTaxSetting(base.taxes) : null;
}

// =============================================================================
// 저장 본문 — PUT /legal/doc-form-settings
// =============================================================================

export interface DocFormSettingSave {
  domain: DocFormDomain;
  regTypeKey: string;
  companyType: string;
  /** 회사유형 줄은 '' 일 수 있다(= 기본 줄 값을 씀). */
  label: string;
  formNo: string | null;
  regPurpose: string | null;
  regReason: string | null;
  /** 법인변경만. 설립이면 null 이고 저장하지 않는다. */
  matter: string | null;
  matterBody: string | null;
  /** 회사유형 줄은 언제나 true(규칙 7). */
  isActive: boolean;
  /** 법인변경만. 셋 다 비면 null. */
  taxes: DocFormTaxes | null;
  /** 설립만. 다섯 칸 모두 있거나 null. */
  incorpTax: IncorpTaxSetting | null;
  /** 비면 null. */
  attachments: DocFormAttachment[] | null;
}

type Fail = { ok: false; field: string; message: string };
const fail = (field: string, message: string): Fail => ({ ok: false, field, message });
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 줄 키 — 구분 · 코드 · 회사유형. 저장과 지우기가 같이 쓴다. */
function parseKey(raw: Record<string, unknown>): { ok: true; value: { domain: DocFormDomain; regTypeKey: string; companyType: string } } | Fail {
  if (!isDocFormDomain(raw.domain)) return fail('domain', '구분(domain)이 올바르지 않습니다');
  const domain = raw.domain;
  const regTypeKey = typeof raw.regTypeKey === 'string' ? raw.regTypeKey.trim() : '';
  if (regTypeKey === '' || regTypeKey.length > 50) return fail('regTypeKey', '등기 종류(regTypeKey)가 올바르지 않습니다');
  if (domain === 'corp-change' && settingKeyFor(regTypeKey) !== regTypeKey) {
    return fail('regTypeKey', '목적변경은 상호변경 줄을 같이 씁니다 — 상호변경에서 고치세요');
  }
  const companyType = raw.companyType ?? '';
  if (typeof companyType !== 'string' || !companyTypesOf(domain).includes(companyType)) {
    return fail('companyType', domain === 'incorporation' ? '법인설립은 기본 줄만 있습니다' : '회사유형이 올바르지 않습니다');
  }
  return { ok: true, value: { domain, regTypeKey, companyType } };
}

/** 글 칸 — 앞뒤 공백을 걷고, 비면 null. 줄바꿈은 그대로(`\r\n` 은 `\n` 으로). */
function text(raw: unknown, field: string, label: string, max: number): { ok: true; value: string | null } | Fail {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== 'string') return fail(field, `${label}이(가) 올바르지 않습니다`);
  const v = raw.replace(/\r\n?/g, '\n').trim();
  if (v.length > max) return fail(field, `${label}은(는) ${max}자 이내로 입력하세요`);
  return { ok: true, value: v === '' ? null : v };
}

/** 0 이상 정수 또는 빈칸(null · undefined · ''). */
function amount(raw: unknown, field: string, label: string): { ok: true; value: number | null } | Fail {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null };
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > 1e12) {
    return fail(field, `${label}은(는) 0 이상 정수로 입력하세요`);
  }
  return { ok: true, value: raw };
}

const FIXED_TAX_LABEL: Record<keyof DocFormTaxes, string> = {
  regLicense: '등록면허세',
  localEdu: '지방교육세',
  regFee: '등기신청수수료',
};

export const INCORP_TAX_LABEL: Record<keyof IncorpTaxSetting, string> = {
  regLicenseRate: '등록면허세율',
  regLicenseMin: '최소 등록면허세',
  metroMultiplier: '대도시 중과 배수',
  localEduRate: '지방교육세율',
  regFee: '등기신청수수료',
};

function parseFixedTaxes(raw: unknown): { ok: true; value: DocFormTaxes | null } | Fail {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (!isObj(raw)) return fail('taxes', '세금이 올바르지 않습니다');
  const out: DocFormTaxes = { regLicense: null, localEdu: null, regFee: null };
  for (const k of ['regLicense', 'localEdu', 'regFee'] as const) {
    const r = amount(raw[k], `taxes.${k}`, FIXED_TAX_LABEL[k]);
    if (!r.ok) return r;
    out[k] = r.value;
  }
  return { ok: true, value: out.regLicense === null && out.localEdu === null && out.regFee === null ? null : out };
}

function parseIncorpTax(raw: unknown): { ok: true; value: IncorpTaxSetting | null } | Fail {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (!isObj(raw)) return fail('incorpTax', '설립 세금이 올바르지 않습니다');
  const got: Partial<IncorpTaxSetting> = {};
  for (const k of INCORP_TAX_KEYS) {
    const r = amount(raw[k], `incorpTax.${k}`, INCORP_TAX_LABEL[k]);
    if (!r.ok) return r;
    if (r.value !== null) got[k] = r.value;
  }
  const n = Object.keys(got).length;
  if (n === 0) return { ok: true, value: null };
  if (n < INCORP_TAX_KEYS.length) {
    const missing = INCORP_TAX_KEYS.find((k) => got[k] === undefined)!;
    return fail(`incorpTax.${missing}`, '설립 세금은 다섯 칸을 모두 넣거나 모두 비우세요');
  }
  return { ok: true, value: got as IncorpTaxSetting };
}

function parseAttachments(raw: unknown): { ok: true; value: DocFormAttachment[] | null } | Fail {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (!Array.isArray(raw)) return fail('attachments', '첨부서면이 올바르지 않습니다');
  if (raw.length > DOC_FORM_ATTACHMENTS_MAX) return fail('attachments', `첨부서면은 ${DOC_FORM_ATTACHMENTS_MAX}개까지입니다`);
  const out: DocFormAttachment[] = [];
  for (const [i, item] of raw.entries()) {
    if (!isObj(item)) return fail(`attachments.${i}`, '첨부서면이 올바르지 않습니다');
    const name = typeof item.name === 'string' ? item.name.replace(/\r\n?/g, '\n').trim() : '';
    if (name === '') continue; // 규칙 4 — 이름이 빈 행은 버린다
    if (name.length > DOC_FORM_LABEL_MAX) return fail(`attachments.${i}.name`, `첨부서면 이름은 ${DOC_FORM_LABEL_MAX}자 이내로 입력하세요`);
    const c = item.copies;
    if (typeof c !== 'number' || !Number.isInteger(c) || c < 0 || c > DOC_FORM_COPIES_MAX) {
      return fail(`attachments.${i}.copies`, `통수는 0~${DOC_FORM_COPIES_MAX} 사이 정수로 입력하세요`);
    }
    out.push({ name, copies: c });
  }
  return { ok: true, value: out.length > 0 ? out : null };
}

/** 저장 본문 검사 — 규칙은 머리말 1~8. */
export function parseDocFormSettingSave(raw: unknown): { ok: true; value: DocFormSettingSave } | Fail {
  if (!isObj(raw)) return fail('body', '요청 형식이 올바르지 않습니다');
  const key = parseKey(raw);
  if (!key.ok) return key;
  const { domain, companyType } = key.value;
  const isBase = companyType === '';

  const label = text(raw.label, 'label', '표시명', DOC_FORM_LABEL_MAX);
  if (!label.ok) return label;
  if (isBase && label.value === null) return fail('label', '기본 줄의 표시명을 입력하세요');
  const formNo = text(raw.formNo, 'formNo', '양식호수', DOC_FORM_LABEL_MAX);
  if (!formNo.ok) return formNo;
  const regPurpose = text(raw.regPurpose, 'regPurpose', '등기의 목적', DOC_FORM_TEXT_MAX);
  if (!regPurpose.ok) return regPurpose;
  const regReason = text(raw.regReason, 'regReason', '등기의 사유', DOC_FORM_TEXT_MAX);
  if (!regReason.ok) return regReason;

  let matter: string | null = null;
  let matterBody: string | null = null;
  let taxes: DocFormTaxes | null = null;
  let incorpTax: IncorpTaxSetting | null = null;
  if (domain === 'corp-change') {
    const m = text(raw.matter, 'matter', '등기할 사항(제목)', DOC_FORM_TEXT_MAX);
    if (!m.ok) return m;
    const mb = text(raw.matterBody, 'matterBody', '등기할 사항(내용)', DOC_FORM_TEXT_MAX);
    if (!mb.ok) return mb;
    const t = parseFixedTaxes(raw.taxes);
    if (!t.ok) return t;
    matter = m.value;
    matterBody = mb.value;
    taxes = t.value;
  } else {
    const t = parseIncorpTax(raw.incorpTax);
    if (!t.ok) return t;
    incorpTax = t.value;
  }

  const attachments = parseAttachments(raw.attachments);
  if (!attachments.ok) return attachments;

  let isActive = true;
  if (isBase && raw.isActive !== undefined) {
    if (typeof raw.isActive !== 'boolean') return fail('isActive', '사용 여부가 올바르지 않습니다');
    isActive = raw.isActive;
  }

  return {
    ok: true,
    value: {
      ...key.value,
      label: label.value ?? '',
      formNo: formNo.value,
      regPurpose: regPurpose.value,
      regReason: regReason.value,
      matter,
      matterBody,
      isActive,
      taxes,
      incorpTax,
      attachments: attachments.value,
    },
  };
}

/** 지우기 키 — 회사유형 줄만(규칙 7). 기본 줄은 거절한다. */
export function parseDocFormSettingDeleteKey(
  raw: Record<string, unknown>,
): { ok: true; value: { domain: DocFormDomain; regTypeKey: string; companyType: string } } | Fail {
  const key = parseKey(raw);
  if (!key.ok) return key;
  if (key.value.companyType === '') return fail('companyType', '기본 줄은 지우지 않습니다 — 사용 끔으로 두세요');
  return key;
}
