/**
 * `/tax/classify` — 주소 · 본문 해석(400) · 404 · 세션 단체를 그대로 넘기는지 · 엑셀 응답 · 엑셀 칸.
 *
 * ★ DB 에 붙지 않는다. 남은 줄 셈 · 확정 · 거래처 기억 · 파일 거르기는 `scripts/verify-tax-classify.js` 가 실제 DB 에서 잰다.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import * as XLSX from 'xlsx';
import { afterEach, describe, expect, it } from 'vitest';
import type { ErpSession, ScopeRole } from '@swonbiz/shared';
import type { ClassifyQuery, TaxClassifyResponse, TaxClassifyRow } from '@swonbiz/shared/domain/tax-classify';
import { buildXlsx } from '../lib/xlsxExport.ts';
import { cardExportSheet, cashExportSheet, invoiceExportSheet, registerTaxClassifyRoutes, type TaxClassifyDeps } from './taxClassify.ts';

const session = (role: ScopeRole): ErpSession => ({
  erpSid: 'sid-hash',
  s020MemberId: 7,
  s020OrgId: role === 'operator' ? 1 : 9001,
  companyId: null,
  role,
  expiresAt: new Date(Date.now() + 60_000),
  lastActiveAt: null,
});

const Q: ClassifyQuery = { month: '2026-09', view: 'left', kind: 'all', from: null, to: null, fileId: null };
const LIST: TaxClassifyResponse = {
  query: Q,
  bizType: 'C',
  bizTypeName: '법인',
  counts: { left: 0, total: 0, kinds: { all: 0, P: 0, S: 0, CARD: 0, CASH: 0, PPIYONG: 0, BANK: 0 } },
  rows: [],
  file: null,
  codes: { items: [], itemNames: [], invDirs: [], kinds: [] },
};
const NOT_FOUND = { ok: false as const, status: 404 as const, error: 'not_found', message: '없는 계산서입니다' };

function fakeDeps(over: Partial<TaxClassifyDeps> = {}) {
  const calls: unknown[][] = [];
  const deps: TaxClassifyDeps = {
    itemCodes: async () => ['RENT', 'TEL'],
    list: async (s, q) => { calls.push(['list', s.s020OrgId, q]); return { ok: true, data: LIST }; },
    confirm: async (s, rows) => { calls.push(['confirm', s.s020OrgId, rows]); return { ok: true, data: { confirmed: rows.length } }; },
    exportFile: async (s, q) => {
      calls.push(['export', s.s020OrgId, q]);
      return { ok: true, data: { fileName: '거래분류_2026-09.xlsx', bytes: buildXlsx([{ name: 's', columns: [], rows: [] }]) } };
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

async function build(role: ScopeRole, deps: TaxClassifyDeps): Promise<FastifyInstance> {
  app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.session = session(role);
  });
  registerTaxClassifyRoutes(app, deps);
  await app.ready();
  return app;
}

describe('GET /tax/classify', () => {
  it('주소를 해석해 세션 단체로 읽는다', async () => {
    const { deps, calls } = fakeDeps();
    const a = await build('tenant', deps);
    const res = await a.inject({ method: 'GET', url: '/tax/classify?month=2026-09&view=all&kind=P' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(calls).toEqual([['list', 9001, { ...Q, view: 'all', kind: 'P' }]]);
  });

  it('주소가 틀리면 400 + errors, 읽지 않는다', async () => {
    const { deps, calls } = fakeDeps();
    const a = await build('tenant', deps);
    const res = await a.inject({ method: 'GET', url: '/tax/classify?month=2026-09&from=2026-09-01' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_request', errors: [{ field: 'period' }] });
    expect(calls).toEqual([]);
  });

  it('남의 단체 · 없는 파일은 404', async () => {
    const { deps } = fakeDeps({ list: async () => ({ ok: false, status: 404, error: 'not_found', message: '없는 파일입니다' }) });
    const a = await build('tenant', deps);
    const res = await a.inject({ method: 'GET', url: '/tax/classify?month=2026-09&file=other' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found', message: '없는 파일입니다' });
  });
});

describe('POST /tax/classify/confirm', () => {
  it('그 회사 항목이면 세션 단체로 확정한다', async () => {
    const { deps, calls } = fakeDeps();
    const a = await build('operator', deps);
    const res = await a.inject({ method: 'POST', url: '/tax/classify/confirm', payload: { rows: [{ kind: 'CARD', id: 'i1', itemCode: 'RENT' }] } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toEqual({ confirmed: 1 });
    expect(calls).toEqual([['confirm', 1, [{ kind: 'CARD', id: 'i1', itemCode: 'RENT' }]]]);
  });

  it('목록에 없는 항목 · 빈 줄은 400, 확정하지 않는다', async () => {
    const { deps, calls } = fakeDeps();
    const a = await build('tenant', deps);
    const bad = await a.inject({ method: 'POST', url: '/tax/classify/confirm', payload: { rows: [{ kind: 'INVOICE', id: 'i1', itemCode: 'ENTERTAIN' }] } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ errors: [{ field: 'itemCode' }] });
    const empty = await a.inject({ method: 'POST', url: '/tax/classify/confirm', payload: { rows: [] } });
    expect(empty.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });

  it('세무 설정이 없으면(항목 목록 빔) 400 — 세무 설정 안내', async () => {
    const { deps } = fakeDeps({ itemCodes: async () => [] });
    const a = await build('tenant', deps);
    const res = await a.inject({ method: 'POST', url: '/tax/classify/confirm', payload: { rows: [{ kind: 'INVOICE', id: 'i1', itemCode: 'RENT' }] } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ message: '세무 설정에서 사업자 유형을 먼저 고르세요' });
  });

  it('남의 단체 · 없는 줄은 404 · 매출 줄은 400(처리 결과 그대로)', async () => {
    const nf = await build('tenant', fakeDeps({ confirm: async () => NOT_FOUND }).deps);
    expect((await nf.inject({ method: 'POST', url: '/tax/classify/confirm', payload: { rows: [{ kind: 'INVOICE', id: 'x', itemCode: 'RENT' }] } })).statusCode).toBe(404);
    await nf.close();
    const sales = await build('tenant', fakeDeps({
      confirm: async () => ({ ok: false, status: 400, error: 'sales_invoice', message: '매출 계산서에는 항목을 붙이지 않습니다' }),
    }).deps);
    const res = await sales.inject({ method: 'POST', url: '/tax/classify/confirm', payload: { rows: [{ kind: 'INVOICE', id: 's', itemCode: 'RENT' }] } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'sales_invoice', message: '매출 계산서에는 항목을 붙이지 않습니다' });
  });
});

describe('GET /tax/classify/export', () => {
  it('엑셀 파일로 보낸다 — 거르기는 화면과 같은 주소', async () => {
    const { deps, calls } = fakeDeps();
    const a = await build('tenant', deps);
    const res = await a.inject({ method: 'GET', url: '/tax/classify/export?month=2026-09&view=all&kind=S' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers['content-disposition']).toContain(`filename*=UTF-8''${encodeURIComponent('거래분류_2026-09.xlsx')}`);
    expect(calls).toEqual([['export', 9001, { ...Q, view: 'all', kind: 'S' }]]);
  });

  it('주소가 틀리면 400 · 남의 파일은 404', async () => {
    const { deps } = fakeDeps();
    const a = await build('tenant', deps);
    expect((await a.inject({ method: 'GET', url: '/tax/classify/export?month=x' })).statusCode).toBe(400);
    await a.close();
    const nf = await build('tenant', fakeDeps({ exportFile: async () => ({ ok: false, status: 404, error: 'not_found', message: '없는 파일입니다' }) }).deps);
    expect((await nf.inject({ method: 'GET', url: '/tax/classify/export?month=2026-09&file=x' })).statusCode).toBe(404);
  });
});

describe('invoiceExportSheet — 계산서 시트(표준 양식 칸 + 항목)', () => {
  const row = (over: Partial<TaxClassifyRow>): TaxClassifyRow => ({
    kind: 'INVOICE', description: null, cardLast4: null, cardAlias: null, vatDeduct: null, payMethod: null, proof: null,
    id: 'i', direction: 'P', writeDate: '2026-09-05', approvalNo: 'A-1', vendorId: 'v', vendorName: '(주)강남빌딩',
    bizNo: '1208133459', supplyAmount: 1500000, taxAmount: 150000, totalAmount: 1650000, invClass: 'TAX', fileId: 'f',
    itemCode: 'RENT', suggestedItemCode: null, ...over,
  });
  const names = {
    invDirs: [{ code: 'P', name: '매입' }, { code: 'S', name: '매출' }],
    invClasses: [{ code: 'TAX', name: '세금계산서' }],
    itemNames: [{ code: 'RENT', name: '사무실 월세' }],
    kindName: '매입·매출 계산서',
  };

  it('칸 — 구분 · 작성일 · 승인번호 · 거래처명 · 사업자번호 · 공급가액 · 세액 · 종류 · 항목', () => {
    const bytes = buildXlsx([
      invoiceExportSheet([row({}), row({ id: 'j', itemCode: null }), row({ id: 's', direction: 'S', itemCode: null })], names),
    ]);
    const wb = XLSX.read(bytes, { type: 'array' });
    expect(wb.SheetNames).toEqual(['매입·매출 계산서']);
    expect(XLSX.utils.sheet_to_json(wb.Sheets['매입·매출 계산서']!, { header: 1 })).toEqual([
      ['구분', '작성일', '승인번호', '거래처명', '사업자번호', '공급가액', '세액', '종류', '항목'],
      ['매입', '2026-09-05', 'A-1', '(주)강남빌딩', '120-81-33459', 1500000, 150000, '세금계산서', '사무실 월세'],
      ['매입', '2026-09-05', 'A-1', '(주)강남빌딩', '120-81-33459', 1500000, 150000, '세금계산서', '분류 필요'],
      ['매출', '2026-09-05', 'A-1', '(주)강남빌딩', '120-81-33459', 1500000, 150000, '세금계산서', '매출'],
    ]);
  });
});

describe('cardExportSheet — 카드 사용 내역 시트(1-4)', () => {
  const base: TaxClassifyRow = {
    kind: 'CARD', id: 'c', direction: 'P', writeDate: '2026-09-03', approvalNo: null, vendorId: 'v', vendorName: '지어낸 가게',
    description: null, bizNo: '2208162517', supplyAmount: 10000, taxAmount: 1000, totalAmount: 11000, invClass: null,
    cardLast4: '4821', cardAlias: '법인카드 1', vatDeduct: 'Y', payMethod: null, proof: null, fileId: 'f', itemCode: 'MEAL', suggestedItemCode: null,
  };
  const names = {
    kindName: '카드 사용 내역',
    itemNames: [{ code: 'MEAL', name: '식대·회의비' }],
    deducts: [{ code: 'Y', name: '공제' }, { code: 'N', name: '불공제' }],
  };

  it('칸 — 사용일 · 카드(별칭 · 끝 4자리만) · 가맹점명 · 사업자번호 · 공급가액 · 세액 · 합계 · 공제 여부 · 항목', () => {
    const bytes = buildXlsx([cardExportSheet([
      base,
      { ...base, id: 'd', cardAlias: null, bizNo: null, totalAmount: -5000, supplyAmount: -5000, taxAmount: 0, vatDeduct: null, itemCode: null },
    ], names)]);
    const wb = XLSX.read(bytes, { type: 'array' });
    expect(wb.SheetNames).toEqual(['카드 사용 내역']);
    expect(XLSX.utils.sheet_to_json(wb.Sheets['카드 사용 내역']!, { header: 1, defval: '' })).toEqual([
      ['사용일', '카드', '가맹점명', '사업자번호', '공급가액', '세액', '합계', '공제 여부', '항목'],
      ['2026-09-03', '법인카드 1 · 끝 4821', '지어낸 가게', '220-81-62517', 10000, 1000, 11000, '공제', '식대·회의비'],
      ['2026-09-03', '끝 4821', '지어낸 가게', '', -5000, 0, -5000, '', '분류 필요'],
    ]);
  });
});

describe('cashExportSheet — 현금 경비 시트(1-4)', () => {
  const base: TaxClassifyRow = {
    kind: 'CASH', id: 'x', direction: 'P', writeDate: '2026-09-05', approvalNo: null, vendorId: null, vendorName: '지어낸 식당',
    description: '점심', bizNo: null, supplyAmount: null, taxAmount: null, totalAmount: 5000, invClass: null,
    cardLast4: null, cardAlias: null, vatDeduct: null, payMethod: 'CASH', proof: 'RECEIPT', fileId: 'f', itemCode: null, suggestedItemCode: null,
  };
  const names = {
    kindName: '현금 경비',
    itemNames: [{ code: 'MEAL', name: '식대·회의비' }],
    invDirs: [{ code: 'P', name: '매입' }, { code: 'S', name: '매출' }],
    payMethods: [{ code: 'CASH', name: '현금' }],
    proofs: [{ code: 'RECEIPT', name: '영수증' }],
  };

  it('칸 — 날짜 · 품명 · 거래처 · 구분 · 금액 · 지급방법 · 증빙 · 항목(매출은 「매출」)', () => {
    const bytes = buildXlsx([cashExportSheet([
      { ...base, itemCode: 'MEAL' },
      base,
      { ...base, id: 'y', direction: 'S', vendorName: '', proof: null, totalAmount: 30000 },
    ], names)]);
    const wb = XLSX.read(bytes, { type: 'array' });
    expect(XLSX.utils.sheet_to_json(wb.Sheets['현금 경비']!, { header: 1, defval: '' })).toEqual([
      ['날짜', '품명', '거래처', '구분', '금액', '지급방법', '증빙', '항목'],
      ['2026-09-05', '점심', '지어낸 식당', '매입', 5000, '현금', '영수증', '식대·회의비'],
      ['2026-09-05', '점심', '지어낸 식당', '매입', 5000, '현금', '영수증', '분류 필요'],
      ['2026-09-05', '점심', '', '매출', 30000, '현금', '', '매출'],
    ]);
  });
});
