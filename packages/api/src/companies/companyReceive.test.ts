/**
 * 입주사 회사 정보 「받기」(삐용 → ERP, 2026-10-23) — 칸 고르기 · 토큰 확인 · 결과.
 * ★ DB · 삐용에 붙지 않는다. 내 메뉴와 쓰기는 대역이다.
 */
import { describe, expect, it } from 'vitest';
import type { MyMenusOutcome, MyOrgOutcome } from '../bbiyong/types.ts';
import type { CompanyFromBbiyong } from '../db/companies.ts';
import { parseCompanyReceiveBody, receiveCompany, type CompanyReceiveDeps } from './companyReceive.ts';

const OK_MENUS: MyMenusOutcome = { kind: 'ok', screens: ['S021100010'] };
/** 회사 계정 — 단체관리 없음 · 「내 단체 정보」 수정 키 있음(대역 코드 줄 ORG_SELF = S021100021:F002). */
const KEYED: MyMenusOutcome = { kind: 'ok', screens: ['S021100021'], keys: { S021100021: ['F002'] } };

function deps(
  menus: MyMenusOutcome = OK_MENUS,
  result: 'applied' | 'not_found' | 'duplicate' = 'applied',
  org: MyOrgOutcome = { kind: 'rejected' },
  grantName: string | null = 'S021100021:F002',
) {
  const applied: { orgId: number; fields: CompanyFromBbiyong }[] = [];
  const d: CompanyReceiveDeps = {
    myMenus: async () => menus,
    myOrg: async () => org,
    orgGrantName: async () => grantName,
    apply: async (orgId, fields) => {
      applied.push({ orgId, fields });
      return result;
    },
  };
  return { d, applied };
}

describe('parseCompanyReceiveBody', () => {
  it('★★ 다섯 칸만 — 번호는 숫자로 받아 하이픈 모양으로 · 주소 · 단체코드는 보지 않는다', () => {
    expect(
      parseCompanyReceiveBody({
        orgId: 324,
        orgCode: 'Z04',
        orgName: ' 한성무역 ',
        bizNumber: '1058768687',
        corpNumber: '1110002313123',
        businessType: '도매',
        businessItem: '무역',
        zipCode: '06097',
        address: '서울',
        detailAddress: '3층',
      }),
    ).toEqual({
      ok: true,
      orgId: 324,
      fields: {
        companyName: '한성무역',
        bizNumber: '105-87-68687',
        corpNumber: '111000-2313123',
        businessType: '도매',
        businessItem: '무역',
      },
    });
  });
  it('★★ 없는 칸 · null · 빈 값은 「안 바꿈」', () => {
    expect(parseCompanyReceiveBody({ orgId: 324, orgName: '', businessType: '  ', businessItem: null, corpNumber: '1110002313123' })).toEqual({
      ok: true,
      orgId: 324,
      fields: { corpNumber: '111000-2313123' },
    });
  });
  it('틀리면 400 칸 오류 — 단체 ID · 글자 아님 · 자릿수', () => {
    const out = parseCompanyReceiveBody({ orgId: 0, orgName: 5, bizNumber: '123' });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.errors.map((e) => e.field)).toEqual(['orgId', 'orgName', 'bizNumber']);
  });
});

describe('receiveCompany', () => {
  const body = { orgId: 324, orgName: '한성무역' };

  it('★★ 단체관리가 있으면 받은 칸만 쓴다', async () => {
    const v = deps();
    expect(await receiveCompany('Bearer t', body, v.d)).toEqual({ status: 200, body: { ok: true, applied: true, skipped: null } });
    expect(v.applied).toEqual([{ orgId: 324, fields: { companyName: '한성무역' } }]);
  });
  it('★ 토큰이 없거나 운영사도 그 회사도 아니면 403 · 쓰지 않는다', async () => {
    const none = deps();
    expect((await receiveCompany(undefined, body, none.d)).status).toBe(403);
    const noMenu = deps({ kind: 'ok', screens: [] });
    expect((await receiveCompany('Bearer t', body, noMenu.d)).status).toBe(403);
    expect([...none.applied, ...noMenu.applied]).toEqual([]);
  });
  it('★★ 운영사가 아니면 대상 = 본문 orgId — 지금 계정의 단체와 같을 때만 받는다', async () => {
    const own = deps(KEYED, 'applied', { kind: 'ok', orgId: 324 });
    expect((await receiveCompany('Bearer t', body, own.d)).status).toBe(200);
    expect(own.applied).toEqual([{ orgId: 324, fields: { companyName: '한성무역' } }]);
    const other = deps(KEYED, 'applied', { kind: 'ok', orgId: 325 });
    expect((await receiveCompany('Bearer t', body, other.d)).status).toBe(403);
    expect(other.applied).toEqual([]);
  });
  it('★★ 운영사가 아니면 단체 수정 키(ORG_SELF)가 있을 때만 — 키 없음 · 화면 없음 · 코드 줄 없음 · 모양 틀림은 403(C3)', async () => {
    const own = { kind: 'ok', orgId: 324 } as const;
    const cases = [
      deps({ kind: 'ok', screens: ['S021100021'], keys: { S021100021: ['F001'] } }, 'applied', own),
      deps({ kind: 'ok', screens: [], keys: { S021100021: ['F002'] } }, 'applied', own),
      deps(KEYED, 'applied', own, null),
      deps(KEYED, 'applied', own, 'S021100021'),
    ];
    for (const v of cases) expect((await receiveCompany('Bearer t', body, v.d)).status).toBe(403);
    expect(cases.flatMap((v) => v.applied)).toEqual([]);
  });
  it('★ 그 단체의 입주사가 없으면 성공(not_found) · 칸이 없으면 쓰기를 부르지 않고 성공', async () => {
    expect((await receiveCompany('Bearer t', body, deps(OK_MENUS, 'not_found').d)).body).toEqual({
      ok: true,
      applied: false,
      skipped: 'not_found',
    });
    const empty = deps();
    expect((await receiveCompany('Bearer t', { orgId: 324, orgName: '' }, empty.d)).body).toEqual({
      ok: true,
      applied: false,
      skipped: 'no_fields',
    });
    expect(empty.applied).toEqual([]);
  });
  it('사업자번호가 겹치면 409', async () => {
    const out = await receiveCompany('Bearer t', { orgId: 324, bizNumber: '1058768687' }, deps(OK_MENUS, 'duplicate').d);
    expect(out.status).toBe(409);
  });
});
