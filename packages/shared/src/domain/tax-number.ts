/**
 * 세무(S05) 번호 규칙 — 사업자번호 · 법인번호 · 계좌번호 · 카드 끝 4자리 · 메일 모양.
 *
 * ★★ 세무는 사업자번호 · 법인번호를 **숫자만** 저장하고 주고받는다(결정 2026-10-25). 하이픈은 화면이
 *    보여 줄 때만 붙인다. 10 · 13자리 검사는 한국 회사에만 쓴다 — 부르는 쪽이 가린다.
 * ★ 사업자번호 끝자리 검증 번호가 틀려도 **막지 않는다**(경고만). 그래서 자리수 검사와 따로 둔다.
 * ★ ERP 의 `biz-number-check.ts`(`isBizNumberFormatOk`)는 건드리지 않는다 — 입주사 화면이 쓰는 것이다.
 */

/** 숫자만 남긴다 — 하이픈 · 공백 등은 모두 뗀다. */
export function digitsOnly(v: string): string {
  return v.replace(/\D/g, '');
}

/** 사업자번호 — 숫자 10자리(숫자만 받은 값). */
export function isBizNumberLength(digits: string): boolean {
  return /^\d{10}$/.test(digits);
}

/** 법인번호 — 숫자 13자리(숫자만 받은 값). */
export function isCorpNumberLength(digits: string): boolean {
  return /^\d{13}$/.test(digits);
}

/** 화면 표시용 — 사업자번호 `000-00-00000`. 숫자 10자리가 아니면 받은 그대로. 저장은 숫자만이다. */
export function formatBizNumber(digits: string): string {
  return isBizNumberLength(digits) ? `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}` : digits;
}

/** 화면 표시용 — 법인번호 `000000-0000000`. 숫자 13자리가 아니면 받은 그대로. */
export function formatCorpNumber(digits: string): string {
  return isCorpNumberLength(digits) ? `${digits.slice(0, 6)}-${digits.slice(6)}` : digits;
}

/** 끝자리 검증 가중치 — 국세청 사업자등록번호 규칙. */
const BIZ_CHECK_WEIGHTS = [1, 3, 7, 1, 3, 7, 1, 3, 5] as const;

/**
 * 사업자번호 끝자리 검증 번호가 맞는가 — **경고용**(틀려도 저장은 막지 않는다).
 * 숫자 10자리가 아니면 false.
 */
export function isBizNumberChecksumOk(digits: string): boolean {
  if (!isBizNumberLength(digits)) return false;
  const d = [...digits].map(Number);
  let sum = 0;
  for (let i = 0; i < BIZ_CHECK_WEIGHTS.length; i++) sum += d[i]! * BIZ_CHECK_WEIGHTS[i]!;
  sum += Math.floor((d[8]! * 5) / 10);
  return (10 - (sum % 10)) % 10 === d[9];
}

/** 계좌번호 입력 — 숫자와 `-` 만, 숫자 10~14자리. 저장은 `digitsOnly` 로 숫자만. */
export function isAccountNumberInput(v: string): boolean {
  if (!/^[\d-]+$/.test(v)) return false;
  const n = digitsOnly(v).length;
  return n >= 10 && n <= 14;
}

/** 카드 — 끝 4자리 숫자만. 카드 전체 번호는 받지 않는다. */
export function isCardLast4(v: string): boolean {
  return /^\d{4}$/.test(v);
}

/** 메일 — `name@example.com` 모양(시안과 같은 검사). */
export function isEmailShape(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}
