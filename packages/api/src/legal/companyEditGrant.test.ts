/**
 * 비입주사 법무 회사 정보를 고칠 수 있는 사람(2026-10-25) — 운영사 · 「내 단체 정보」 수정 키가 있는 회사 사용자.
 * ★ DB · 삐용에 붙지 않는다. 코드 줄 이름과 내 메뉴는 대역이다.
 */
import { describe, expect, it } from 'vitest';
import type { ErpSession, ScopeRole } from '@swonbiz/shared';
import { BbiyongUnavailableError, type MyMenusOutcome } from '../bbiyong/types.ts';
import { canEditLegalCompany, hasEditGrant, parseEditGrant, type CompanyEditorDeps } from './companyEditGrant.ts';

const session = (role: ScopeRole): ErpSession =>
  ({ erpSid: 'sid-hash', s020MemberId: 1, s020OrgId: role === 'operator' ? 1 : 9003, role }) as ErpSession;

const GRANT = 'S021100021:F002';
const WITH_F002: MyMenusOutcome = { kind: 'ok', screens: ['S021100021'], keys: { S021100021: ['F001', 'F002'] } };
const READ_ONLY: MyMenusOutcome = { kind: 'ok', screens: ['S021100021'], keys: { S021100021: ['F001'] } };

function deps(name: string | null, menus: MyMenusOutcome | Error): CompanyEditorDeps & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    grantName: async () => {
      asked.push('grant');
      return name;
    },
    myMenus: async () => {
      asked.push('menus');
      if (menus instanceof Error) throw menus;
      return menus;
    },
  };
}

describe('parseEditGrant', () => {
  it('「화면코드:키」 — 앞뒤 공백은 무시 · 모양이 틀리면 null', () => {
    expect(parseEditGrant(GRANT)).toEqual({ screen: 'S021100021', key: 'F002' });
    expect(parseEditGrant(' S021100021 : F002 ')).toEqual({ screen: 'S021100021', key: 'F002' });
    for (const bad of ['S021100021', 'S021100021:', ':F002', 'S021100021:F002:X', '', null, undefined]) {
      expect(parseEditGrant(bad), String(bad)).toBeNull();
    }
  });
});

describe('hasEditGrant', () => {
  const grant = { screen: 'S021100021', key: 'F002' };
  it('그 화면에 그 키가 있어야 한다 — 다른 화면의 F002 · 키 없는 옛 모양 · 거절은 아니다', () => {
    expect(hasEditGrant(WITH_F002, grant)).toBe(true);
    expect(hasEditGrant(READ_ONLY, grant)).toBe(false);
    expect(hasEditGrant({ kind: 'ok', screens: ['S021100010'], keys: { S021100010: ['F002'] } }, grant)).toBe(false);
    expect(hasEditGrant({ kind: 'ok', screens: ['S021100021'] }, grant)).toBe(false);
    expect(hasEditGrant({ kind: 'rejected' }, grant)).toBe(false);
  });
});

describe('canEditLegalCompany', () => {
  it('★ 운영사 — 코드도 삐용도 묻지 않고 연다', async () => {
    const d = deps(null, new Error('부르면 안 된다'));
    expect(await canEditLegalCompany(session('operator'), d)).toBe(true);
    expect(d.asked).toEqual([]);
  });
  it('★★ 회사 사용자 — 코드 줄의 화면에 수정 키(F002)가 있으면 연다 · 없으면 닫는다', async () => {
    expect(await canEditLegalCompany(session('tenant'), deps(GRANT, WITH_F002))).toBe(true);
    expect(await canEditLegalCompany(session('tenant'), deps(GRANT, READ_ONLY))).toBe(false);
    expect(await canEditLegalCompany(session('tenant'), deps(GRANT, { kind: 'rejected' }))).toBe(false);
  });
  it('★ 코드 줄이 없거나 모양이 틀리면 닫는다 — 삐용은 부르지 않는다', async () => {
    for (const name of [null, 'F002']) {
      const d = deps(name, WITH_F002);
      expect(await canEditLegalCompany(session('tenant'), d)).toBe(false);
      expect(d.asked).toEqual(['grant']);
    }
  });
  it('★ 삐용에 붙지 못하면 닫는다 · 그 밖의 오류(재로그인 등)는 그대로 던진다', async () => {
    expect(await canEditLegalCompany(session('tenant'), deps(GRANT, new BbiyongUnavailableError('연결 안 됨')))).toBe(false);
    await expect(canEditLegalCompany(session('tenant'), deps(GRANT, new Error('재로그인')))).rejects.toThrow('재로그인');
  });
});
