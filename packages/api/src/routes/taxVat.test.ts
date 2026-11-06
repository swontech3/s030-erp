/**
 * `/tax/vat` — 주소 해석(400) · 세션 단체 · 엑셀 응답 · 엑셀 칸(1-8 결정 11).
 *
 * ★ DB 에 붙지 않는다. 계산은 shared `tax-vat.test.ts`, 실제 DB 는 `scripts/verify-tax-vat.js` 가 잰다.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import * as XLSX from 'xlsx';
import { afterEach, describe, expect, it } from 'vitest';
import type { ErpSession, ScopeRole } from '@swonbiz/shared';
import type { TaxVatResponse, VatLedgerRow } from '@swonbiz/shared/domain/tax-vat';
import { buildXlsx } from '../lib/xlsxExport.ts';
import { registerTaxVatRoutes, vatLedgerSheet, type TaxVatDeps } from './taxVat.ts';

const session = (role: ScopeRole): ErpSession => ({
  erpSid: 'sid-hash',
  s020MemberId: 7,
  s020OrgId: role === 'operator' ? 1 : 9001,
  companyId: null,
  role,
  expiresAt: new Date(Date.now() + 60_000),
  lastActiveAt: null,
});

const DATA: TaxVatResponse = {
  query: { month: '2026-09', periodId: null },
  bizType: null,
  bizTypeName: null,
  period: null,
  periods: [],
  rangeLabel: null,
  vat: null,
};
const BAD_PERIOD = { ok: false as const, status: 400 as const, error: 'invalid_request', message: '신고 기간이 올바르지 않습니다' };

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

async function build(role: ScopeRole, over: Partial<TaxVatDeps> = {}) {
  const calls: unknown[][] = [];
  const deps: TaxVatDeps = {
    get: async (s, q) => {
      calls.push(['get', s.s020OrgId, q]);
      return { ok: true, data: DATA };
    },
    exportFile: async (s, q) => {
      calls.push(['export', s.s020OrgId, q]);
      return { ok: true, data: { fileName: '부가세_2026년3분기.xlsx', bytes: buildXlsx([{ name: 's', columns: [], rows: [] }]) } };
    },
    ...over,
  };
  app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.session = session(role);
  });
  registerTaxVatRoutes(app, deps);
  await app.ready();
  return { a: app, calls };
}

describe('GET /tax/vat', () => {
  it('달 · 기간으로 세션 단체를 읽는다 — 운영사도 자기 단체', async () => {
    const { a, calls } = await build('operator');
    const res = await a.inject({ method: 'GET', url: '/tax/vat?month=2026-09&period=2026-Q2' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(calls).toEqual([['get', 1, { month: '2026-09', periodId: '2026-Q2' }]]);
  });

  it('주소가 틀리면 400, 읽지 않는다', async () => {
    const { a, calls } = await build('tenant');
    const res = await a.inject({ method: 'GET', url: '/tax/vat?month=2026-09&period=2026-Q9' });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors.map((e: { field: string }) => e.field)).toEqual(['period']);
    expect(calls).toEqual([]);
  });

  it('사업자 유형과 맞지 않는 기간은 처리가 400 으로 돌려준다', async () => {
    const { a } = await build('tenant', { get: async () => BAD_PERIOD });
    const res = await a.inject({ method: 'GET', url: '/tax/vat?month=2026-09&period=2026-H1' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_request', message: '신고 기간이 올바르지 않습니다' });
  });
});

describe('GET /tax/vat/export', () => {
  it('엑셀 파일로 보낸다 — 주소는 화면과 같다', async () => {
    const { a, calls } = await build('tenant');
    const res = await a.inject({ method: 'GET', url: '/tax/vat/export?month=2026-09' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain(encodeURIComponent('부가세_2026년3분기.xlsx'));
    expect(calls).toEqual([['export', 9001, { month: '2026-09', periodId: null }]]);
  });

  it('주소가 틀리면 400, 만들지 않는다', async () => {
    const { a, calls } = await build('tenant');
    expect((await a.inject({ method: 'GET', url: '/tax/vat/export?month=x' })).statusCode).toBe(400);
    expect(calls).toEqual([]);
  });
});

/** 시트 → 줄 배열(제목 줄 포함). */
function aoa(sheet: Parameters<typeof buildXlsx>[0][number]): unknown[][] {
  const wb = XLSX.read(buildXlsx([sheet]), { type: 'array' });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]!]!, { header: 1, defval: null });
}

describe('vatLedgerSheet — 매출 · 매입 시트(결정 11)', () => {
  it('칸 — 작성일 · 거래처 · 사업자번호 · 공급가액 · 세액 · 자료(계산서/카드) · 공제 여부(코드 이름)', () => {
    const rows: VatLedgerRow[] = [
      { date: '2026-08-01', partner: '가게', bizNo: null, supply: 300, tax: 30, source: 'CARD', vatDeduct: 'N' },
      { date: '2026-08-02', partner: '갑상사', bizNo: '1234567890', supply: 200, tax: 20, source: 'INVOICE', vatDeduct: null },
    ];
    const sheet = vatLedgerSheet('매입', rows, [{ code: 'Y', name: '공제' }, { code: 'N', name: '불공제' }]);
    expect(sheet.name).toBe('매입');
    expect(aoa(sheet)).toEqual([
      ['작성일', '거래처', '사업자번호', '공급가액', '세액', '자료', '공제 여부'],
      ['2026-08-01', '가게', null, 300, 30, '카드', '불공제'],
      ['2026-08-02', '갑상사', '1234567890', 200, 20, '계산서', null],
    ]);
  });
});
