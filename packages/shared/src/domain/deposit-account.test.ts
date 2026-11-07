import { describe, expect, it } from 'vitest';
import { DEPOSIT_ACCOUNT_CATEGORY, depositAccountOf } from './deposit-account';

const line = (code: string, description: string | null, category = DEPOSIT_ACCOUNT_CATEGORY) => ({ category, code, description });

describe('입금 계좌(공통 코드 DEPOSIT_ACCT)', () => {
  it('설명 칸의 값을 읽는다 — 앞뒤 공백은 버린다', () => {
    expect(depositAccountOf([line('ACCOUNT', ' 우리은행 1005-002-433395 '), line('HOLDER', '㈜에스원테크')])).toEqual({
      account: '우리은행 1005-002-433395',
      holder: '㈜에스원테크',
    });
  });
  it('줄이 없거나 설명이 비면 설정되지 않음(null) — 소스 기본값 없음', () => {
    expect(depositAccountOf([])).toBeNull();
    expect(depositAccountOf([line('ACCOUNT', '우리은행 1')])).toBeNull();
    expect(depositAccountOf([line('ACCOUNT', '우리은행 1'), line('HOLDER', '  ')])).toBeNull();
    expect(depositAccountOf([line('ACCOUNT', null), line('HOLDER', '가')])).toBeNull();
  });
  it('다른 분류의 같은 코드값은 보지 않는다', () => {
    expect(depositAccountOf([line('ACCOUNT', 'x', 'OTHER'), line('HOLDER', 'y', 'OTHER')])).toBeNull();
  });
});
