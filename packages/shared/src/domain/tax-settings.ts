/**
 * 세무(S05) 세무 설정(s050100010) — 저장 본문 해석 · 검사와 응답 모양.
 *
 * 표는 201 의 둘이다 — `tb_s050_settings`(회사당 1줄) · `tb_s050_fin_accounts`(계좌 · 카드, 구분 B · C).
 * [저장] 한 번에 화면 전체를 보낸다(`PUT /tax/settings`).
 *
 * ★★ 선택지는 **코드 표에서** 읽는다 — 사업자 유형 · 원천세 주기 · 자료 종류 · 은행 · 카드사가 맞는
 *    코드값인지는 부르는 쪽이 읽어 온 코드값(`TaxCodeSets`)으로 본다. 여기에 코드값 목록을 박지 않는다.
 *    예외는 구분 B · C 하나다 — 201 의 번호 검사(DB CHECK)가 그 값에 기댄다(고정 코드).
 * ★ 틀린 칸은 **모두** 알린다(칸마다 하나) — 화면이 빨간 테두리 N곳을 그린다(08 S05-11 [저장]).
 * ★ 세무사 메일: 이름 · 역할은 선택, 메일은 필수. 둘 다 빈 줄은 버리고, 버린 뒤 3개까지.
 *   「최대 3」은 여기(서버)만 본다 — DB 는 강제하지 않는다(201).
 * ★ 계좌번호는 숫자와 `-` 를 받아 **숫자만** 저장한다. 카드는 끝 4자리뿐이다.
 */
import { digitsOnly, isAccountNumberInput, isCardLast4, isEmailShape } from './tax-number.ts';

/** 세무 코드는 모두 공통 파티션 하나다(202). */
export const TAX_CODE_USE_TP = '000';
export const TAX_BIZ_TP_CATEGORY = 'TAX_BIZ_TP';
export const TAX_WH_CYCLE_CATEGORY = 'TAX_WH_CYCLE';
export const TAX_KIND_CATEGORY = 'TAX_KIND';
export const TAX_FIN_KIND_CATEGORY = 'TAX_FIN_KIND';
export const BANK_CATEGORY = 'BANK';
export const CARD_COMPANY_CATEGORY = 'CARD_COMPANY';

/** 구분 — 은행(B) · 카드(C). ★ 고정 코드(code-usage.ts `PINNED_CODES`) — 201 번호 검사가 기댄다. */
export const TAX_FIN_KIND_BANK = 'B';
export const TAX_FIN_KIND_CARD = 'C';
export type TaxFinKind = typeof TAX_FIN_KIND_BANK | typeof TAX_FIN_KIND_CARD;

/** 원천세 신고 주기 기본값 — 201 의 칸 기본값(`DEFAULT 'M'`)과 같다. 설정 줄이 아직 없을 때 보여 준다. */
export const TAX_WH_CYCLE_DEFAULT = 'M';

export const TAX_EMAILS_MAX = 3;
const EMAIL_NAME_MAX = 100;
const EMAIL_MAX = 254;
/** 201 `alias varchar(50)`. */
const ALIAS_MAX = 50;

/** 코드 표에서 읽은 「살아 있는」 코드값 — 본문 검사에 쓴다. */
export interface TaxCodeSets {
  bizTypes: readonly string[];
  withholdingCycles: readonly string[];
  kinds: readonly string[];
  banks: readonly string[];
  cardCompanies: readonly string[];
}

export interface TaxEmail {
  /** 이름 · 역할 — 선택. */
  name: string | null;
  email: string;
}

export interface TaxFinAccountSave {
  /** 있는 줄이면 그 id, 새 줄이면 null. */
  id: string | null;
  kind: TaxFinKind;
  bankCode: string | null;
  cardCoCode: string | null;
  /** 숫자만 — B 계좌번호 10~14자리 · C 끝 4자리. */
  number: string;
  alias: string | null;
  isActive: boolean;
}

export interface TaxSettingsSave {
  bizType: string;
  withholdingCycle: string;
  taxEmails: TaxEmail[];
  unusedKinds: string[];
  /** 계좌 · 카드 — 보낸 순서가 화면 순서다. 빠진 줄은 지운다. */
  finAccounts: TaxFinAccountSave[];
}

export interface TaxFieldError {
  field: string;
  message: string;
}

export type TaxSettingsParsed = { ok: true; value: TaxSettingsSave } | { ok: false; errors: TaxFieldError[] };

// =============================================================================
// 응답 모양 — GET · PUT /tax/settings
// =============================================================================

export interface TaxCodeOption {
  code: string;
  name: string;
  /** 코드 표의 설명 칸 — 원천세 주기의 안내 문구 등. 없으면 null. */
  description: string | null;
}

export interface TaxFinAccountView {
  id: string;
  kind: TaxFinKind;
  bankCode: string | null;
  cardCoCode: string | null;
  number: string;
  alias: string | null;
  isActive: boolean;
  sortOrder: number;
}

/**
 * 회사 기본정보 — 보기만 한다. 어디서 읽었는지(`source`)를 함께 준다.
 *   · `tenant` ERP 입주사 표 · `legal` 법무 비입주사 회사 정보 · `none` 둘 다 없음(회사명만 세션 값)
 * ★ 번호는 숫자만이다(세무 규칙). 없으면 null.
 */
export interface TaxCompanyInfo {
  source: 'tenant' | 'legal' | 'none';
  name: string | null;
  bizNumber: string | null;
  corpNumber: string | null;
}

export interface TaxSettingsResponse {
  settings: {
    /** 설정 줄이 저장돼 있는가 — false 면 아래 값은 처음 상태다. */
    saved: boolean;
    bizType: string | null;
    withholdingCycle: string;
    taxEmails: TaxEmail[];
    unusedKinds: string[];
  };
  finAccounts: TaxFinAccountView[];
  codes: {
    bizTypes: TaxCodeOption[];
    withholdingCycles: TaxCodeOption[];
    kinds: TaxCodeOption[];
    finKinds: TaxCodeOption[];
    banks: TaxCodeOption[];
    cardCompanies: TaxCodeOption[];
  };
  company: TaxCompanyInfo;
}

// =============================================================================
// 해석
// =============================================================================

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 글자 칸 — 없음(undefined · null)은 ''. 글자가 아니면 null(형식 오류). 앞뒤 공백은 뗀다. */
const textOf = (v: unknown): string | null => {
  if (v === undefined || v === null) return '';
  return typeof v === 'string' ? v.trim() : null;
};

function parseEmails(raw: unknown, errors: TaxFieldError[]): TaxEmail[] {
  if (!Array.isArray(raw)) {
    errors.push({ field: 'taxEmails', message: '세무사 메일 형식이 올바르지 않습니다' });
    return [];
  }
  const kept: { row: TaxEmail; index: number }[] = [];
  raw.forEach((item, i) => {
    const name = textOf(isObj(item) ? item.name : undefined);
    const email = textOf(isObj(item) ? item.email : undefined);
    if (!isObj(item) || name === null || email === null) {
      errors.push({ field: `taxEmails[${i}]`, message: '세무사 메일 형식이 올바르지 않습니다' });
      return;
    }
    if (name === '' && email === '') return; // 둘 다 빈 줄은 버린다
    kept.push({ row: { name: name === '' ? null : name, email }, index: i });
  });
  if (kept.length > TAX_EMAILS_MAX) {
    errors.push({ field: 'taxEmails', message: `세무사 메일은 ${TAX_EMAILS_MAX}개까지입니다` });
    return [];
  }
  for (const { row, index } of kept) {
    if (row.name !== null && row.name.length > EMAIL_NAME_MAX) {
      errors.push({ field: `taxEmails[${index}].name`, message: `이름 · 역할은 ${EMAIL_NAME_MAX}자 이내입니다` });
    }
    if (row.email === '') {
      errors.push({ field: `taxEmails[${index}].email`, message: '메일을 입력하세요' });
    } else if (row.email.length > EMAIL_MAX || !isEmailShape(row.email)) {
      errors.push({ field: `taxEmails[${index}].email`, message: '메일은 name@example.com 모양입니다' });
    }
  }
  return kept.map((k) => k.row);
}

function parseFinAccounts(raw: unknown, codes: TaxCodeSets, errors: TaxFieldError[]): TaxFinAccountSave[] {
  if (!Array.isArray(raw)) {
    errors.push({ field: 'finAccounts', message: '계좌 · 카드 형식이 올바르지 않습니다' });
    return [];
  }
  const out: TaxFinAccountSave[] = [];
  const seenIds = new Set<string>();
  raw.forEach((item, i) => {
    const at = (f: string) => `finAccounts[${i}].${f}`;
    if (!isObj(item)) {
      errors.push({ field: `finAccounts[${i}]`, message: '계좌 · 카드 형식이 올바르지 않습니다' });
      return;
    }
    const before = errors.length;

    let id: string | null = null;
    if (item.id !== undefined && item.id !== null) {
      if (typeof item.id !== 'string' || item.id.trim() === '') {
        errors.push({ field: at('id'), message: '계좌 · 카드 id 가 올바르지 않습니다' });
      } else if (seenIds.has(item.id)) {
        errors.push({ field: at('id'), message: '같은 계좌 · 카드가 두 번 왔습니다' });
      } else {
        id = item.id;
        seenIds.add(item.id);
      }
    }

    const kind = item.kind;
    if (kind !== TAX_FIN_KIND_BANK && kind !== TAX_FIN_KIND_CARD) {
      errors.push({ field: at('kind'), message: '구분은 은행 · 카드 중 하나입니다' });
      return;
    }
    const isBank = kind === TAX_FIN_KIND_BANK;

    // 구분에 맞는 기관 코드 칸만 — 제 칸이 비었으면 그것만, 아니면 남의 칸이 차 있는지 본다
    const bankCode = textOf(item.bankCode);
    const cardCoCode = textOf(item.cardCoCode);
    const own = isBank ? bankCode : cardCoCode;
    const ownField = isBank ? 'bankCode' : 'cardCoCode';
    const other = isBank ? cardCoCode : bankCode;
    const allowed = isBank ? codes.banks : codes.cardCompanies;
    if (own === null || own === '') {
      errors.push({ field: at(ownField), message: isBank ? '은행을 고르세요' : '카드사를 고르세요' });
    } else if (!allowed.includes(own)) {
      errors.push({ field: at(ownField), message: isBank ? '없는 은행입니다' : '없는 카드사입니다' });
    } else if (other !== '') {
      errors.push({
        field: at(isBank ? 'cardCoCode' : 'bankCode'),
        message: isBank ? '은행 계좌에는 카드사를 넣지 않습니다' : '카드에는 은행을 넣지 않습니다',
      });
    }

    const rawNumber = textOf(item.number);
    const numberOk = rawNumber !== null && (isBank ? isAccountNumberInput(rawNumber) : isCardLast4(rawNumber));
    if (!numberOk) {
      errors.push({
        field: at('number'),
        message: isBank ? '계좌번호는 숫자와 - 만(숫자 10~14자리)입니다' : '카드는 끝 4자리 숫자입니다',
      });
    }

    const alias = textOf(item.alias);
    if (alias === null || alias.length > ALIAS_MAX) {
      errors.push({ field: at('alias'), message: `별칭은 ${ALIAS_MAX}자 이내의 글자입니다` });
    }

    let isActive = true;
    if (item.isActive !== undefined) {
      if (typeof item.isActive !== 'boolean') errors.push({ field: at('isActive'), message: '사용 여부가 올바르지 않습니다' });
      else isActive = item.isActive;
    }

    if (errors.length > before) return;
    out.push({
      id,
      kind,
      bankCode: isBank ? own : null,
      cardCoCode: isBank ? null : own,
      number: digitsOnly(rawNumber!),
      alias: alias === '' ? null : alias,
      isActive,
    });
  });
  return out;
}

function parseUnusedKinds(raw: unknown, codes: TaxCodeSets, errors: TaxFieldError[]): string[] {
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== 'string' || !codes.kinds.includes(v))) {
    errors.push({ field: 'unusedKinds', message: '쓰지 않는 자료에 없는 자료 종류가 있습니다' });
    return [];
  }
  return [...new Set(raw as string[])];
}

/** 저장 본문 → 저장할 값. 코드값은 부르는 쪽이 코드 표에서 읽어 준 것으로 본다. */
export function parseTaxSettingsSave(raw: unknown, codes: TaxCodeSets): TaxSettingsParsed {
  if (!isObj(raw)) return { ok: false, errors: [{ field: 'body', message: '요청 형식이 올바르지 않습니다' }] };
  const errors: TaxFieldError[] = [];

  const bizType = textOf(raw.bizType);
  if (bizType === null || bizType === '') errors.push({ field: 'bizType', message: '사업자 유형을 고르세요' });
  else if (!codes.bizTypes.includes(bizType)) errors.push({ field: 'bizType', message: '없는 사업자 유형입니다' });

  const withholdingCycle = textOf(raw.withholdingCycle);
  if (withholdingCycle === null || !codes.withholdingCycles.includes(withholdingCycle)) {
    errors.push({ field: 'withholdingCycle', message: '원천세 신고 주기를 고르세요' });
  }

  const taxEmails = parseEmails(raw.taxEmails, errors);
  const finAccounts = parseFinAccounts(raw.finAccounts, codes, errors);
  const unusedKinds = parseUnusedKinds(raw.unusedKinds, codes, errors);

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { bizType: bizType!, withholdingCycle: withholdingCycle!, taxEmails, unusedKinds, finAccounts },
  };
}
