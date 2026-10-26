/**
 * 법무 회사 정보 「받기」(삐용 → 법무, 2026-10-23) — 토큰 확인 · 칸 고르기 · 결과.
 * ★ DB · 삐용에 붙지 않는다. 내 메뉴와 쓰기는 대역이다.
 */
import { describe, expect, it } from 'vitest';
import { BbiyongUnavailableError, type MyMenusOutcome, type MyOrgOutcome } from '../bbiyong/types.ts';
import type { LegalOrgFromBbiyong } from '../db/corpChanges.ts';
import { bearerOf, parseReceiveBody, receiveLegalOrg, type ReceiveDeps } from './legalOrgReceive.ts';

const OK_MENUS: MyMenusOutcome = { kind: 'ok', screens: ['S021000000', 'S021100010'] };
/** 운영사가 아닌 토큰 — 단체관리 없음. */
const COMPANY_MENUS: MyMenusOutcome = { kind: 'ok', screens: ['S021000000'] };
/** 회사 계정 — 단체관리 없음 · 「내 단체 정보」 수정 키 있음(대역 코드 줄 ORG_SELF = S021100021:F002). */
const KEYED: MyMenusOutcome = { kind: 'ok', screens: ['S021000000', 'S021100021'], keys: { S021100021: ['F002'] } };

function deps(
  menus: MyMenusOutcome | Error = OK_MENUS,
  result: 'applied' | 'tenant' | 'not_found' = 'applied',
  org: MyOrgOutcome = { kind: 'rejected' },
  grantName: string | null = 'S021100021:F002',
) {
  const tokens: string[] = [];
  const applied: { orgId: number; fields: LegalOrgFromBbiyong }[] = [];
  const d: ReceiveDeps = {
    myMenus: async (token) => {
      tokens.push(token);
      if (menus instanceof Error) throw menus;
      return menus;
    },
    myOrg: async () => org,
    orgGrantName: async () => grantName,
    apply: async (orgId, fields) => {
      applied.push({ orgId, fields });
      return result;
    },
  };
  return { d, tokens, applied };
}

describe('parseReceiveBody', () => {
  it('★★ 다섯 칸만 받는다 — 번호는 숫자로 받아 하이픈 모양으로 · 회사명 · 단체코드는 보지 않는다', () => {
    expect(
      parseReceiveBody({
        orgId: 9003,
        orgCode: 'Z99',
        orgName: '바뀐 이름',
        zipCode: '06097',
        address: '서울 강남구 테헤란로 1',
        detailAddress: '3층',
        bizNumber: '1058768687',
        corpNumber: '1110002313123',
      }),
    ).toEqual({
      ok: true,
      orgId: 9003,
      fields: {
        headZipCode: '06097',
        headAddress: '서울 강남구 테헤란로 1',
        headAddressDetail: '3층',
        bizNumber: '105-87-68687',
        corpNumber: '111000-2313123',
      },
    });
  });
  it('★★ 없는 칸 · null · 빈 값(공백뿐)은 「안 바꿈」 — 담지 않는다', () => {
    expect(parseReceiveBody({ orgId: 9003, zipCode: '', address: '  ', detailAddress: null, bizNumber: '1058768687' })).toEqual({
      ok: true,
      orgId: 9003,
      fields: { bizNumber: '105-87-68687' },
    });
  });
  it('틀리면 400 칸 오류 — 단체 ID · 글자 아님 · 자릿수 · 길이', () => {
    const out = parseReceiveBody({ orgId: 'x', zipCode: 6097, bizNumber: '12345', detailAddress: 'a'.repeat(201) });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.errors.map((e) => e.field)).toEqual(['orgId', 'zipCode', 'detailAddress', 'bizNumber']);
    expect(parseReceiveBody([]).ok).toBe(false);
    expect(parseReceiveBody({ zipCode: '06097' }).ok).toBe(false);
  });
});

describe('bearerOf', () => {
  it('Bearer 뒤 토큰 — 없거나 모양이 다르면 null', () => {
    expect(bearerOf('Bearer eyJ.a')).toBe('eyJ.a');
    expect(bearerOf('bearer eyJ.a')).toBe('eyJ.a');
    expect(bearerOf(undefined)).toBeNull();
    expect(bearerOf('Basic abc')).toBeNull();
    expect(bearerOf('Bearer ')).toBeNull();
  });
});

describe('receiveLegalOrg', () => {
  const body = { orgId: 9003, orgCode: 'Z99', address: '서울', bizNumber: '1058768687' };

  it('★★ 내 메뉴에 단체관리가 있으면 받은 칸만 쓴다 — 토큰은 실어 온 것 그대로', async () => {
    const v = deps();
    expect(await receiveLegalOrg('Bearer eyJ.in', body, v.d)).toEqual({ status: 200, body: { ok: true, applied: true, skipped: null } });
    expect(v.tokens).toEqual(['eyJ.in']);
    expect(v.applied).toEqual([{ orgId: 9003, fields: { headAddress: '서울', bizNumber: '105-87-68687' } }]);
  });

  it('★★ 토큰이 없거나 · 거절되거나 · 운영사도 그 회사도 아니면 403 — 칸 오류도 쓰기도 보이지 않는다', async () => {
    const none = deps();
    expect((await receiveLegalOrg(undefined, body, none.d)).status).toBe(403);
    expect(none.tokens).toEqual([]);
    const rejected = deps({ kind: 'rejected' });
    expect((await receiveLegalOrg('Bearer eyJ.in', body, rejected.d)).status).toBe(403);
    const noMenu = deps(COMPANY_MENUS);
    expect((await receiveLegalOrg('Bearer eyJ.in', { orgId: 'x' }, noMenu.d)).status).toBe(403);
    expect([...rejected.applied, ...noMenu.applied]).toEqual([]);
  });

  it('★★ 운영사가 아니면 대상 = 본문 orgId — 지금 계정의 단체와 같을 때만 받는다', async () => {
    const own = deps(KEYED, 'applied', { kind: 'ok', orgId: 9003 });
    expect((await receiveLegalOrg('Bearer eyJ.in', body, own.d)).status).toBe(200);
    expect(own.applied).toEqual([{ orgId: 9003, fields: { headAddress: '서울', bizNumber: '105-87-68687' } }]);
    const other = deps(KEYED, 'applied', { kind: 'ok', orgId: 9001 });
    expect((await receiveLegalOrg('Bearer eyJ.in', body, other.d)).status).toBe(403);
    expect(other.applied).toEqual([]);
  });

  it('★★ 운영사가 아니면 단체 수정 키(ORG_SELF)가 있을 때만 — 키 없음 · 화면 없음 · 코드 줄 없음 · 모양 틀림은 403(C3)', async () => {
    const own = { kind: 'ok', orgId: 9003 } as const;
    const cases = [
      deps(COMPANY_MENUS, 'applied', own),
      deps({ kind: 'ok', screens: ['S021100021'], keys: { S021100021: ['F001'] } }, 'applied', own),
      deps(KEYED, 'applied', own, null),
      deps(KEYED, 'applied', own, 'S021100021'),
    ];
    for (const v of cases) expect((await receiveLegalOrg('Bearer eyJ.in', body, v.d)).status).toBe(403);
    expect(cases.flatMap((v) => v.applied)).toEqual([]);
  });

  it('삐용에 못 붙으면 503 · 쓰지 않는다', async () => {
    const v = deps(new BbiyongUnavailableError('삐용 my-menus 호출 실패'));
    expect((await receiveLegalOrg('Bearer eyJ.in', body, v.d)).status).toBe(503);
    expect(v.applied).toEqual([]);
  });

  it('★ 법무 줄이 없거나 입주사면 쓰지 않고 성공 · 바꿀 칸이 없으면 쓰기를 부르지 않고 성공', async () => {
    expect((await receiveLegalOrg('Bearer eyJ.in', body, deps(OK_MENUS, 'not_found').d)).body).toEqual({
      ok: true,
      applied: false,
      skipped: 'not_found',
    });
    expect((await receiveLegalOrg('Bearer eyJ.in', body, deps(OK_MENUS, 'tenant').d)).body).toEqual({
      ok: true,
      applied: false,
      skipped: 'tenant',
    });
    const empty = deps();
    expect((await receiveLegalOrg('Bearer eyJ.in', { orgId: 9003, address: '' }, empty.d)).body).toEqual({
      ok: true,
      applied: false,
      skipped: 'no_fields',
    });
    expect(empty.applied).toEqual([]);
  });

  it('칸이 틀리면 400 · 쓰지 않는다', async () => {
    const v = deps();
    const out = await receiveLegalOrg('Bearer eyJ.in', { orgId: 9003, bizNumber: '123' }, v.d);
    expect(out.status).toBe(400);
    expect(v.applied).toEqual([]);
  });
});
