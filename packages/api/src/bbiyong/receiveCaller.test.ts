/**
 * 「받기」 부르는 쪽 확인(2026-10-25) — 운영사 · 자기 회사 · 남의 회사 · 토큰 없음 · 거절 · 삐용 연결 안 됨.
 * ★ 삐용에 붙지 않는다. 내 메뉴 · 지금 계정의 단체는 대역이고, 마지막 묶음만 실제 해석(`parseMyMenus`)을 거친다.
 */
import { describe, expect, it } from 'vitest';
import { parseMyMenuKeys, parseMyMenus } from './HttpBbiyongAuth.ts';
import { checkReceiveCaller, type ReceiveCallerDeps } from './receiveCaller.ts';
import { BbiyongUnavailableError, type MyMenusOutcome, type MyOrgOutcome } from './types.ts';

/** 운영사 — 단체관리(S021100010)와 그 수정 키 F002(2026-11-08 좁힘). */
const OPERATOR: MyMenusOutcome = { kind: 'ok', screens: ['S021100010'], keys: { S021100010: ['F002'] } };
/** 단체관리가 「보기」뿐 — 운영사가 아니다. */
const VIEW_ONLY: MyMenusOutcome = { kind: 'ok', screens: ['S021100010'], keys: { S021100010: ['F001'] } };
/** 공통 코드 BBIYONG_EDIT_GRANT / OPERATOR 줄 이름(대역). */
const OPERATOR_GRANT = 'S021100010:F002';
const COMPANY: MyMenusOutcome = { kind: 'ok', screens: ['S021000000'] };

function deps(
  menus: MyMenusOutcome | Error,
  org: MyOrgOutcome | Error = { kind: 'rejected' },
  operatorGrant: string | null = OPERATOR_GRANT,
) {
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
    operatorGrantName: async () => operatorGrant,
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

  it('★★ my-menus 실물 응답 — 객체 목록에 단체관리 F002 면 운영사 · 키 없는 옛 문자열 목록은 운영사가 아니다(2026-11-08)', async () => {
    const body = (data: unknown[]) => ({ status: 200, result: 'success', massage: null, data, error: [] });
    /** 어댑터(`HttpBbiyongAuth.myMenus`)와 같은 조립 — 화면 목록 + 키. */
    const real = (data: unknown[]): MyMenusOutcome => {
      const out = parseMyMenus(body(data));
      const keys = out.kind === 'ok' ? parseMyMenuKeys(body(data)) : null;
      return out.kind === 'ok' && keys ? { ...out, keys } : out;
    };
    const objects = deps(real([{ menuCode: 'S021000000', keys: [] }, { menuCode: 'S021100010', keys: ['F001', 'F002'] }]));
    expect(await checkReceiveCaller('Bearer a', objects.d, target(null).get, '시험')).toBeNull();
    expect(objects.calls).toEqual(['menus:a']);
    // 단체관리가 보기(F001)뿐 → 운영사가 아니다 → 지금 계정의 단체로 넘어간다
    const viewOnly = deps(real([{ menuCode: 'S021100010', keys: ['F001'] }]), { kind: 'ok', orgId: 324 });
    expect((await checkReceiveCaller('Bearer a', viewOnly.d, target(325).get, '시험'))?.status).toBe(403);
    expect(viewOnly.calls).toEqual(['menus:a', 'org:a']);
    // 옛 문자열 목록(키 없음) → 운영사로 보지 않는다(안전한 쪽)
    const strings = deps(real(['S021000000', 'S021100010']), { kind: 'ok', orgId: 324 });
    expect((await checkReceiveCaller('Bearer a', strings.d, target(325).get, '시험'))?.status).toBe(403);
    expect(strings.calls).toEqual(['menus:a', 'org:a']);
    // 단체관리가 없는 객체 목록도 운영사가 아니다
    const company = deps(real([{ menuCode: 'S021000000', keys: [] }]), { kind: 'ok', orgId: 324 });
    expect((await checkReceiveCaller('Bearer a', company.d, target(325).get, '시험'))?.status).toBe(403);
    expect(company.calls).toEqual(['menus:a', 'org:a']);
  });

  it('★★ 단체관리 보기만 → 운영사가 아니다: 자기 회사 규칙에 걸리면 받음 · 아니면 403(2026-11-08)', async () => {
    const own = deps(VIEW_ONLY, { kind: 'ok', orgId: 324 });
    expect(await checkReceiveCaller('Bearer a', own.d, target(324).get, '시험')).toBeNull();
    expect(own.calls).toEqual(['menus:a', 'org:a']);
    const other = deps(VIEW_ONLY, { kind: 'ok', orgId: 324 });
    expect((await checkReceiveCaller('Bearer a', other.d, target(325).get, '시험'))?.status).toBe(403);
    const unknown = deps(VIEW_ONLY, { kind: 'ok', orgId: 324 });
    expect((await checkReceiveCaller('Bearer a', unknown.d, target(null).get, '시험'))?.status).toBe(403);
  });

  it('★ 운영사 키 코드 줄이 없거나 모양이 틀리면 아무도 운영사가 아니다 — F002 가 있어도 다음 규칙으로', async () => {
    for (const grant of [null, '', 'S021100010', 'S021100010:F002:X']) {
      const v = deps(OPERATOR, { kind: 'ok', orgId: 324 }, grant);
      expect((await checkReceiveCaller('Bearer a', v.d, target(325).get, '시험'))?.status).toBe(403);
      expect(v.calls).toEqual(['menus:a', 'org:a']);
    }
  });

  it('★ 키 값은 코드 줄을 따른다 — 코드 줄이 다른 키를 가리키면 그 키로 판정', async () => {
    const v = deps(VIEW_ONLY, { kind: 'rejected' }, 'S021100010:F001');
    expect(await checkReceiveCaller('Bearer a', v.d, target(null).get, '시험')).toBeNull();
  });
});
