/**
 * `/org-lookup` — 권한(운영사만) · 입주사 딱지 · 규격 없음 처리.
 *
 * ★ 삐용·DB 에 붙지 않는다. 세션은 시험이 직접 꽂고(실제 훅은 DB 를 본다), 바깥은
 *   `OrgLookupDeps` 대역으로 바꾼다. 라우트 코드는 실물 그대로 돈다.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { ErpSession, ScopeRole } from '@swonbiz/shared';
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
    listOrgs: async (_s, name) => {
      calls.push(`list:${name}`);
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

  it('★ Z 대역이 아닌 단체는 목록에서 뺀다 — 삐용이 섞어 보내도', async () => {
    const deps = fakeDeps({
      listOrgs: async () => ({
        kind: 'ok',
        value: [...ORGS, { orgId: 1, orgCode: 'S01', orgName: '에스원테크', repName: null, status: null }],
      }),
    });
    const a = await build(session('operator', 1), deps);
    const res = await a.inject({ method: 'GET', url: '/org-lookup' });
    expect(res.json().orgs.map((o: { orgCode: string }) => o.orgCode)).toEqual(['Z97', 'Z99']);
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

describe('MockBbiyongOrg — 단체 조회', () => {
  it('★ 모의 계정 단체가 나오고 Z 코드만, 이름으로 찾는다', async () => {
    const mock = new MockBbiyongOrg();
    const all = await mock.listOrgs({ name: '' }, 't');
    expect(all.kind).toBe('ok');
    if (all.kind !== 'ok') return;
    expect(all.value.map((o) => o.orgCode)).toEqual(['Z97', 'Z98', 'Z99']);
    expect(all.value.every((o) => o.orgId !== 1)).toBe(true); // 운영사 단체는 빠진다

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
});
