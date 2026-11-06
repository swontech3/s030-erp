import { describe, expect, it } from 'vitest';
import {
  buildVat,
  deadlineLabel,
  parseVatQuery,
  vatExportFileName,
  vatLedger,
  vatPeriodById,
  vatPeriodOf,
  vatPeriodMonth,
  vatPeriodOptions,
  vatRange,
  vatRangeLabel,
  type VatSources,
} from './tax-vat.ts';

describe('신고 기간 — 법인 분기 · 개인 반기(결정 9, 휴일 미루기 없음)', () => {
  it('법인 9월 → 2026년 3분기 예정 · 7~9월 · 마감 10월 25일', () => {
    const p = vatPeriodOf('C', '2026-09')!;
    expect(p).toMatchObject({
      id: '2026-Q3', from: '2026-07', to: '2026-09', deadline: '2026-10-25', prepayDeadline: null,
      title: '2026년 3분기 예정신고 · 7~9월', option: '2026년 3분기 예정 (7~9월)', desc: '법인은 분기마다 신고합니다 (예정 · 확정)',
    });
  });

  it('법인 2분기 · 4분기는 확정, 4분기 마감은 다음 해 1월 25일', () => {
    expect(vatPeriodOf('C', '2026-05')).toMatchObject({ id: '2026-Q2', title: '2026년 2분기 확정신고 · 4~6월', deadline: '2026-07-25' });
    expect(vatPeriodOf('C', '2026-12')).toMatchObject({ id: '2026-Q4', title: '2026년 4분기 확정신고 · 10~12월', deadline: '2027-01-25' });
    expect(vatPeriodOf('C', '2026-01')).toMatchObject({ id: '2026-Q1', option: '2026년 1분기 예정 (1~3월)', deadline: '2026-04-25' });
  });

  it('개인 9월 → 2026년 2기 확정 · 7~12월 · 마감 다음 해 1월 25일 · 예정고지 10월 25일', () => {
    expect(vatPeriodOf('I', '2026-09')).toMatchObject({
      id: '2026-H2', from: '2026-07', to: '2026-12', deadline: '2027-01-25', prepayDeadline: '2026-10-25',
      title: '2026년 2기 확정신고 · 7~12월', option: '2026년 2기 확정 (7~12월)',
      desc: '개인 일반과세자는 반기마다 확정신고하고, 중간에는 세무서 고지서로 냅니다 (예정고지)',
    });
    expect(vatPeriodOf('I', '2026-03')).toMatchObject({ id: '2026-H1', title: '2026년 1기 확정신고 · 1~6월', deadline: '2026-07-25', prepayDeadline: '2026-04-25' });
  });

  it('사업자 유형이 없거나 모르는 값이면 null', () => {
    expect(vatPeriodOf(null, '2026-09')).toBeNull();
    expect(vatPeriodOf('X', '2026-09')).toBeNull();
  });

  it('선택지 — 올해 포함 최근 3년(작업할 달이 더 앞이면 그 해부터)에서 이번 달까지 시작한 기간, 최신순(11-06)', () => {
    expect(vatPeriodOptions('C', '2026-09', '2026-11').map((p) => p.id)).toEqual([
      '2026-Q4', '2026-Q3', '2026-Q2', '2026-Q1', '2025-Q4', '2025-Q3', '2025-Q2', '2025-Q1', '2024-Q4', '2024-Q3', '2024-Q2', '2024-Q1',
    ]);
    expect(vatPeriodOptions('I', '2026-09', '2026-03').map((p) => p.option)).toEqual([
      '2026년 1기 확정 (1~6월)', '2025년 2기 확정 (7~12월)', '2025년 1기 확정 (1~6월)', '2024년 2기 확정 (7~12월)', '2024년 1기 확정 (1~6월)',
    ]);
    expect(vatPeriodOptions('C', '2022-05', '2026-02').map((p) => p.id).at(-1)).toBe('2022-Q1');
    expect(vatPeriodOptions(null, '2026-09', '2026-11')).toEqual([]);
  });

  it('기간을 고르면 작업할 달은 그 기간 끝 달 — 이번 달보다 뒤면 이번 달', () => {
    expect(vatPeriodMonth(vatPeriodById('C', '2025-Q3')!, '2026-11')).toBe('2025-09');
    expect(vatPeriodMonth(vatPeriodById('C', '2026-Q4')!, '2026-11')).toBe('2026-11');
  });

  it('id 로 찾기 — 사업자 유형과 맞지 않으면 null', () => {
    expect(vatPeriodById('C', '2026-Q2')?.from).toBe('2026-04');
    expect(vatPeriodById('I', '2026-H1')?.to).toBe('2026-06');
    expect(vatPeriodById('C', '2026-H1')).toBeNull();
    expect(vatPeriodById('I', '2026-Q3')).toBeNull();
  });

  it('마감 글자 — 기간과 같은 해면 「10월 25일」, 다음 해면 「2027년 1월 25일」', () => {
    expect(deadlineLabel('2026-10-25', '2026')).toBe('10월 25일');
    expect(deadlineLabel('2027-01-25', '2026')).toBe('2027년 1월 25일');
  });

  it('세는 범위 — 기간 첫날부터 (기간 끝 · 작업할 달 중 이른 달)의 다음 달 첫날 전까지', () => {
    expect(vatRange(vatPeriodOf('I', '2026-09')!, '2026-09')).toEqual(['2026-07-01', '2026-10-01']);
    expect(vatRange(vatPeriodById('I', '2026-H1')!, '2026-09')).toEqual(['2026-01-01', '2026-07-01']);
    expect(vatRange(vatPeriodById('C', '2026-Q4')!, '2026-12')).toEqual(['2026-10-01', '2027-01-01']);
  });
});

describe('vatRangeLabel — 센 범위 「a~b월」', () => {
  it('여러 달 · 한 달', () => {
    expect(vatRangeLabel(['2026-07-01', '2026-10-01'])).toBe('7~9월');
    expect(vatRangeLabel(['2026-10-01', '2027-01-01'])).toBe('10~12월');
    expect(vatRangeLabel(['2026-07-01', '2026-08-01'])).toBe('7월');
  });
});

describe('주소', () => {
  it('달은 꼭, 기간은 고르면 id 모양만 본다', () => {
    expect(parseVatQuery({ month: '2026-09' })).toEqual({ ok: true, value: { month: '2026-09', periodId: null } });
    expect(parseVatQuery({ month: '2026-09', period: '2026-Q2' })).toEqual({ ok: true, value: { month: '2026-09', periodId: '2026-Q2' } });
    expect(parseVatQuery({ month: '2026-13' }).ok).toBe(false);
    expect(parseVatQuery({ month: '2026-09', period: '2026-Q5' }).ok).toBe(false);
  });

  it('엑셀 파일 이름', () => {
    expect(vatExportFileName(vatPeriodById('C', '2026-Q3')!)).toBe('부가세_2026년3분기.xlsx');
    expect(vatExportFileName(vatPeriodById('I', '2026-H2')!)).toBe('부가세_2026년2기.xlsx');
  });
});

const inv = (direction: 'S' | 'P', date: string, supply: number, tax: number, itemCode: string | null = null) => ({
  direction, date, partner: `${direction}상사`, bizNo: '1234567890', supply, tax, itemCode,
});
const card = (date: string, supply: number, tax: number, vatDeduct: string | null, itemCode: string | null = null) => ({
  date, merchant: '가게', bizNo: null as string | null, supply, tax, vatDeduct, itemCode,
});
const EMPTY: VatSources = { invoices: [], cards: [], cashSales: [], cashPurchases: [] };
const RANGE: [string, string] = ['2026-07-01', '2026-10-01'];
const ITEMS = [
  { code: 'MEAL', name: '식대·회의비' },
  { code: 'ENTERTAIN', name: '접대비' },
  { code: 'VEHICLE', name: '차량유지비' },
];
const NODEDUCT = ['ENTERTAIN', 'NONBIZ_TAXPRO', 'VEHICLE'];
const MONTHS = ['2026-07', '2026-08', '2026-09'];
const o = { range: RANGE, months: MONTHS, items: ITEMS, nodeductItems: NODEDUCT };

describe('buildVat — 낼 세금 예상', () => {
  it('매출세액 = 매출 계산서 세액 합(결정 10) · 매입세액 = 매입 계산서 세액 합 · 범위 밖은 뺀다', () => {
    const r = buildVat(
      {
        ...EMPTY,
        invoices: [
          inv('S', '2026-07-03', 1000000, 100000),
          inv('S', '2026-09-30', 30000, 2727),
          inv('S', '2026-10-01', 999, 99),
          inv('P', '2026-08-01', 200000, 20000, 'MEAL'),
          inv('P', '2026-06-30', 1, 1),
        ],
      },
      o,
    );
    expect(r.sales).toEqual({ supply: 1030000, tax: 102727 });
    expect(r.purchase).toEqual({ supply: 200000, tax: 20000 });
  });

  it('카드 — 홈택스 공제(Y) 줄의 세액만(결정 3), 불공제 · 빈 값은 빼고 취소 줄은 음수 그대로', () => {
    const r = buildVat(
      { ...EMPTY, cards: [card('2026-07-02', 10000, 1000, 'Y'), card('2026-07-03', 5000, 500, 'N'), card('2026-07-04', 3000, 300, null), card('2026-07-05', -2000, -200, 'Y')] },
      o,
    );
    expect(r.card.tax).toBe(800);
  });

  it('낼 세금 예상 = 매출세액 − 매입세액 − 카드', () => {
    const r = buildVat(
      { ...EMPTY, invoices: [inv('S', '2026-07-03', 1000000, 100000), inv('P', '2026-08-01', 200000, 20000)], cards: [card('2026-07-02', 10000, 1000, 'Y')] },
      o,
    );
    expect(r.payable).toBe(79000);
  });

  it('현금 매출은 세액을 세지 않고 합계만(결정 7)', () => {
    const r = buildVat({ ...EMPTY, cashSales: [{ date: '2026-07-01', amount: 55000 }, { date: '2026-11-01', amount: 1 }] }, o);
    expect(r.cashSales).toBe(55000);
    expect(r.payable).toBe(0);
  });

  it('미지정 건 — 매입 계산서 · 카드 · 현금 매입 중 항목이 빈 줄 수', () => {
    const r = buildVat(
      {
        ...EMPTY,
        invoices: [inv('P', '2026-08-01', 1, 1), inv('P', '2026-08-02', 1, 1, 'MEAL'), inv('S', '2026-08-03', 1, 1)],
        cards: [card('2026-07-02', 1, 1, 'N')],
        cashPurchases: [{ date: '2026-07-09', itemCode: null }, { date: '2026-07-09', itemCode: 'MEAL' }],
      },
      o,
    );
    expect(r.unassignedCount).toBe(3);
  });
});

describe('buildVat — 달마다 표(11-06)', () => {
  it('기간의 달마다 한 줄 — 매출 · 매입(계산서) 공급가액 · 부가세, 카드는 공제(Y) 줄 공급가액 · 부가세, 낼 부가세', () => {
    const r = buildVat(
      {
        ...EMPTY,
        invoices: [inv('S', '2026-07-03', 1000000, 100000), inv('P', '2026-07-09', 200000, 20000), inv('S', '2026-09-30', 30000, 3000)],
        cards: [card('2026-07-02', 10000, 1000, 'Y'), card('2026-07-03', 5000, 500, 'N')],
      },
      o,
    );
    expect(r.months).toEqual([
      { month: '2026-07', salesSupply: 1000000, salesTax: 100000, purchaseSupply: 200000, purchaseTax: 20000, cardSupply: 10000, cardTax: 1000, payable: 79000 },
      { month: '2026-08', salesSupply: 0, salesTax: 0, purchaseSupply: 0, purchaseTax: 0, cardSupply: 0, cardTax: 0, payable: 0 },
      { month: '2026-09', salesSupply: 30000, salesTax: 3000, purchaseSupply: 0, purchaseTax: 0, cardSupply: 0, cardTax: 0, payable: 3000 },
    ]);
  });

  it('합계 줄 = 달 줄의 합, 합계의 낼 부가세 = 그 기간 예상액 · 센 범위 밖 달은 0', () => {
    const r = buildVat(
      { ...EMPTY, invoices: [inv('S', '2026-07-03', 100, 10), inv('S', '2026-09-03', 500, 50)], cards: [card('2026-08-02', 40, 4, 'Y')] },
      { ...o, range: ['2026-07-01', '2026-09-01'] },
    );
    expect(r.months.map((m) => m.payable)).toEqual([10, -4, 0]);
    expect(r.total).toEqual({ salesSupply: 100, salesTax: 10, purchaseSupply: 0, purchaseTax: 0, cardSupply: 40, cardTax: 4, payable: 6 });
    expect(r.total.payable).toBe(r.payable);
  });
});

describe('buildVat — 공제가 안 될 수 있는 매입(결정 4)', () => {
  it('매입 계산서 · 공제(Y) 카드 중 코드 표 항목인 줄의 세액을 항목별로(코드 표 순서) · 합계', () => {
    const r = buildVat(
      {
        ...EMPTY,
        invoices: [inv('P', '2026-08-01', 100000, 10000, 'VEHICLE'), inv('P', '2026-08-02', 1, 5, 'MEAL')],
        cards: [
          card('2026-07-02', 40000, 4000, 'Y', 'ENTERTAIN'),
          card('2026-07-03', 20000, 2000, 'Y', 'ENTERTAIN'),
          card('2026-07-04', 9000, 900, 'N', 'ENTERTAIN'),
        ],
      },
      o,
    );
    expect(r.nodeduct.lines).toEqual([
      { itemCode: 'ENTERTAIN', label: '접대비', tax: 6000 },
      { itemCode: 'VEHICLE', label: '차량유지비', tax: 10000 },
    ]);
    expect(r.nodeduct.total).toBe(16000);
  });

  it('없으면 빈 목록 · 0', () => {
    expect(buildVat(EMPTY, o).nodeduct).toEqual({ lines: [], total: 0 });
  });
});

describe('vatLedger — 엑셀 매출 · 매입 명세(결정 11)', () => {
  it('매출 = 매출 계산서, 매입 = 매입 계산서 + 카드 전부(공제 여부 실음) · 작성일 순 · 범위 안만', () => {
    const l = vatLedger(
      {
        ...EMPTY,
        invoices: [inv('S', '2026-08-05', 100, 10), inv('P', '2026-08-02', 200, 20), inv('S', '2026-12-01', 9, 9)],
        cards: [card('2026-08-01', 300, 30, 'N')],
        cashSales: [{ date: '2026-08-01', amount: 7 }],
      },
      RANGE,
    );
    expect(l.sales).toEqual([{ date: '2026-08-05', partner: 'S상사', bizNo: '1234567890', supply: 100, tax: 10, source: 'INVOICE', vatDeduct: null }]);
    expect(l.purchases).toEqual([
      { date: '2026-08-01', partner: '가게', bizNo: null, supply: 300, tax: 30, source: 'CARD', vatDeduct: 'N' },
      { date: '2026-08-02', partner: 'P상사', bizNo: '1234567890', supply: 200, tax: 20, source: 'INVOICE', vatDeduct: null },
    ]);
  });
});
