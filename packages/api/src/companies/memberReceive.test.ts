/**
 * 입주사 직원 정보 「받기」(삐용 → ERP, 2026-10-23) — 칸 고르기 · 토큰 확인 · 결과.
 * ★ DB · 삐용에 붙지 않는다. 내 메뉴와 쓰기는 대역이다. 실제 쓰기 SQL 은 `routes/companyReceive.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { MyMenusOutcome } from '../bbiyong/types.ts';
import type { MemberFromBbiyong } from '../db/companies.ts';
import { parseMemberReceiveBody, receiveMember, type MemberReceiveDeps } from './memberReceive.ts';

const OK_MENUS: MyMenusOutcome = { kind: 'ok', screens: ['S021100010'] };

function deps(menus: MyMenusOutcome = OK_MENUS, result: 'applied' | 'not_found' | 'email_taken' = 'applied') {
  const applied: { memberId: number; fields: MemberFromBbiyong }[] = [];
  const d: MemberReceiveDeps = {
    myMenus: async () => menus,
    apply: async (memberId, fields) => {
      applied.push({ memberId, fields });
      return result;
    },
  };
  return { d, applied };
}

describe('parseMemberReceiveBody', () => {
  it('★★ 이름 · 이메일 · 연락처만 — 연락처는 숫자로 받아 하이픈 모양으로 · 단체 ID · 코드는 보지 않는다', () => {
    expect(
      parseMemberReceiveBody({ memberId: 851, orgId: 324, orgCode: 'Z04', memberName: ' 최현수 ', email: 'ceo@x.co', hpNo: '01012345678' }),
    ).toEqual({ ok: true, memberId: 851, fields: { name: '최현수', email: 'ceo@x.co', phone: '010-1234-5678' } });
  });
  it('★★ 없는 칸 · null · 빈 값은 「안 바꿈」', () => {
    expect(parseMemberReceiveBody({ memberId: 851, memberName: '', email: null, hpNo: '01012345678' })).toEqual({
      ok: true,
      memberId: 851,
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
  it('★★ 이메일이 같은 회사 다른 직원과 겹치면 400', async () => {
    const out = await receiveMember('Bearer t', { memberId: 851, email: 'dup@x.co' }, deps(OK_MENUS, 'email_taken').d);
    expect(out.status).toBe(400);
    if (out.status === 400) expect(out.body.errors).toEqual([{ field: 'email', message: '같은 회사의 다른 직원이 쓰는 이메일입니다' }]);
  });
});
