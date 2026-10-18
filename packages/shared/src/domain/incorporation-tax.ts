/**
 * 법인설립(발기설립) 등기의 세금 · 수수료 — 자본금으로 계산한다(2026-10-14). 순수 함수.
 *
 * ★ 세율 · 최소액 · 중과 배수 · 수수료는 **등기 설정**(`tb_s080_doc_form_settings` 발기설립 줄의 `taxes`)
 *   에 있다(결정 2026-10-18 — 090 화면에서 고친다). 이 파일은 계산식만 갖는다. 설정이 비면 세금 칸은 빈칸.
 *
 *   등록면허세   = 자본금 × n/1000, 최소액 이상. 대도시 중과면 (최소액을 적용한 값) × 배수
 *   지방교육세   = 등록면허세 × n/100
 *   세액합계     = 등록면허세 + 지방교육세   (농어촌특별세 칸은 빈칸 — 계산하지 않는다)
 *   등기신청수수료 = 설정 값
 *   끝수         = 등록면허세 · 지방교육세 각각 10원 미만 버림
 *
 * ★ 과세표준은 「납입한 주식금액」이다 — 발기설립은 전액 납입이라 자본금을 쓴다(작성완료 때
 *   자본금 = 1주의 금액 × 설립 때 발행 주식 수를 검증한다, `validateIncorporation`).
 * ★ 대도시 중과 여부는 사람이 정한다 — 설립 정보의 「대도시 중과」 체크. 비어 있으면(사람이 고치지
 *   않았으면) 본점 시·도가 서울특별시일 때만 중과로 본다(`metroSurchargeOf`). 지역 목록은 두지 않는다
 *   (결정 2026-10-14 — 서울 밖 과밀억제권역 · 산업단지 · 중과 제외 업종은 사람이 고친다).
 */
import { sidoOf } from './korea-sido.ts';

/**
 * 설립 세금 설정 — 등기 설정 발기설립 줄의 `taxes`(jsonb). 다섯 칸 모두 0 이상 정수.
 * 2026-10-14 의 값은 등록면허세율 4 · 최소액 112,500 · 배수 3 · 교육세율 20 · 수수료 35,000 이다.
 */
export interface IncorpTaxSetting {
  /**
   * 등록면허세율 「1,000분의 n」 — 지방세법 제28조 ①6호 가목1) 「납입한 주식금액…의 1천분의 4」.
   * 분자만 둔다(소수 오차).
   */
  regLicenseRate: number;
  /** 최소 등록면허세 — 같은 목 괄호 「세액이 11만2천5백원 미만인 때에는 11만2천5백원으로 한다」. */
  regLicenseMin: number;
  /**
   * 대도시 중과 배수 — 지방세법 제28조 ② 「…11만2천500원 미만일 때에는 11만2천500원으로 한다)의 100분의 300」.
   * 최소액을 적용한 뒤에 곱한다(법제처 해석 — 최소 337,500원). 「대도시」는 같은 법 제13조 ②(수도권정비계획법
   * 제6조의 과밀억제권역, 산업집적법을 적용받는 산업단지는 제외). 단서의 대도시 중과 제외 업종은 중과하지 않는다.
   */
  metroMultiplier: number;
  /** 지방교육세율 「100분의 n」 — 지방세법 제151조 ①2호 「…등록면허세액의 100분의 20」. */
  localEduRate: number;
  /** 등기신청수수료 — 등기사항증명서 등 수수료규칙 제5조의3 ① 설립등기 서면신청(2025-08-01 시행). */
  regFee: number;
}

/** 칸 이름 — `taxes` jsonb 의 키이자 저장 검사 순서. */
export const INCORP_TAX_KEYS = ['regLicenseRate', 'regLicenseMin', 'metroMultiplier', 'localEduRate', 'regFee'] as const;

/** 등록면허세율 분모(1,000분의 n) · 지방교육세율 분모(100분의 n). 설정은 분자만 갖는다. */
const REG_LICENSE_RATE_DEN = 1000;
const LOCAL_EDU_RATE_DEN = 100;

/** 끝수 — 10원 미만 버림(결정 2026-10-14). */
export const TAX_ROUND_UNIT = 10;

/** 대도시 중과 기본값 — 본점 시·도가 서울특별시면 중과(결정 2026-10-14). */
export const METRO_DEFAULT_SIDO = '서울특별시';

const floorUnit = (n: number) => Math.floor(n / TAX_ROUND_UNIT) * TAX_ROUND_UNIT;

/**
 * 저장된 `taxes` 를 설립 세금 설정으로 읽는다. 다섯 칸이 모두 0 이상 정수가 아니면 null(세금 칸 빈칸).
 * ★ 모양을 믿지 않는다 — 090 이 다섯 칸을 함께 저장하지만, 손으로 고친 값일 수 있다.
 */
export function readIncorpTaxSetting(raw: unknown): IncorpTaxSetting | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const out = {} as IncorpTaxSetting;
  for (const k of INCORP_TAX_KEYS) {
    const v = o[k];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return null;
    out[k] = v;
  }
  return out;
}

/**
 * 이 건의 대도시 중과 여부 — 사람이 체크했으면 그 값, 비어 있으면 본점 시·도가 서울이면 true.
 * @param stored 설립 정보의 「대도시 중과」(null = 사람이 고치지 않았다)
 */
export function metroSurchargeOf(stored: boolean | null | undefined, hqAddress: string | null | undefined): boolean {
  if (stored === true || stored === false) return stored;
  return sidoOf(hqAddress) === METRO_DEFAULT_SIDO;
}

export interface IncorporationTax {
  regLicense: number;
  localEdu: number;
  total: number;
  regFee: number;
}

/**
 * 세금 · 수수료. 자본금이 없거나 0 이하면 null, 설정이 없으면 null(서류의 세금 칸은 빈칸).
 * @param setting 등기 설정의 설립 세금(`readIncorpTaxSetting`)
 */
export function incorporationTax(
  capitalAmount: number | null | undefined,
  metroSurcharge: boolean,
  setting: IncorpTaxSetting | null,
): IncorporationTax | null {
  if (!setting) return null;
  if (typeof capitalAmount !== 'number' || !Number.isFinite(capitalAmount) || capitalAmount <= 0) return null;
  const base = Math.max((capitalAmount * setting.regLicenseRate) / REG_LICENSE_RATE_DEN, setting.regLicenseMin);
  const regLicense = floorUnit(metroSurcharge ? base * setting.metroMultiplier : base);
  const localEdu = floorUnit((regLicense * setting.localEduRate) / LOCAL_EDU_RATE_DEN);
  return { regLicense, localEdu, total: regLicense + localEdu, regFee: setting.regFee };
}
