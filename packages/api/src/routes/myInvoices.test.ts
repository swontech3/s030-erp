/**
 * `GET /my/invoices` — 내 청구서(s030200090) · 앱 1단계 7-나 (대표 지시 2026-11-08).
 *
 * ★ DB 에 붙지 않는다. 세션은 시험이 직접 꽂고(실제 훅은 DB 를 본다), 바깥은 `MyInvoicesDeps` 대역으로 바꾼다.
 *   라우트 코드는 실물 그대로 돈다. 회사 거르기(RLS)는 `scripts/verify-my-invoices.mts` 가 개발계에서 본다.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { ErpSession, ScopeRole } from '@swonbiz/shared';
import type { InvoiceRow } from '../db/invoices.ts';
import { registerMyInvoicesRoutes, type MyInvoicesDeps } from './myInvoices.ts';

const session = (role: ScopeRole, companyId: string | null): ErpSession => ({
  erpSid: 'sid-hash',
  s020MemberId: 1,
  s020OrgId: role === 'operator' ? 1 : 421,
  companyId,
  role,
  expiresAt: new Date(Date.now() + 60_000),
  lastActiveAt: null,
});

const ROW: InvoiceRow = {
  invoice_id: 'inv-1',
  company_id: 'c-421',
  build_id: 'b-1',
  contract_id: 'ct-1',
  year_month: '2026-11',
  due_day: '2026-11-05',
  supply_amount: 750_000,
  vat_amount: 75_000,
  total_amount: 825_000,
  paid_amount: 0,
  status: 'P',
};

function fakeDeps(rows: InvoiceRow[] = [ROW]): MyInvoicesDeps & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    listMyInvoices: async (s, from, to) => {
      calls.push({ companyId: s.companyId, role: s.role, from, to });
      return rows;
    },
  };
}

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

async function build(who: ErpSession, deps: MyInvoicesDeps): Promise<FastifyInstance> {
  app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.session = who;
  });
  registerMyInvoicesRoutes(app, deps);
  await app.ready();
  return app;
}

describe('GET /my/invoices — 권한', () => {
  it('★★ 운영사는 403 — DB 를 부르지도 않는다 (운영사는 청구 화면 /billing 에서 본다)', async () => {
    const deps = fakeDeps();
    const a = await build(session('operator', null), deps);
    const res = await a.inject({ method: 'GET', url: '/my/invoices?from=2025-11&to=2026-11' });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toContain('/billing');
    expect(deps.calls).toEqual([]);
  });

  it('회사 연결이 없는 입주사는 빈 목록 — DB 를 부르지 않는다', async () => {
    const deps = fakeDeps();
    const a = await build(session('tenant', null), deps);
    const res = await a.inject({ method: 'GET', url: '/my/invoices?from=2025-11&to=2026-11' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ invoices: [] });
    expect(deps.calls).toEqual([]);
  });
});

describe('GET /my/invoices — 기간', () => {
  it.each([
    ['from 없음', '/my/invoices?to=2026-11'],
    ['to 없음', '/my/invoices?from=2025-11'],
    ['달 모양 틀림', '/my/invoices?from=2025-1&to=2026-11'],
    ['13월', '/my/invoices?from=2025-13&to=2026-11'],
    ['날짜까지', '/my/invoices?from=2025-11-01&to=2026-11'],
    ['거꾸로', '/my/invoices?from=2026-11&to=2025-11'],
    ['24개월 넘음(25개월)', '/my/invoices?from=2024-11&to=2026-11'],
  ])('%s → 400 · DB 를 부르지 않는다', async (_name, url) => {
    const deps = fakeDeps();
    const a = await build(session('tenant', 'c-421'), deps);
    const res = await a.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(400);
    expect(deps.calls).toEqual([]);
  });

  it('24개월(양 끝 포함)까지는 받는다', async () => {
    const deps = fakeDeps([]);
    const a = await build(session('tenant', 'c-421'), deps);
    const res = await a.inject({ method: 'GET', url: '/my/invoices?from=2024-12&to=2026-11' });
    expect(res.statusCode).toBe(200);
  });
});

describe('GET /my/invoices — 입주사', () => {
  it('자기 세션(회사 · 역할)과 기간으로 부르고, 줄 모양을 바꿔 돌려준다', async () => {
    const deps = fakeDeps();
    const a = await build(session('tenant', 'c-421'), deps);
    const res = await a.inject({ method: 'GET', url: '/my/invoices?from=2025-11&to=2026-11' });
    expect(res.statusCode).toBe(200);
    expect(deps.calls).toEqual([{ companyId: 'c-421', role: 'tenant', from: '2025-11', to: '2026-11' }]);
    expect(res.json()).toEqual({
      invoices: [
        {
          invoiceId: 'inv-1',
          yearMonth: '2026-11',
          dueDate: '2026-11-05',
          totalAmount: 825_000,
          paidAmount: 0,
          status: 'P',
        },
      ],
    });
  });

  it('★ 응답에 회사 · 계약 · 건물 번호를 싣지 않는다 (화면에 필요 없는 것)', async () => {
    const a = await build(session('tenant', 'c-421'), fakeDeps());
    const res = await a.inject({ method: 'GET', url: '/my/invoices?from=2025-11&to=2026-11' });
    const keys = Object.keys(res.json().invoices[0]).sort();
    expect(keys).toEqual(['dueDate', 'invoiceId', 'paidAmount', 'status', 'totalAmount', 'yearMonth']);
  });
});
