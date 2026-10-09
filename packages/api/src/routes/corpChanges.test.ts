/**
 * `GET /legal/corp-changes` — 필터 읽기 · 선택지 거르기 · 운영사/회사 모두 열림.
 *
 * ★ DB 에 붙지 않는다. 세션은 시험이 직접 꽂고, 바깥은 `CorpChangeDeps` 대역이다.
 *   RLS 로 실제 갈리는지는 `scripts/verify-corp-change-list.js`(erp_app 접속, 롤백)가 본다.
 * ★ `listCorpChanges` 의 SQL 조립은 가짜 클라이언트로 본다(아래 describe).
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { ErpSession, ScopeRole } from '@swonbiz/shared';
import type { CorpChangeListFilter } from '@swonbiz/shared/domain/corp-change-list';
import { registerCorpChangeRoutes, type CorpChangeDeps } from './corpChanges.ts';
import { listCorpChanges } from '../db/corpChanges.ts';

const session = (role: ScopeRole, s020OrgId: number): ErpSession => ({
  erpSid: 'sid-hash',
  s020MemberId: 1,
  s020OrgId,
  companyId: null,
  role,
  expiresAt: new Date(Date.now() + 60_000),
  lastActiveAt: null,
});

/** 개발 DB 코드표 모양 그대로 — 앱이 모르는 CEO_CHG · S 가 섞여 있다. */
const TYPE_ROWS = [
  { code: 'CEO_ADDR', name: '대표이사 주소변경' },
  { code: 'CEO_CHG', name: '대표이사변경' },
  { code: 'HQ', name: '동일관할내에서의본점이전' },
  { code: 'NAME', name: '상호 목적 공고방법변경' },
  { code: 'OFFICER', name: '임원변경' },
  { code: 'PURPOSE', name: '목적변경' },
];
const STATUS_ROWS = [
  { code: 'A', name: '서류제출' },
  { code: 'C', name: '완료' },
  { code: 'E', name: '서류작성완료' },
  { code: 'P', name: '서류작성중' },
  { code: 'S', name: '준비중' },
  { code: 'X', name: '취소' },
];

function fakeDeps(): CorpChangeDeps & { filters: CorpChangeListFilter[]; who: number[] } {
  const filters: CorpChangeListFilter[] = [];
  const who: number[] = [];
  return {
    filters,
    who,
    list: async (s, f) => {
      filters.push(f);
      who.push(s.s020OrgId);
      return [];
    },
    codes: async () => ({ types: TYPE_ROWS, statuses: STATUS_ROWS }),
  };
}

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

async function build(who: ErpSession, deps: CorpChangeDeps): Promise<FastifyInstance> {
  app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.session = who;
  });
  registerCorpChangeRoutes(app, deps);
  await app.ready();
  return app;
}

describe('GET /legal/corp-changes — 선택지', () => {
  it('★★ CEO_CHG · S 는 선택지에 없다 · 이름은 코드표의 것', async () => {
    const a = await build(session('operator', 1), fakeDeps());
    const body = (await a.inject({ method: 'GET', url: '/legal/corp-changes' })).json();
    expect(body.changeTypes).toEqual([
      { code: 'CEO_ADDR', name: '대표이사 주소변경' },
      { code: 'HQ', name: '동일관할내에서의본점이전' },
      { code: 'NAME', name: '상호 목적 공고방법변경' },
      { code: 'OFFICER', name: '임원변경' },
      { code: 'PURPOSE', name: '목적변경' },
    ]);
    expect(body.statuses.map((s: { code: string }) => s.code)).toEqual(['A', 'C', 'E', 'P']);
    // ★ 취소는 필터에 없지만 상태 열에 이름이 나와야 한다
    expect(body.statusNames).toEqual({ P: '서류작성중', E: '서류작성완료', A: '서류제출', C: '완료', X: '취소' });
  });
});

describe('GET /legal/corp-changes — 운영사 · 회사', () => {
  it('★ 회사 세션도 403 이 아니다 — 자기 단체로 부른다(무엇이 보이는지는 RLS)', async () => {
    for (const s of [session('operator', 1), session('tenant', 9003)]) {
      const deps = fakeDeps();
      const a = await build(s, deps);
      const res = await a.inject({ method: 'GET', url: '/legal/corp-changes' });
      expect(res.statusCode).toBe(200);
      expect(deps.who).toEqual([s.s020OrgId]);
      await a.close();
      app = null;
    }
  });
});

describe('GET /legal/corp-changes — 필터', () => {
  const filterOf = async (qs: string) => {
    const deps = fakeDeps();
    const a = await build(session('operator', 1), deps);
    const res = await a.inject({ method: 'GET', url: `/legal/corp-changes${qs}` });
    return { status: res.statusCode, filter: deps.filters[0], body: res.json() };
  };

  it('★ 아무 조건이 없으면 취소는 뺀다(기본)', async () => {
    const { filter } = await filterOf('');
    expect(filter).toEqual({ from: null, to: null, changeType: null, status: null, tenancy: null, includeCancelled: false });
  });

  it('조건을 모두 실어 넘긴다', async () => {
    const { filter } = await filterOf('?from=2026-10-01&to=2026-10-31&changeType=HQ&status=E&tenancy=nontenant&includeCancelled=1');
    expect(filter).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
      changeType: 'HQ',
      status: 'E',
      tenancy: 'nontenant',
      includeCancelled: true,
    });
  });

  it.each([
    ['?from=2026-13-01', '시작일'],
    ['?to=10/31', '종료일'],
    ['?from=2026-10-31&to=2026-10-01', '늦습니다'],
    ['?changeType=CEO_CHG', '변경 구분'],
    ['?status=S', '진행 상태'],
    ['?status=X', '진행 상태'],
    ['?tenancy=member', '입주 여부'],
    ['?includeCancelled=yes', '취소 포함'],
  ])('★ 틀린 조건 %s 은 400 — 조용히 빼지 않는다', async (qs, word) => {
    const { status, filter, body } = await filterOf(qs);
    expect(status).toBe(400);
    expect(body.message).toContain(word);
    expect(filter).toBeUndefined();
  });
});

describe('listCorpChanges — SQL 조립', () => {
  const capture = async (f: Partial<CorpChangeListFilter>) => {
    const seen: { sql: string; params: unknown[] }[] = [];
    const client = {
      query: async (sql: string, params?: unknown[]) => {
        seen.push({ sql, params: params ?? [] });
        return { rows: [] };
      },
    };
    await listCorpChanges(client, {
      from: null, to: null, changeType: null, status: null, tenancy: null, includeCancelled: false, ...f,
    });
    const { sql, params } = seen[0]!;
    return { where: sql.slice(sql.indexOf('WHERE')).replace(/\s+/g, ' '), params, sql };
  };

  it('기본 — 취소만 뺀다 · 단체 조건은 SQL 에 없다(RLS 몫)', async () => {
    const { where, params, sql } = await capture({});
    expect(where).toMatch(/^WHERE c\.status <> 'X' ORDER BY/);
    expect(params).toEqual([]);
    expect(sql).not.toMatch(/org_id\s*=\s*\$/);
  });

  it('취소 포함이면 상태 조건이 없다', async () => {
    const { sql } = await capture({ includeCancelled: true });
    expect(sql).not.toContain('WHERE');
  });

  it('조합 — 자리표시 번호가 값 순서와 맞는다', async () => {
    const { where, params } = await capture({
      from: '2026-10-01', to: '2026-10-31', changeType: 'OFFICER', status: 'A', tenancy: 'tenant',
    });
    expect(where).toContain('c.created_at >= $1::date');
    expect(where).toContain('c.created_at < ($2::date + 1)');
    expect(where).toContain('c.change_type = $3');
    expect(where).toContain('c.status = $4');
    expect(where).toContain('(co.company_id IS NOT NULL) = $5');
    expect(params).toEqual(['2026-10-01', '2026-10-31', 'OFFICER', 'A', true]);
  });

  it('비입주사 필터는 false 로 넘긴다', async () => {
    const { params } = await capture({ tenancy: 'nontenant' });
    expect(params).toEqual([false]);
  });
});
