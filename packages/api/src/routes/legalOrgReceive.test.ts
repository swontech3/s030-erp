/**
 * POST /legal/bbiyong/org-changed — 세션 없이 들어오는지 · 응답을 그대로 내는지 · 실제 쓰기 SQL.
 * ★ 판정은 `legal/legalOrgReceive.test.ts` 가 본다. 여기서는 라우트 껍데기와 db 함수만 본다.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerSessionHook } from '../session/hook.ts';
import { isTenantOrg, patchLegalOrgFromBbiyong } from '../db/corpChanges.ts';
import type { ReceiveDeps } from '../legal/legalOrgReceive.ts';
import { registerLegalOrgReceiveRoutes } from './legalOrgReceive.ts';

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

/** SQL 로 답을 고르는 가짜 클라이언트 — 실제 db 함수를 태운다. */
function fakeClient(tenant: boolean, rowCount: number) {
  const seen: { sql: string; params: unknown[] }[] = [];
  return {
    seen,
    client: {
      query: async (sql: string, params?: unknown[]) => {
        seen.push({ sql, params: params ?? [] });
        if (/FROM public\.tb_s080_companies/.test(sql)) return { rows: tenant ? [{ one: 1 }] : [], rowCount: tenant ? 1 : 0 };
        if (/UPDATE public\.tb_s080_legal_orgs/.test(sql)) return { rows: [], rowCount };
        return { rows: [], rowCount: 0 };
      },
    },
  };
}

async function build(tenant = false, rowCount = 1) {
  await app?.close();
  const db = fakeClient(tenant, rowCount);
  const deps: ReceiveDeps = {
    myMenus: async (token) =>
      token === 'good' ? { kind: 'ok', screens: ['S021100010'] } : { kind: 'rejected' },
    myOrg: async () => ({ kind: 'rejected' }),
    orgGrantName: async () => null,
    apply: async (orgId, fields) => {
      if (await isTenantOrg(db.client, orgId)) return 'tenant';
      return (await patchLegalOrgFromBbiyong(db.client, { orgId, fields, actor: 'bbiyong' })) > 0 ? 'applied' : 'not_found';
    },
  };
  app = Fastify();
  // ★ 실제 세션 훅을 건다 — 쿠키 없이 401 이 나면 public 이 빠진 것이다.
  registerSessionHook(app);
  registerLegalOrgReceiveRoutes(app, deps);
  await app.ready();
  return { a: app, db };
}

const PATH = '/legal/bbiyong/org-changed';
const good = { authorization: 'Bearer good' };

describe('POST /legal/bbiyong/org-changed', () => {
  it('★★ ERP 세션 없이 들어온다 · 받은 칸만 UPDATE(줄을 만들지 않는다) · 응답 모양', async () => {
    const { a, db } = await build();
    const res = await a.inject({
      method: 'POST',
      url: PATH,
      headers: good,
      payload: { orgId: 9003, orgCode: 'Z99', zipCode: '06097', corpNumber: '1110002313123' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, applied: true, skipped: null });
    const upd = db.seen.find((s) => /UPDATE/.test(s.sql))!;
    expect(upd.sql).toContain('head_zip_code = $3, corp_number = $4');
    expect(upd.sql).not.toMatch(/head_address\b|biz_number|INSERT/);
    expect(upd.params).toEqual([9003, 'bbiyong', '06097', '111000-2313123']);
  });

  it('★ 입주사면 UPDATE 하지 않는다 · 줄이 없으면 not_found 로 성공', async () => {
    const t = await build(true);
    const res = await t.a.inject({ method: 'POST', url: PATH, headers: good, payload: { orgId: 9001, address: '서울' } });
    expect(res.json()).toEqual({ ok: true, applied: false, skipped: 'tenant' });
    expect(t.db.seen.some((s) => /UPDATE/.test(s.sql))).toBe(false);

    const n = await build(false, 0);
    const res2 = await n.a.inject({ method: 'POST', url: PATH, headers: good, payload: { orgId: 9100, address: '서울' } });
    expect(res2.statusCode).toBe(200);
    expect(res2.json()).toEqual({ ok: true, applied: false, skipped: 'not_found' });
  });

  it('토큰이 거절되면 403 · DB 를 보지 않는다', async () => {
    const { a, db } = await build();
    const res = await a.inject({ method: 'POST', url: PATH, headers: { authorization: 'Bearer bad' }, payload: { orgId: 9003, address: '서울' } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('forbidden');
    expect(db.seen).toEqual([]);
  });
});
