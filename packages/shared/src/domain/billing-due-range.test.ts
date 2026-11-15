import { describe, it, expect } from 'vitest';
import { DUE_RANGE_MAX_MONTHS, DUE_RANGE_TOO_LONG, dueRangeLimit, isDueRangeTooLong } from './billing-due-range.ts';

/** 청구 화면 납부기한 검색 기간 상한 — 끝일이 시작일 + 6개월을 넘으면 막는다(2026-11-15). */
describe('납부기한 기간 상한 6개월', () => {
  it('상한은 6개월 · 안내 말', () => {
    expect(DUE_RANGE_MAX_MONTHS).toBe(6);
    expect(DUE_RANGE_TOO_LONG).toBe('납부기한은 6개월 안으로 넣어 주세요');
  });

  it('시작일 + 6개월 날까지는 된다 · 하루 넘으면 막는다', () => {
    expect(dueRangeLimit('2026-01-01')).toBe('2026-07-01');
    expect(isDueRangeTooLong('2026-01-01', '2026-07-01')).toBe(false);
    expect(isDueRangeTooLong('2026-01-01', '2026-07-02')).toBe(true);
  });

  it('이번 달 1일 ~ 말일(처음 값)은 된다', () => {
    expect(isDueRangeTooLong('2026-11-01', '2026-11-30')).toBe(false);
  });

  it('해를 넘긴다', () => {
    expect(dueRangeLimit('2026-08-15')).toBe('2027-02-15');
  });

  it('말일 — 6개월 뒤 달에 그날이 없으면 그 달 말일', () => {
    expect(dueRangeLimit('2026-08-31')).toBe('2027-02-28');
    expect(dueRangeLimit('2027-08-31')).toBe('2028-02-29');
    expect(isDueRangeTooLong('2026-08-31', '2027-03-01')).toBe(true);
  });

  it('읽을 수 없는 날이면 판정하지 않는다(형식 검사는 부르는 쪽)', () => {
    expect(dueRangeLimit('2026-02-30')).toBeNull();
    expect(isDueRangeTooLong('2026-02-30', '2027-12-31')).toBe(false);
  });
});
