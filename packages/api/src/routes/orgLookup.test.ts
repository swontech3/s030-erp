/**
 * `/org-lookup` — 권한(운영사만) · 입주사 딱지 · 규격 없음 처리.
 *
 * ★ 삐용·DB 에 붙지 않는다. 세션은 시험이 직접 꽂고(실제 훅은 DB 를 본다), 바깥은
 *   `OrgLookupDeps` 대역으로 바꾼다. 라우트 코드는 실물 그대로 돈다.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { BBIYONG, type ErpSession, type ScopeRole } from '@swonbiz/shared';
import type { OrgInfo } from '@swonbiz/shared/domain/org-lookup';
import { MockBbiyongOrg } from '../bbiyong/MockBbiyongOrg.ts';
import { registerOrgLookupRoutes, type OrgLookupDeps } from './orgLookup.ts';

const session = (role: ScopeRole, s020OrgId: number): ErpSession => ({
  erpSid: 'sid-hash',
  s020MemberId: 1,
  s020OrgId,
  companyId: null,
  role,
  expiresAt: new Date(Date.now() + 60_000),
  lastActiveAt: null,
});

const ORGS: OrgInfo[] = [
  { orgId: 9001, orgCode: 'Z97', orgName: '주식회사 비앤케이넷', repName: '홍길동', status: '정상' },
  { orgId: 9003, orgCode: 'Z99', orgName: '주식회사 한빛법인', repName: '이법무', status: '정상' },
];

/** 9001 만 ERP 입주사에 연결돼 있다. 부른 기록을 남긴다. */
function fakeDeps(over: Partial<OrgLookupDeps> = {}): OrgLookupDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    listOrgs: async (_s, name, moduleCode) => {
      calls.push(moduleCode ? `list:${name}:${moduleCode}` : `list:${name}`);
      return { kind: 'ok', value: ORGS.filter((o) => o.orgName.includes(name)) };
    },
    getOrg: async (_s, key) => {
      calls.push(`get:${JSON.stringify(key)}`);
      return { kind: 'ok', value: ORGS.find((o) => ('orgId' in key ? o.orgId === key.orgId : o.orgCode === key.orgCode)) ?? null };
    },
    linkedOrgIds: async (_s, ids) => ids.filter((id) => id === 9001),
    ...over,
  };
}

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

async function build(who: ErpSession, deps: OrgLookupDeps): Promise<FastifyInstance> {
  app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.session = who;
  });
  registerOrgLookupRoutes(app, deps);
  await app.ready();
  return app;
}

describe('GET /org-lookup — 권한', () => {
  it('★★ 회사 사용자는 403 — 삐용을 부르지도 않는다', async () => {
    const deps = fakeDeps();
    const a = await build(session('tenant', 9003), deps);
    for (const url of ['/org-lookup?q=한빛', '/org-lookup/one?orgId=9001']) {
      const res = await a.inject({ method: 'GET', url: encodeURI(url) });
      expect(res.statusCode).toBe(403);
    }
    expect(deps.calls).toEqual([]);
  });

  it('운영사는 목록을 받는다', async () => {
    const a = await build(session('operator', 1), fakeDeps());
    const res = await a.inject({ method: 'GET', url: '/org-lookup' });
    expect(res.statusCode).toBe(200);
    expect(res.json().orgs).toHaveLength(2);
  });
});

describe('GET /org-lookup — 입주사 딱지', () => {
  it('★ ERP 입주사에 연결된 단체만 isTenant=true', async () => {
    const a = await build(session('operator', 1), fakeDeps());
    const res = await a.inject({ method: 'GET', url: '/org-lookup' });
    expect(res.json().orgs.map((o: { orgId: number; isTenant: boolean }) => [o.orgId, o.isTenant])).toEqual([
      [9001, true],
      [9003, false],
    ]);
  });

  it('검색어는 앞뒤 공백을 떼고 넘긴다', async () => {
    const deps = fakeDeps();
    const a = await build(session('operator', 1), deps);
    await a.inject({ method: 'GET', url: `/org-lookup?q=${encodeURIComponent('  한빛 ')}` });
    expect(deps.calls).toEqual(['list:한빛']);
  });

  it('★ 받은 목록을 그대로 보여 준다 — Z 대역이 아니어도 거르지 않는다(삐용 몫)', async () => {
    const deps = fakeDeps({
      listOrgs: async () => ({
        kind: 'ok',
        value: [...ORGS, { orgId: 1, orgCode: 'S01', orgName: '에스원테크', repName: null, status: null }],
      }),
    });
    const a = await build(session('operator', 1), deps);
    const res = await a.inject({ method: 'GET', url: '/org-lookup' });
    expect(res.json().orgs.map((o: { orgCode: string }) => o.orgCode)).toEqual(['Z97', 'Z99', 'S01']);
  });
});

describe('GET /org-lookup — 규격 없음', () => {
  it('★ 어댑터가 unsupported 면 503 + 그 문구 (장애 문구가 아니다)', async () => {
    const deps = fakeDeps({ listOrgs: async () => ({ kind: 'unsupported', message: '규격 대기' }) });
    const a = await build(session('operator', 1), deps);
    const res = await a.inject({ method: 'GET', url: '/org-lookup' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'org_lookup_unsupported', message: '규격 대기' });
  });
});

describe('GET /org-lookup — 삐용 권한 · 연결 실패(2026-11-01)', () => {
  it('★ 삐용 단체관리 권한이 없으면(forbidden) 403 + 그 문구 · 목록도 단건도', async () => {
    const no = { kind: 'forbidden' as const, message: '삐용 단체관리 권한이 필요합니다' };
    const deps = fakeDeps({ listOrgs: async () => no, getOrg: async () => no });
    const a = await build(session('operator', 1), deps);
    for (const url of ['/org-lookup', '/org-lookup/one?orgId=9001']) {
      const res = await a.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'bbiyong_forbidden', message: '삐용 단체관리 권한이 필요합니다' });
    }
  });
});

describe('GET /org-lookup/one — 단건', () => {
  it('단체 ID 로 찾고 딱지를 붙인다', async () => {
    const a = await build(session('operator', 1), fakeDeps());
    const res = await a.inject({ method: 'GET', url: '/org-lookup/one?orgId=9001' });
    expect(res.json().org).toMatchObject({ orgId: 9001, orgCode: 'Z97', isTenant: true });
  });

  it('단체코드로 찾는다', async () => {
    const a = await build(session('operator', 1), fakeDeps());
    const res = await a.inject({ method: 'GET', url: '/org-lookup/one?orgCode=z99' });
    expect(res.json().org).toMatchObject({ orgId: 9003, isTenant: false });
  });

  it('없으면 org: null', async () => {
    const a = await build(session('operator', 1), fakeDeps());
    const res = await a.inject({ method: 'GET', url: '/org-lookup/one?orgId=12345' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ org: null });
  });

  it('키가 없거나 둘 다 오면 400', async () => {
    const a = await build(session('operator', 1), fakeDeps());
    for (const url of ['/org-lookup/one', '/org-lookup/one?orgId=1&orgCode=Z01', '/org-lookup/one?orgId=abc']) {
      expect((await a.inject({ method: 'GET', url })).statusCode).toBe(400);
    }
  });
});

describe('GET /org-lookup — 구독 모듈로 거르기(moduleCode, 2026-11-27)', () => {
  it('★ 법무 코드(BBIYONG.LEGAL_MODULE_CODE = LEGAL_INCORP)를 그대로 삐용 쪽에 넘긴다', async () => {
    expect(BBIYONG.LEGAL_MODULE_CODE).toBe('LEGAL_INCORP');
    const deps = fakeDeps();
    const a = await build(session('operator', 1), deps);
    const res = await a.inject({ method: 'GET', url: `/org-lookup?q=&moduleCode=${BBIYONG.LEGAL_MODULE_CODE}` });
    expect(res.statusCode).toBe(200);
    expect(deps.calls).toEqual(['list::LEGAL_INCORP']);
  });

  it('★ 안 주면 지금과 같다 — 모듈 코드 없이 부른다(ERP 화면의 회사 조회)', async () => {
    const deps = fakeDeps();
    const a = await build(session('operator', 1), deps);
    await a.inject({ method: 'GET', url: '/org-lookup?q=' });
    await a.inject({ method: 'GET', url: '/org-lookup?q=&moduleCode=' });
    expect(deps.calls).toEqual(['list:', 'list:']);
  });

  it('★ 다른 코드(ERP 의 LEGAL 등)는 400 — 삐용을 부르지 않는다', async () => {
    const deps = fakeDeps();
    const a = await build(session('operator', 1), deps);
    for (const code of ['LEGAL', 'OFFICE', 'legal_incorp']) {
      const res = await a.inject({ method: 'GET', url: `/org-lookup?moduleCode=${code}` });
      expect(res.statusCode).toBe(400);
    }
    expect(deps.calls).toEqual([]);
  });

  it('회사 사용자는 모듈 코드가 있어도 403', async () => {
    const deps = fakeDeps();
    const a = await build(session('tenant', 9003), deps);
    const res = await a.inject({ method: 'GET', url: `/org-lookup?moduleCode=${BBIYONG.LEGAL_MODULE_CODE}` });
    expect(res.statusCode).toBe(403);
    expect(deps.calls).toEqual([]);
  });
});

describe('MockBbiyongOrg — 단체 조회', () => {
  it('★ moduleCode 가 오면 그 모듈 구독 회사만 — 모의 회사 중 한빛법인(Z99)만 법무 구독', async () => {
    const mock = new MockBbiyongOrg();
    const legal = await mock.listOrgs({ name: '', moduleCode: BBIYONG.LEGAL_MODULE_CODE }, 't');
    expect(legal.kind === 'ok' && legal.value.map((o) => o.orgCode)).toEqual(['Z99']);
    // 이름 검색과 함께 — 법무 구독이 아닌 회사는 이름이 맞아도 안 나온다
    const named = await mock.listOrgs({ name: '비앤케이', moduleCode: BBIYONG.LEGAL_MODULE_CODE }, 't');
    expect(named.kind === 'ok' && named.value).toEqual([]);
    // 안 주면 지금과 같다
    const all = await mock.listOrgs({ name: '' }, 't');
    expect(all.kind === 'ok' && all.value.map((o) => o.orgCode)).toEqual(['Z97', 'Z98', 'Z99']);
  });

  it('이 프로세스가 등록한 회사는 등록 때 보낸 모듈로 거른다', async () => {
    const mock = new MockBbiyongOrg();
    await mock.createOrg(
      { orgCode: 'Z04', orgName: '사무실회사', memberName: '김대표', hpNo: '01000000002', email: 'o@p.q',
        countryCode: 'KR', moduleCodes: ['OFFICE', 'AUTHZ'] },
      't',
    );
    const office = await mock.listOrgs({ name: '', moduleCode: 'OFFICE' }, 't');
    const legal = await mock.listOrgs({ name: '', moduleCode: BBIYONG.LEGAL_MODULE_CODE }, 't');
    expect(office.kind === 'ok' && office.value.map((o) => o.orgCode)).toEqual(['Z04']);
    expect(legal.kind === 'ok' && legal.value.map((o) => o.orgCode)).toEqual(['Z99']);
  });

  it('★ 모의 계정 단체가 나오고, 이름으로 찾는다', async () => {
    const mock = new MockBbiyongOrg();
    const all = await mock.listOrgs({ name: '' }, 't');
    expect(all.kind).toBe('ok');
    if (all.kind !== 'ok') return;
    expect(all.value.map((o) => o.orgCode)).toEqual(['Z97', 'Z98', 'Z99']);
    // 운영사 계정은 단체코드가 없어 모의 단체 목록에 없다(필터가 아니라 시드에 없는 것이다).
    expect(all.value.every((o) => o.orgId !== 1)).toBe(true);

    const found = await mock.listOrgs({ name: ' 한빛 ' }, 't');
    expect(found.kind === 'ok' && found.value.map((o) => o.orgId)).toEqual([9003]);
  });

  it('단건 — 단체 ID · 단체코드', async () => {
    const mock = new MockBbiyongOrg();
    const byId = await mock.getOrg({ orgId: 9003 }, 't');
    const byCode = await mock.getOrg({ orgCode: 'z97' }, 't');
    const none = await mock.getOrg({ orgId: 424242 }, 't');
    expect(byId.kind === 'ok' && byId.value?.orgName).toBe('주식회사 한빛법인');
    expect(byCode.kind === 'ok' && byCode.value?.orgId).toBe(9001);
    expect(none).toEqual({ kind: 'ok', value: null });
  });

  it('★ 이 프로세스가 만든 회사도 나온다 · 모의 계정 코드는 「이미 있음」', async () => {
    const mock = new MockBbiyongOrg();
    const req: Parameters<MockBbiyongOrg['createOrg']>[0] = {
      orgCode: 'Z03', orgName: '새회사', memberName: '김대표', hpNo: '01000000000', email: 'a@b.c',
      countryCode: 'KR', moduleCodes: ['OFFICE'],
    };
    await mock.createOrg(req, 't');
    const listed = await mock.listOrgs({ name: '새회사' }, 't');
    expect(listed.kind === 'ok' && listed.value.map((o) => o.orgCode)).toEqual(['Z03']);

    const dup = await mock.createOrg({ ...req, orgCode: 'Z99' }, 't');
    expect(dup.kind).toBe('duplicate_code');
  });

  /*
   * ★ Z 아닌 단체는 삐용 화면에서 등록된다 — ERP 등록 주소는 Z 만 받는다(회신 2026-10-14).
   *   그래서 mock 등록도 Z 아닌 코드를 거부한다. 「목록이 Z 아닌 단체를 거르지 않는다」는
   *   위 `받은 목록을 그대로 보여 준다` 시험(가짜 어댑터) 몫이다.
   */
  it('★ Z 아닌 단체는 삐용 화면에서 등록된다 — ERP 등록 주소는 Z 만(회신 2026-10-14)', async () => {
    const mock = new MockBbiyongOrg();
    const out = await mock.createOrg(
      { orgCode: 'A05', orgName: '바깥회사', memberName: '박대표', hpNo: '01000000001', email: 'x@y.z',
        countryCode: 'KR', moduleCodes: ['OFFICE'] },
      't',
    );
    expect(out).toEqual({
      kind: 'rejected',
      message: 'Z 로 시작하는 단체코드는 시스템 예약 코드입니다',
      retryable: false,
    });
    const listed = await mock.listOrgs({ name: '바깥' }, 't');
    expect(listed.kind === 'ok' && listed.value).toEqual([]);
  });
});
