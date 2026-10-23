/**
 * MockBbiyongAuth — 내 메뉴(법무 회사 정보 「받기」의 토큰 확인, 2026-10-23).
 */
import { describe, expect, it } from 'vitest';
import { MOCK_PASSWORD, MockBbiyongAuth } from './MockBbiyongAuth.ts';

describe('MockBbiyongAuth.myMenus', () => {
  it('★ 운영사 계정 토큰이면 단체관리(S021100010)가 있다 · 회사 계정은 없다', async () => {
    const auth = new MockBbiyongAuth();
    const op = await auth.signIn('operator@s-wontech.co.kr', MOCK_PASSWORD);
    const tenant = await auth.signIn('nontenant@test.com', MOCK_PASSWORD);
    expect(await auth.myMenus(op.accessToken)).toEqual({ kind: 'ok', screens: ['S021100010'] });
    expect(await auth.myMenus(tenant.accessToken)).toEqual({ kind: 'ok', screens: [] });
  });
  it('mock 토큰 모양이 아니거나 없는 계정이면 rejected', async () => {
    const auth = new MockBbiyongAuth();
    expect(await auth.myMenus('eyJ.real')).toEqual({ kind: 'rejected' });
    expect(await auth.myMenus('mock-access.9999.1')).toEqual({ kind: 'rejected' });
  });
});
