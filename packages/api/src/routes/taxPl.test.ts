/**
 * `/tax/pl` — 주소 해석(400) · 세션 단체를 그대로 넘기는지(1-8).
 *
 * ★ DB 에 붙지 않는다. 계산은 shared `tax-pl.test.ts`, 실제 DB 는 `scripts/verify-tax-pl.js` 가 잰다.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { ErpSession, ScopeRole } from '@swonbiz/shared';
import type { TaxPlResponse } from '@swonbiz/shared/domain/tax-pl';
import { registerTaxPlRoutes, type TaxPlDeps } from './taxPl.ts';

const session = (role: ScopeRole): ErpSession => ({
  erpSid: 'sid-hash',
  s020MemberId: 7,
  s020OrgId: role === 'operator' ? 1 : 9001,
  companyId: null,
  role,
  expiresAt: new Date(Date.now() + 60_000),
  lastActiveAt: null,
});

const DATA: TaxPlResponse = {
  month: '2026-09',
  bizTypeName: '법인',
  pl: {
    year: '2026',
    months: [],
    detail: { income: [], expense: [], incomeTotal: 0, expenseTotal: 0, profit: 0, nonBiz: 0, unassigned: { count: 0, amount: 0 } },
    ytd: { income: 0, expense: 0, profit: 0 },
  },
};

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

async function build(role: ScopeRole) {
  const calls: unknown[][] = [];
  const deps: TaxPlDeps = {
    get: async (s, month) => {
      calls.push([s.s020OrgId, month]);
      return { ok: true, data: DATA };
    },
  };
  app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.session = session(role);
  });
  registerTaxPlRoutes(app, deps);
  await app.ready();
  return { a: app, calls };
}

describe('GET /tax/pl', () => {
  it('작업할 달로 세션 단체를 읽는다 — 운영사도 자기 단체', async () => {
    const { a, calls } = await build('operator');
    const res = await a.inject({ method: 'GET', url: '/tax/pl?month=2026-09' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toEqual(DATA);
    expect(calls).toEqual([[1, '2026-09']]);
  });

  it('달이 틀리면 400, 읽지 않는다', async () => {
    const { a, calls } = await build('tenant');
    const res = await a.inject({ method: 'GET', url: '/tax/pl?month=2026-9' });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors.map((e: { field: string }) => e.field)).toEqual(['month']);
    expect(calls).toEqual([]);
  });
});
