/**
 * MockBbiyongAuth — 내 메뉴(법무 회사 정보 「받기」의 토큰 확인, 2026-10-23).
 */
import { describe, expect, it } from 'vitest';
import { MOCK_ACCOUNTS, MockBbiyongAuth } from './MockBbiyongAuth.ts';

// ★ 비밀번호 로그인(signIn)은 없다(규격서 Q6) — mock 토큰 = mock-access.{회원번호}.{시각}
const mockAccess = (email: string) =>
  `mock-access.${MOCK_ACCOUNTS.find((a) => a.email === email)!.memberId}.${Date.now()}`;

describe('MockBbiyongAuth.myMenus', () => {
  it('★ 운영사 계정 토큰이면 단체관리(S021100010)가 있다 · 회사 계정은 없다', async () => {
    const auth = new MockBbiyongAuth();
    expect(await auth.myMenus(mockAccess('operator@s-wontech.co.kr'))).toEqual({ kind: 'ok', screens: ['S021100010'] });
    // 회사 계정(화면 확인용, 2026-10-25)은 「내 단체 정보」와 수정 키만 — 단체관리는 없다.
    expect(await auth.myMenus(mockAccess('nontenant@test.com'))).toEqual({
      kind: 'ok',
      screens: ['S021100021'],
      keys: { S021100021: ['F002'] },
    });
    expect(await auth.myMenus(mockAccess('tenant@test.com'))).toEqual({ kind: 'ok', screens: [] });
  });
  it('mock 토큰 모양이 아니거나 없는 계정이면 rejected', async () => {
    const auth = new MockBbiyongAuth();
    expect(await auth.myMenus('eyJ.real')).toEqual({ kind: 'rejected' });
    expect(await auth.myMenus('mock-access.9999.1')).toEqual({ kind: 'rejected' });
  });
});

describe('MockBbiyongAuth.myOrg', () => {
  it('★ mock 토큰의 계정 단체(my-orgs 의 지금 계정 자리) · 모양이 아니거나 없는 계정이면 rejected', async () => {
    const auth = new MockBbiyongAuth();
    expect(await auth.myOrg(mockAccess('operator@s-wontech.co.kr'))).toEqual({ kind: 'ok', orgId: 1 });
    expect(await auth.myOrg(mockAccess('tenant@test.com'))).toEqual({ kind: 'ok', orgId: 9001 });
    expect(await auth.myOrg('eyJ.real')).toEqual({ kind: 'rejected' });
    expect(await auth.myOrg('mock-access.9999.1')).toEqual({ kind: 'rejected' });
  });
});
