/**
 * POST /companies/bbiyong/org-changed — 세션 없이 들어오는지 · 실제 쓰기 SQL · `/companies/:id/...` 와 안 겹치는지.
 * ★ 판정은 `companies/companyReceive.test.ts` 가 본다. 여기서는 라우트 껍데기와 db 함수만 본다.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerSessionHook } from '../session/hook.ts';
import { findCompanyIdByOrgId, patchCompanyFromBbiyong } from '../db/companies.ts';
import type { CompanyReceiveDeps } from '../companies/companyReceive.ts';
import { registerCompanyReceiveRoutes } from './companyReceive.ts';

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
    myMenus: async (token) => (token === 'good' ? { kind: 'ok', screens: ['S021100010'] } : { kind: 'rejected' }),
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
  registerCompanyReceiveRoutes(app, { company });
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
