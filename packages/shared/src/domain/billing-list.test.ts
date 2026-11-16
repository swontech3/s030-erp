import { describe, expect, it } from 'vitest';
import { invoiceItemLabel, matchesBillingFilter, payStCodeOf } from './billing-list.ts';

const asOf = new Date(2026, 10, 16, 12, 0, 0);
const row = (over: Partial<Parameters<typeof matchesBillingFilter>[0]> = {}) => ({
  companyName: '스원테크',
  roomNames: 'FREE03',
  dueDate: '2026-11-10',
  status: 'P',
  paidAmount: 0,
  totalAmount: 110000,
  ...over,
});
const all = { from: '', to: '', q: '', st: null };

describe('invoiceItemLabel', () => {
  it('종류(호실)', () => {
    expect(invoiceItemLabel('FREE03')).toBe('이용료(FREE03)');
    expect(invoiceItemLabel('')).toBe('이용료');
  });
});

describe('matchesBillingFilter', () => {
  it('납부기한 양 끝 포함 · 빈 값은 제한 없음', () => {
    expect(matchesBillingFilter(row(), { ...all, from: '2026-11-10', to: '2026-11-10' }, asOf)).toBe(true);
    expect(matchesBillingFilter(row(), { ...all, from: '2026-11-11' }, asOf)).toBe(false);
    expect(matchesBillingFilter(row(), { ...all, to: '2026-11-09' }, asOf)).toBe(false);
  });

  it('글자는 입주사 · 호실 어느 쪽이든, 대소문자 무시', () => {
    expect(matchesBillingFilter(row(), { ...all, q: '스원' }, asOf)).toBe(true);
    expect(matchesBillingFilter(row(), { ...all, q: 'free03' }, asOf)).toBe(true);
    expect(matchesBillingFilter(row(), { ...all, q: '없는' }, asOf)).toBe(false);
  });

  it('상태 코드 — 기한 지난 P 는 미납(O), 부분납부는 P, 과납은 E', () => {
    expect(matchesBillingFilter(row(), { ...all, st: 'O' }, asOf)).toBe(true);
    expect(matchesBillingFilter(row({ paidAmount: 10000 }), { ...all, st: 'P' }, asOf)).toBe(true);
    expect(matchesBillingFilter(row({ status: 'E', paidAmount: 120000 }), { ...all, st: 'E' }, asOf)).toBe(true);
    expect(payStCodeOf('canceled')).toBe('C');
  });
});
