import { describe, expect, it } from 'vitest';
import { NONBIZ_ITEM_CODES, buildPl, cardCost, type PlSources } from './tax-pl.ts';

const ITEMS = [
  { code: 'RENT', name: '사무실 월세' },
  { code: 'MEAL', name: '식대·회의비' },
  { code: 'NONBIZ_TAXPRO', name: '사업과 무관 — 세무사 판단' },
  { code: 'UNKNOWN', name: '잘 모름 — 세무사에게 묻기' },
];
const NOEXP = ['근로소득세(갑)', '부가가치세'];
const EMPTY: PlSources = { salesInvoices: [], cashSales: [], purchases: [], taxPays: [], loans: [] };
const src = (over: Partial<PlSources>): PlSources => ({ ...EMPTY, ...over });
const opts = { month: '2026-09', items: ITEMS, noExpNames: NOEXP };

describe('cardCost — 카드 한 줄의 비용(명세 06 §6)', () => {
  it('공제(Y)면 합계 − 세액', () => expect(cardCost(11000, 1000, 'Y')).toBe(10000));
  it('불공제(N) · 빈 값이면 합계 그대로', () => {
    expect(cardCost(11000, 1000, 'N')).toBe(11000);
    expect(cardCost(11000, 1000, null)).toBe(11000);
  });
  it('취소 줄(음수)도 같은 식', () => expect(cardCost(-11000, -1000, 'Y')).toBe(-10000));
});

describe('buildPl — 매출', () => {
  it('매출 계산서 공급가액 + 현금 매출(결정 7), 줄 이름 · 합계', () => {
    const r = buildPl(
      src({
        salesInvoices: [
          { date: '2026-09-03', supply: 1000000, partner: '갑상사' },
          { date: '2026-09-20', supply: 3000000, partner: '을상사' },
          { date: '2026-08-31', supply: 999, partner: '병상사' },
        ],
        cashSales: [{ date: '2026-09-10', amount: 50000 }],
      }),
      opts,
    );
    expect(r.detail.income.map((l) => [l.label, l.amount])).toEqual([
      ['매출 (세금계산서)', 4000000],
      ['현금 매출', 50000],
    ]);
    expect(r.detail.incomeTotal).toBe(4050000);
  });

  it('매출 줄 풀이 — 금액 큰 거래처 셋 + 「외」 + 「부가세 뺀 금액」', () => {
    const r = buildPl(
      src({
        salesInvoices: [
          { date: '2026-09-01', supply: 100, partner: '가' },
          { date: '2026-09-02', supply: 400, partner: '나' },
          { date: '2026-09-03', supply: 300, partner: '다' },
          { date: '2026-09-04', supply: 200, partner: '라' },
          { date: '2026-09-05', supply: 250, partner: '나' },
        ],
      }),
      opts,
    );
    expect(r.detail.income[0]!.note).toBe('나 · 다 · 라 외 — 부가세 뺀 금액');
  });

  it('거래처가 셋 이하면 「외」 없음', () => {
    const r = buildPl(src({ salesInvoices: [{ date: '2026-09-01', supply: 100, partner: '가' }] }), opts);
    expect(r.detail.income[0]!.note).toBe('가 — 부가세 뺀 금액');
  });

  it('자료가 없는 줄은 싣지 않는다', () => {
    expect(buildPl(EMPTY, opts).detail.income).toEqual([]);
  });
});

describe('buildPl — 비용', () => {
  it('항목별 — 계산서 · 카드 · 현금을 항목 코드로 묶고 코드 순서대로, 「잘 모름」은 넣는다(결정 5)', () => {
    const r = buildPl(
      src({
        purchases: [
          { date: '2026-09-02', itemCode: 'MEAL', cost: 30000 },
          { date: '2026-09-03', itemCode: 'RENT', cost: 1500000 },
          { date: '2026-09-04', itemCode: 'MEAL', cost: 20000 },
          { date: '2026-09-05', itemCode: 'UNKNOWN', cost: 7000 },
        ],
      }),
      opts,
    );
    expect(r.detail.expense.map((l) => [l.label, l.amount])).toEqual([
      ['사무실 월세', 1500000],
      ['식대·회의비', 50000],
      ['잘 모름 — 세무사에게 묻기', 7000],
    ]);
    expect(r.detail.expenseTotal).toBe(1557000);
  });

  it('미지정 건(항목 빔)은 비용에 「미지정」 한 줄로 넣고(11-06), 줄 수 · 금액도 따로', () => {
    const r = buildPl(
      src({
        purchases: [
          { date: '2026-09-02', itemCode: null, cost: 11000 },
          { date: '2026-09-03', itemCode: null, cost: 4000 },
          { date: '2026-09-04', itemCode: 'RENT', cost: 100 },
        ],
      }),
      opts,
    );
    expect(r.detail.unassigned).toEqual({ count: 2, amount: 15000 });
    expect(r.detail.expense.map((l) => [l.key, l.label, l.amount])).toEqual([
      ['ITEM:RENT', '사무실 월세', 100],
      ['UNASSIGNED', '미지정', 15000],
    ]);
    expect(r.detail.expenseTotal).toBe(15100);
  });

  it('「사업과 무관」 두 항목은 비용에서 빼고 따로 합(결정 5)', () => {
    expect(NONBIZ_ITEM_CODES).toEqual(['NONBIZ_TAXPRO', 'NONBIZ_OWNER']);
    const r = buildPl(
      src({
        purchases: [
          { date: '2026-09-02', itemCode: 'NONBIZ_TAXPRO', cost: 30000 },
          { date: '2026-09-03', itemCode: 'NONBIZ_OWNER', cost: 5000 },
          { date: '2026-09-04', itemCode: 'RENT', cost: 100 },
        ],
      }),
      opts,
    );
    expect(r.detail.nonBiz).toBe(35000);
    expect(r.detail.expense.map((l) => l.label)).toEqual(['사무실 월세']);
    expect(r.detail.expenseTotal).toBe(100);
  });

  it('항목 목록에 없는 코드는 코드값으로 보인다', () => {
    const r = buildPl(src({ purchases: [{ date: '2026-09-02', itemCode: 'GONE', cost: 1 }] }), opts);
    expect(r.detail.expense.map((l) => l.label)).toEqual(['GONE']);
  });

  it('국세 · 지방세 — 「비용이 아닌 세목」은 빼고 나머지만 「세금 (비용인 세목)」 한 줄, 풀이에 세목', () => {
    const r = buildPl(
      src({
        taxPays: [
          { date: '2026-09-10', taxItem: '근로소득세(갑)', amount: 100000 },
          { date: '2026-09-11', taxItem: '주민세', amount: 62500 },
          { date: '2026-09-12', taxItem: '면허세', amount: 10000 },
          { date: '2026-09-13', taxItem: '주민세', amount: 1 },
        ],
      }),
      opts,
    );
    expect(r.detail.expense).toEqual([{ key: 'TAX', label: '세금 (비용인 세목)', note: '주민세 · 면허세', amount: 72501 }]);
  });

  it('대출 — 이자 · 수수료를 따로 두 줄, 원금은 넣지 않는다(결정 6)', () => {
    const r = buildPl(
      src({
        loans: [
          { date: '2026-09-25', interest: 40000, fee: 0 },
          { date: '2026-09-01', interest: 0, fee: 5000 },
        ],
      }),
      opts,
    );
    expect(r.detail.expense.map((l) => [l.label, l.amount])).toEqual([
      ['대출 이자', 40000],
      ['대출 수수료', 5000],
    ]);
  });

  it('이익 = 매출 − 비용', () => {
    const r = buildPl(
      src({
        salesInvoices: [{ date: '2026-09-03', supply: 1000, partner: '갑' }],
        purchases: [{ date: '2026-09-04', itemCode: 'RENT', cost: 1500 }],
      }),
      opts,
    );
    expect(r.detail.profit).toBe(-500);
  });
});

describe('buildPl — 한 해 막대', () => {
  it('작업할 달의 해 1~12월, 달마다 매출 · 비용 · 자료 있음', () => {
    const r = buildPl(
      src({
        salesInvoices: [{ date: '2026-08-03', supply: 1000, partner: '갑' }],
        purchases: [
          { date: '2026-09-04', itemCode: 'RENT', cost: 300 },
          { date: '2026-07-01', itemCode: null, cost: 99 },
        ],
        loans: [{ date: '2025-12-31', interest: 5, fee: 0 }],
      }),
      opts,
    );
    expect(r.year).toBe('2026');
    expect(r.months).toHaveLength(12);
    expect(r.months.map((m) => m.month)[0]).toBe('2026-01');
    const by = Object.fromEntries(r.months.map((m) => [m.month, m]));
    expect(by['2026-08']).toEqual({ month: '2026-08', income: 1000, expense: 0, hasData: true });
    expect(by['2026-09']).toEqual({ month: '2026-09', income: 0, expense: 300, hasData: true });
    // 미지정 건도 비용 막대에 들어간다(11-06)
    expect(by['2026-07']).toEqual({ month: '2026-07', income: 0, expense: 99, hasData: true });
    expect(by['2026-10']!.hasData).toBe(false);
  });

  it('막대 값과 그 달 내역 합계가 같다', () => {
    const r = buildPl(
      src({
        salesInvoices: [{ date: '2026-09-03', supply: 1000, partner: '갑' }],
        cashSales: [{ date: '2026-09-04', amount: 10 }],
        purchases: [{ date: '2026-09-04', itemCode: 'MEAL', cost: 300 }],
        taxPays: [{ date: '2026-09-04', taxItem: '주민세', amount: 7 }],
        loans: [{ date: '2026-09-04', interest: 2, fee: 1 }],
      }),
      opts,
    );
    const sep = r.months.find((m) => m.month === '2026-09')!;
    expect([sep.income, sep.expense]).toEqual([r.detail.incomeTotal, r.detail.expenseTotal]);
    expect(r.detail.expenseTotal).toBe(310);
  });
});

describe('buildPl — 올해 누적', () => {
  it('작업할 달 해의 1월 ~ 작업할 달까지 매출 · 비용 · 이익을 더한다(뒤 달 · 지난해는 빼고)', () => {
    const r = buildPl(
      src({
        salesInvoices: [
          { date: '2026-01-10', supply: 1000, partner: '갑' },
          { date: '2026-09-30', supply: 2000, partner: '을' },
          { date: '2026-10-01', supply: 9999, partner: '병' },
          { date: '2025-12-31', supply: 8888, partner: '정' },
        ],
        cashSales: [{ date: '2026-05-05', amount: 100 }],
        purchases: [
          { date: '2026-03-04', itemCode: 'RENT', cost: 500 },
          { date: '2026-09-04', itemCode: 'NONBIZ_TAXPRO', cost: 7777 },
          { date: '2026-09-05', itemCode: null, cost: 6666 },
        ],
        loans: [{ date: '2026-02-01', interest: 30, fee: 0 }],
      }),
      opts,
    );
    // 미지정 6,666 은 비용에 넣고 사업과 무관 7,777 만 뺀다(11-06)
    expect(r.ytd).toEqual({ income: 3100, expense: 7196, profit: -4096 });
  });

  it('1월이면 1월 한 달과 같다', () => {
    const r = buildPl(src({ salesInvoices: [{ date: '2026-01-10', supply: 1000, partner: '갑' }] }), { ...opts, month: '2026-01' });
    expect(r.ytd).toEqual({ income: r.detail.incomeTotal, expense: r.detail.expenseTotal, profit: r.detail.profit });
  });
});
