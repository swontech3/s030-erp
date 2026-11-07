/**
 * `/tax/vendors` — 본문 해석(400) · 404 · 경고 · 세션 단체를 그대로 넘기는지 · 엑셀 시트(2026-11-07 대표 수정 ③ 거래처).
 *
 * ★ DB 에 붙지 않는다. 첫 거래월 셈 · 종료 저장 · 구분 · 덮지 않기는 `scripts/verify-tax-uploads.js` 가 실제 DB 에서 잰다.
 * ★ 합치기 · 지우기는 없앴다(2026-11-07) — 주소가 없어야 한다.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import * as XLSX from 'xlsx';
import { afterEach, describe, expect, it } from 'vitest';
import type { ErpSession, ScopeRole } from '@swonbiz/shared';
import type { TaxVendorView, TaxVendorsResponse } from '@swonbiz/shared/domain/tax-uploads';
import { buildXlsx } from '../lib/xlsxExport.ts';
import { registerTaxVendorRoutes, vendorsExportSheet, type TaxVendorsDeps } from './taxVendors.ts';

const session = (role: ScopeRole): ErpSession => ({
  erpSid: 'sid-hash',
  s020MemberId: 7,
  s020OrgId: role === 'operator' ? 1 : 9001,
  companyId: null,
  role,
  expiresAt: new Date(Date.now() + 60_000),
  lastActiveAt: null,
});

const VENDOR: TaxVendorView = { id: 'v1', name: '가', bizNo: null, vendorTp: 'M', tpSetByUser: false, closed: false, firstMonth: null };
const LIST: TaxVendorsResponse = { vendors: [VENDOR], codes: { vendorTps: [] } };
const NOT_FOUND = { ok: false as const, status: 404 as const, error: 'not_found', message: '없는 거래처입니다' };

function fakeDeps(over: Partial<TaxVendorsDeps> = {}) {
  const calls: unknown[][] = [];
  const deps: TaxVendorsDeps = {
    vendorTps: async () => ['M', 'G'],
    list: async (s) => { calls.push(['list', s.s020OrgId]); return LIST; },
    edit: async (s, id, edit) => { calls.push(['edit', s.s020OrgId, id, edit]); return { ok: true, data: VENDOR }; },
    setType: async (s, ids, tp) => { calls.push(['type', s.s020OrgId, ids, tp]); return { ok: true, data: { updated: ids.length } }; },
    close: async (s, ids) => { calls.push(['close', s.s020OrgId, ids]); return { ok: true, data: { closed: ids.length } }; },
    exportFile: async (s, q) => {
      calls.push(['export', s.s020OrgId, q]);
      return { ok: true, data: { fileName: '거래처_2026-11-07.xlsx', bytes: buildXlsx([{ name: '거래처', columns: [], rows: [] }]) } };
    },
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
  it('세션 단체의 목록 전부를 읽는다 — 달은 받지 않는다(「N월 거래」 칸을 뺐다)', async () => {
    const { deps, calls } = fakeDeps();
    const a = await build('tenant', deps);
    const res = await a.inject({ method: 'GET', url: '/tax/vendors' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toEqual(LIST);
    expect(calls).toEqual([['list', 9001]]);
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

  it('★ 거래 중 / 거래 종료를 함께 넘긴다(되돌리기)', async () => {
    const { deps, calls } = fakeDeps();
    const a = await build('tenant', deps);
    const res = await a.inject({ method: 'PATCH', url: '/tax/vendors/v1', payload: { name: '가', closed: false } });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([['edit', 9001, 'v1', { name: '가', closed: false }]]);
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

describe('★ POST /tax/vendors/close — [거래종료]', () => {
  it('고른 거래처를 세션 단체로 종료한다(지우지 않음)', async () => {
    const { deps, calls } = fakeDeps();
    const a = await build('operator', deps);
    const res = await a.inject({ method: 'POST', url: '/tax/vendors/close', payload: { ids: ['v1', 'v2'] } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toEqual({ closed: 2 });
    expect(calls).toEqual([['close', 1, ['v1', 'v2']]]);
  });

  it('고른 거래처가 없으면 400 · 남의 단체는 404', async () => {
    const { deps, calls } = fakeDeps();
    const a = await build('tenant', deps);
    const none = await a.inject({ method: 'POST', url: '/tax/vendors/close', payload: { ids: [] } });
    expect(none.statusCode).toBe(400);
    expect(calls).toEqual([]);
    const { deps: d2 } = fakeDeps({ close: async () => NOT_FOUND });
    await app?.close();
    const b = await build('tenant', d2);
    const other = await b.inject({ method: 'POST', url: '/tax/vendors/close', payload: { ids: ['other'] } });
    expect(other.statusCode).toBe(404);
  });
});

describe('★ GET /tax/vendors/export — 지금 걸린 검색 조건 결과', () => {
  it('검색 조건을 그대로 넘기고 xlsx 를 한글 이름으로', async () => {
    const { deps, calls } = fakeDeps();
    const a = await build('tenant', deps);
    const res = await a.inject({ method: 'GET', url: '/tax/vendors/export?q=%ED%95%9C%EB%B9%9B&tp=M&closed=all' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain(encodeURIComponent('거래처_2026-11-07.xlsx'));
    expect(calls).toEqual([['export', 9001, { q: '한빛', tp: 'M', closed: 'all' }]]);
  });

  it('조건이 없으면 처음 값(거래 중)', async () => {
    const { deps, calls } = fakeDeps();
    const a = await build('tenant', deps);
    await a.inject({ method: 'GET', url: '/tax/vendors/export' });
    expect(calls).toEqual([['export', 9001, { q: '', tp: null, closed: 'open' }]]);
  });
});

describe('★ 합치기 · 지우기는 없다', () => {
  it('POST /tax/vendors/merge · /tax/vendors/delete 는 404', async () => {
    const { deps } = fakeDeps();
    const a = await build('tenant', deps);
    const m = await a.inject({ method: 'POST', url: '/tax/vendors/merge', payload: { keepId: 'v1', ids: ['v2'] } });
    const d = await a.inject({ method: 'POST', url: '/tax/vendors/delete', payload: { ids: ['v1'] } });
    expect([m.statusCode, d.statusCode]).toEqual([404, 404]);
  });
});

describe('vendorsExportSheet — 목록과 같은 칸', () => {
  it('거래처명 · 사업자번호(하이픈) · 구분(코드 이름) · 종료여부 · 첫 거래월(없으면 「—」)', () => {
    const sheet = vendorsExportSheet(
      [
        { ...VENDOR, name: '한빛상사', bizNo: '1234567890', vendorTp: 'M', firstMonth: '2026-07' },
        { ...VENDOR, id: 'v2', name: '두리식당', vendorTp: 'G', closed: true },
      ],
      [{ code: 'M', name: '주거래처' }, { code: 'G', name: '일반' }],
    );
    const wb = XLSX.read(buildXlsx([sheet]), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]!]!, { header: 1, defval: null });
    expect(wb.SheetNames).toEqual(['거래처']);
    expect(rows).toEqual([
      ['거래처명', '사업자번호', '구분', '종료여부', '첫 거래월'],
      ['한빛상사', '123-45-67890', '주거래처', '거래 중', '2026-07'],
      ['두리식당', null, '일반', '종료', '—'],
    ]);
  });
});
