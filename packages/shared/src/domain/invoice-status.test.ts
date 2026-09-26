import { describe, it, expect } from 'vitest';
import { displayInvoiceStatus } from './invoice-status.ts';

/**
 * 레거시 S-WonERP `src/lib/invoice-status.test.ts` 7건을 옮기고 **1건을 더했다**
 * — 「납부일 당일」이다. 아래 마지막 describe 를 보라.
 */

const asOf = new Date(2026, 5, 10); // 2026-06-10 로컬 자정

/** 로컬 자정의 `Date` — pg 가 `date` 컬럼을 주는 모양이다. */
function day(y: number, m1: number, d: number): Date {
  return new Date(y, m1 - 1, d);
}

describe('displayInvoiceStatus', () => {
  it('취소(C)는 수납 여부와 무관하게 canceled', () => {
    expect(
      displayInvoiceStatus({ status: 'C', paidAmount: 500, totalAmount: 500, dueDate: null, asOf }),
    ).toBe('canceled');
  });

  it('저장상태 E 면 paid', () => {
    expect(
      displayInvoiceStatus({ status: 'E', paidAmount: 0, totalAmount: 500, dueDate: null, asOf }),
    ).toBe('paid');
  });

  it('완납(수납 >= 청구)이면 paid', () => {
    expect(
      displayInvoiceStatus({ status: 'P', paidAmount: 500, totalAmount: 500, dueDate: null, asOf }),
    ).toBe('paid');
  });

  it('일부만 들어왔으면 partial', () => {
    expect(
      displayInvoiceStatus({ status: 'P', paidAmount: 200, totalAmount: 500, dueDate: null, asOf }),
    ).toBe('partial');
  });

  it('0원 + 납부일이 지났으면 unpaid', () => {
    expect(
      displayInvoiceStatus({
        status: 'P',
        paidAmount: 0,
        totalAmount: 500,
        dueDate: day(2026, 6, 5),
        asOf,
      }),
    ).toBe('unpaid');
  });

  it('0원 + 납부일 전이면 pending', () => {
    expect(
      displayInvoiceStatus({
        status: 'P',
        paidAmount: 0,
        totalAmount: 500,
        dueDate: day(2026, 6, 20),
        asOf,
      }),
    ).toBe('pending');
  });

  it('0원 + 납부일이 없으면 pending', () => {
    expect(
      displayInvoiceStatus({ status: 'P', paidAmount: 0, totalAmount: 500, dueDate: null, asOf }),
    ).toBe('pending');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   ★★ 레거시에 없던 시험 — 「납부일 당일」
   ══════════════════════════════════════════════════════════════════════════
   레거시는 `asOf > dueDate` 로 `Date` 끼리 그냥 비교했다. pg 의 `date` 는 **로컬
   자정**으로 오고 「지금」은 하루 중 어느 시각이라, **납부일 당일 00:00 을 넘긴
   순간부터 미납**이 된다. 납부일에 아침 업무 시작과 동시에 전 입주사가 연체로 뜬다.

   같은 종류의 어긋남을 `day.ts` 머리말이 이미 적어 두었다 — 그래서 이 판정도
   `daysBetweenLocal` 을 거친다.
   ══════════════════════════════════════════════════════════════════════════ */
describe('displayInvoiceStatus — 납부일 당일은 아직 미납이 아니다', () => {
  it('납부일 당일 낮이면 pending (하루가 다 지나야 미납이다)', () => {
    const 납부일당일오전 = new Date(2026, 5, 10, 9, 30);
    expect(
      displayInvoiceStatus({
        status: 'P',
        paidAmount: 0,
        totalAmount: 500,
        dueDate: day(2026, 6, 10),
        asOf: 납부일당일오전,
      }),
    ).toBe('pending');
  });

  it('납부일 다음 날이면 unpaid', () => {
    expect(
      displayInvoiceStatus({
        status: 'P',
        paidAmount: 0,
        totalAmount: 500,
        dueDate: day(2026, 6, 10),
        asOf: new Date(2026, 5, 11, 9, 30),
      }),
    ).toBe('unpaid');
  });
});
