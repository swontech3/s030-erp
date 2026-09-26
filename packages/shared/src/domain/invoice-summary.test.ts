import { describe, it, expect } from 'vitest';
import { summarizeInvoices, type SummaryInvoice } from './invoice-summary.ts';

/**
 * 월별 청구의 요약 카드 · 표 합계 줄이 쓰는 합계.
 *
 * ★★ 2026-09-26 재현 — 월납 첫 달 중간 해지(청구 183,333 · 수납 550,000)가 있으면
 *    미수금이 「청구 − 수납」이라 **음수가 섞여** 다른 입주사의 미납 550,000 이
 *    183,333 으로 깎여 보였다. 과납은 미수금에 더하지도 빼지도 않는다.
 */

const asOf = new Date(2026, 8, 26); // 2026-09-26 로컬 자정

const inv = (over: Partial<SummaryInvoice>): SummaryInvoice => ({
  status: 'P',
  totalAmount: 550_000,
  paidAmount: 0,
  dueDate: '2026-09-01',
  ...over,
});

/** 재현한 그 두 장. */
const 재현 = [
  inv({ status: 'E', totalAmount: 183_333, paidAmount: 550_000 }), // 첫 달 중간 해지
  inv({ status: 'P', totalAmount: 550_000, paidAmount: 0 }), //       다른 입주사 미납
];

describe('summarizeInvoices — 과납이 다른 입주사 미수금을 깎지 않는다', () => {
  it('★ 미수금은 양수만 더한다 — 550,000 그대로', () => {
    expect(summarizeInvoices(재현, asOf).outstanding).toBe(550_000);
  });

  it('★ 과납은 따로 센다 — 366,667 · 1건', () => {
    const s = summarizeInvoices(재현, asOf);
    expect(s.overpaid).toBe(366_667);
    expect(s.overpaidCount).toBe(1);
  });

  it('★ 수납 완료는 청구에 들어간 몫만 — 청구 = 수납 완료 + 미수금', () => {
    const s = summarizeInvoices(재현, asOf);
    expect(s.received).toBe(183_333);
    expect(s.total).toBe(s.received + s.outstanding);
  });

  it('미납은 displayInvoiceStatus 가 unpaid 라고 한 장만', () => {
    const s = summarizeInvoices(재현, asOf);
    expect(s.unpaidCount).toBe(1);
    expect(s.unpaidAmount).toBe(550_000);
  });
});

describe('summarizeInvoices — 기본', () => {
  it('취소된 장은 어디에도 안 들어간다 (선납이 남아 있어도)', () => {
    const s = summarizeInvoices([inv({ status: 'C', paidAmount: 550_000 })], asOf);
    expect(s).toMatchObject({ count: 0, total: 0, received: 0, outstanding: 0, overpaid: 0 });
  });

  it('부분납부는 남은 금액만 미수금이다', () => {
    const s = summarizeInvoices([inv({ paidAmount: 200_000 })], asOf);
    expect(s.received).toBe(200_000);
    expect(s.outstanding).toBe(350_000);
    expect(s.unpaidCount).toBe(0); // 부분납부는 미납이 아니다
  });

  it('납부일 당일은 미납이 아니다', () => {
    const s = summarizeInvoices([inv({ dueDate: '2026-09-26' })], asOf);
    expect(s.unpaidCount).toBe(0);
    expect(s.outstanding).toBe(550_000);
  });

  it('무상 장(0 · 0)은 건수에만 들어간다', () => {
    const s = summarizeInvoices([inv({ status: 'E', totalAmount: 0 })], asOf);
    expect(s).toMatchObject({ count: 1, total: 0, received: 0, outstanding: 0, overpaid: 0 });
  });

  it('비어 있으면 전부 0', () => {
    expect(summarizeInvoices([], asOf)).toEqual({
      count: 0, total: 0, received: 0, outstanding: 0,
      overpaid: 0, overpaidCount: 0, unpaidCount: 0, unpaidAmount: 0,
    });
  });
});
