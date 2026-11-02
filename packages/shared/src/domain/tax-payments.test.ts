import { describe, expect, it } from 'vitest';
import {
  PAYMENT_TABS,
  PAYMENT_TAB_LABELS,
  loanSummary,
  parsePaymentsQuery,
  payTotals,
  paymentsExportFileName,
  paymentsRange,
  paymentsSearch,
  tabOfFileKind,
  type PaymentsQuery,
} from './tax-payments.ts';

const Q: PaymentsQuery = { month: '2026-09', tab: 'NTAX', from: null, to: null, fileId: null };

describe('탭 — 국세 · 지방세 · 4대보험 · 대출(1-7 결정 ①)', () => {
  it('넷, 이 순서 · 이름', () => {
    expect(PAYMENT_TABS).toEqual(['NTAX', 'LTAX', 'SOCIAL', 'LOAN']);
    expect(PAYMENT_TABS.map((t) => PAYMENT_TAB_LABELS[t])).toEqual(['국세', '지방세', '4대보험', '대출']);
  });

  it('올린 파일의 자료 종류 → 탭. 다른 자료는 null', () => {
    expect(tabOfFileKind('NTAX')).toBe('NTAX');
    expect(tabOfFileKind('LTAX')).toBe('LTAX');
    expect(tabOfFileKind('SOCIAL')).toBe('SOCIAL');
    expect(tabOfFileKind('LOAN')).toBe('LOAN');
    expect(tabOfFileKind('INVOICE')).toBeNull();
    expect(tabOfFileKind('BANK')).toBeNull();
  });
});

describe('parsePaymentsQuery — 주소', () => {
  it('처음 값 — 국세 탭 · 기간 없음 · 파일 없음', () => {
    expect(parsePaymentsQuery({ month: '2026-09' })).toEqual({ ok: true, value: Q });
  });

  it('탭 · 기간 직접 지정', () => {
    expect(parsePaymentsQuery({ month: '2026-09', tab: 'LOAN', from: '2026-07-01', to: '2026-09-30' })).toEqual({
      ok: true,
      value: { ...Q, tab: 'LOAN', from: '2026-07-01', to: '2026-09-30' },
    });
  });

  it('파일로 들어오면 기간을 버린다(탭은 서버가 파일 종류로 정한다)', () => {
    expect(parsePaymentsQuery({ month: '2026-09', file: 'f1', from: '2026-07-01', to: '2026-09-30' })).toEqual({
      ok: true,
      value: { ...Q, fileId: 'f1' },
    });
  });

  it('달 · 탭 · 기간이 틀리면 errors', () => {
    const fields = (raw: Record<string, unknown>) => {
      const r = parsePaymentsQuery(raw);
      return r.ok ? [] : r.errors.map((e) => e.field);
    };
    expect(fields({ month: '2026-13' })).toEqual(['month']);
    expect(fields({ month: '2026-09', tab: 'BANK' })).toEqual(['tab']);
    expect(fields({ month: '2026-09', from: '2026-07-01' })).toEqual(['period']);
    expect(fields({ month: '2026-09', from: '2026-02-30', to: '2026-03-01' })).toEqual(['period']);
    expect(fields({ month: '2026-09', from: '2026-09-02', to: '2026-09-01' })).toEqual(['period']);
  });
});

describe('paymentsRange — 날짜 범위 [첫날, 끝 다음 날)', () => {
  it('국세 · 지방세 · 대출 — 작업할 달, 직접 지정이면 그 날짜', () => {
    expect(paymentsRange(Q)).toEqual(['2026-09-01', '2026-10-01']);
    expect(paymentsRange({ ...Q, tab: 'LOAN', month: '2026-12' })).toEqual(['2026-12-01', '2027-01-01']);
    expect(paymentsRange({ ...Q, tab: 'LTAX', from: '2026-07-05', to: '2026-09-20' })).toEqual(['2026-07-05', '2026-09-21']);
  });

  it('★ 4대보험은 고지 연월로 — 직접 지정 날짜의 달 첫날 ~ 끝 달 다음 달 첫날(결정 ⑥)', () => {
    expect(paymentsRange({ ...Q, tab: 'SOCIAL' })).toEqual(['2026-09-01', '2026-10-01']);
    expect(paymentsRange({ ...Q, tab: 'SOCIAL', from: '2026-07-15', to: '2026-12-03' })).toEqual(['2026-07-01', '2027-01-01']);
  });

  it('파일로 들어오면 null(그 파일 줄 전부)', () => {
    expect(paymentsRange({ ...Q, fileId: 'f1' })).toBeNull();
  });
});

describe('paymentsExportFileName — 엑셀 이름(결정 ④)', () => {
  it('탭마다 이름 · 작업할 달', () => {
    expect(paymentsExportFileName(Q)).toBe('국세납부_2026-09.xlsx');
    expect(paymentsExportFileName({ ...Q, tab: 'LTAX' })).toBe('지방세납부_2026-09.xlsx');
    expect(paymentsExportFileName({ ...Q, tab: 'SOCIAL' })).toBe('4대보험_2026-09.xlsx');
    expect(paymentsExportFileName({ ...Q, tab: 'LOAN' })).toBe('대출_2026-09.xlsx');
  });

  it('기간 직접 지정이면 _YYYY-MM~YYYY-MM, 파일이면 작업할 달', () => {
    expect(paymentsExportFileName({ ...Q, tab: 'LOAN', from: '2026-07-01', to: '2026-09-30' })).toBe('대출_2026-07~2026-09.xlsx');
    expect(paymentsExportFileName({ ...Q, fileId: 'f1' })).toBe('국세납부_2026-09.xlsx');
  });
});

describe('paymentsSearch — 화면 목록 · 엑셀이 같은 주소', () => {
  it('달 · 탭, 기간이 있으면 기간', () => {
    expect(paymentsSearch(Q)).toBe('?month=2026-09&tab=NTAX');
    expect(paymentsSearch({ ...Q, tab: 'SOCIAL', from: '2026-07-01', to: '2026-09-30' })).toBe(
      '?month=2026-09&tab=SOCIAL&from=2026-07-01&to=2026-09-30',
    );
  });

  it('파일이면 파일만(기간 · 탭 없음)', () => {
    expect(paymentsSearch({ ...Q, tab: 'LOAN', fileId: 'f 1', from: '2026-07-01', to: '2026-09-30' })).toBe('?month=2026-09&file=f+1');
  });

  it('주소를 다시 읽으면 같은 거르기', () => {
    const q: PaymentsQuery = { ...Q, tab: 'LTAX', from: '2026-07-01', to: '2026-09-30' };
    expect(parsePaymentsQuery(Object.fromEntries(new URLSearchParams(paymentsSearch(q))))).toEqual({ ok: true, value: q });
  });
});

describe('payTotals — 국세 · 지방세 합계(전체 · 비용 · 비용 아님 · 가산금)', () => {
  it('비용 여부로 나누고, 가산금은 있는 줄만 더한다', () => {
    expect(
      payTotals([
        { amount: 1000, expense: true, penalty: 100 },
        { amount: 500, expense: false, penalty: 0 },
        { amount: 300, expense: true, penalty: null },
      ]),
    ).toEqual({ count: 3, amount: 1800, expense: 1300, nonExpense: 500, penalty: 100 });
  });

  it('줄이 없으면 모두 0', () => {
    expect(payTotals([])).toEqual({ count: 0, amount: 0, expense: 0, nonExpense: 0, penalty: 0 });
  });
});

describe('loanSummary — 대출(은행 · 끝 4자리)별 요약(결정 ⑤ · 원금은 실행 · 상환 두 칸)', () => {
  it('실행 원금 · 상환 원금 · 이자 · 수수료 합계 — 잔액은 싣지 않는다', () => {
    const s = loanSummary([
      { bankCode: '020', loanLast4: '1234', txnTp: 'D', principal: 10000, interest: 0, fee: 50 },
      { bankCode: '020', loanLast4: '1234', txnTp: 'R', principal: 1000, interest: 120, fee: 0 },
      { bankCode: '004', loanLast4: '9999', txnTp: 'R', principal: 0, interest: -10, fee: 0 },
      { bankCode: '020', loanLast4: '1234', txnTp: 'R', principal: 1000, interest: 110, fee: 5 },
    ]);
    expect(s).toEqual([
      { bankCode: '004', loanLast4: '9999', count: 1, draw: 0, repay: 0, interest: -10, fee: 0 },
      { bankCode: '020', loanLast4: '1234', count: 3, draw: 10000, repay: 2000, interest: 230, fee: 55 },
    ]);
  });
});
