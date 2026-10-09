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
    run: async () => {
      throw new Error('목록 시험은 run 을 부르지 않는다');
    },
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

// =============================================================================
// 3단계 — 새 건 · 상세 · 변경 내용 · 임원 · 회사 정보 (가짜 클라이언트)
// =============================================================================
// ★ RLS 로 실제 갈리는지 · 다른 건 임원 ID 가 0건인지는 `scripts/verify-corp-change-detail.js` 가
//   erp_app 접속 · 롤백 트랜잭션으로 본다. 여기서는 라우트의 판정 순서와 응답 모양을 본다.

interface Seen {
  sql: string;
  params: unknown[];
}

/** SQL 로 답을 고르는 가짜 클라이언트. 답이 없으면 빈 줄. */
function fakeDb(answers: { match: RegExp; rows: unknown[] }[] = []) {
  const seen: Seen[] = [];
  let runs = 0;
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      seen.push({ sql, params: params ?? [] });
      const hit = answers.find((a) => a.match.test(sql));
      return { rows: hit ? hit.rows : [], rowCount: hit ? hit.rows.length : 0 };
    },
  };
  const deps: CorpChangeDeps = {
    list: async () => [],
    codes: async () => ({ types: TYPE_ROWS, statuses: STATUS_ROWS }),
    run: async (_s, fn) => {
      runs += 1;
      return fn(client);
    },
  };
  return { deps, seen, runs: () => runs };
}

const change = (over: Record<string, unknown> = {}) => ({
  id: 'cc-1',
  org_id: 9003,
  org_code: 'Z99',
  change_type: 'OFFICER',
  status: 'P',
  payload: {},
  created_on: '2026-10-10',
  ...over,
});
const CHANGE_ROW = (over: Record<string, unknown> = {}) => ({
  match: /FROM public\.tb_s080_corp_changes\s+WHERE id/,
  rows: [change(over)],
});

describe('POST /legal/corp-changes — 첫 저장(새 건)', () => {
  const INS_CHANGE = /INSERT INTO public\.tb_s080_corp_changes/;
  const INS_OFFICER = /INSERT INTO public\.tb_s080_corp_change_officers/;

  it('★★ 회사 세션이 남의 단체 ID 로 만들면 403 — DB 에 닿지 않는다', async () => {
    const db = fakeDb();
    const a = await build(session('tenant', 9003), db.deps);
    const res = await a.inject({ method: 'POST', url: '/legal/corp-changes', payload: { changeType: 'NAME', orgId: 9001, payload: {} } });
    expect(res.statusCode).toBe(403);
    expect(db.runs()).toBe(0);
  });

  it('회사 세션 — 단체를 안 적으면 자기 단체 · 단체코드는 ERP 에서(입주사) · 본문의 코드는 안 쓴다 · 변경 내용을 같이 넣는다', async () => {
    const db = fakeDb([{ match: /SELECT link_org_code/, rows: [{ link_org_code: 'Z97' }] }]);
    const a = await build(session('tenant', 9001), db.deps);
    const res = await a.inject({
      method: 'POST',
      url: '/legal/corp-changes',
      payload: { changeType: 'NAME', orgCode: 'ZZZ', payload: { newName: '새상호' } },
    });
    expect(res.statusCode).toBe(201);
    const insert = db.seen.find((s) => INS_CHANGE.test(s.sql))!;
    // id, 구분, 상태, 변경 내용, 운영사, 단체, 단체코드, 작성자
    expect(insert.params.slice(1, 3)).toEqual(['NAME', 'P']);
    expect(JSON.parse(insert.params[3] as string)).toEqual({ newName: '새상호', newNameEn: null, resolutionDate: null });
    expect(insert.params.slice(4, 7)).toEqual([1, 9001, 'Z97']);
    expect(res.json().id).toBe(insert.params[0]);
  });

  it('운영사 — 단체 필수 · 단체코드는 형식만 본다(표시용)', async () => {
    const db = fakeDb();
    const a = await build(session('operator', 1), db.deps);
    expect((await a.inject({ method: 'POST', url: '/legal/corp-changes', payload: { changeType: 'NAME' } })).statusCode).toBe(400);
    expect(
      (await a.inject({ method: 'POST', url: '/legal/corp-changes', payload: { changeType: 'NAME', orgId: 9003, orgCode: 'Z-9' } })).statusCode,
    ).toBe(400);
    const res = await a.inject({ method: 'POST', url: '/legal/corp-changes', payload: { changeType: 'NAME', orgId: 9003, orgCode: 'Z99' } });
    expect(res.statusCode).toBe(201);
    const insert = db.seen.find((s) => INS_CHANGE.test(s.sql))!;
    expect(insert.params.slice(5, 7)).toEqual([9003, 'Z99']);
    expect(db.seen.some((s) => /link_org_code/.test(s.sql))).toBe(false);
  });

  it('★★ 임원까지 한 번에 — 주민번호는 암호화 · 평문이 어디에도 없다 · 단체는 건의 것', async () => {
    const officerRow = { id: 'o', name: '김', change_kind: 'APPOINT', position: null, effective_date: null, zip_code: null, address: null, address_detail: null, rrn_masked: '900101-1******', sort_order: 1 };
    const db = fakeDb([{ match: INS_OFFICER, rows: [officerRow] }]);
    const a = await build(session('operator', 1), db.deps);
    const res = await a.inject({
      method: 'POST',
      url: '/legal/corp-changes',
      payload: {
        changeType: 'OFFICER',
        orgId: 9003,
        payload: { resolutionDate: '2026-10-01' },
        officers: [
          { name: '김', changeKind: 'APPOINT', rrn: '900101-1234567' },
          { name: '이', changeKind: 'RESIGN' },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.body).not.toContain('1234567');
    const officers = db.seen.filter((s) => INS_OFFICER.test(s.sql));
    expect(officers).toHaveLength(2);
    const caseId = db.seen.find((s) => INS_CHANGE.test(s.sql))!.params[0];
    expect(officers.every((o) => o.params[1] === caseId && o.params[2] === 9003)).toBe(true);
    expect(JSON.stringify(db.seen.map((s) => s.params))).not.toContain('9001011234567');
    expect(officers[0]!.params[10]).toMatch(/^v1\./);
    expect(officers[1]!.params[10]).toBeNull();
  });

  it('★★ 하나라도 틀리면 아무것도 만들지 않는다 — 칸별 오류를 다 모은다 · DB 에 닿지 않는다', async () => {
    const db = fakeDb();
    const a = await build(session('operator', 1), db.deps);
    const res = await a.inject({
      method: 'POST',
      url: '/legal/corp-changes',
      payload: {
        changeType: 'OFFICER',
        orgId: 9003,
        payload: { resolutionDate: 3 },
        officers: [{ name: '김', rrn: '900101-1234567' }, { name: '이', rrn: '12345', effectiveDate: '2026-02-30' }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain('900101-1234567');
    expect(res.json().errors.map((e: { field: string }) => e.field)).toEqual([
      'resolutionDate',
      'officers.1.effectiveDate',
      'officers.1.rrn',
    ]);
    expect(db.runs()).toBe(0);
  });

  it('임원변경이 아닌 구분에 임원이 오면 400', async () => {
    const db = fakeDb();
    const a = await build(session('operator', 1), db.deps);
    const res = await a.inject({ method: 'POST', url: '/legal/corp-changes', payload: { changeType: 'NAME', orgId: 9003, officers: [{ name: '김' }] } });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].field).toBe('officers');
    expect(db.runs()).toBe(0);
  });

  it.each([['CEO_CHG'], ['name'], [undefined]])('변경 구분 %s 은 400', async (changeType) => {
    const db = fakeDb();
    const a = await build(session('operator', 1), db.deps);
    const res = await a.inject({ method: 'POST', url: '/legal/corp-changes', payload: { changeType, orgId: 9003 } });
    expect(res.statusCode).toBe(400);
    expect(db.runs()).toBe(0);
  });
});

describe('GET /legal/corp-changes/draft — 임시 모드', () => {
  it('★ 건을 읽지 않는다 · 경로가 :id 로 새지 않는다', async () => {
    const db = fakeDb();
    const a = await build(session('operator', 1), db.deps);
    const res = await a.inject({ method: 'GET', url: '/legal/corp-changes/draft?changeType=HQ&orgId=9003&orgCode=Z99' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ orgId: 9003, orgCode: 'Z99', changeType: 'HQ', status: 'P' });
    expect(res.json().company.displayName).toBe('Z99');
    expect(db.seen.some((s) => /tb_s080_corp_changes/.test(s.sql))).toBe(false);
  });

  it('★★ 회사 세션이 주소에 남의 단체를 적으면 403 — 회사 정보를 읽지 않는다', async () => {
    const db = fakeDb();
    const a = await build(session('tenant', 9003), db.deps);
    const res = await a.inject({ method: 'GET', url: '/legal/corp-changes/draft?changeType=HQ&orgId=9001' });
    expect(res.statusCode).toBe(403);
    expect(db.runs()).toBe(0);
  });

  it('회사 세션 — 단체를 안 적으면 자기 단체 · 주소의 단체코드는 쓰지 않는다', async () => {
    const db = fakeDb();
    const a = await build(session('tenant', 9003), db.deps);
    const res = await a.inject({ method: 'GET', url: '/legal/corp-changes/draft?changeType=HQ&orgCode=Z01' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ orgId: 9003, orgCode: null });
  });
});

describe('PATCH /legal/corp-changes/:id — 변경 내용', () => {
  it('★ 서류작성중(P)이 아니면 409 — 제출(A) · 완료(C) 등', async () => {
    for (const status of ['A', 'C', 'E', 'X']) {
      const db = fakeDb([CHANGE_ROW({ change_type: 'NAME', status })]);
      const a = await build(session('operator', 1), db.deps);
      const res = await a.inject({ method: 'PATCH', url: '/legal/corp-changes/cc-1', payload: { payload: { newName: '새이름' } } });
      expect(res.statusCode).toBe(409);
      expect(db.seen.some((s) => /^s*UPDATE/.test(s.sql))).toBe(false);
      await a.close();
      app = null;
    }
  });

  it('없는(안 보이는) 건은 404', async () => {
    const a = await build(session('tenant', 9003), fakeDb().deps);
    expect((await a.inject({ method: 'PATCH', url: '/legal/corp-changes/nope', payload: { payload: {} } })).statusCode).toBe(404);
  });

  it('★ 저장 때 내용 검증은 하지 않는다 — 필수 칸이 비어도 저장 · 상태를 잠가 읽는다', async () => {
    const db = fakeDb([CHANGE_ROW({ change_type: 'NAME' })]);
    const a = await build(session('tenant', 9003), db.deps);
    const res = await a.inject({ method: 'PATCH', url: '/legal/corp-changes/cc-1', payload: { payload: { newName: '' } } });
    expect(res.statusCode).toBe(200);
    expect(db.seen[0]!.sql).toContain('FOR UPDATE');
    const upd = db.seen.find((s) => /UPDATE public\.tb_s080_corp_changes/.test(s.sql))!;
    expect(JSON.parse(upd.params[1] as string)).toEqual({ newName: null, newNameEn: null, resolutionDate: null });
  });

  it('구분을 바꾸려 하면 400', async () => {
    const db = fakeDb([CHANGE_ROW({ change_type: 'NAME' })]);
    const a = await build(session('operator', 1), db.deps);
    const res = await a.inject({ method: 'PATCH', url: '/legal/corp-changes/cc-1', payload: { changeType: 'HQ', payload: {} } });
    expect(res.statusCode).toBe(400);
  });
});

describe('임원 — /legal/corp-changes/:id/officers', () => {
  const RRN = '9001011234567';
  const officerRow = {
    id: 'o-1',
    name: '김임원',
    change_kind: 'APPOINT',
    position: '이사',
    effective_date: null,
    zip_code: null,
    address: null,
    address_detail: null,
    rrn_masked: '900101-1******',
    sort_order: 1,
  };

  it('★★ 주민번호는 암호화해 넣고 · 응답에는 마스킹만 · 평문이 어디에도 없다', async () => {
    const db = fakeDb([CHANGE_ROW(), { match: /INSERT INTO public\.tb_s080_corp_change_officers/, rows: [officerRow] }]);
    const a = await build(session('tenant', 9003), db.deps);
    const res = await a.inject({
      method: 'POST',
      url: '/legal/corp-changes/cc-1/officers',
      payload: { name: '김임원', changeKind: 'APPOINT', position: '이사', rrn: '900101-1234567' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.body).not.toContain(RRN);
    expect(res.body).not.toContain('1234567');
    expect(res.json().rrnMasked).toBe('900101-1******');

    const insert = db.seen.find((s) => /INSERT INTO public\.tb_s080_corp_change_officers/.test(s.sql))!;
    // ★ 평문이 어느 자리에도 없다 · cipher 는 v1 덩어리 · rrn_iv 는 NULL(SQL 에 박혀 있다)
    expect(JSON.stringify(insert.params)).not.toContain(RRN);
    expect(insert.params[10]).toMatch(/^v1\./);
    expect(insert.params[11]).toBe('900101-1******');
    expect(insert.sql).toMatch(/\$11, NULL, \$12/);
    // 단체 ID 는 부모 건의 것
    expect(insert.params[2]).toBe(9003);
  });

  it.each([['12345'], ['900101-123456X'], ['9001011234567890']])(
    '★ 주민번호 형식 오류 %s 는 400 — DB 에 닿지 않는다',
    async (rrn) => {
      const db = fakeDb([CHANGE_ROW()]);
      const a = await build(session('operator', 1), db.deps);
      const res = await a.inject({ method: 'POST', url: '/legal/corp-changes/cc-1/officers', payload: { name: '김', rrn } });
      expect(res.statusCode).toBe(400);
      expect(db.seen).toHaveLength(0);
    },
  );

  it('★ 수정 때 주민번호를 비우면 그대로 둔다 · 수정 · 삭제는 건 ID 를 함께 건다', async () => {
    const db = fakeDb([CHANGE_ROW(), { match: /UPDATE public\.tb_s080_corp_change_officers/, rows: [officerRow] }]);
    const a = await build(session('operator', 1), db.deps);
    const res = await a.inject({
      method: 'PATCH',
      url: '/legal/corp-changes/cc-1/officers/o-1',
      payload: { name: '김임원', rrn: '' },
    });
    expect(res.statusCode).toBe(200);
    const upd = db.seen.find((s) => /UPDATE public\.tb_s080_corp_change_officers/.test(s.sql))!;
    expect(upd.sql).not.toContain('rrn_cipher');
    expect(upd.sql).toContain('WHERE id = $1 AND corp_change_id = $2');
    expect(upd.params.slice(0, 2)).toEqual(['o-1', 'cc-1']);
    await a.close();
    app = null;

    const del = fakeDb([CHANGE_ROW()]);
    const b = await build(session('operator', 1), del.deps);
    // 맞는 줄이 없으면(다른 건의 임원) 404
    expect((await b.inject({ method: 'DELETE', url: '/legal/corp-changes/cc-1/officers/other' })).statusCode).toBe(404);
    expect(del.seen.find((s) => /DELETE/.test(s.sql))!.sql).toContain('corp_change_id = $2');
  });

  it('임원변경이 아닌 건 · P 가 아닌 건은 409', async () => {
    for (const over of [{ change_type: 'NAME' }, { status: 'A' }]) {
      const db = fakeDb([CHANGE_ROW(over)]);
      const a = await build(session('operator', 1), db.deps);
      const res = await a.inject({ method: 'POST', url: '/legal/corp-changes/cc-1/officers', payload: { name: '김' } });
      expect(res.statusCode).toBe(409);
      expect(db.seen.some((s) => /INSERT/.test(s.sql))).toBe(false);
      await a.close();
      app = null;
    }
  });
});

describe('PUT /legal/corp-changes/company-info — 비입주사 법무 회사 정보(단체 기준)', () => {
  const body = { legalName: '주식회사 한빛', ceoName: '이대표', memberType: 'R' };
  const codes = {
    match: /FROM public\.tb_s080_codes_line/,
    rows: [{ category: 'MEMBER_TYPE', code: 'R', name: '주식회사' }],
  };
  const URL = '/legal/corp-changes/company-info';

  it('★ 입주사 단체면 409 — 법무는 ERP 에 쓰지 않는다(판정은 link_s020_org_id)', async () => {
    const db = fakeDb([{ match: /FROM public\.tb_s080_companies\s+WHERE link_s020_org_id/, rows: [{ company_id: 'c-1' }] }]);
    const a = await build(session('operator', 1), db.deps);
    const res = await a.inject({ method: 'PUT', url: URL, payload: { ...body, orgId: 9001 } });
    expect(res.statusCode).toBe(409);
    expect(db.seen.some((s) => /INSERT INTO public\.tb_s080_legal_orgs/.test(s.sql))).toBe(false);
  });

  it('★★ 회사 세션 — 자기 단체로 저장 · 남의 단체는 403(DB 에 닿지 않는다)', async () => {
    const db = fakeDb([codes]);
    const a = await build(session('tenant', 9003), db.deps);
    const res = await a.inject({ method: 'PUT', url: URL, payload: body });
    expect(res.statusCode).toBe(200);
    const up = db.seen.find((s) => /INSERT INTO public\.tb_s080_legal_orgs/.test(s.sql))!;
    expect(up.params.slice(0, 2)).toEqual([9003, '주식회사 한빛']);

    const other = fakeDb([codes]);
    const b = await build(session('tenant', 9003), other.deps);
    expect((await b.inject({ method: 'PUT', url: URL, payload: { ...body, orgId: 9001 } })).statusCode).toBe(403);
    expect(other.runs()).toBe(0);
  });

  it('운영사 — 단체 필수', async () => {
    const db = fakeDb([codes]);
    const a = await build(session('operator', 1), db.deps);
    expect((await a.inject({ method: 'PUT', url: URL, payload: body })).statusCode).toBe(400);
    expect((await a.inject({ method: 'PUT', url: URL, payload: { ...body, orgId: 9003 } })).statusCode).toBe(200);
  });

  it('회사유형은 MEMBER_TYPE 002 에 있어야 한다 · 칸 길이가 DB 를 넘으면 400', async () => {
    const a = await build(session('tenant', 9003), fakeDb([codes]).deps);
    const bad = await a.inject({ method: 'PUT', url: URL, payload: { ...body, memberType: 'P' } });
    expect(bad.statusCode).toBe(400);
    const long = await a.inject({ method: 'PUT', url: URL, payload: { ceoName: 'x'.repeat(51) } });
    expect(long.statusCode).toBe(400);
    expect(long.json().errors[0].field).toBe('ceoName');
  });

  it('★ 건 기준 옛 경로(/:id/company-info)는 없다', async () => {
    const a = await build(session('operator', 1), fakeDb().deps);
    expect((await a.inject({ method: 'PUT', url: '/legal/corp-changes/cc-1/company-info', payload: body })).statusCode).toBe(404);
  });
});
