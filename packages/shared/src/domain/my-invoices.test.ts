/**
 * 내 청구서(보기 전용 /billing/mine) — 앱 1단계 7-나 (대표 지시 2026-11-08)
 *
 * ★ 보기 전용이다. 청구 · 수납 처리는 운영사 /billing 한 곳뿐이다.
 * ★ 상태 판정 · 합계는 **기존 함수 그대로** — `displayInvoiceStatus` · `summarizeInvoices`.
 *   이 파일의 시험은 그 둘을 다시 정의하지 않고, 이 화면이 그 둘을 어떻게 묶는지만 본다.
 * ★ 미납 띠 = 미납 장이 있거나, 기한이 지났는데 남은 금액이 있는 장(부분납부)이 있을 때(대표 결정 2026-11-08).
 *   기존 상태 판정은 바꾸지 않는다 — 기한 지난 부분납부는 여전히 「부분납부」로 보인다.
 */
import { describe, expect, it } from 'vitest';
import {
  MY_INVOICES_HISTORY_MONTHS,
  accountNumberOf,
  myInvoicesRange,
  paymentHistory,
  showUnpaidNotice,
  thisMonthCard,
  yearMonthOf,
  type MyInvoice,
} from './my-invoices';
import { summarizeInvoices } from './invoice-summary';
import type { DisplayStatus } from './invoice-status';

const inv = (over: Partial<MyInvoice>): MyInvoice => ({
  invoiceId: 'i1',
  yearMonth: '2026-11',
  dueDate: '2026-11-21',
  totalAmount: 550_000,
  paidAmount: 0,
  status: 'P',
  ...over,
});

/** 지금 = 2026-11-08 (로컬) 오후 */
const NOW = new Date(2026, 10, 8, 15, 0);

/** web billing-model 의 STATUS_ORDER 와 같은 값 — 화면이 그것을 넘긴다 */
const ORDER: readonly DisplayStatus[] = ['unpaid', 'overpaid', 'partial', 'pending', 'paid', 'canceled'];

describe('yearMonthOf · myInvoicesRange — 이번 달과 조회 기간', () => {
  it('이번 달은 보는 사람의 로컬 날짜로 정한다', () => {
    expect(yearMonthOf(NOW)).toBe('2026-11');
    expect(yearMonthOf(new Date(2026, 0, 1, 0, 0))).toBe('2026-01');
    expect(yearMonthOf(new Date(2026, 11, 31, 23, 59))).toBe('2026-12');
  });

  it('납부 내역은 12개월', () => {
    expect(MY_INVOICES_HISTORY_MONTHS).toBe(12);
  });

  it('기간 = 12개월 전 ~ 이번 달 (미래 달은 받지 않는다)', () => {
    expect(myInvoicesRange('2026-11')).toEqual({ from: '2025-11', to: '2026-11' });
    expect(myInvoicesRange('2026-01')).toEqual({ from: '2025-01', to: '2026-01' });
    expect(myInvoicesRange('2026-12')).toEqual({ from: '2025-12', to: '2026-12' });
  });
});

describe('thisMonthCard — 「XX월 납부 안내」 카드', () => {
  it('이번 달 청구가 없으면 null', () => {
    expect(thisMonthCard([inv({ yearMonth: '2026-10', dueDate: '2026-10-21' })], NOW)).toBeNull();
    expect(thisMonthCard([], NOW)).toBeNull();
  });

  it('취소된 장만 있으면 null', () => {
    expect(thisMonthCard([inv({ status: 'C' })], NOW)).toBeNull();
  });

  it('한 장 — 청구 · 남은 금액 · 기한 · 달 이름', () => {
    const c = thisMonthCard([inv({})], NOW)!;
    expect(c.yearMonth).toBe('2026-11');
    expect(c.monthLabel).toBe('11월');
    expect(c.total).toBe(550_000);
    expect(c.outstanding).toBe(550_000);
    expect(c.dueDate).toBe('2026-11-21');
    expect(c.paidUp).toBe(false);
    expect(c.lines).toHaveLength(1);
    expect(c.lines[0]).toMatchObject({ invoiceId: 'i1', dueDate: '2026-11-21', status: 'pending' });
  });

  it('여러 장 — 합계 · 남은 금액은 summarizeInvoices 와 같고, 줄은 기한 순 · 취소는 뺀다', () => {
    const items = [
      inv({ invoiceId: 'b', dueDate: '2026-11-21', totalAmount: 300_000, paidAmount: 100_000 }),
      inv({ invoiceId: 'a', dueDate: '2026-11-04', totalAmount: 200_000 }),
      inv({ invoiceId: 'x', dueDate: '2026-11-10', totalAmount: 999_000, status: 'C' }),
      inv({ invoiceId: 'z', yearMonth: '2026-10', dueDate: '2026-10-21', totalAmount: 1 }),
    ];
    const c = thisMonthCard(items, NOW)!;
    const s = summarizeInvoices(items.filter((i) => i.yearMonth === '2026-11'), NOW);
    expect(c.total).toBe(s.total);
    expect(c.outstanding).toBe(s.outstanding);
    expect(c.total).toBe(500_000);
    expect(c.outstanding).toBe(400_000);
    expect(c.lines.map((l) => l.invoiceId)).toEqual(['a', 'b']);
    expect(c.lines.map((l) => l.status)).toEqual(['unpaid', 'partial']);
  });

  it('기한 = 남은 장 중 가장 이른 날 (다 낸 장의 기한은 보지 않는다)', () => {
    const c = thisMonthCard(
      [
        inv({ invoiceId: 'paid', dueDate: '2026-11-02', paidAmount: 550_000, status: 'E' }),
        inv({ invoiceId: 'late', dueDate: '2026-11-25' }),
        inv({ invoiceId: 'mid', dueDate: '2026-11-15', paidAmount: 10 }),
      ],
      NOW,
    )!;
    expect(c.dueDate).toBe('2026-11-15');
    expect(c.paidUp).toBe(false);
  });

  it('다 냈으면 paidUp · 기한 없음 · 남은 금액 0', () => {
    const c = thisMonthCard([inv({ paidAmount: 550_000, status: 'E' })], NOW)!;
    expect(c.paidUp).toBe(true);
    expect(c.dueDate).toBeNull();
    expect(c.outstanding).toBe(0);
  });

  it('과납 장은 끝난 장이다 — 남은 금액에 음수로 섞이지 않는다', () => {
    const c = thisMonthCard(
      [inv({ invoiceId: 'o', totalAmount: 183_333, paidAmount: 550_000, status: 'E' }), inv({ invoiceId: 'p', totalAmount: 100_000 })],
      NOW,
    )!;
    expect(c.outstanding).toBe(100_000);
    expect(c.dueDate).toBe('2026-11-21');
    expect(c.lines.find((l) => l.invoiceId === 'o')!.status).toBe('overpaid');
  });
});

describe('paymentHistory — 지난 12개월 납부 내역', () => {
  it('이번 달 · 미래 달 · 12개월보다 앞선 달은 뺀다 · 최근 달부터', () => {
    const rows = paymentHistory(
      [
        inv({ yearMonth: '2026-11' }),
        inv({ yearMonth: '2026-12', dueDate: '2026-12-21' }),
        inv({ yearMonth: '2025-10', dueDate: '2025-10-21' }),
        inv({ yearMonth: '2025-11', dueDate: '2025-11-21', paidAmount: 550_000, status: 'E' }),
        inv({ yearMonth: '2026-10', dueDate: '2026-10-21', paidAmount: 550_000, status: 'E' }),
      ],
      NOW,
      ORDER,
    );
    expect(rows.map((r) => r.yearMonth)).toEqual(['2026-10', '2025-11']);
  });

  it('달 이름 · 청구 · 납부 — 한 달 여러 장은 합친다 · 취소 장은 뺀다', () => {
    const rows = paymentHistory(
      [
        inv({ invoiceId: '1', yearMonth: '2026-10', dueDate: '2026-10-04', totalAmount: 300_000, paidAmount: 300_000, status: 'E' }),
        inv({ invoiceId: '2', yearMonth: '2026-10', dueDate: '2026-10-21', totalAmount: 200_000, paidAmount: 50_000 }),
        inv({ invoiceId: '3', yearMonth: '2026-10', dueDate: '2026-10-21', totalAmount: 777_000, status: 'C' }),
      ],
      NOW,
      ORDER,
    );
    expect(rows).toEqual([{ yearMonth: '2026-10', label: '2026년 10월', total: 500_000, paid: 350_000, status: 'partial' }]);
  });

  it('달 상태 = 넘겨받은 순서에서 가장 앞선 상태 (미납이 먼저)', () => {
    const rows = paymentHistory(
      [
        inv({ invoiceId: '1', yearMonth: '2026-09', dueDate: '2026-09-04', paidAmount: 550_000, status: 'E' }),
        inv({ invoiceId: '2', yearMonth: '2026-09', dueDate: '2026-09-21' }),
      ],
      NOW,
      ORDER,
    );
    expect(rows[0]!.status).toBe('unpaid');
  });

  it('과납 달 — 납부는 실제로 받은 금액 · 상태는 과납', () => {
    const rows = paymentHistory(
      [inv({ yearMonth: '2026-09', dueDate: '2026-09-21', totalAmount: 183_333, paidAmount: 550_000, status: 'E' })],
      NOW,
      ORDER,
    );
    expect(rows[0]).toMatchObject({ total: 183_333, paid: 550_000, status: 'overpaid' });
  });

  it('취소 장만 있는 달은 줄을 만들지 않는다', () => {
    expect(paymentHistory([inv({ yearMonth: '2026-09', dueDate: '2026-09-21', status: 'C' })], NOW, ORDER)).toEqual([]);
  });
});

describe('showUnpaidNotice — 미납 안내 띠 (대표 결정 2026-11-08)', () => {
  it('미납 장이 있으면 띄운다', () => {
    expect(showUnpaidNotice([inv({ yearMonth: '2026-10', dueDate: '2026-10-21' })], NOW)).toBe(true);
  });

  it('★ 기한이 지났는데 남은 금액이 있는 부분납부 장도 띄운다', () => {
    const it1 = inv({ yearMonth: '2026-10', dueDate: '2026-10-21', paidAmount: 100_000 });
    expect(showUnpaidNotice([it1], NOW)).toBe(true);
  });

  it('★ 그 장의 상태 판정은 그대로 「부분납부」다 — 기존 판정을 바꾸지 않는다', () => {
    const rows = paymentHistory([inv({ yearMonth: '2026-10', dueDate: '2026-10-21', paidAmount: 100_000 })], NOW, ORDER);
    expect(rows[0]!.status).toBe('partial');
  });

  it('기한 전 부분납부 · 납부대기는 띄우지 않는다', () => {
    expect(showUnpaidNotice([inv({ paidAmount: 100_000 }), inv({ invoiceId: 'i2' })], NOW)).toBe(false);
  });

  it('★ 기한 당일은 아직 지나지 않았다 (부분납부 · 미납 모두)', () => {
    expect(showUnpaidNotice([inv({ dueDate: '2026-11-08' })], NOW)).toBe(false);
    expect(showUnpaidNotice([inv({ dueDate: '2026-11-08', paidAmount: 1 })], NOW)).toBe(false);
    expect(showUnpaidNotice([inv({ dueDate: '2026-11-07', paidAmount: 1 })], NOW)).toBe(true);
  });

  it('다 낸 장 · 과납 장 · 취소 장은 띄우지 않는다', () => {
    expect(
      showUnpaidNotice(
        [
          inv({ dueDate: '2026-10-21', yearMonth: '2026-10', paidAmount: 550_000, status: 'E' }),
          inv({ dueDate: '2026-10-21', yearMonth: '2026-10', totalAmount: 100, paidAmount: 550_000, status: 'E' }),
          inv({ dueDate: '2026-10-21', yearMonth: '2026-10', status: 'C' }),
        ],
        NOW,
      ),
    ).toBe(false);
  });

  it('미래 달 장은 보지 않는다 (기한이 지났더라도)', () => {
    expect(showUnpaidNotice([inv({ yearMonth: '2026-12', dueDate: '2026-11-01' })], NOW)).toBe(false);
  });
});

describe('accountNumberOf — [계좌 복사]가 복사하는 것', () => {
  it('은행 이름을 떼고 계좌 번호만', () => {
    expect(accountNumberOf('우리은행 1005-002-433395')).toBe('1005-002-433395');
  });
  it('번호가 없으면 받은 글자 그대로', () => {
    expect(accountNumberOf('계좌 없음')).toBe('계좌 없음');
  });
});
