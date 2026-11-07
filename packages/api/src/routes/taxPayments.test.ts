/**
 * `/tax/payments` — 주소 해석(400) · 404 · 세션 단체를 그대로 넘기는지 · 엑셀 응답 · 엑셀 칸(1-7).
 *
 * ★ DB 에 붙지 않는다. 단체 가르기 · 파일 거르기 · 합계는 `scripts/verify-tax-payments.js` 가 실제 DB 에서 잰다.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import * as XLSX from 'xlsx';
import { afterEach, describe, expect, it } from 'vitest';
import type { ErpSession, ScopeRole } from '@swonbiz/shared';
import type {
  LoanTxnRow,
  PaymentsQuery,
  SocialInsRow,
  TaxPaymentRow,
  TaxPaymentsResponse,
} from '@swonbiz/shared/domain/tax-payments';
import { buildXlsx } from '../lib/xlsxExport.ts';
import {
  loanExportSheet,
  payExportSheet,
  paymentsSheets,
  registerTaxPaymentsRoutes,
  socialExportSheet,
  socialTotalsSheet,
  type TaxPaymentsDeps,
} from './taxPayments.ts';

const session = (role: ScopeRole): ErpSession => ({
  erpSid: 'sid-hash',
  s020MemberId: 7,
  s020OrgId: role === 'operator' ? 1 : 9001,
  companyId: null,
  role,
  expiresAt: new Date(Date.now() + 60_000),
  lastActiveAt: null,
});

const Q: PaymentsQuery = { month: '2026-09', tab: 'NTAX', from: null, to: null, fileId: null };
const LIST: TaxPaymentsResponse = {
  query: Q,
  counts: { NTAX: 0, LTAX: 0, SOCIAL: 0, LOAN: 0 },
  pays: [],
  social: [],
  loans: [],
  file: null,
  codes: { paySrcs: [], socialIns: [], loanTps: [], banks: [] },
};
const NOT_FOUND = { ok: false as const, status: 404 as const, error: 'not_found', message: '없는 파일입니다' };

function fakeDeps(over: Partial<TaxPaymentsDeps> = {}) {
  const calls: unknown[][] = [];
  const deps: TaxPaymentsDeps = {
    list: async (s, q) => { calls.push(['list', s.s020OrgId, q]); return { ok: true, data: LIST }; },
    exportFile: async (s, q) => {
      calls.push(['export', s.s020OrgId, q]);
      return { ok: true, data: { fileName: '국세납부_2026-09.xlsx', bytes: buildXlsx([{ name: 's', columns: [], rows: [] }]) } };
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

async function build(role: ScopeRole, deps: TaxPaymentsDeps): Promise<FastifyInstance> {
  app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.session = session(role);
  });
  registerTaxPaymentsRoutes(app, deps);
  await app.ready();
  return app;
}

describe('GET /tax/payments', () => {
  it('주소를 해석해 세션 단체로 읽는다 — 운영사도 자기 단체', async () => {
    const { deps, calls } = fakeDeps();
    const a = await build('operator', deps);
    const res = await a.inject({ method: 'GET', url: '/tax/payments?month=2026-09&tab=LOAN&from=2026-07-01&to=2026-09-30' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(calls).toEqual([['list', 1, { ...Q, tab: 'LOAN', from: '2026-07-01', to: '2026-09-30' }]]);
  });

  it('⑥ 세금 전체(tab=PAY) · 4대보험 보험 거르기(ins) 를 그대로 넘긴다', async () => {
    const { deps, calls } = fakeDeps();
    const a = await build('tenant', deps);
    expect((await a.inject({ method: 'GET', url: '/tax/payments?month=2026-09&tab=PAY' })).statusCode).toBe(200);
    expect((await a.inject({ method: 'GET', url: '/tax/payments?month=2026-09&tab=SOCIAL&ins=HI' })).statusCode).toBe(200);
    expect(calls).toEqual([['list', 9001, { ...Q, tab: 'PAY' }], ['list', 9001, { ...Q, tab: 'SOCIAL', ins: 'HI' }]]);
    expect((await a.inject({ method: 'GET', url: '/tax/payments?month=2026-09&tab=SOCIAL&ins=LTC' })).statusCode).toBe(400);
  });

  it('주소가 틀리면 400 + errors, 읽지 않는다', async () => {
    const { deps, calls } = fakeDeps();
    const a = await build('tenant', deps);
    const res = await a.inject({ method: 'GET', url: '/tax/payments?month=2026-09&tab=BANK' });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors.map((e: { field: string }) => e.field)).toEqual(['tab']);
    expect(calls).toEqual([]);
  });

  it('남의 단체 · 없는 파일 · 이 화면 자료가 아닌 파일은 404', async () => {
    const { deps } = fakeDeps({ list: async () => NOT_FOUND });
    const a = await build('tenant', deps);
    const res = await a.inject({ method: 'GET', url: '/tax/payments?month=2026-09&file=x' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found', message: '없는 파일입니다' });
  });
});

describe('GET /tax/payments/export', () => {
  it('엑셀 파일로 보낸다 — 거르기는 화면과 같은 주소', async () => {
    const { deps, calls } = fakeDeps();
    const a = await build('tenant', deps);
    const res = await a.inject({ method: 'GET', url: '/tax/payments/export?month=2026-09&tab=NTAX' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain(encodeURIComponent('국세납부_2026-09.xlsx'));
    expect(calls).toEqual([['export', 9001, Q]]);
  });

  it('주소가 틀리면 400 · 남의 파일은 404', async () => {
    const { deps, calls } = fakeDeps({ exportFile: async () => NOT_FOUND });
    const a = await build('tenant', deps);
    expect((await a.inject({ method: 'GET', url: '/tax/payments/export?month=2026-9' })).statusCode).toBe(400);
    expect(calls).toEqual([]);
    expect((await a.inject({ method: 'GET', url: '/tax/payments/export?month=2026-09&file=x' })).statusCode).toBe(404);
  });
});

/** 시트 → 줄 배열(제목 줄 포함). */
function aoa(sheet: Parameters<typeof buildXlsx>[0][number]): unknown[][] {
  const wb = XLSX.read(buildXlsx([sheet]), { type: 'array' });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]!]!, { header: 1, defval: null });
}

const PAY: TaxPaymentRow = {
  id: 'p1', kind: 'NTAX', payDate: '2026-09-10', taxItem: '근로소득세(갑)', expense: false, amount: 1000, penalty: 0,
  belongMonth: null, office: '서초세무서', payMethod: null, payNo: '0126-1',
};

describe('payExportSheet — 국세 · 지방세 시트', () => {
  it('국세 칸 — 납부일 · 세목 · 비용 여부 · 금액 · 가산금 · 수납관서 · 전자납부번호', () => {
    const rows = aoa(payExportSheet('NTAX', [PAY, { ...PAY, id: 'p2', taxItem: '면허세', expense: true, penalty: 30 }]));
    expect(rows).toEqual([
      ['납부일', '세목', '비용 여부', '금액', '가산금', '수납관서', '전자납부번호'],
      ['2026-09-10', '근로소득세(갑)', '비용 아님', 1000, 0, '서초세무서', '0126-1'],
      ['2026-09-10', '면허세', '비용', 1000, 30, '서초세무서', '0126-1'],
    ]);
  });

  it('지방세 칸 — 납부일 · 세목 · 비용 여부 · 금액 · 귀속 연월 · 납부기관 · 납부방법 · 납세번호, 시트 이름 「지방세」', () => {
    const sheet = payExportSheet('LTAX', [{ ...PAY, penalty: null, belongMonth: '2026-08', payMethod: '계좌이체' }]);
    expect(sheet.name).toBe('지방세');
    expect(aoa(sheet)).toEqual([
      ['납부일', '세목', '비용 여부', '금액', '귀속 연월', '납부기관', '납부방법', '납세번호'],
      ['2026-09-10', '근로소득세(갑)', '비용 아님', 1000, '2026-08', '서초세무서', '계좌이체', '0126-1'],
    ]);
  });
});

const SOC: SocialInsRow = {
  id: 's1', noticeMonth: '2026-09', insTp: 'HI', name: '홍길동', memberLast4: '1234', payBase: 3000000, noticeAmount: 106350,
};
const INS = [{ code: 'NP', name: '국민연금' }, { code: 'HI', name: '건강보험' }, { code: 'LTC', name: '장기요양' }];

describe('socialExportSheet · socialTotalsSheet — 4대보험 두 시트(결정 ④)', () => {
  it('사람별 칸 — 고지 연월 · 보험 종류 · 이름 · 보수월액 · 금액 (가입자 번호는 넣지 않는다)', () => {
    expect(aoa(socialExportSheet([SOC, { ...SOC, id: 's2', insTp: 'LTC', memberLast4: null, payBase: null, noticeAmount: 13780 }], INS))).toEqual([
      ['고지 연월', '보험 종류', '이름', '보수월액', '금액'],
      ['2026-09', '건강보험', '홍길동', 3000000, 106350],
      ['2026-09', '장기요양', '홍길동', null, 13780],
    ]);
  });

  it('보험 종류별 합계 — 코드 순서 · 사람 수 · 금액 + 합계 줄', () => {
    const sheet = socialTotalsSheet([SOC, { ...SOC, id: 's2', insTp: 'NP', noticeAmount: 135000 }, { ...SOC, id: 's3', name: '김', noticeAmount: 50000 }], INS);
    expect(sheet.name).toBe('보험 종류별 합계');
    expect(aoa(sheet)).toEqual([
      ['보험 종류', '사람 수', '금액'],
      ['국민연금', 1, 135000],
      ['건강보험', 2, 156350],
      ['합계', 3, 291350],
    ]);
  });
});

const LOAN: LoanTxnRow = {
  id: 'l1', bankCode: '020', loanLast4: '5678', txnDate: '2026-09-25', txnTp: 'R', txnType: '이자납입',
  principal: 0, interest: 120000, fee: 0, balance: 50000000,
};

describe('loanExportSheet — 대출 시트', () => {
  it('칸 — 거래일 · 대출(은행 · 끝 4자리) · 구분 · 거래종류 · 원금 · 이자 · 수수료 · 잔액', () => {
    const rows = aoa(loanExportSheet([LOAN], [{ code: '020', name: '우리은행' }], [{ code: 'R', name: '상환' }]));
    expect(rows).toEqual([
      ['거래일', '대출', '구분', '거래종류', '원금', '이자', '수수료', '잔액'],
      ['2026-09-25', '우리은행 · 끝 5678', '상환', '이자납입', 0, 120000, 0, 50000000],
    ]);
  });
});

describe('paymentsSheets — [엑셀 내려받기] 시트(⑥ 2026-11-08)', () => {
  const data = (over: Partial<TaxPaymentsResponse>): TaxPaymentsResponse => ({ ...LIST, ...over });
  const L = { ...PAY, id: 'l1', kind: 'LTAX' as const, penalty: null };
  it('세금 전체(PAY) — 국세 · 지방세 두 시트로 나눠 담는다', () => {
    const sheets = paymentsSheets(data({ query: { ...Q, tab: 'PAY' }, pays: [PAY, L] }));
    expect(sheets.map((x) => x.name)).toEqual(['국세', '지방세']);
    expect(sheets.map((x) => x.rows.length)).toEqual([1, 1]);
  });
  it('국세만 · 지방세만이면 그 시트 하나, 4대보험은 사람별 + 보험 종류별 합계, 대출은 하나(지금 그대로)', () => {
    expect(paymentsSheets(data({ query: { ...Q, tab: 'LTAX' }, pays: [L] })).map((x) => x.name)).toEqual(['지방세']);
    expect(paymentsSheets(data({ query: { ...Q, tab: 'SOCIAL' } })).map((x) => x.name)).toEqual(['4대보험', '보험 종류별 합계']);
    expect(paymentsSheets(data({ query: { ...Q, tab: 'LOAN' } })).map((x) => x.name)).toEqual(['대출']);
  });
});
