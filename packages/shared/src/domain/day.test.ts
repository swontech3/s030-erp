/**
 * 날짜 한 칸 — `YYYY-MM-DD` 를 읽고 하루를 더한다.
 *
 * ★ 이 파일이 지키는 것은 **두 가지 규칙**이고, 그 둘이 계약 전체에 퍼져 있다.
 *     ① 없는 날짜(`2026-02-31`)를 조용히 다음 달로 넘기지 않는다
 *     ② UTC 로 센다 — 로컬로 세면 시간대에 따라 하루가 밀린다
 *
 *   ①이 깨지면 계약 시작일이 말없이 바뀌고, ②가 깨지면 종료일과 첫 청구월이 함께
 *   밀린다. 셋 이상의 모듈이 같은 규칙을 쓰고 있어 한 곳으로 모았다.
 */
import { describe, it, expect } from 'vitest';
import { dayAfter, daysBetweenLocal, parseDay, toDay } from './day.ts';

describe('parseDay', () => {
  it('YYYY-MM-DD 를 UTC 자정으로 읽는다', () => {
    expect(parseDay('2026-09-21')?.toISOString()).toBe('2026-09-21T00:00:00.000Z');
  });

  /** ★ `Date.UTC` 는 없는 날짜를 조용히 다음 달로 넘긴다 — 그걸 통과시키지 않는다. */
  it('★ 없는 날짜는 읽지 않는다', () => {
    expect(parseDay('2026-02-31')).toBeNull();
    expect(parseDay('2026-13-01')).toBeNull();
    expect(parseDay('2027-02-29')).toBeNull();
  });

  it('윤년의 2월 29일은 있는 날짜다', () => {
    expect(parseDay('2028-02-29')?.toISOString().slice(0, 10)).toBe('2028-02-29');
  });

  /**
   * ★★ ISO 전체 문자열을 **받지 않는다.** `2026-12-31T15:00:00.000Z` 는 KST 로 다음 날
   *    자정이라, 앞 10자를 잘라 쓰면 하루 앞선 날짜가 된다. 그 실수를 막으려면
   *    「자를 수 있게」 두지 말고 아예 거부해야 한다.
   */
  it('★ ISO 전체 문자열·빈 값은 읽지 않는다', () => {
    expect(parseDay('2026-12-31T15:00:00.000Z')).toBeNull();
    expect(parseDay('')).toBeNull();
    expect(parseDay('2026/09/21')).toBeNull();
  });
});

describe('toDay', () => {
  it('Date 를 YYYY-MM-DD 로 — UTC 기준이다', () => {
    expect(toDay(new Date('2026-09-21T23:00:00.000Z'))).toBe('2026-09-21');
  });
});

describe('dayAfter', () => {
  it('다음 날을 준다', () => {
    expect(dayAfter('2026-09-21')).toBe('2026-09-22');
  });

  it('★ 달과 해를 넘긴다', () => {
    expect(dayAfter('2026-01-31')).toBe('2026-02-01');
    expect(dayAfter('2026-12-31')).toBe('2027-01-01');
  });

  it('★ 윤년을 안다', () => {
    expect(dayAfter('2028-02-28')).toBe('2028-02-29');
    expect(dayAfter('2027-02-28')).toBe('2027-03-01');
  });

  it('읽을 수 없으면 null 이다', () => {
    expect(dayAfter('2026-02-31')).toBeNull();
    expect(dayAfter('')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   ★★★ Date 끼리 비교할 때는 **로컬**이다
   ══════════════════════════════════════════════════════════════════════════
   pg 는 `date`/`timestamp` 를 **로컬 자정의 Date** 로 준다. 그 값의 UTC 날짜는
   하루 앞이고(KST), 「오늘」(`new Date()`)은 낮에 UTC 날짜와 로컬 날짜가 같다 —
   **어긋남이 서로 달라서** UTC 로 세면 한쪽만 밀린다.

   `new Date(y, m, d)` 는 정의상 로컬 자정이라 pg 가 주는 모양 그대로다. */
describe('daysBetweenLocal', () => {
  it('같은 날은 0 이다 — 시:분:초를 버린다', () => {
    expect(daysBetweenLocal(new Date(2026, 8, 18, 23, 59), new Date(2026, 8, 18, 0, 1))).toBe(0);
  });

  it('하루 뒤는 1, 하루 앞은 -1 이다', () => {
    expect(daysBetweenLocal(new Date(2026, 8, 18), new Date(2026, 8, 19))).toBe(1);
    expect(daysBetweenLocal(new Date(2026, 8, 18), new Date(2026, 8, 17))).toBe(-1);
  });

  /** ★★ 이것이 UTC 로 세면 깨지는 자리다 — 시각을 바꿔도 답이 같아야 한다. */
  it('★★ 보는 시각이 달라도 답이 같다', () => {
    const endDate = new Date(2026, 8, 18); // pg 가 주는 모양(로컬 자정)
    for (const hour of [0, 9, 15, 23]) {
      expect(daysBetweenLocal(new Date(2026, 8, 18, hour, 30), endDate), `${hour}시`).toBe(0);
    }
  });

  it('달을 넘어도 센다', () => {
    expect(daysBetweenLocal(new Date(2026, 0, 31), new Date(2026, 1, 1))).toBe(1);
  });
});
