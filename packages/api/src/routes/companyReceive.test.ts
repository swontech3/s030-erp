/**
 * POST /companies/bbiyong/org-changed — 세션 없이 들어오는지 · 실제 쓰기 SQL · `/companies/:id/...` 와 안 겹치는지.
 * ★ 판정은 `companies/companyReceive.test.ts` 가 본다. 여기서는 라우트 껍데기와 db 함수만 본다.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerSessionHook } from '../session/hook.ts';
import { findCompanyIdByOrgId, patchCompanyFromBbiyong } from '../db/companies.ts';
import type { CompanyReceiveDeps } from '../companies/companyReceive.ts';
import type { MemberReceiveDeps } from '../companies/memberReceive.ts';
import { applyMemberFromBbiyong, registerCompanyReceiveRoutes } from './companyReceive.ts';

const okMenus: MemberReceiveDeps['myMenus'] = async (token) =>
  token === 'good' ? { kind: 'ok', screens: ['S021100010'] } : { kind: 'rejected' };
const noOrg: MemberReceiveDeps['myOrg'] = async () => ({ kind: 'rejected' });

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

function fakeClient(companyId: string | null) {
  const seen: { sql: string; params: unknown[] }[] = [];
  return {
    seen,
    client: {
      query: async (sql: string, params?: unknown[]) => {
        seen.push({ sql, params: params ?? [] });
        if (/SELECT company_id FROM public\.tb_s080_companies/.test(sql)) {
          return { rows: companyId ? [{ company_id: companyId }] : [], rowCount: companyId ? 1 : 0 };
        }
        if (/UPDATE public\.tb_s080_companies/.test(sql)) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      },
    },
  };
}

async function build(companyId: string | null = 'c-1') {
  const db = fakeClient(companyId);
  const company: CompanyReceiveDeps = {
    myMenus: okMenus,
    myOrg: noOrg,
    orgGrantName: async () => null,
    apply: async (orgId, fields) => {
      const id = await findCompanyIdByOrgId(db.client, orgId);
      if (id === null) return 'not_found';
      return (await patchCompanyFromBbiyong(db.client, { companyId: id, fields, actor: 'bbiyong' })) > 0 ? 'applied' : 'not_found';
    },
  };
  app = Fastify();
  registerSessionHook(app);
  // ★ 같은 앞머리의 세션 라우트가 있어도 고정 경로가 먼저 골라진다.
  app.post('/companies/:id/bbiyong-link', async () => ({ wrong: true }));
  const member: MemberReceiveDeps = { myMenus: okMenus, myOrg: noOrg, orgOfMember: async () => ({ orgId: null, representative: false }), memberGrantName: async () => null, orgGrantName: async () => null, apply: async () => 'not_found' };
  registerCompanyReceiveRoutes(app, { company, member });
  await app.ready();
  return { a: app, db };
}

const PATH = '/companies/bbiyong/org-changed';

describe('POST /companies/bbiyong/org-changed', () => {
  it('★★ ERP 세션 없이 들어온다 · 받은 칸만 UPDATE · 단체 ID 로 찾는다', async () => {
    const { a, db } = await build();
    const res = await a.inject({
      method: 'POST',
      url: PATH,
      headers: { authorization: 'Bearer good' },
      payload: { orgId: 324, orgCode: 'Z04', orgName: '한성무역', bizNumber: '1058768687', address: '서울' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, applied: true, skipped: null });
    expect(db.seen[0]!.params).toEqual([324]);
    const upd = db.seen.find((s) => /UPDATE/.test(s.sql))!;
    expect(upd.sql).toContain('company_name = $3, biz_number = $4');
    expect(upd.sql).not.toMatch(/address|zip_code|INSERT/);
    expect(upd.params).toEqual(['c-1', 'bbiyong', '한성무역', '105-87-68687']);
  });

  it('입주사가 없으면 UPDATE 하지 않고 성공 · 토큰이 거절되면 403', async () => {
    const n = await build(null);
    const res = await n.a.inject({ method: 'POST', url: PATH, headers: { authorization: 'Bearer good' }, payload: { orgId: 9, orgName: '가' } });
    expect(res.json()).toEqual({ ok: true, applied: false, skipped: 'not_found' });
    expect(n.db.seen.some((s) => /UPDATE/.test(s.sql))).toBe(false);
    const bad = await n.a.inject({ method: 'POST', url: PATH, headers: { authorization: 'Bearer bad' }, payload: { orgId: 9, orgName: '가' } });
    expect(bad.statusCode).toBe(403);
  });
});

// =============================================================================
// 직원 받기 — 실제 쓰기(`applyMemberFromBbiyong`)를 가짜 클라이언트로
// =============================================================================

interface MemberRow {
  member_id: string;
  company_id: string;
  is_representative: string;
  status: string;
}

function memberClient(row: MemberRow | null, emailTaken = false) {
  const seen: { sql: string; params: unknown[] }[] = [];
  return {
    seen,
    client: {
      query: async (sql: string, params?: unknown[]) => {
        seen.push({ sql, params: params ?? [] });
        if (/WHERE link_s020_member_id = \$1/.test(sql)) return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
        if (/lower\(btrim/.test(sql)) return { rows: emailTaken ? [{ one: 1 }] : [], rowCount: emailTaken ? 1 : 0 };
        if (/UPDATE/.test(sql)) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      },
    },
  };
}

const REP: MemberRow = { member_id: 'M-rep', company_id: 'c-1', is_representative: 'C', status: 'active' };

describe('applyMemberFromBbiyong', () => {
  it('★★ 회원번호로 찾아 받은 칸만 UPDATE · 활성 대표면 회사 표 ceo_name 도', async () => {
    const db = memberClient(REP);
    expect(await applyMemberFromBbiyong(db.client, 851, { name: '최현수2', phone: '010-1234-5678' })).toBe('applied');
    expect(db.seen[0]!.params).toEqual([851]);
    const upd = db.seen.filter((s) => /UPDATE/.test(s.sql));
    expect(upd[0]!.sql).toContain('tb_s080_members');
    expect(upd[0]!.sql).toContain('name = $3, phone = $4');
    expect(upd[0]!.sql).not.toMatch(/email|link_/);
    expect(upd[0]!.params).toEqual(['M-rep', 'bbiyong', '최현수2', '010-1234-5678']);
    expect(upd[1]!.sql).toContain('tb_s080_companies SET ceo_name');
    expect(upd[1]!.params).toEqual(['c-1', '최현수2', 'bbiyong']);
  });

  it('★ 직원이거나 · 비활성 옛 대표이거나 · 이름을 안 받았으면 ceo_name 은 그대로', async () => {
    for (const [row, fields] of [
      [{ ...REP, is_representative: 'M' }, { name: '가' }],
      [{ ...REP, status: 'inactive' }, { name: '가' }],
      [REP, { email: 'a@x.co' }],
    ] as const) {
      const db = memberClient(row);
      await applyMemberFromBbiyong(db.client, 851, fields);
      expect(db.seen.some((s) => /tb_s080_companies/.test(s.sql))).toBe(false);
    }
  });

  it('★★ 이메일이 겹치면 아무것도 쓰지 않는다 · 직원이 없으면 not_found', async () => {
    const dup = memberClient(REP, true);
    expect(await applyMemberFromBbiyong(dup.client, 851, { name: '가', email: 'dup@x.co' })).toBe('email_taken');
    expect(dup.seen.some((s) => /UPDATE/.test(s.sql))).toBe(false);
    expect(dup.seen[1]!.params).toEqual(['c-1', 'M-rep', 'dup@x.co']);

    const none = memberClient(null);
    expect(await applyMemberFromBbiyong(none.client, 9, { name: '가' })).toBe('not_found');
    expect(none.seen.some((s) => /UPDATE/.test(s.sql))).toBe(false);
  });
});

describe('POST /companies/bbiyong/member-changed', () => {
  it('ERP 세션 없이 들어온다 · 토큰이 거절되면 403', async () => {
    const { a } = await build();
    const ok = await a.inject({ method: 'POST', url: '/companies/bbiyong/member-changed', headers: { authorization: 'Bearer good' }, payload: { memberId: 9, memberName: '가' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ok: true, applied: false, skipped: 'not_found' });
    const bad = await a.inject({ method: 'POST', url: '/companies/bbiyong/member-changed', headers: { authorization: 'Bearer bad' }, payload: { memberId: 9 } });
    expect(bad.statusCode).toBe(403);
  });
});
