/**
 * 「받기」 부르는 쪽 확인(2026-10-25) — 운영사 · 자기 회사 · 남의 회사 · 토큰 없음 · 거절 · 삐용 연결 안 됨.
 * ★ 삐용에 붙지 않는다. 내 메뉴 · 지금 계정의 단체는 대역이고, 마지막 묶음만 실제 해석(`parseMyMenus`)을 거친다.
 */
import { describe, expect, it } from 'vitest';
import { parseMyMenus } from './HttpBbiyongAuth.ts';
import { checkReceiveCaller, type ReceiveCallerDeps } from './receiveCaller.ts';
import { BbiyongUnavailableError, type MyMenusOutcome, type MyOrgOutcome } from './types.ts';

const OPERATOR: MyMenusOutcome = { kind: 'ok', screens: ['S021100010'] };
const COMPANY: MyMenusOutcome = { kind: 'ok', screens: ['S021000000'] };

function deps(menus: MyMenusOutcome | Error, org: MyOrgOutcome | Error = { kind: 'rejected' }) {
  const calls: string[] = [];
  const d: ReceiveCallerDeps = {
    myMenus: async (token) => {
      calls.push(`menus:${token}`);
      if (menus instanceof Error) throw menus;
      return menus;
    },
    myOrg: async (token) => {
      calls.push(`org:${token}`);
      if (org instanceof Error) throw org;
      return org;
    },
  };
  return { d, calls };
}

/** 대상 회사 대역 — 불렸는지 센다. */
function target(orgId: number | null) {
  let asked = 0;
  return {
    get: async () => {
      asked += 1;
      return orgId;
    },
    asked: () => asked,
  };
}

describe('checkReceiveCaller', () => {
  it('★★ 운영사 토큰 → 받음 — 지금 계정의 단체 · 대상은 묻지 않는다', async () => {
    const v = deps(OPERATOR);
    const t = target(324);
    expect(await checkReceiveCaller('Bearer a', v.d, t.get, '시험')).toBeNull();
    expect(v.calls).toEqual(['menus:a']);
    expect(t.asked()).toBe(0);
  });

  it('★★ 자기 회사 토큰 + 자기 회사 → 받음', async () => {
    const v = deps(COMPANY, { kind: 'ok', orgId: 324 });
    expect(await checkReceiveCaller('Bearer a', v.d, target(324).get, '시험')).toBeNull();
    expect(v.calls).toEqual(['menus:a', 'org:a']);
  });

  it('★★ 자기 회사 토큰 + 남의 회사 → 403 · 대상을 모르면(null) 403', async () => {
    const v = deps(COMPANY, { kind: 'ok', orgId: 324 });
    expect((await checkReceiveCaller('Bearer a', v.d, target(325).get, '시험'))?.status).toBe(403);
    expect((await checkReceiveCaller('Bearer a', v.d, target(null).get, '시험'))?.status).toBe(403);
  });

  it('★ 토큰 없음 → 403 · 삐용을 부르지 않는다', async () => {
    const v = deps(OPERATOR);
    for (const h of [undefined, '', 'Basic abc', 'Bearer ']) {
      expect((await checkReceiveCaller(h, v.d, target(324).get, '시험'))?.status).toBe(403);
    }
    expect(v.calls).toEqual([]);
  });

  it('★ 내 메뉴 거절 → 403 · 지금 계정의 단체 거절 → 403 · 대상은 묻지 않는다', async () => {
    const t = target(324);
    const menusRejected = deps({ kind: 'rejected' });
    expect((await checkReceiveCaller('Bearer a', menusRejected.d, t.get, '시험'))?.status).toBe(403);
    expect(menusRejected.calls).toEqual(['menus:a']);
    const orgRejected = deps(COMPANY, { kind: 'rejected' });
    expect((await checkReceiveCaller('Bearer a', orgRejected.d, t.get, '시험'))?.status).toBe(403);
    expect(t.asked()).toBe(0);
  });

  it('★ 삐용 연결 안 됨 → 503 — 내 메뉴에서든 지금 계정의 단체에서든', async () => {
    const down = new BbiyongUnavailableError('삐용 호출 실패');
    expect((await checkReceiveCaller('Bearer a', deps(down).d, target(324).get, '시험'))?.status).toBe(503);
    expect((await checkReceiveCaller('Bearer a', deps(COMPANY, down).d, target(324).get, '시험'))?.status).toBe(503);
  });

  it('그 밖의 예외는 그대로 던진다(503 으로 감추지 않는다)', async () => {
    await expect(checkReceiveCaller('Bearer a', deps(new Error('버그')).d, target(324).get, '시험')).rejects.toThrow('버그');
  });

  it('★★ my-menus 실물 응답 — 객체 목록 { menuCode, keys } 로도 · 옛 문자열 목록으로도 운영사가 통과한다', async () => {
    const ok = (data: unknown[]) => parseMyMenus({ status: 200, result: 'success', massage: null, data, error: [] });
    const objects = deps(ok([{ menuCode: 'S021000000', keys: [] }, { menuCode: 'S021100010', keys: ['VIEW'] }]));
    expect(await checkReceiveCaller('Bearer a', objects.d, target(null).get, '시험')).toBeNull();
    const strings = deps(ok(['S021000000', 'S021100010']));
    expect(await checkReceiveCaller('Bearer a', strings.d, target(null).get, '시험')).toBeNull();
    // 단체관리가 없는 객체 목록은 운영사가 아니다 → 지금 계정의 단체로 넘어간다
    const company = deps(ok([{ menuCode: 'S021000000', keys: [] }]), { kind: 'ok', orgId: 324 });
    expect((await checkReceiveCaller('Bearer a', company.d, target(325).get, '시험'))?.status).toBe(403);
    expect(company.calls).toEqual(['menus:a', 'org:a']);
  });
});
