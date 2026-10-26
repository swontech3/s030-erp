/**
 * 입주사 직원 정보 「받기」(삐용 → ERP, 2026-10-23) — 칸 고르기 · 토큰 확인 · 결과.
 * ★ DB · 삐용에 붙지 않는다. 내 메뉴와 쓰기는 대역이다. 실제 쓰기 SQL 은 `routes/companyReceive.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { MyMenusOutcome, MyOrgOutcome } from '../bbiyong/types.ts';
import type { MemberFromBbiyong } from '../db/companies.ts';
import { parseMemberReceiveBody, receiveMember, type MemberReceiveDeps } from './memberReceive.ts';

const OK_MENUS: MyMenusOutcome = { kind: 'ok', screens: ['S021100010'] };
/** 회사 계정 — 단체관리 없음 · 대역 코드 줄(MEMBER_SELF = S021100031:F003)의 화면 · 키 있음. */
const KEYED: MyMenusOutcome = { kind: 'ok', screens: ['S021100031'], keys: { S021100031: ['F003'] } };

/** 회사 계정 — 단체관리 없음 · 대역 코드 줄(ORG_SELF = S021100021:F002)의 화면 · 키만 있음. */
const ORG_KEYED: MyMenusOutcome = { kind: 'ok', screens: ['S021100021'], keys: { S021100021: ['F002'] } };

/**
 * 직원 851 은 단체 324 의 입주사 직원(대표 아님), 853 은 단체 324 의 활성 대표다(대역).
 * 852 는 ERP 에 있지만 회사에 단체 ID 가 없다. 그 밖은 없다.
 */
const ORG_OF_MEMBER: Record<number, { orgId: number | null; representative: boolean }> = {
  851: { orgId: 324, representative: false },
  852: { orgId: null, representative: false },
  853: { orgId: 324, representative: true },
};

function deps(
  menus: MyMenusOutcome = OK_MENUS,
  result: 'applied' | 'not_found' | 'email_taken' = 'applied',
  org: MyOrgOutcome = { kind: 'rejected' },
  grantName: string | null = 'S021100031:F003',
  orgGrantName: string | null = null,
) {
  const applied: { memberId: number; fields: MemberFromBbiyong }[] = [];
  const asked: number[] = [];
  const d: MemberReceiveDeps = {
    myMenus: async () => menus,
    myOrg: async () => org,
    orgOfMember: async (memberId) => {
      asked.push(memberId);
      return memberId in ORG_OF_MEMBER ? ORG_OF_MEMBER[memberId]! : 'not_found';
    },
    memberGrantName: async () => grantName,
    orgGrantName: async () => orgGrantName,
    apply: async (memberId, fields) => {
      applied.push({ memberId, fields });
      return result;
    },
  };
  return { d, applied, asked };
}

describe('parseMemberReceiveBody', () => {
  it('★★ 이름 · 이메일 · 연락처만 — 연락처는 숫자로 받아 하이픈 모양으로 · 단체 ID · 코드는 보지 않는다', () => {
    expect(
      parseMemberReceiveBody({ memberId: 851, orgId: 324, orgCode: 'Z04', memberName: ' 최현수 ', email: 'ceo@x.co', hpNo: '01012345678' }),
    ).toEqual({ ok: true, memberId: 851, orgId: 324, fields: { name: '최현수', email: 'ceo@x.co', phone: '010-1234-5678' } });
  });
  it('★★ 없는 칸 · null · 빈 값은 「안 바꿈」', () => {
    expect(parseMemberReceiveBody({ memberId: 851, memberName: '', email: null, hpNo: '01012345678' })).toEqual({
      ok: true,
      memberId: 851,
      orgId: null,
      fields: { phone: '010-1234-5678' },
    });
  });
  it('틀리면 400 칸 오류 — 회원번호 · 글자 아님 · 연락처 자릿수', () => {
    const out = parseMemberReceiveBody({ memberId: 'x', email: 3, hpNo: '0101' });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.errors.map((e) => e.field)).toEqual(['memberId', 'email', 'hpNo']);
  });
});

describe('receiveMember', () => {
  const body = { memberId: 851, memberName: '최현수2' };

  it('★★ 단체관리가 있으면 받은 칸만 쓴다', async () => {
    const v = deps();
    expect(await receiveMember('Bearer t', body, v.d)).toEqual({ status: 200, body: { ok: true, applied: true, skipped: null } });
    expect(v.applied).toEqual([{ memberId: 851, fields: { name: '최현수2' } }]);
  });
  it('★ 토큰이 없거나 거절되면 403 · 쓰지 않는다', async () => {
    const none = deps();
    expect((await receiveMember(undefined, body, none.d)).status).toBe(403);
    const rejected = deps({ kind: 'rejected' });
    expect((await receiveMember('Bearer t', body, rejected.d)).status).toBe(403);
    expect([...none.applied, ...rejected.applied]).toEqual([]);
  });
  it('★★ 운영사가 아니면 대상 = 그 직원이 속한 회사의 단체 — 지금 계정의 단체와 같을 때만 받는다', async () => {
    const own = deps(KEYED, 'applied', { kind: 'ok', orgId: 324 });
    expect((await receiveMember('Bearer t', body, own.d)).status).toBe(200);
    expect(own.asked).toEqual([851]);
    expect(own.applied).toEqual([{ memberId: 851, fields: { name: '최현수2' } }]);
    const other = deps(KEYED, 'applied', { kind: 'ok', orgId: 325 });
    expect((await receiveMember('Bearer t', body, other.d)).status).toBe(403);
    // 직원이 없고 본문 orgId 도 없으면 대상을 모른다 — 운영사가 아니면 403
    const unknown = deps(KEYED, 'applied', { kind: 'ok', orgId: 324 });
    expect((await receiveMember('Bearer t', { memberId: 999, memberName: 'x' }, unknown.d)).status).toBe(403);
    expect([...other.applied, ...unknown.applied]).toEqual([]);
  });
  it('★★ 직원이 ERP 에 있어도 운영사가 아니면 직원 수정 키(MEMBER_SELF)가 있을 때만 — 없으면 403 · 직원도 묻지 않는다(C3)', async () => {
    const own = { kind: 'ok', orgId: 324 } as const;
    const cases = [
      deps({ kind: 'ok', screens: [] }, 'applied', own),
      deps({ kind: 'ok', screens: ['S021100031'], keys: { S021100031: ['F001'] } }, 'applied', own),
      deps(KEYED, 'applied', own, null),
      deps(KEYED, 'applied', own, 'S021100031'),
    ];
    for (const v of cases) expect((await receiveMember('Bearer t', body, v.d)).status).toBe(403);
    expect(cases.flatMap((v) => [...v.applied, ...v.asked])).toEqual([]);
  });
  it('★ 운영사면 직원의 회사를 묻지 않는다', async () => {
    const v = deps();
    await receiveMember('Bearer t', body, v.d);
    expect(v.asked).toEqual([]);
  });
  it('★ 회원번호의 직원이 없으면 성공(not_found) · 칸이 없으면 쓰기를 부르지 않고 성공', async () => {
    expect((await receiveMember('Bearer t', body, deps(OK_MENUS, 'not_found').d)).body).toEqual({
      ok: true,
      applied: false,
      skipped: 'not_found',
    });
    const empty = deps();
    expect((await receiveMember('Bearer t', { memberId: 851, email: ' ' }, empty.d)).body).toEqual({
      ok: true,
      applied: false,
      skipped: 'no_fields',
    });
    expect(empty.applied).toEqual([]);
  });
  describe('★★ 직원이 ERP 에 없으면 대상 = 본문 orgId · 직원 수정 키가 있을 때만(삐용 통합 시험 C1)', () => {
    // 비입주사 대표 토큰 — 단체관리 없음 · 지금 회사 9003 · 대역 코드 줄의 화면 · 키(위 KEYED)
    const NOT_IN_ERP = { memberId: 999, orgId: 9003, memberName: '새직원' };
    const own = { kind: 'ok', orgId: 9003 } as const;

    it('자기 회사 orgId + 키 있음 → 200 not_found', async () => {
      const v = deps(KEYED, 'not_found', own);
      expect(await receiveMember('Bearer t', NOT_IN_ERP, v.d)).toEqual({
        status: 200,
        body: { ok: true, applied: false, skipped: 'not_found' },
      });
    });
    it('키 없음 · 코드 줄 없음 · 남의 회사 orgId · 본문 orgId 없음 → 403', async () => {
      const noKey = deps({ kind: 'ok', screens: ['S021100031'], keys: { S021100031: ['F001'] } }, 'not_found', own);
      expect((await receiveMember('Bearer t', NOT_IN_ERP, noKey.d)).status).toBe(403);
      expect((await receiveMember('Bearer t', NOT_IN_ERP, deps(KEYED, 'not_found', own, null).d)).status).toBe(403);
      expect((await receiveMember('Bearer t', { ...NOT_IN_ERP, orgId: 9001 }, deps(KEYED, 'not_found', own).d)).status).toBe(403);
      expect((await receiveMember('Bearer t', { memberId: 999, memberName: 'x' }, deps(KEYED, 'not_found', own).d)).status).toBe(403);
      expect((await receiveMember('Bearer t', { ...NOT_IN_ERP, orgId: 'abc' }, deps(KEYED, 'not_found', own).d)).status).toBe(403);
    });
    it('★ 직원이 ERP 에 있으면 본문 orgId 는 보지 않는다 — 키가 있어도', async () => {
      // 851 은 단체 324 직원 — 본문이 자기 회사 9003 이라 해도 남의 회사
      expect((await receiveMember('Bearer t', { memberId: 851, orgId: 9003, memberName: 'x' }, deps(KEYED, 'applied', own).d)).status).toBe(403);
      // 852 는 회사에 단체 ID 가 없다 — 대상을 모르니 403
      expect((await receiveMember('Bearer t', { memberId: 852, orgId: 9003, memberName: 'x' }, deps(KEYED, 'applied', own).d)).status).toBe(403);
    });
  });
  describe('★★ 활성 대표 · ERP 에 없는 직원은 회사 수정 키(ORG_SELF)로도 받는다(삐용 통합 시험 C4)', () => {
    const own = { kind: 'ok', orgId: 324 } as const;
    const ORG_GRANT = 'S021100021:F002';
    const BOTH: MyMenusOutcome = { kind: 'ok', screens: ['S021100021', 'S021100031'], keys: { S021100021: ['F002'], S021100031: ['F003'] } };
    const NONE: MyMenusOutcome = { kind: 'ok', screens: [] };
    const CEO = { memberId: 853, memberName: '대표2' };

    it('대표 + ORG_SELF 만 → 받음 / MEMBER_SELF 만 → 받음 / 둘 다 없음 → 403', async () => {
      const orgOnly = deps(ORG_KEYED, 'applied', own, 'S021100031:F003', ORG_GRANT);
      expect(await receiveMember('Bearer t', CEO, orgOnly.d)).toEqual({ status: 200, body: { ok: true, applied: true, skipped: null } });
      expect(orgOnly.applied).toEqual([{ memberId: 853, fields: { name: '대표2' } }]);
      const memberOnly = deps(KEYED, 'applied', own, 'S021100031:F003', ORG_GRANT);
      expect((await receiveMember('Bearer t', CEO, memberOnly.d)).status).toBe(200);
      const none = deps(NONE, 'applied', own, 'S021100031:F003', ORG_GRANT);
      expect((await receiveMember('Bearer t', CEO, none.d)).status).toBe(403);
      expect([...none.applied, ...none.asked]).toEqual([]);
    });
    it('대표 아닌 직원 + ORG_SELF 만 → 403 / MEMBER_SELF 있음 → 받음', async () => {
      const orgOnly = deps(ORG_KEYED, 'applied', own, 'S021100031:F003', ORG_GRANT);
      expect((await receiveMember('Bearer t', body, orgOnly.d)).status).toBe(403);
      expect(orgOnly.applied).toEqual([]);
      const memberKey = deps(KEYED, 'applied', own, 'S021100031:F003', ORG_GRANT);
      expect((await receiveMember('Bearer t', body, memberKey.d)).status).toBe(200);
      const both = deps(BOTH, 'applied', own, 'S021100031:F003', ORG_GRANT);
      expect((await receiveMember('Bearer t', body, both.d)).status).toBe(200);
    });
    it('ERP 에 없는 직원 + ORG_SELF 만 · MEMBER_SELF 만 → 200 not_found(쓰는 것 없이)', async () => {
      const notInErp = { memberId: 999, orgId: 324, memberName: '새직원' };
      const notFound = { status: 200, body: { ok: true, applied: false, skipped: 'not_found' } };
      expect(await receiveMember('Bearer t', notInErp, deps(ORG_KEYED, 'not_found', own, 'S021100031:F003', ORG_GRANT).d)).toEqual(notFound);
      expect(await receiveMember('Bearer t', notInErp, deps(KEYED, 'not_found', own, 'S021100031:F003', ORG_GRANT).d)).toEqual(notFound);
    });
    it('남의 회사 → 403 — 대표 + ORG_SELF 여도 · 운영사 → 받음', async () => {
      const other = deps(BOTH, 'applied', { kind: 'ok', orgId: 325 }, 'S021100031:F003', ORG_GRANT);
      expect((await receiveMember('Bearer t', CEO, other.d)).status).toBe(403);
      expect((await receiveMember('Bearer t', body, other.d)).status).toBe(403);
      expect(other.applied).toEqual([]);
      const operator = deps(OK_MENUS, 'applied', { kind: 'rejected' }, null, null);
      expect((await receiveMember('Bearer t', CEO, operator.d)).status).toBe(200);
      expect(operator.asked).toEqual([]);
    });
  });
  it('★★ 이메일이 같은 회사 다른 직원과 겹치면 400', async () => {
    const out = await receiveMember('Bearer t', { memberId: 851, email: 'dup@x.co' }, deps(OK_MENUS, 'email_taken').d);
    expect(out.status).toBe(400);
    if (out.status === 400) expect(out.body.errors).toEqual([{ field: 'email', message: '같은 회사의 다른 직원이 쓰는 이메일입니다' }]);
  });
});
