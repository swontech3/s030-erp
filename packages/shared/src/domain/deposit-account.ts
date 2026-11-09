/**
 * 입금 계좌 — 공통 코드에서 읽는다(삐용팀 지적, 2026-11-08). 소스 상수 `CONTRACT_OFFICE.BANK` · `ACCOUNT_HOLDER` 를 옮겼다.
 *
 *   분류 `DEPOSIT_ACCT`(입금 계좌) / 파티션 `000`(공통)
 *     코드값 `ACCOUNT` — 이름 「입금 계좌」 · 설명 = 은행과 계좌번호(예 `우리은행 1005-002-433395`)
 *     코드값 `HOLDER`  — 이름 「예금주」     · 설명 = 예금주(예 `㈜에스원테크`)
 *
 * ★ 값은 **설명 칸**에 있다. 이름 칸은 사람이 읽는 이름이다. 고칠 때는 코드 관리(s030100030)에서 그 줄의 「설명」을 고친다.
 * ★ 소스 기본값은 없다 — 줄이 없거나 설명이 비면 `null`, 화면은 `DEPOSIT_ACCOUNT_MISSING` 을 보인다.
 * ★ 쓰는 곳: 이용계약서 「오피스 정보」의 은행(계좌번호) · 정산서 「입금 계좌」.
 */
export const DEPOSIT_ACCOUNT_CATEGORY = 'DEPOSIT_ACCT';
export const DEPOSIT_ACCOUNT_USE_TP = '000';
export const DEPOSIT_ACCOUNT_CODE = 'ACCOUNT';
export const DEPOSIT_HOLDER_CODE = 'HOLDER';

export const DEPOSIT_ACCOUNT_MISSING = '입금 계좌가 설정되지 않았습니다';

export interface DepositAccount {
  /** 은행과 계좌번호 — 예 `우리은행 1005-002-433395`. */
  account: string;
  /** 예금주 — 예 `㈜에스원테크`. */
  holder: string;
}

/** 코드 줄에서 입금 계좌를 읽는다 — 둘 중 하나라도 없거나 설명이 비면 `null`(설정되지 않음). */
export function depositAccountOf(
  lines: readonly { category: string; code: string; description?: string | null }[],
): DepositAccount | null {
  const valueOf = (code: string) =>
    lines.find((l) => l.category === DEPOSIT_ACCOUNT_CATEGORY && l.code === code)?.description?.trim() ?? '';
  const account = valueOf(DEPOSIT_ACCOUNT_CODE);
  const holder = valueOf(DEPOSIT_HOLDER_CODE);
  if (account === '' || holder === '') return null;
  return { account, holder };
}
