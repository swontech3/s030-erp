import { describe, it, expect } from 'vitest';
import { usedPeriod, usedPeriodLabel } from './usage-period.ts';

/**
 * 실제 이용 기간 — 시작일 ~ 종료일자(둘 다 포함). 정산 카드와 정산서가 계약 기간 옆에 적는다.
 * 「2026.09.01 ~ 2026.11.15 (2개월 15일)」
 */
describe('usedPeriod', () => {
  it('★ 지시서 사례 — 09.01 ~ 11.15 는 2개월 15일', () => {
    expect(usedPeriod('2026-09-01', '2026-11-15')).toEqual({ months: 2, days: 15 });
  });

  it('딱 떨어지면 일수 0 — 09.01 ~ 11.30 은 3개월', () => {
    expect(usedPeriod('2026-09-01', '2026-11-30')).toEqual({ months: 3, days: 0 });
  });

  it('한 달이 안 되면 일수만 — 09.01 ~ 09.10 은 10일', () => {
    expect(usedPeriod('2026-09-01', '2026-09-10')).toEqual({ months: 0, days: 10 });
  });

  it('하루 — 시작일에 끝내면 1일', () => {
    expect(usedPeriod('2026-09-01', '2026-09-01')).toEqual({ months: 0, days: 1 });
  });

  it('달 중간 시작 — 08.26 ~ 10.10 은 1개월 15일', () => {
    // 08.26 + 1개월 = 09.26 · 09.26 ~ 10.10 = 15일
    expect(usedPeriod('2026-08-26', '2026-10-10')).toEqual({ months: 1, days: 15 });
  });

  /*
   * ★ 말일 규칙은 계약 종료일(`calcEndDate`)과 **같아야** 한다 — 01.31 시작 1개월 계약의
   *   종료일은 02.27 이다(02.31 이 없어 02.28 로 맞춘 뒤 하루를 뺀다). 계약을 다 채우고 끝낸
   *   사람의 실제 이용 기간이 「1개월」이 아니면 정산서가 계약서와 다른 말을 한다.
   */
  it('★ 말일 시작 — 01.31 ~ 02.27 은 1개월 (계약 종료일 규칙과 같다)', () => {
    expect(usedPeriod('2026-01-31', '2026-02-27')).toEqual({ months: 1, days: 0 });
    expect(usedPeriod('2026-01-31', '2026-02-28')).toEqual({ months: 1, days: 1 });
    expect(usedPeriod('2026-01-31', '2026-02-26')).toEqual({ months: 0, days: 27 });
  });

  it('★ 계약을 다 채우면 계약 개월수 그대로 — calcEndDate 와 왕복', async () => {
    const { calcEndDate } = await import('./contract-amounts.ts');
    for (const start of ['2026-01-31', '2026-03-15', '2026-08-01', '2026-12-31']) {
      for (const months of [1, 3, 12]) {
        const end = calcEndDate(new Date(`${start}T00:00:00Z`), months).toISOString().slice(0, 10);
        expect(usedPeriod(start, end)).toEqual({ months, days: 0 });
      }
    }
  });

  it('종료가 시작보다 앞이면 던진다', () => {
    expect(() => usedPeriod('2026-09-10', '2026-09-01')).toThrow(RangeError);
  });

  it('읽을 수 없는 날짜면 던진다', () => {
    expect(() => usedPeriod('2026-9-1', '2026-09-10')).toThrow(RangeError);
  });
});

describe('usedPeriodLabel', () => {
  it('「2026.09.01 ~ 2026.11.15 (2개월 15일)」', () => {
    expect(usedPeriodLabel('2026-09-01', '2026-11-15')).toBe('2026.09.01 ~ 2026.11.15 (2개월 15일)');
  });

  it('일수가 0 이면 개월만', () => {
    expect(usedPeriodLabel('2026-09-01', '2026-11-30')).toBe('2026.09.01 ~ 2026.11.30 (3개월)');
  });

  it('개월이 0 이면 일수만', () => {
    expect(usedPeriodLabel('2026-09-01', '2026-09-10')).toBe('2026.09.01 ~ 2026.09.10 (10일)');
  });
});

import { usageChargeBreakdown } from './usage-period.ts';

/*
 * 정산서의 「실제 이용료(개월 + 일할)」. 금액은 정산 원장의 \`usage_charge\` 그대로다 —
 * 여기서 다시 계산하지 않고 **나누어 보여 줄** 뿐이다. 나눈 둘의 합은 원장과 같아야 한다.
 */
describe('usageChargeBreakdown', () => {
  it('★ 무상 1 · 06.01 시작 · 08.15 해지 · 월 297,000 → 1개월 297,000 + 8월 15/31일 143,710', () => {
    expect(
      usageChargeBreakdown({ startDate: '2026-06-01', terminateDate: '2026-08-15', freeMonths: 1, monthlyTotal: 297_000, usageCharge: 440_710 }),
    ).toEqual({ paidMonths: 1, monthsAmount: 297_000, usedDays: 15, monthDays: 31, daysAmount: 143_710 });
  });

  it('첫 달 중간 해지 — 0개월 + 10/30일', () => {
    expect(
      usageChargeBreakdown({ startDate: '2026-09-01', terminateDate: '2026-09-10', freeMonths: 0, monthlyTotal: 550_000, usageCharge: 183_333 }),
    ).toEqual({ paidMonths: 0, monthsAmount: 0, usedDays: 10, monthDays: 30, daysAmount: 183_333 });
  });

  it('★ 두 금액의 합은 언제나 원장의 실이용료다 (일할 쪽이 나머지를 가진다)', () => {
    const b = usageChargeBreakdown({ startDate: '2026-06-01', terminateDate: '2026-07-15', freeMonths: 0, monthlyTotal: 550_000, usageCharge: 816_129 });
    expect(b.monthsAmount + b.daysAmount).toBe(816_129);
  });
});
