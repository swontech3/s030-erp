/**
 * `/tax/vendors` — 본문 해석(400) · 404 · 경고 · 세션 단체를 그대로 넘기는지.
 *
 * ★ DB 에 붙지 않는다. 합치기 · 구분 · 덮지 않기는 `scripts/verify-tax-uploads.js` 가 실제 DB 에서 잰다.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { ErpSession, ScopeRole } from '@swonbiz/shared';
import type { TaxVendorView, TaxVendorsResponse } from '@swonbiz/shared/domain/tax-uploads';
import { registerTaxVendorRoutes, type TaxVendorsDeps } from './taxVendors.ts';

const session = (role: ScopeRole): ErpSession => ({
  erpSid: 'sid-hash',
  s020MemberId: 7,
  s020OrgId: role === 'operator' ? 1 : 9001,
  companyId: null,
  role,
  expiresAt: new Date(Date.now() + 60_000),
  lastActiveAt: null,
});

const VENDOR: TaxVendorView = {
  id: 'v1', name: '가', bizNo: null, vendorTp: 'M', tpSetByUser: false, firstKind: 'INVOICE', firstDirection: 'S',
  monthCount: 0, totalCount: 0,
};
const LIST: TaxVendorsResponse = { month: '2026-09', vendors: [VENDOR], sameBizNoGroups: [], codes: { vendorTps: [], kinds: [], invDirs: [] } };
const NOT_FOUND = { ok: false as const, status: 404 as const, error: 'not_found', message: '없는 거래처입니다' };
const HAS_INVOICES = {
  ok: false as const, status: 409 as const, error: 'vendor_has_invoices', message: '거래가 있는 거래처는 지울 수 없습니다',
};

function fakeDeps(over: Partial<TaxVendorsDeps> = {}) {
  const calls: unknown[][] = [];
  const deps: TaxVendorsDeps = {
    vendorTps: async () => ['M', 'G'],
    list: async (s, month) => { calls.push(['list', s.s020OrgId, month]); return LIST; },
    edit: async (s, id, edit) => { calls.push(['edit', s.s020OrgId, id, edit]); return { ok: true, data: VENDOR }; },
    setType: async (s, ids, tp) => { calls.push(['type', s.s020OrgId, ids, tp]); return { ok: true, data: { updated: ids.length } }; },
    merge: async (s, keepId, ids) => { calls.push(['merge', s.s020OrgId, keepId, ids]); return NOT_FOUND; },
    remove: async (s, ids) => { calls.push(['remove', s.s020OrgId, ids]); return { ok: true, data: { deleted: ids.length } }; },
    ...over,
  };
  return { deps, calls };
}

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

async function build(role: ScopeRole, deps: TaxVendorsDeps): Promise<FastifyInstance> {
  app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.session = session(role);
  });
  registerTaxVendorRoutes(app, deps);
  await app.ready();
  return app;
}

describe('GET /tax/vendors', () => {
  it('달을 받아 세션 단체로 읽는다', async () => {
    const { deps, calls } = fakeDeps();
    const a = await build('tenant', deps);
    const res = await a.inject({ method: 'GET', url: '/tax/vendors?month=2026-09' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(calls).toEqual([['list', 9001, '2026-09']]);
  });

  it('달이 틀리면 400', async () => {
    const { deps } = fakeDeps();
    const a = await build('tenant', deps);
    const res = await a.inject({ method: 'GET', url: '/tax/vendors?month=9' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ errors: [{ field: 'month' }] });
  });
});

describe('PATCH /tax/vendors/:id', () => {
  it('번호는 숫자만 넘기고, 끝자리 틀림은 경고와 함께 200', async () => {
    const { deps, calls } = fakeDeps();
    const a = await build('operator', deps);
    const res = await a.inject({ method: 'PATCH', url: '/tax/vendors/v1', payload: { name: '새 이름', bizNo: '123-45-67890' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ vendor: VENDOR, warnings: [{ field: 'bizNo', code: 'checksum' }] });
    expect(calls).toEqual([['edit', 1, 'v1', { name: '새 이름', bizNo: '1234567890' }]]);
  });

  it('번호 자리수가 틀리면 400 + errors, 저장하지 않는다', async () => {
    const { deps, calls } = fakeDeps();
    const a = await build('tenant', deps);
    const res = await a.inject({ method: 'PATCH', url: '/tax/vendors/v1', payload: { bizNo: '12345' } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_request', errors: [{ field: 'bizNo' }] });
    expect(calls).toEqual([]);
  });

  it('남의 단체 · 없는 id 는 404', async () => {
    const { deps } = fakeDeps({ edit: async () => NOT_FOUND });
    const a = await build('tenant', deps);
    const res = await a.inject({ method: 'PATCH', url: '/tax/vendors/other', payload: { name: '가' } });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /tax/vendors/type', () => {
  it('코드 표의 구분만 받는다', async () => {
    const { deps, calls } = fakeDeps();
    const a = await build('tenant', deps);
    const bad = await a.inject({ method: 'POST', url: '/tax/vendors/type', payload: { ids: ['v1'], tp: 'X' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ errors: [{ field: 'tp' }] });
    const ok = await a.inject({ method: 'POST', url: '/tax/vendors/type', payload: { ids: ['v1', 'v2'], tp: 'G' } });
    expect(ok.statusCode).toBe(200);
    expect(calls).toEqual([['type', 9001, ['v1', 'v2'], 'G']]);
  });
});

describe('POST /tax/vendors/merge', () => {
  it('남길 곳이 합칠 곳에 있으면 400', async () => {
    const { deps, calls } = fakeDeps();
    const a = await build('tenant', deps);
    const res = await a.inject({ method: 'POST', url: '/tax/vendors/merge', payload: { keepId: 'v1', ids: ['v1', 'v2'] } });
    expect(res.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });

  it('남의 단체 · 없는 id 는 404', async () => {
    const { deps, calls } = fakeDeps();
    const a = await build('tenant', deps);
    const res = await a.inject({ method: 'POST', url: '/tax/vendors/merge', payload: { keepId: 'v1', ids: ['v2'] } });
    expect(res.statusCode).toBe(404);
    expect(calls).toEqual([['merge', 9001, 'v1', ['v2']]]);
  });
});

describe('POST /tax/vendors/delete', () => {
  it('고른 거래처를 세션 단체로 지운다', async () => {
    const { deps, calls } = fakeDeps();
    const a = await build('operator', deps);
    const res = await a.inject({ method: 'POST', url: '/tax/vendors/delete', payload: { ids: ['v1', 'v2'] } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toEqual({ deleted: 2 });
    expect(calls).toEqual([['remove', 1, ['v1', 'v2']]]);
  });

  it('고른 거래처가 없으면 400, 지우지 않는다', async () => {
    const { deps, calls } = fakeDeps();
    const a = await build('tenant', deps);
    const res = await a.inject({ method: 'POST', url: '/tax/vendors/delete', payload: { ids: [] } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_request', errors: [{ field: 'ids' }] });
    expect(calls).toEqual([]);
  });

  it('남의 단체 · 없는 id 는 404', async () => {
    const { deps } = fakeDeps({ remove: async () => NOT_FOUND });
    const a = await build('tenant', deps);
    const res = await a.inject({ method: 'POST', url: '/tax/vendors/delete', payload: { ids: ['other'] } });
    expect(res.statusCode).toBe(404);
  });

  it('거래가 있는 거래처가 하나라도 있으면 409', async () => {
    const { deps } = fakeDeps({ remove: async () => HAS_INVOICES });
    const a = await build('tenant', deps);
    const res = await a.inject({ method: 'POST', url: '/tax/vendors/delete', payload: { ids: ['v1', 'v2'] } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'vendor_has_invoices', message: '거래가 있는 거래처는 지울 수 없습니다' });
  });
});
