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
import { encrypt } from '../lib/crypto.ts';
import type {
  BbiyongCompanyDefaults,
  LegalOrgInput,
  LegalOrgSyncResult,
} from '@swonbiz/shared/domain/corp-change-detail';

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
  { code: 'NAME', name: '상호변경' },
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
    companyDefaults: async () => null,
    pushCompany: async () => null,
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
  it('★★ CEO_CHG · S · A(제출) 는 선택지에 없다 · 이름은 코드표의 것', async () => {
    const a = await build(session('operator', 1), fakeDeps());
    const body = (await a.inject({ method: 'GET', url: '/legal/corp-changes' })).json();
    expect(body.changeTypes).toEqual([
      { code: 'CEO_ADDR', name: '대표이사 주소변경' },
      { code: 'HQ', name: '동일관할내에서의본점이전' },
      { code: 'NAME', name: '상호변경' },
      { code: 'OFFICER', name: '임원변경' },
      { code: 'PURPOSE', name: '목적변경' },
    ]);
    expect(body.statuses.map((s: { code: string }) => s.code)).toEqual(['C', 'E', 'P']);
    // ★ 취소는 필터에 없지만 상태 열에 이름이 나와야 한다
    expect(body.statusNames).toEqual({ P: '서류작성중', E: '서류작성완료', C: '완료', X: '취소' });
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
      from: '2026-10-01', to: '2026-10-31', changeType: 'OFFICER', status: 'C', tenancy: 'tenant',
    });
    expect(where).toContain('c.created_at >= $1::date');
    expect(where).toContain('c.created_at < ($2::date + 1)');
    expect(where).toContain('c.change_type = $3');
    expect(where).toContain('c.status = $4');
    expect(where).toContain('(co.company_id IS NOT NULL) = $5');
    expect(params).toEqual(['2026-10-01', '2026-10-31', 'OFFICER', 'C', true]);
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
function fakeDb(
  answers: { match: RegExp; rows: unknown[] }[] = [],
  defaults: BbiyongCompanyDefaults | null = null,
  sync: LegalOrgSyncResult | null = { kind: 'ok' },
) {
  const seen: Seen[] = [];
  const asked: { role: string; orgId: number }[] = [];
  /** 삐용 보내기 — 그때까지 run 이 몇 번 끝났는지(커밋 뒤인지)도 적는다. */
  const pushed: { orgCode: string | null; company: LegalOrgInput; runsBefore: number }[] = [];
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
    companyDefaults: async (s, orgId) => {
      asked.push({ role: s.role, orgId });
      return defaults;
    },
    pushCompany: async (_s, orgCode, company) => {
      pushed.push({ orgCode, company, runsBefore: runs });
      return sync;
    },
  };
  return { deps, seen, asked, pushed, runs: () => runs };
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

describe('비입주사 회사 정보 — [저장] 하나로(첫 저장 · PATCH 의 company)', () => {
  const company = { legalName: '주식회사 한빛', ceoName: '이대표', memberType: 'R' };
  const codes = {
    match: /FROM public\.tb_s080_codes_line/,
    rows: [{ category: 'MEMBER_TYPE', code: 'R', name: '주식회사' }],
  };
  const TENANT = { match: /FROM public\.tb_s080_companies\s+WHERE link_s020_org_id/, rows: [{ company_id: 'c-1' }] };
  const UPSERT_ORG = /INSERT INTO public\.tb_s080_legal_orgs/;
  const UPD_PAYLOAD = /UPDATE public\.tb_s080_corp_changes\s+SET payload/;

  it('★★ 단체 기준 옛 경로는 없다 — PUT /company-info 는 404(:id 로도 새지 않는다)', async () => {
    const db = fakeDb();
    const a = await build(session('operator', 1), db.deps);
    expect((await a.inject({ method: 'PUT', url: '/legal/corp-changes/company-info', payload: company })).statusCode).toBe(404);
    expect((await a.inject({ method: 'PUT', url: '/legal/corp-changes/cc-1/company-info', payload: company })).statusCode).toBe(404);
    expect(db.runs()).toBe(0);
  });

  it('첫 저장 — 건과 회사 정보를 같은 트랜잭션(run 한 번)에서 · 회사 단체는 건의 단체', async () => {
    const db = fakeDb([codes]);
    const a = await build(session('operator', 1), db.deps);
    const res = await a.inject({
      method: 'POST',
      url: '/legal/corp-changes',
      payload: { changeType: 'NAME', orgId: 9003, orgCode: 'Z99', payload: {}, company },
    });
    expect(res.statusCode).toBe(201);
    expect(db.runs()).toBe(1);
    const up = db.seen.find((s) => UPSERT_ORG.test(s.sql))!;
    expect(up.params.slice(0, 2)).toEqual([9003, '주식회사 한빛']);
  });

  it('★★ 첫 저장 — 회사 정보가 틀리면 건을 만들지 않는다(판정이 쓰기보다 먼저)', async () => {
    // 회사유형이 코드표에 없다 → 400 · 입주사 단체 → 409. 어느 쪽도 INSERT 가 없다.
    const cases: [{ match: RegExp; rows: unknown[] }[], Record<string, unknown>, number][] = [
      [[codes], { ...company, memberType: 'P' }, 400],
      [[TENANT, codes], company, 409],
    ];
    for (const [answers, body, status] of cases) {
      const db = fakeDb(answers);
      const a = await build(session('operator', 1), db.deps);
      const res = await a.inject({
        method: 'POST',
        url: '/legal/corp-changes',
        payload: { changeType: 'NAME', orgId: 9003, payload: { newName: '새' }, company: body },
      });
      expect(res.statusCode).toBe(status);
      if (status === 400) expect(res.json().errors[0].field).toBe('company.memberType');
      expect(db.seen.some((s) => /^\s*(INSERT|UPDATE)/.test(s.sql))).toBe(false);
      await a.close();
      app = null;
    }
  });

  it('첫 저장 — 회사 칸 모양 · 길이 오류는 변경 내용 오류와 함께 모은다 · DB 에 닿지 않는다', async () => {
    const db = fakeDb();
    const a = await build(session('operator', 1), db.deps);
    const res = await a.inject({
      method: 'POST',
      url: '/legal/corp-changes',
      payload: { changeType: 'NAME', orgId: 9003, payload: { newName: 3 }, company: { ceoName: 'x'.repeat(51), tel: 5 } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors.map((e: { field: string }) => e.field)).toEqual(['newName', 'company.ceoName', 'company.tel']);
    expect(db.runs()).toBe(0);
  });

  it('★★ 회사 세션 — 회사 정보를 실으면 403 · 건도 회사 정보도 쓰지 않는다(운영사만, 결정 2026-10-22)', async () => {
    const db = fakeDb([codes]);
    const a = await build(session('tenant', 9003), db.deps);
    const res = await a.inject({ method: 'POST', url: '/legal/corp-changes', payload: { changeType: 'NAME', payload: {}, company } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('operator_only');
    expect(db.seen.some((s) => /^\s*(INSERT|UPDATE)/.test(s.sql))).toBe(false);
  });

  it('★★ 회사 세션 — PATCH 에 회사 정보를 실으면 403 · 변경 내용도 안 바뀐다 · 안 실으면 저장된다', async () => {
    const db = fakeDb([CHANGE_ROW({ change_type: 'NAME' }), codes]);
    const a = await build(session('tenant', 9003), db.deps);
    const res = await a.inject({ method: 'PATCH', url: '/legal/corp-changes/cc-1', payload: { payload: { newName: '새' }, company } });
    expect(res.statusCode).toBe(403);
    expect(db.seen.some((s) => UPD_PAYLOAD.test(s.sql) || UPSERT_ORG.test(s.sql))).toBe(false);
    const ok = await a.inject({ method: 'PATCH', url: '/legal/corp-changes/cc-1', payload: { payload: { newName: '새' } } });
    expect(ok.statusCode).toBe(200);
    expect(db.seen.some((s) => UPSERT_ORG.test(s.sql))).toBe(false);
  });

  it('PATCH — 변경 내용과 회사 정보를 같이 저장하고 새 상세를 돌려준다', async () => {
    const db = fakeDb([CHANGE_ROW({ change_type: 'NAME' }), codes]);
    const a = await build(session('operator', 1), db.deps);
    const res = await a.inject({ method: 'PATCH', url: '/legal/corp-changes/cc-1', payload: { payload: { newName: '새' }, company } });
    expect(res.statusCode).toBe(200);
    expect(db.runs()).toBe(1);
    expect(db.seen.find((s) => UPSERT_ORG.test(s.sql))!.params[0]).toBe(9003);
    expect(res.json()).toMatchObject({ id: 'cc-1', status: 'P', company: { isTenant: false } });
  });

  it('★★ PATCH — 회사 정보가 틀리면 변경 내용도 바꾸지 않는다', async () => {
    const cases: [{ match: RegExp; rows: unknown[] }[], Record<string, unknown>, number][] = [
      [[codes], { ...company, memberType: 'P' }, 400],
      [[TENANT, codes], company, 409],
      [[codes], { legalName: 7 }, 400],
    ];
    for (const [answers, body, status] of cases) {
      const db = fakeDb([CHANGE_ROW({ change_type: 'NAME' }), ...answers]);
      const a = await build(session('operator', 1), db.deps);
      const res = await a.inject({ method: 'PATCH', url: '/legal/corp-changes/cc-1', payload: { payload: { newName: '새' }, company: body } });
      expect(res.statusCode).toBe(status);
      expect(db.seen.some((s) => UPD_PAYLOAD.test(s.sql) || UPSERT_ORG.test(s.sql))).toBe(false);
      await a.close();
      app = null;
    }
  });

  it('PATCH — company 를 안 실으면 회사 정보를 건드리지 않는다', async () => {
    const db = fakeDb([CHANGE_ROW({ change_type: 'NAME' })]);
    const a = await build(session('operator', 1), db.deps);
    const res = await a.inject({ method: 'PATCH', url: '/legal/corp-changes/cc-1', payload: { payload: { newName: '새' } } });
    expect(res.statusCode).toBe(200);
    expect(db.seen.some((s) => UPSERT_ORG.test(s.sql))).toBe(false);
    expect(db.seen.some((s) => UPD_PAYLOAD.test(s.sql))).toBe(true);
  });
});

describe('비입주사 회사 정보 → 삐용 보내기(결정 2026-10-22)', () => {
  const company = {
    legalName: '주식회사 한빛',
    memberType: 'R',
    bizNumber: '1058768687',
    corpNumber: '1110002313123',
    headZipCode: '06097',
    headAddress: '서울 강남구 테헤란로 1',
  };
  const codes = { match: /FROM public\.tb_s080_codes_line/, rows: [{ category: 'MEMBER_TYPE', code: 'R', name: '주식회사' }] };
  const TENANT = { match: /FROM public\.tb_s080_companies\s+WHERE link_s020_org_id/, rows: [{ company_id: 'c-1' }] };
  const UPSERT_ORG = /INSERT INTO public\.tb_s080_legal_orgs/;

  it('★★ 첫 저장 — 커밋 뒤에 보낸다 · 단체코드는 팝업 값 · 번호는 저장 모양(하이픈) 그대로 · 응답에 결과', async () => {
    const db = fakeDb([codes]);
    const a = await build(session('operator', 1), db.deps);
    const res = await a.inject({
      method: 'POST',
      url: '/legal/corp-changes',
      payload: { changeType: 'NAME', orgId: 9003, orgCode: 'Z99', payload: {}, company },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ companySync: { kind: 'ok' } });
    expect(db.pushed).toHaveLength(1);
    expect(db.pushed[0]).toMatchObject({
      orgCode: 'Z99',
      runsBefore: 1,
      company: { bizNumber: '105-87-68687', corpNumber: '111000-2313123', headZipCode: '06097' },
    });
  });

  it('★★ PATCH — 단체코드는 건의 것 · 실패해도 저장은 그대로(200) · 사유를 응답에 싣는다', async () => {
    const db = fakeDb([CHANGE_ROW({ change_type: 'NAME' }), codes], null, { kind: 'failed', reason: '삐용이 거절했다' });
    const a = await build(session('operator', 1), db.deps);
    const res = await a.inject({ method: 'PATCH', url: '/legal/corp-changes/cc-1', payload: { payload: { newName: '새' }, company } });
    expect(res.statusCode).toBe(200);
    expect(db.seen.some((s) => UPSERT_ORG.test(s.sql))).toBe(true);
    expect(db.pushed.map((p) => [p.orgCode, p.runsBefore])).toEqual([['Z99', 1]]);
    expect(res.json()).toMatchObject({ id: 'cc-1', companySync: { kind: 'failed', reason: '삐용이 거절했다' } });
  });

  it('회사 정보를 안 실으면 보내지 않는다 — PATCH 응답의 companySync 는 null', async () => {
    const db = fakeDb([CHANGE_ROW({ change_type: 'NAME' })]);
    const a = await build(session('operator', 1), db.deps);
    const res = await a.inject({ method: 'PATCH', url: '/legal/corp-changes/cc-1', payload: { payload: { newName: '새' } } });
    expect(res.statusCode).toBe(200);
    expect(res.json().companySync).toBeNull();
    expect(db.pushed).toEqual([]);
  });

  it('★ 저장이 거절되면(입주사 409 · 회사 세션 403 · 칸 오류 400) 보내지 않는다', async () => {
    const cases: [ErpSession, { match: RegExp; rows: unknown[] }[], Record<string, unknown>, number][] = [
      [session('operator', 1), [TENANT, codes], company, 409],
      [session('tenant', 9003), [codes], company, 403],
      [session('operator', 1), [codes], { ...company, tel: 5 }, 400],
    ];
    for (const [who, answers, body, status] of cases) {
      const db = fakeDb([CHANGE_ROW({ change_type: 'NAME' }), ...answers]);
      const a = await build(who, db.deps);
      const res = await a.inject({ method: 'PATCH', url: '/legal/corp-changes/cc-1', payload: { payload: { newName: '새' }, company: body } });
      expect(res.statusCode).toBe(status);
      expect(db.pushed).toEqual([]);
      await a.close();
      app = null;
    }
  });
});

describe('비입주사 회사 정보의 기본값 — 삐용 값으로 빈 칸만 채워 보여 준다', () => {
  const LEGAL_ROW = (over: Record<string, unknown>) => ({ match: /FROM public\.tb_s080_legal_orgs/, rows: [over] });
  const draftUrl = '/legal/corp-changes/draft?changeType=NAME&orgId=9003&orgCode=Z99';

  it('★ 법무 회사 정보가 없으면 회사명 · 대표자명을 채우고 「저장 전」 칸으로 알린다 · 쓰지 않는다', async () => {
    const db = fakeDb([], { orgName: '주식회사 삐용', repName: '김대표' });
    const a = await build(session('operator', 1), db.deps);
    const body = (await a.inject({ method: 'GET', url: draftUrl })).json();
    expect(body.company).toMatchObject({
      displayName: '주식회사 삐용',
      legalName: '주식회사 삐용',
      ceoName: '김대표',
      defaultedFields: ['legalName', 'ceoName'],
      hasLegalOrg: false,
    });
    expect(db.asked).toEqual([{ role: 'operator', orgId: 9003 }]);
    expect(db.seen.some((s) => /^\s*(INSERT|UPDATE)/.test(s.sql))).toBe(false);
  });

  it('★ 저장된 값이 우선 — 빈 칸만 채운다', async () => {
    const db = fakeDb([LEGAL_ROW({ legal_name: '등기 상호', ceo_name: null })], { orgName: '삐용 이름', repName: '김대표' });
    const a = await build(session('operator', 1), db.deps);
    const body = (await a.inject({ method: 'GET', url: draftUrl })).json();
    expect(body.company).toMatchObject({ legalName: '등기 상호', ceoName: '김대표', defaultedFields: ['ceoName'] });
  });

  it('조회 실패(null)면 칸을 비워 두고 회사명은 단체코드', async () => {
    const db = fakeDb([], null);
    const a = await build(session('operator', 1), db.deps);
    const body = (await a.inject({ method: 'GET', url: draftUrl })).json();
    expect(body.company).toMatchObject({ displayName: 'Z99', legalName: null, ceoName: null, defaultedFields: [] });
  });

  it('★ 입주사는 부르지도 채우지도 않는다 — ERP 값 그대로', async () => {
    const db = fakeDb(
      [{ match: /FROM public\.tb_s080_companies\s+WHERE link_s020_org_id/, rows: [{ company_id: 'c-1', company_name: null }] }],
      { orgName: '삐용 이름' },
    );
    const a = await build(session('operator', 1), db.deps);
    const body = (await a.inject({ method: 'GET', url: draftUrl })).json();
    expect(body.company).toMatchObject({ isTenant: true, legalName: null, defaultedFields: [] });
    expect(db.asked).toEqual([]);
  });

  it('상세 · 저장 응답에도 같은 규칙 — 건의 단체로 묻는다(회사 세션은 자기 단체)', async () => {
    const db = fakeDb([CHANGE_ROW({ change_type: 'NAME' })], { orgName: '내 회사' });
    const a = await build(session('tenant', 9003), db.deps);
    const detail = (await a.inject({ method: 'GET', url: '/legal/corp-changes/cc-1' })).json();
    expect(detail.company).toMatchObject({ legalName: '내 회사', defaultedFields: ['legalName'] });
    const saved = (await a.inject({ method: 'PATCH', url: '/legal/corp-changes/cc-1', payload: { payload: {} } })).json();
    expect(saved.company.displayName).toBe('내 회사');
    expect(db.asked.length).toBe(2);
    expect(db.asked.every((q) => q.role === 'tenant' && q.orgId === 9003)).toBe(true);
  });

  it('★ 회사유형은 상호에서 추정한다 — 코드표(002) 이름으로 찾는다 · 「저장 전」', async () => {
    const codes = {
      match: /FROM public\.tb_s080_codes_line/,
      rows: [
        { category: 'MEMBER_TYPE', code: 'R', name: '주식회사' },
        { category: 'MEMBER_TYPE', code: 'A', name: '유한회사' },
      ],
    };
    const db = fakeDb([codes], { orgName: '(유)삐용' });
    const a = await build(session('operator', 1), db.deps);
    const body = (await a.inject({ method: 'GET', url: draftUrl })).json();
    expect(body.company).toMatchObject({ memberType: 'A', memberTypeName: '유한회사', defaultedFields: ['legalName', 'memberType'] });
  });

  it('★ 숫자 칸 자릿수가 틀리면 400(company.tel) — 변경 내용도 안 바뀐다', async () => {
    const db = fakeDb([CHANGE_ROW({ change_type: 'NAME' })]);
    const a = await build(session('operator', 1), db.deps);
    const res = await a.inject({
      method: 'PATCH',
      url: '/legal/corp-changes/cc-1',
      payload: { payload: { newName: '새' }, company: { tel: '010-123-4567' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors.map((e: { field: string }) => e.field)).toEqual(['company.tel']);
    expect(db.seen.some((s) => /^\s*(INSERT|UPDATE)/.test(s.sql))).toBe(false);
  });

  it('실패 응답에는 부르지 않는다', async () => {
    const db = fakeDb([], { orgName: 'x' });
    const a = await build(session('operator', 1), db.deps);
    expect((await a.inject({ method: 'GET', url: '/legal/corp-changes/nope' })).statusCode).toBe(404);
    expect(db.asked).toEqual([]);
  });
});

// =============================================================================
// 4단계 — 상태 전이 · 삭제 · 제출 스냅샷 (가짜 클라이언트)
// =============================================================================
// ★ RLS · 동시 전이 · 원자성은 `scripts/verify-corp-change-transition.js`(erp_app 접속 · 롤백)가 본다.
//   여기서는 라우트의 판정 순서 · 거절 상태 코드 · 쓰는 SQL 을 본다.

describe('POST /legal/corp-changes/:id/transition — 상태 전이', () => {
  const URL = '/legal/corp-changes/cc-1/transition';
  const STATUS_UPDATE = { match: /UPDATE public\.tb_s080_corp_changes SET status/, rows: [{}] };
  const NAME_OK = { newName: '주식회사 새이름', resolutionDate: '2026-10-01' };
  /** 비입주사 법무 회사 정보 — 대표자 자택이 있다(대표주소 변경의 「변경 전 주소」). */
  const CEO_HOME = {
    match: /FROM public\.tb_s080_legal_orgs/,
    rows: [{ ceo_zip_code: '06000', ceo_address: '서울 강남구 자택로 1', ceo_address_detail: null }],
  };
  const statusUpdate = (db: ReturnType<typeof fakeDb>) =>
    db.seen.find((s) => /UPDATE public\.tb_s080_corp_changes SET status/.test(s.sql));

  /** 그 상태의 건에서 그 역할로 to 를 누른다. */
  async function press(
    role: ScopeRole,
    row: Record<string, unknown>,
    to: string,
    extra: Record<string, unknown> = {},
    answers: { match: RegExp; rows: unknown[] }[] = [],
  ) {
    const db = fakeDb([CHANGE_ROW(row), STATUS_UPDATE, ...answers]);
    const a = await build(session(role, role === 'operator' ? 1 : 9003), db.deps);
    const res = await a.inject({ method: 'POST', url: URL, payload: { from: row.status, to, ...extra } });
    await a.close();
    app = null;
    return { res, db };
  }

  it.each([
    ['P', 'E'],
    ['E', 'P'],
    ['E', 'C'],
  ])('★ 회사 — %s→%s 허용', async (from, to) => {
    const { res, db } = await press('tenant', { change_type: 'NAME', status: from, payload: NAME_OK }, to);
    expect(res.statusCode).toBe(200);
    expect(statusUpdate(db)!.params.slice(0, 3)).toEqual(['cc-1', from, to]);
  });

  it.each([
    ['C', 'E'],
    ['P', 'X'],
    ['E', 'X'],
    ['C', 'X'],
  ])('★★ 회사 — %s→%s 는 403 · 쓰지 않는다', async (from, to) => {
    const { res, db } = await press('tenant', { change_type: 'NAME', status: from, payload: NAME_OK }, to);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('forbidden');
    expect(statusUpdate(db)).toBeUndefined();
  });

  it('★★ 회사 — 복원(X→직전)도 403', async () => {
    const { res, db } = await press('tenant', { change_type: 'NAME', status: 'X', status_before_cancel: 'E' }, 'E');
    expect(res.statusCode).toBe(403);
    expect(statusUpdate(db)).toBeUndefined();
  });

  it.each([
    ['P', 'E'],
    ['E', 'P'],
    ['E', 'C'],
    ['C', 'E'],
    ['P', 'X'],
    ['E', 'X'],
    ['C', 'X'],
  ])('운영사 — %s→%s 허용', async (from, to) => {
    const { res } = await press('operator', { change_type: 'NAME', status: from, payload: NAME_OK }, to);
    expect(res.statusCode).toBe(200);
  });

  it.each([
    ['P', 'C'],
    ['C', 'P'],
    ['P', 'P'],
  ])('★ 표에 없는 전이 %s→%s 는 409(운영사도)', async (from, to) => {
    const { res, db } = await press('operator', { change_type: 'NAME', status: from, payload: NAME_OK }, to);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('not_allowed');
    expect(statusUpdate(db)).toBeUndefined();
  });

  it('★★ 제출(A)은 없다 — A 로 가는 요청은 400(모르는 상태) · DB 에 닿지 않는다', async () => {
    const db = fakeDb([CHANGE_ROW({ change_type: 'NAME', status: 'E' })]);
    const a = await build(session('operator', 1), db.deps);
    expect((await a.inject({ method: 'POST', url: URL, payload: { from: 'E', to: 'A' } })).statusCode).toBe(400);
    expect(db.seen).toHaveLength(0);
  });

  it('★ 복원 — 취소 직전 상태로만(다르면 409) · 맞으면 취소 칸을 비운다', async () => {
    const wrong = await press('operator', { change_type: 'NAME', status: 'X', status_before_cancel: 'E' }, 'P');
    expect(wrong.res.statusCode).toBe(409);
    expect(wrong.res.json().error).toBe('restore_target');
    expect(statusUpdate(wrong.db)).toBeUndefined();

    const right = await press('operator', { change_type: 'NAME', status: 'X', status_before_cancel: 'E' }, 'E');
    expect(right.res.statusCode).toBe(200);
    expect(statusUpdate(right.db)!.sql).toMatch(/status_before_cancel = NULL, cancelled_at = NULL, cancel_reason = NULL/);
  });

  it('★★ 화면이 본 상태가 낡았으면 409 — 잠가서 읽고 · 쓰지 않는다', async () => {
    // 운영사가 C 를 보고 완료 취소(C→E)를 눌렀는데 그새 취소(X)됐다 — 덮지 않고 막혀야 한다
    const db = fakeDb([CHANGE_ROW({ change_type: 'NAME', status: 'X', status_before_cancel: 'C' }), STATUS_UPDATE]);
    const a = await build(session('operator', 1), db.deps);
    const res = await a.inject({ method: 'POST', url: URL, payload: { from: 'C', to: 'E' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('stale_status');
    expect(db.seen[0]!.sql).toContain('FOR UPDATE');
    expect(statusUpdate(db)).toBeUndefined();
  });

  it('본문 모양이 틀리면 400 — DB 에 닿지 않는다(from 없음 · 모르는 상태 · 취소 아닌데 사유)', async () => {
    for (const payload of [{ to: 'E' }, { from: 'P', to: 'S' }, { from: 'E', to: 'C', cancelReason: '왜' }]) {
      const db = fakeDb([CHANGE_ROW()]);
      const a = await build(session('operator', 1), db.deps);
      expect((await a.inject({ method: 'POST', url: URL, payload })).statusCode).toBe(400);
      expect(db.seen).toHaveLength(0);
      await a.close();
      app = null;
    }
  });

  it('없는(안 보이는) 건은 404', async () => {
    const a = await build(session('tenant', 9003), fakeDb().deps);
    expect((await a.inject({ method: 'POST', url: URL, payload: { from: 'P', to: 'E' } })).statusCode).toBe(404);
  });

  it('★★ P→E 검증 실패 — 400 + 칸별 오류 · 상태 불변(UPDATE 없음) · 저장된 값으로 검증', async () => {
    const { res, db } = await press(
      'tenant',
      { change_type: 'HQ', status: 'P', payload: { newHqAddress: { zipCode: '06000' }, resolutionDate: '2026-10-01', relocationDate: '2026-10-02' } },
      'E',
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toEqual([{ field: 'newHqAddress.address', message: '신규 본점주소의 기본주소을(를) 입력하세요' }]);
    expect(statusUpdate(db)).toBeUndefined();
  });

  it.each([
    ['NAME', { newName: '새' }, ['resolutionDate']],
    ['PURPOSE', { purposes: '소프트웨어 개발' }, ['resolutionDate']],
    ['HQ', { newHqAddress: { zipCode: '06000', address: '서울' } }, ['resolutionDate', 'relocationDate']],
    ['CEO_ADDR', { newCeoAddress: { zipCode: '04000', address: '서울' } }, ['moveInDate']],
  ])('★ 작성완료 때 날짜 필수 — %s 은(는) 날짜가 없으면 400 · 칸별 오류 · 상태 불변', async (type, payload, missing) => {
    const { res, db } = await press('tenant', { change_type: type, status: 'P', payload }, 'E', {}, [CEO_HOME]);
    expect(res.statusCode).toBe(400);
    expect(res.json().errors.map((e: { field: string }) => e.field)).toEqual(missing);
    expect(statusUpdate(db)).toBeUndefined();
  });

  describe('★ 대표주소 변경 — 「변경 전 주소」 = 기본정보의 대표자 자택', () => {
    const CEO_PAYLOAD = { newCeoAddress: { zipCode: '04000', address: '서울' }, moveInDate: '2026-10-01' };

    it('자택 주소가 있으면 통과 · 스냅샷의 변경 전 회사값에 자택이 들어간다', async () => {
      const { res, db } = await press('tenant', { change_type: 'CEO_ADDR', status: 'P', payload: CEO_PAYLOAD }, 'E', {}, [CEO_HOME]);
      expect(res.statusCode).toBe(200);
      const snap = JSON.parse(statusUpdate(db)!.params[4] as string);
      expect(snap.company.ceoHome).toEqual({ zipCode: '06000', address: '서울 강남구 자택로 1', addressDetail: null });
    });

    it('비입주사 — 자택 주소가 비면 400(company.ceo) · 상태 불변', async () => {
      const { res, db } = await press('tenant', { change_type: 'CEO_ADDR', status: 'P', payload: CEO_PAYLOAD }, 'E');
      expect(res.statusCode).toBe(400);
      expect(res.json().errors).toEqual([
        { field: 'company.ceo', message: '대표자 자택 주소(변경 전 주소)의 우편번호 · 기본주소를 입력하세요' },
      ]);
      expect(statusUpdate(db)).toBeUndefined();
    });

    it('입주사 — 문구가 입주사 화면으로 보낸다', async () => {
      const tenant = { match: /FROM public\.tb_s080_companies\s+WHERE link_s020_org_id/, rows: [{ company_id: 'c-1', ceo_address: null }] };
      const { res } = await press('operator', { change_type: 'CEO_ADDR', status: 'P', payload: CEO_PAYLOAD }, 'E', {}, [tenant]);
      expect(res.statusCode).toBe(400);
      expect(res.json().errors[0]).toEqual({
        field: 'company.ceo',
        message: '대표자 자택 주소(변경 전 주소)가 비어 있습니다 — 입주사 화면에서 입력하세요',
      });
    });

    it('★ 옛 건 payload 의 oldCeoAddress 는 무시한다 — 검증을 막지 않는다', async () => {
      const { res } = await press(
        'tenant',
        { change_type: 'CEO_ADDR', status: 'P', payload: { ...CEO_PAYLOAD, oldCeoAddress: { zipCode: '1', address: '옛' } } },
        'E',
        {},
        [CEO_HOME],
      );
      expect(res.statusCode).toBe(200);
    });
  });

  describe('임원 건 — 저장된 임원 목록을 함께 검증한다', () => {
    const OFFICERS = /FROM public\.tb_s080_corp_change_officers\s+WHERE corp_change_id/;
    const officer = (over: Record<string, unknown> = {}) => ({
      id: 'o-1',
      name: '김임원',
      change_kind: 'APPOINT',
      position: '이사',
      effective_date: '2026-10-01',
      zip_code: null,
      address: null,
      address_detail: null,
      rrn_masked: '900101-1******',
      sort_order: 1,
      ...over,
    });
    const OFFICER_PAYLOAD = { resolutionDate: '2026-10-01' };

    it('임원이 없으면 400(officers)', async () => {
      const { res, db } = await press('tenant', { status: 'P', payload: OFFICER_PAYLOAD }, 'E');
      expect(res.statusCode).toBe(400);
      expect(res.json().errors).toEqual([{ field: 'officers', message: '임원을 1명 이상 등록하세요' }]);
      expect(statusUpdate(db)).toBeUndefined();
    });

    it('★ 임원변경 — 결의일 · 임원별 효력일이 없으면 400(officers.{순번}.effectiveDate)', async () => {
      const { res, db } = await press('tenant', { status: 'P', payload: {} }, 'E', {}, [
        { match: OFFICERS, rows: [officer(), officer({ id: 'o-2', effective_date: null })] },
      ]);
      expect(res.statusCode).toBe(400);
      expect(res.json().errors.map((e: { field: string }) => e.field)).toEqual(['resolutionDate', 'officers.1.effectiveDate']);
      expect(statusUpdate(db)).toBeUndefined();
    });

    it('★ 줄 오류는 officers.{순번}.{칸} — 화면이 그 줄 옆에 붙인다', async () => {
      const { res } = await press('tenant', { status: 'P', payload: OFFICER_PAYLOAD }, 'E', {}, [
        { match: OFFICERS, rows: [officer(), officer({ id: 'o-2', position: null })] },
      ]);
      expect(res.statusCode).toBe(400);
      expect(res.json().errors).toEqual([{ field: 'officers.1.position', message: '직위를 입력하세요' }]);
    });

    it('★★ P→E — 작성완료 시각 · 스냅샷을 같은 UPDATE 에 싣는다 · 주민번호(마스킹 포함) 없음 · 회사값은 변경 전 값', async () => {
      const legal = {
        match: /FROM public\.tb_s080_legal_orgs/,
        rows: [
          {
            legal_name: '주식회사 시험',
            corp_number: '110111-0000001',
            biz_number: '123-45-67890',
            ceo_name: '홍대표',
            tel: '02-000-0000',
            member_type: 'A',
            head_zip_code: '06000',
            head_address: '서울 강남구',
            head_address_detail: null,
            ceo_zip_code: '04000',
            ceo_address: '서울 마포구',
            ceo_address_detail: '101호',
          },
        ],
      };
      const { res, db } = await press('tenant', { status: 'P', payload: OFFICER_PAYLOAD }, 'E', {}, [
        { match: OFFICERS, rows: [officer()] },
        legal,
      ]);
      expect(res.statusCode).toBe(200);
      const upd = statusUpdate(db)!;
      expect(upd.sql).toMatch(/written_at = now\(\), submit_snapshot = \$5::jsonb/);
      const raw = upd.params[4] as string;
      expect(raw).not.toContain('900101');
      expect(raw).not.toMatch(/rrn/i);
      const snap = JSON.parse(raw);
      expect(snap.version).toBe(3);
      expect(snap.company).toEqual({
        isTenant: false,
        name: '주식회사 시험',
        corpNumber: '110111-0000001',
        bizNumber: '123-45-67890',
        ceoName: '홍대표',
        tel: '02-000-0000',
        memberType: 'A',
        head: { zipCode: '06000', address: '서울 강남구', addressDetail: null },
        ceoHome: { zipCode: '04000', address: '서울 마포구', addressDetail: '101호' },
      });
      expect(snap.payload).toEqual(OFFICER_PAYLOAD);
      expect(snap.officers).toEqual([
        { name: '김임원', changeKind: 'APPOINT', position: '이사', effectiveDate: '2026-10-01', zipCode: null, address: null, addressDetail: null },
      ]);
    });
  });

  it('★ 취소 — 직전 상태 · 시각 · 사유를 같은 UPDATE 로', async () => {
    const { res, db } = await press('operator', { change_type: 'NAME', status: 'C' }, 'X', { cancelReason: '고객 요청' });
    expect(res.statusCode).toBe(200);
    const upd = statusUpdate(db)!;
    expect(upd.sql).toMatch(/status_before_cancel = \$2, cancelled_at = now\(\), cancel_reason = \$5/);
    expect(upd.sql).toMatch(/WHERE id = \$1 AND status = \$2/);
    expect(upd.params).toEqual(['cc-1', 'C', 'X', '1', '고객 요청']);
  });

  it('★ E→C 는 완료 시각 · C→E(완료 취소)는 완료 시각을 비운다 · E→P 는 작성완료 기록을 지우지 않는다', async () => {
    const done = await press('operator', { change_type: 'NAME', status: 'E' }, 'C');
    expect(statusUpdate(done.db)!.sql).toContain('completed_at = now()');
    const undo = await press('operator', { change_type: 'NAME', status: 'C' }, 'E');
    expect(statusUpdate(undo.db)!.sql).toContain('completed_at = NULL');
    expect(statusUpdate(undo.db)!.sql).not.toMatch(/written_at|submit_snapshot/);
    const back = await press('operator', { change_type: 'NAME', status: 'E' }, 'P');
    expect(statusUpdate(back.db)!.sql).not.toMatch(/written_at|submit_snapshot|completed_at/);
  });
});

describe('DELETE /legal/corp-changes/:id — 삭제', () => {
  const dels = (db: ReturnType<typeof fakeDb>) => db.seen.filter((s) => /^DELETE/.test(s.sql.trim()));
  async function remove(role: ScopeRole, status: string, from: string | null = status) {
    const db = fakeDb([CHANGE_ROW({ status }), { match: /DELETE FROM public\.tb_s080_corp_changes /, rows: [{}] }]);
    const a = await build(session(role, role === 'operator' ? 1 : 9003), db.deps);
    const res = await a.inject({ method: 'DELETE', url: `/legal/corp-changes/cc-1${from === null ? '' : `?from=${from}`}` });
    await a.close();
    app = null;
    return { res, db };
  }

  it.each([['P'], ['X']])('★ 운영사 · %s — 204 · 임원을 먼저 지우고 건을 지운다', async (status) => {
    const { res, db } = await remove('operator', status);
    expect(res.statusCode).toBe(204);
    const sqls = dels(db).map((s) => s.sql);
    expect(sqls[0]).toMatch(/DELETE FROM public\.tb_s080_corp_change_officers WHERE corp_change_id = \$1/);
    expect(sqls[1]).toMatch(/DELETE FROM public\.tb_s080_corp_changes WHERE id = \$1 AND status = \$2/);
    expect(db.seen[0]!.sql).toContain('FOR UPDATE');
  });

  it.each([['E'], ['C']])('★ 진행 중 · 완료 %s 는 409 — 지우지 않는다', async (status) => {
    const { res, db } = await remove('operator', status);
    expect(res.statusCode).toBe(409);
    expect(dels(db)).toHaveLength(0);
  });

  it.each([['P'], ['X']])('★★ 회사 세션은 %s 라도 403', async (status) => {
    const { res, db } = await remove('tenant', status);
    expect(res.statusCode).toBe(403);
    expect(dels(db)).toHaveLength(0);
  });

  it('★ 본 상태가 낡았으면 409 · 본 상태가 없으면 400', async () => {
    const stale = await remove('operator', 'E', 'P');
    expect(stale.res.statusCode).toBe(409);
    expect(stale.res.json().error).toBe('stale_status');
    expect(dels(stale.db)).toHaveLength(0);
    const none = await remove('operator', 'P', null);
    expect(none.res.statusCode).toBe(400);
    expect(none.db.seen).toHaveLength(0);
  });
});

describe('GET /legal/corp-changes/:id — 버튼 재료(4단계)', () => {
  async function detail(role: ScopeRole, row: Record<string, unknown>) {
    const a = await build(session(role, role === 'operator' ? 1 : 9003), fakeDb([CHANGE_ROW(row)]).deps);
    const body = (await a.inject({ method: 'GET', url: '/legal/corp-changes/cc-1' })).json();
    await a.close();
    app = null;
    return body;
  }

  it('★ 역할을 반영한 전이 · 삭제 가능 여부', async () => {
    expect((await detail('tenant', { change_type: 'NAME', status: 'E' })).availableTransitions).toEqual(['P', 'C']);
    expect((await detail('operator', { change_type: 'NAME', status: 'E' })).availableTransitions).toEqual(['P', 'C', 'X']);
    expect((await detail('tenant', { change_type: 'NAME', status: 'C' })).availableTransitions).toEqual([]);
    expect((await detail('operator', { change_type: 'NAME', status: 'C' })).availableTransitions).toEqual(['E', 'X']);
    const tenantP = await detail('tenant', { change_type: 'NAME', status: 'P' });
    const operatorP = await detail('operator', { change_type: 'NAME', status: 'P' });
    expect([tenantP.canDelete, operatorP.canDelete]).toEqual([false, true]);
  });

  it('취소 건 — 직전 상태 · 사유를 싣고, 복원 버튼은 직전 상태 하나 · 회사도 사유를 본다', async () => {
    const row = { change_type: 'NAME', status: 'X', status_before_cancel: 'C', cancel_reason: '중복' };
    const x = await detail('operator', row);
    expect([x.availableTransitions, x.statusBeforeCancel, x.cancelReason, x.canDelete]).toEqual([['C'], 'C', '중복', true]);
    const t = await detail('tenant', row);
    expect([t.availableTransitions, t.cancelReason, t.canDelete]).toEqual([[], '중복', false]);
  });

  it('취소가 아닌 건에 남은 취소 칸은 내려보내지 않는다', async () => {
    const e = await detail('operator', { change_type: 'NAME', status: 'E', status_before_cancel: 'P', cancel_reason: '옛' });
    expect([e.statusBeforeCancel, e.cancelReason]).toEqual([null, null]);
  });

  it('작성완료일 · 완료일을 싣는다', async () => {
    const c = await detail('operator', { change_type: 'NAME', status: 'C', written_on: '2026-10-05', completed_on: '2026-10-09' });
    expect([c.writtenOn, c.completedOn]).toEqual(['2026-10-05', '2026-10-09']);
  });
});

// =============================================================================
// 서류 출력(5-2, 2026-10-11) — `GET /legal/corp-changes/:id/print`
// =============================================================================
// ★ RLS(남의 단체 건 404)는 `scripts/verify-corp-change-print.js`(erp_app 접속 · 롤백)가 본다.

describe('GET /legal/corp-changes/:id/print — 서류 출력', () => {
  const URL = '/legal/corp-changes/cc-1/print';
  const officerSnap = (name: string, changeKind: string) => ({
    name,
    changeKind,
    position: '사내이사',
    effectiveDate: '2026-10-01',
    zipCode: '04500',
    address: '서울 중구 임원로 1',
    addressDetail: null,
  });
  const SNAPSHOT = {
    version: 2,
    changeType: 'OFFICER',
    company: {
      isTenant: true,
      name: '주식회사 시험',
      corpNumber: '110111-0000001',
      bizNumber: '123-45-67890',
      ceoName: '홍대표',
      tel: '02-000-0000',
      memberType: 'R',
      head: { zipCode: '06000', address: '서울 강남구 본점로 1', addressDetail: '3층' },
      ceoHome: { zipCode: '04000', address: '서울 마포구', addressDetail: null },
    },
    payload: { resolutionDate: '2026-10-01' },
    officers: [officerSnap('김갑', 'REELECT'), officerSnap('이을', 'APPOINT')],
  };
  const SNAP = (snap: unknown = SNAPSHOT) => ({ match: /SELECT submit_snapshot/, rows: [{ submit_snapshot: snap }] });
  const CASE_FORM = {
    id: 'f-app',
    name: '법인변경등록1',
    definition: {
      version: 2,
      font: { family: '굴림', size: 9 },
      legal: { domain: 'corp-change', changeTypes: ['NAME', 'HQ', 'PURPOSE', 'OFFICER', 'CEO_ADDR'], companyType: 'ALL', unit: 'case' },
      pages: [{ colWidths: [3], rowHeights: [1], cells: [{ row: 0, col: 0, text: '{{companyName}}' }] }],
    },
  };
  const OFFICER_FORM = {
    id: 'f-reelect',
    name: '사내이사 중임승낙서',
    definition: {
      ...CASE_FORM.definition,
      legal: { domain: 'corp-change', changeTypes: ['OFFICER'], companyType: 'ALL', unit: 'officer', officerKinds: ['REELECT'] },
    },
  };
  const BROKEN_FORM = { id: 'f-bad', name: '깨진양식', definition: { version: 2, legal: { domain: 'corp-change' } } };
  const FORMS = (rows: unknown[]) => ({ match: /FROM public\.tb_s080_form_templates/, rows });
  const SETTINGS = {
    match: /FROM public\.tb_s080_doc_form_settings/,
    rows: [
      {
        reg_type_key: 'OFFICER',
        company_type: '',
        is_active: true,
        label: '주식회사 변경 등기(이사ㆍ감사 등 변경)',
        form_no: '[양식 제72-2호]',
        matter: '대표이사⋅이사⋅감\n사 등의 퇴임⋅취임\n등과 그 연월일',
        tax_mode: 'fixed',
        taxes: null,
        attachments: [{ name: '취임승낙서', copies: 1 }],
        reg_purpose: null,
        reg_reason: null,
        matter_body: null,
      },
    ],
  };
  const CODES = { match: /FROM public\.tb_s080_codes_line/, rows: [{ category: 'LAW_CNG_TP', code: 'OFFICER', name: '임원변경' }] };
  const SECRETS = /rrn_cipher\s+FROM public\.tb_s080_corp_change_officers/;
  const secrets = (rows: { name: string; change_kind: string; rrn_cipher: string | null }[]) => ({ match: SECRETS, rows });

  async function print(
    answers: { match: RegExp; rows: unknown[] }[],
    opts: { role?: ScopeRole; qs?: string; status?: string } = {},
  ) {
    const role = opts.role ?? 'operator';
    // ★ 스냅샷 답을 건 답보다 앞에 둔다 — 건 읽기 정규식이 스냅샷 SELECT 에도 걸린다
    const db = fakeDb([...answers, CHANGE_ROW({ status: opts.status ?? 'E', change_type: 'OFFICER' })]);
    const a = await build(session(role, role === 'operator' ? 1 : 9003), db.deps);
    const res = await a.inject({ method: 'GET', url: `${URL}${opts.qs ?? ''}` });
    await a.close();
    app = null;
    return { res, db };
  }

  it('★★ 200 — 건마다 1장 · 임원마다 그 구분 임원만 · 주민번호 전체 · no-store', async () => {
    const { res } = await print(
      [
        SNAP(),
        FORMS([CASE_FORM, OFFICER_FORM]),
        SETTINGS,
        CODES,
        secrets([
          { name: '김갑', change_kind: 'REELECT', rrn_cipher: encrypt('9001011234567') },
          { name: '이을', change_kind: 'APPOINT', rrn_cipher: encrypt('8001012345678') },
        ]),
      ],
      { qs: '?applyDate=2026-10-11&writeDate=2026-10-12' },
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json();
    expect(body.documents.map((d: { formId: string; unit: string }) => [d.formId, d.unit])).toEqual([
      ['f-app', 'case'],
      ['f-reelect', 'officer'],
    ]);
    expect(body.documents[0].sheets[0].values).toMatchObject({
      companyName: '주식회사 시험',
      hqAddress: '서울 강남구 본점로 1 3층',
      ceoPhone: '02-000-0000',
      formNo: '[양식 제72-2호]',
      regPurpose: '임원변경',
      matterBody: '사내이사 김갑 — 중임 (2026-10-01)\n사내이사 이을 — 취임 (2026-10-01)',
      attachments: '1. 취임승낙서  1통',
      applyDate: '2026년 10월 11일',
      writeDate: '2026년 10월 12일',
      officerRrn: '',
    });
    const sheets = body.documents[1].sheets;
    expect(sheets).toHaveLength(1);
    expect(sheets[0].officerName).toBe('김갑');
    expect(sheets[0].values).toMatchObject({ officerName: '김갑', officerKind: '중임', officerRrn: '900101-1234567' });
    // ★ 장에 들지 않는 임원(이을)의 주민번호는 응답 어디에도 없다
    expect(res.body).not.toContain('800101');
  });

  it('★ 임원마다 양식이 없으면 암호문을 읽지도 않는다', async () => {
    const { res, db } = await print([SNAP(), FORMS([CASE_FORM]), SETTINGS, CODES]);
    expect(res.statusCode).toBe(200);
    expect(db.seen.some((s) => SECRETS.test(s.sql))).toBe(false);
  });

  it('회사 세션도 뽑는다(Q4) — 건이 보이는지는 RLS', async () => {
    const { res } = await print([SNAP(), FORMS([CASE_FORM]), SETTINGS, CODES], { role: 'tenant' });
    expect(res.statusCode).toBe(200);
  });

  it('정의를 못 읽는 양식은 건너뛴다 — 다른 서류는 나온다', async () => {
    const { res } = await print([SNAP(), FORMS([BROKEN_FORM, CASE_FORM]), SETTINGS, CODES]);
    expect(res.json().documents.map((d: { formId: string }) => d.formId)).toEqual(['f-app']);
  });

  it.each(['P', 'X'])('★ %s 는 409 — 작성완료 · 완료만 · 거절에도 no-store', async (status) => {
    const { res, db } = await print([SNAP()], { status });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('not_printable');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(db.seen.some((s) => /SELECT submit_snapshot/.test(s.sql))).toBe(false);
  });

  it('안 보이는 건은 404', async () => {
    const db = fakeDb([]);
    const a = await build(session('tenant', 9003), db.deps);
    const res = await a.inject({ method: 'GET', url: URL });
    expect(res.statusCode).toBe(404);
  });

  it('스냅샷이 없거나 구분이 다르면 409', async () => {
    expect((await print([SNAP(null)])).res.json().error).toBe('no_snapshot');
    expect((await print([SNAP({ ...SNAPSHOT, changeType: 'HQ' })])).res.json().error).toBe('no_snapshot');
  });

  it('★★ 임원 짝이 어긋나면 409 — 남의 주민번호가 찍히지 않게', async () => {
    const { res } = await print([
      SNAP(),
      FORMS([OFFICER_FORM]),
      SETTINGS,
      CODES,
      secrets([
        { name: '이을', change_kind: 'APPOINT', rrn_cipher: encrypt('8001012345678') },
        { name: '김갑', change_kind: 'REELECT', rrn_cipher: encrypt('9001011234567') },
      ]),
    ]);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('officer_mismatch');
    expect(res.body).not.toMatch(/900101|800101/);
  });

  it('★ 복호화 실패는 409 — 빈 주민번호로 출력하지 않는다', async () => {
    const { res } = await print([
      SNAP(),
      FORMS([OFFICER_FORM]),
      SETTINGS,
      CODES,
      secrets([
        { name: '김갑', change_kind: 'REELECT', rrn_cipher: 'v1.broken.x.y' },
        { name: '이을', change_kind: 'APPOINT', rrn_cipher: null },
      ]),
    ]);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('rrn_unreadable');
    expect(res.json().message).toContain('김갑');
  });

  it('주민번호가 비어 있으면 빈칸으로 나간다(선택 칸)', async () => {
    const { res } = await print([
      SNAP(),
      FORMS([OFFICER_FORM]),
      SETTINGS,
      CODES,
      secrets([
        { name: '김갑', change_kind: 'REELECT', rrn_cipher: null },
        { name: '이을', change_kind: 'APPOINT', rrn_cipher: null },
      ]),
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.json().documents[0].sheets[0].values.officerRrn).toBe('');
  });

  it('날짜가 틀리면 400 — DB 에 닿지 않는다', async () => {
    const { res, db } = await print([SNAP()], { qs: '?applyDate=2026-02-30' });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toEqual([{ field: 'applyDate', message: '신청일은(는) 날짜(YYYY-MM-DD)로 입력하세요' }]);
    expect(db.seen).toEqual([]);
  });
});

// =============================================================================
// 출력 이력(040, 2026-10-11) — POST · GET /legal/corp-changes/:id/prints
// =============================================================================
// ★ RLS · FK 없음 · 권한은 `scripts/verify-040.js`(erp_app 접속 · 롤백)가 본다.

describe('출력 이력 — /legal/corp-changes/:id/prints', () => {
  const URL = '/legal/corp-changes/cc-1/prints';
  const officer = (name: string, changeKind: string) => ({
    name, changeKind, position: '사내이사', effectiveDate: '2026-10-01', zipCode: null, address: null, addressDetail: null,
  });
  const SNAPSHOT = {
    version: 2,
    changeType: 'OFFICER',
    company: {
      isTenant: true, name: '주식회사 시험', corpNumber: null, bizNumber: null, ceoName: '홍대표', tel: null, memberType: 'R',
      head: { zipCode: null, address: null, addressDetail: null },
      ceoHome: { zipCode: null, address: null, addressDetail: null },
    },
    payload: {},
    officers: [officer('김갑', 'RESIGN'), officer('이을', 'APPOINT'), officer('박병', 'RESIGN')],
  };
  const def = (legal: unknown) => ({
    version: 2,
    font: { family: '바탕', size: 10 },
    legal,
    pages: [{ colWidths: [3], rowHeights: [1], cells: [] }],
  });
  const FORMS = {
    match: /FROM public\.tb_s080_form_templates/,
    rows: [
      { id: 'f-app', name: '법인변경등록1', definition: def({ domain: 'corp-change', changeTypes: ['OFFICER'], companyType: 'ALL', unit: 'case' }) },
      { id: 'f-resign', name: '사임서', definition: def({ domain: 'corp-change', changeTypes: ['OFFICER'], companyType: 'ALL', unit: 'officer', officerKinds: ['RESIGN'] }) },
      { id: 'f-hq', name: '본점만', definition: def({ domain: 'corp-change', changeTypes: ['HQ'], companyType: 'ALL', unit: 'case' }) },
    ],
  };
  const SNAP = { match: /SELECT submit_snapshot/, rows: [{ submit_snapshot: SNAPSHOT }] };
  const INSERT = /INSERT INTO public\.tb_s080_corp_change_prints/;

  async function record(payload: unknown, opts: { status?: string; role?: ScopeRole } = {}) {
    const db = fakeDb([SNAP, FORMS, { match: INSERT, rows: [] }, CHANGE_ROW({ status: opts.status ?? 'E', change_type: 'OFFICER' })]);
    const role = opts.role ?? 'tenant';
    const a = await build(session(role, role === 'operator' ? 1 : 9003), db.deps);
    const res = await a.inject({ method: 'POST', url: URL, payload: payload as Record<string, unknown> });
    await a.close();
    app = null;
    return { res, insert: db.seen.find((s) => INSERT.test(s.sql)) };
  }

  it('★★ 건마다 서류 — 201 · 단체는 건의 것 · 이름은 양식에서 · 임원 없음', async () => {
    const { res, insert } = await record({ formId: 'f-app', sheet: 0, applyDate: '2026-10-11', writeDate: null });
    expect(res.statusCode).toBe(201);
    const p = insert!.params;
    expect(p.slice(1)).toEqual(['cc-1', 9003, 'f-app', '법인변경등록1', null, '2026-10-11', null, '1', 'tenant']);
  });

  it('★★ 임원마다 서류 — 임원 이름은 서버가 스냅샷에서 찾는다(장 번호만 받는다)', async () => {
    const { res, insert } = await record({ formId: 'f-resign', sheet: 1, officerName: '가짜', officerRrn: '9001011234567' }, { role: 'operator' });
    expect(res.statusCode).toBe(201);
    expect(insert!.params[5]).toBe('박병');
    expect(insert!.params[9]).toBe('operator');
    expect(JSON.stringify(insert!.params)).not.toMatch(/가짜|900101/);
  });

  it.each([
    [{ formId: 'f-hq' }, 'formId'],
    [{ formId: 'f-none' }, 'formId'],
    [{ formId: 'f-resign', sheet: 2 }, 'sheet'],
    [{ formId: 'f-app', sheet: 1 }, 'sheet'],
    [{ sheet: 0 }, 'formId'],
  ])('400 — %j 는 기록하지 않는다', async (payload, field) => {
    const { res, insert } = await record(payload);
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].field).toBe(field);
    expect(insert).toBeUndefined();
  });

  it('작성완료 · 완료가 아니면 409 — 기록하지 않는다', async () => {
    const { res, insert } = await record({ formId: 'f-app' }, { status: 'P' });
    expect(res.statusCode).toBe(409);
    expect(insert).toBeUndefined();
  });

  it('★ DB 가 던지면 500 — 서버는 죽지 않는다(화면은 인쇄를 계속한다)', async () => {
    const db = fakeDb([SNAP, FORMS, CHANGE_ROW({ status: 'E', change_type: 'OFFICER' })]);
    const deps = {
      ...db.deps,
      run: async <T,>(_s: ErpSession, fn: (c: never) => Promise<T>) =>
        fn({
          query: async (sql: string, params?: unknown[]) => {
            if (INSERT.test(sql)) throw new Error('db down');
            const hit = [SNAP, FORMS, CHANGE_ROW({ status: 'E', change_type: 'OFFICER' })].find((x) => x.match.test(sql));
            return { rows: hit ? hit.rows : [], rowCount: 0, params };
          },
        } as never),
    } as CorpChangeDeps;
    const a = await build(session('tenant', 9003), deps);
    const res = await a.inject({ method: 'POST', url: URL, payload: { formId: 'f-app' } });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe('record_failed');
  });

  it('GET — 목록 · 안 보이는 건은 404', async () => {
    const row = {
      printed_at: '2026-10-11 14:05', form_name: '사임서', officer_name: '김갑',
      apply_date: null, write_date: '2026-10-11', printed_by: '7', printed_role: 'tenant',
    };
    const db = fakeDb([{ match: /FROM public\.tb_s080_corp_change_prints/, rows: [row] }, CHANGE_ROW({ status: 'C' })]);
    const a = await build(session('tenant', 9003), db.deps);
    const res = await a.inject({ method: 'GET', url: URL });
    expect(res.json()).toEqual({
      items: [{ printedAt: '2026-10-11 14:05', formName: '사임서', officerName: '김갑', applyDate: null, writeDate: '2026-10-11', printedBy: '7', printedRole: 'tenant' }],
    });
    await a.close();
    app = null;

    const none = fakeDb([]);
    const b = await build(session('tenant', 9003), none.deps);
    expect((await b.inject({ method: 'GET', url: URL })).statusCode).toBe(404);
  });
});
