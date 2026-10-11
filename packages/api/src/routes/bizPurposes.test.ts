/**
 * `/legal/biz-purposes` — 역할 · 본문 · 조건 · 중복 409.
 *
 * ★ DB 에 붙지 않는다. 라우트는 `BizPurposeDeps` 대역으로, 처리(중복 · 404)와 SQL 은 가짜 클라이언트로 본다.
 *   RLS(회사는 사용 중인 줄만 · 쓰기 막힘 · 지우기 권한 없음)는 `scripts/verify-041.js` 가 erp_app 으로 본다.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { ErpSession, ScopeRole } from '@swonbiz/shared';
import type { BizPurposeItem, BizPurposeListFilter } from '@swonbiz/shared/domain/biz-purpose';
import { createBizPurposeOp, registerBizPurposeRoutes, updateBizPurposeOp, type BizPurposeDeps } from './bizPurposes.ts';
import { BIZ_PURPOSE_LIST_LIMIT, listBizPurposes } from '../db/bizPurposes.ts';
import type { ScopedClient } from '../db/withCompanyScope.ts';

const session = (role: ScopeRole): ErpSession => ({
  erpSid: 'sid-hash',
  s020MemberId: 1,
  s020OrgId: role === 'operator' ? 1 : 9003,
  companyId: null,
  role,
  expiresAt: new Date(Date.now() + 60_000),
  lastActiveAt: null,
});

const ITEM: BizPurposeItem = { id: 'p1', text: '경영 컨설팅업', active: true };

function fakeDeps(): BizPurposeDeps & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    list: async (_s, f) => {
      calls.push(['list', f]);
      return { items: [ITEM], truncated: false };
    },
    create: async (_s, text) => {
      calls.push(['create', text]);
      return { ok: true, item: { ...ITEM, text } };
    },
    update: async (_s, id, patch) => {
      calls.push(['update', id, patch]);
      return { ok: true, item: { ...ITEM, id, ...patch } };
    },
  };
}

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

async function build(role: ScopeRole, deps: BizPurposeDeps): Promise<FastifyInstance> {
  app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.session = session(role);
  });
  registerBizPurposeRoutes(app, deps);
  await app.ready();
  return app;
}

describe('GET /legal/biz-purposes', () => {
  it('★ 회사 세션도 읽는다 — 사용 끈 줄 요청은 조용히 끈다', async () => {
    const deps = fakeDeps();
    const a = await build('tenant', deps);
    const res = await a.inject({ method: 'GET', url: '/legal/biz-purposes?q=%20컨설팅%20&includeInactive=1' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [ITEM], truncated: false });
    expect(deps.calls).toEqual([['list', { q: '컨설팅', includeInactive: false }]]);
  });

  it('운영사는 사용 끈 줄도 받을 수 있다', async () => {
    const deps = fakeDeps();
    const a = await build('operator', deps);
    await a.inject({ method: 'GET', url: '/legal/biz-purposes?includeInactive=1' });
    expect(deps.calls).toEqual([['list', { q: null, includeInactive: true }]]);
  });

  it('틀린 검색어는 400', async () => {
    const a = await build('operator', fakeDeps());
    const res = await a.inject({ method: 'GET', url: `/legal/biz-purposes?q=${'가'.repeat(201)}` });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].field).toBe('q');
  });
});

describe('POST · PATCH /legal/biz-purposes — 운영사만', () => {
  it('★ 회사 세션은 403 — 처리에 닿지 않는다', async () => {
    const deps = fakeDeps();
    const a = await build('tenant', deps);
    const post = await a.inject({ method: 'POST', url: '/legal/biz-purposes', payload: { text: '가' } });
    const patch = await a.inject({ method: 'PATCH', url: '/legal/biz-purposes/p1', payload: { active: false } });
    expect([post.statusCode, patch.statusCode]).toEqual([403, 403]);
    expect(deps.calls).toEqual([]);
  });

  it('운영사 추가 — 다듬은 문구로 201', async () => {
    const deps = fakeDeps();
    const a = await build('operator', deps);
    const res = await a.inject({ method: 'POST', url: '/legal/biz-purposes', payload: { text: '  부동산 임대업 ' } });
    expect(res.statusCode).toBe(201);
    expect(res.json().item.text).toBe('부동산 임대업');
    expect(deps.calls).toEqual([['create', '부동산 임대업']]);
  });

  it('운영사 고치기 — 사용 끄기', async () => {
    const deps = fakeDeps();
    const a = await build('operator', deps);
    const res = await a.inject({ method: 'PATCH', url: '/legal/biz-purposes/p1', payload: { active: false } });
    expect(res.statusCode).toBe(200);
    expect(deps.calls).toEqual([['update', 'p1', { active: false }]]);
  });

  it('틀린 본문은 400 · 칸별 오류', async () => {
    const a = await build('operator', fakeDeps());
    const multi = await a.inject({ method: 'POST', url: '/legal/biz-purposes', payload: { text: '가\n나' } });
    const empty = await a.inject({ method: 'PATCH', url: '/legal/biz-purposes/p1', payload: {} });
    expect([multi.statusCode, empty.statusCode]).toEqual([400, 400]);
    expect(multi.json().errors).toEqual([{ field: 'text', message: '사업목적 문구는 한 줄로 입력하세요' }]);
  });

  it('지우기 라우트는 없다', async () => {
    const a = await build('operator', fakeDeps());
    expect((await a.inject({ method: 'DELETE', url: '/legal/biz-purposes/p1' })).statusCode).toBe(404);
  });
});

/** 가짜 클라이언트 — 표 하나를 배열로 흉내 낸다. SQL 의 앞머리로 갈래를 고른다. */
function fakeClient(rows: { id: string; biz_name: string; active: boolean }[]) {
  const sql: { text: string; params: unknown[] }[] = [];
  const client = {
    query: async (text: string, params: unknown[] = []) => {
      sql.push({ text, params });
      if (/^\s*SELECT id, biz_name, active\s+FROM[\s\S]*btrim/.test(text)) {
        const [t, except] = params as [string, string | null];
        return { rows: rows.filter((r) => r.biz_name.trim() === t.trim() && r.id !== except).slice(0, 1) };
      }
      if (/^\s*INSERT/.test(text)) {
        const row = { id: params[0] as string, biz_name: params[1] as string, active: true };
        rows.push(row);
        return { rows: [row] };
      }
      if (/^\s*UPDATE/.test(text)) {
        const r = rows.find((x) => x.id === params[0]);
        if (!r) return { rows: [] };
        if (params[1] !== null) r.biz_name = params[1] as string;
        if (params[2] !== null) r.active = params[2] as boolean;
        return { rows: [r] };
      }
      return { rows: [] };
    },
  };
  return { client: client as unknown as ScopedClient, sql };
}

describe('처리 — 중복 409 · 404', () => {
  it('★ 같은 문구(앞뒤 공백 무시)는 409 — 사용 끈 줄이면 「다시 켜세요」', async () => {
    const { client } = fakeClient([
      { id: 'a', biz_name: '경영 컨설팅업', active: true },
      { id: 'b', biz_name: ' 부동산 임대업', active: false },
    ]);
    expect(await createBizPurposeOp(client, '경영 컨설팅업')).toMatchObject({ ok: false, status: 409, message: '같은 문구가 이미 있습니다' });
    expect(await createBizPurposeOp(client, '부동산 임대업')).toMatchObject({ ok: false, status: 409, message: expect.stringContaining('다시 켜세요') });
  });

  it('★ 새 줄의 업종코드는 NULL 로 넣는다(빈 문자열 아님)', async () => {
    const { client, sql } = fakeClient([]);
    const r = await createBizPurposeOp(client, '전자상거래업');
    expect(r).toMatchObject({ ok: true, item: { text: '전자상거래업', active: true } });
    const insert = sql.find((s) => /^\s*INSERT/.test(s.text))!;
    expect(insert.text).toMatch(/VALUES \(\$1, NULL, \$2, true, now\(\)\)/);
  });

  it('고치기 — 자기 줄과 같은 문구는 통과, 다른 줄과 같으면 409, 없는 줄은 404', async () => {
    const { client } = fakeClient([
      { id: 'a', biz_name: '경영 컨설팅업', active: true },
      { id: 'b', biz_name: '부동산 임대업', active: true },
    ]);
    expect(await updateBizPurposeOp(client, 'a', { text: ' 경영 컨설팅업 ' })).toMatchObject({ ok: true });
    expect(await updateBizPurposeOp(client, 'a', { text: '부동산 임대업' })).toMatchObject({ ok: false, status: 409 });
    expect(await updateBizPurposeOp(client, 'zz', { active: false })).toMatchObject({ ok: false, status: 404 });
  });

  it('사용 여부만 바꿀 때는 중복을 세지 않는다', async () => {
    const { client, sql } = fakeClient([{ id: 'a', biz_name: '경영 컨설팅업', active: true }]);
    expect(await updateBizPurposeOp(client, 'a', { active: false })).toMatchObject({ ok: true, item: { active: false } });
    expect(sql.some((s) => /btrim/.test(s.text))).toBe(false);
  });
});

describe('listBizPurposes — SQL', () => {
  it('검색어의 % _ \\ 는 글자로 · 한도 + 1 로 넘침을 안다', async () => {
    const sql: unknown[][] = [];
    const many = Array.from({ length: BIZ_PURPOSE_LIST_LIMIT + 1 }, (_, i) => ({ id: `r${i}`, biz_name: `문구${i}`, active: true }));
    const client = {
      query: async (_t: string, params: unknown[]) => {
        sql.push(params);
        return { rows: many };
      },
    } as unknown as ScopedClient;
    const filter: BizPurposeListFilter = { q: '50%_\\', includeInactive: false };
    const out = await listBizPurposes(client, filter);
    expect(sql[0]).toEqual([false, '50\\%\\_\\\\', BIZ_PURPOSE_LIST_LIMIT + 1]);
    expect(out.items).toHaveLength(BIZ_PURPOSE_LIST_LIMIT);
    expect(out.truncated).toBe(true);
  });
});
