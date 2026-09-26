import { describe, it, expect } from 'vitest';
import { computeClawback } from './contract-clawback.ts';

/**
 * 중도 해지 환수.
 *
 * 규칙 둘이 서로 맞물려 있다 —
 *   할인 환수 = (기준가 − 계약가) × 실제 사용 기간   (무상 달도 센다)
 *   무상 환수 = 계약가 × (무상 기간 중 실제 사용한 부분)
 *
 * ★★★ **둘을 합치면 무상 달이 기준가가 된다.** 그 불변식이 이 파일의 본체다
 *      (아래 「합치면 기준가」 describe). 한쪽만 틀려도 바로 깨진다.
 */

function utc(y: number, m1: number, d: number): Date {
  return new Date(Date.UTC(y, m1 - 1, d));
}

/** 기준가 300,000 · 계약가 270,000 — 월 30,000 할인. */
const ROOM = { seq: 1, standardFee: 300_000, monthlyFee: 270_000, vatYn: true } as const;

describe('computeClawback — 지시서의 실제 사례', () => {
  /*
   * 기준가 300,000 · 계약가 270,000 · 무상 1개월 · 3개월 계약 · 마지막 달 15일 해지.
   *   2026-03-01 시작(3월 무상) → 2026-05-31 종료 예정, 2026-05-15 해지
   *   사용 기간 = 3월(무상) + 4월 + 5월 15/31 = 2 + 15/31 개월
   */
  const 해지 = () =>
    computeClawback({
      startDate: utc(2026, 3, 1),
      terminateDate: utc(2026, 5, 15),
      freeMonths: 1,
      spaces: [ROOM],
    });

  it('사용 기간에 무상 달이 포함된다', () => {
    expect(해지().usedMonths).toBeCloseTo(2 + 15 / 31, 10);
  });

  it('할인 환수 = 30,000 × 사용 기간 (+ 부가세)', () => {
    // round(30,000 × 2.483870…) = 74,516 · 부가세 floor(74,516 × 10%) = 7,451
    expect(해지().discountClawback).toBe(74_516 + 7_451);
  });

  it('무상 환수 = 계약가 × 무상 1개월 (+ 부가세)', () => {
    expect(해지().freeClawback).toBe(270_000 + 27_000);
  });

  it('합계는 둘의 합이다', () => {
    const r = 해지();
    expect(r.total).toBe(r.discountClawback + r.freeClawback);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   ★★★ 불변식 — 합치면 무상 달이 기준가가 된다
   ══════════════════════════════════════════════════════════════════════════
   중도 해지하면 「깎아 준 것도 공짜로 준 것도 없던 일」이 된다. 즉 쓴 만큼을
   **기준가로 다시 계산**한 것이 총 받을 돈이다.

   무상 달은 청구가 0 이었으므로 환수 둘을 합치면 정확히 **기준가**여야 한다.
   유료 달은 이미 계약가로 청구·수납했으므로 할인분만 더하면 기준가가 된다.
   ══════════════════════════════════════════════════════════════════════════ */
describe('computeClawback — ★ 합치면 무상 달이 기준가가 된다', () => {
  it('무상 1개월을 그 달만 온전히 쓰고 해지하면 환수 공급가 = 기준가', () => {
    const r = computeClawback({
      startDate: utc(2026, 3, 1),
      terminateDate: utc(2026, 3, 31), // 3월을 통째로
      freeMonths: 1,
      spaces: [{ ...ROOM, vatYn: false }], // 부가세를 빼고 공급가만 본다
    });
    expect(r.usedMonths).toBe(1);
    expect(r.discountClawback).toBe(30_000);
    expect(r.freeClawback).toBe(270_000);
    expect(r.total).toBe(300_000); // ★ 기준가
  });

  it('무상 달을 절반만 쓰면 환수도 기준가의 절반이다', () => {
    // 2026-04-01 시작(4월 무상, 30일), 4월 15일 해지 → 15/30 = 0.5
    const r = computeClawback({
      startDate: utc(2026, 4, 1),
      terminateDate: utc(2026, 4, 15),
      freeMonths: 1,
      spaces: [{ ...ROOM, vatYn: false }],
    });
    expect(r.usedMonths).toBe(0.5);
    expect(r.total).toBe(150_000); // 기준가 300,000 의 절반
  });
});

describe('computeClawback — 할인 환수', () => {
  it('★ 계약가가 기준가 이상인 호실은 0 이다 (음수 환수는 없다)', () => {
    const r = computeClawback({
      startDate: utc(2026, 3, 1),
      terminateDate: utc(2026, 3, 31),
      freeMonths: 0,
      spaces: [{ seq: 1, standardFee: 200_000, monthlyFee: 250_000, vatYn: true }],
    });
    expect(r.discountClawback).toBe(0);
  });

  it('기준가와 계약가가 같으면 0 이다', () => {
    const r = computeClawback({
      startDate: utc(2026, 3, 1),
      terminateDate: utc(2026, 3, 31),
      freeMonths: 0,
      spaces: [{ seq: 1, standardFee: 270_000, monthlyFee: 270_000, vatYn: true }],
    });
    expect(r.discountClawback).toBe(0);
  });

  it('해지 달은 일할 비율이다', () => {
    // 2026-03-01 시작, 3월 15일 해지 → 15/31
    const r = computeClawback({
      startDate: utc(2026, 3, 1),
      terminateDate: utc(2026, 3, 15),
      freeMonths: 0,
      spaces: [{ ...ROOM, vatYn: false }],
    });
    expect(r.discountClawback).toBe(14_516); // round(30,000 × 15/31)
  });

  it('★ 무상 달도 사용 기간에 넣는다 — 무상이라고 할인 환수에서 빠지지 않는다', () => {
    // 2026-03-01 시작(3월 무상), 4월 30일 해지 → 2개월 온전
    const r = computeClawback({
      startDate: utc(2026, 3, 1),
      terminateDate: utc(2026, 4, 30),
      freeMonths: 1,
      spaces: [{ ...ROOM, vatYn: false }],
    });
    expect(r.usedMonths).toBe(2);
    expect(r.discountClawback).toBe(60_000); // 30,000 × 2 — 3월도 센다
  });
});

describe('computeClawback — 무상 환수', () => {
  it('무상이 0 이면 0 이다', () => {
    const r = computeClawback({
      startDate: utc(2026, 3, 1),
      terminateDate: utc(2026, 5, 15),
      freeMonths: 0,
      spaces: [ROOM],
    });
    expect(r.freeClawback).toBe(0);
  });

  it('★ 무상 기간 중 실제로 쓴 부분만 환수한다', () => {
    // 무상 2개월인데 3월 15일에 해지 → 무상 기간의 15/31 만 썼다
    const r = computeClawback({
      startDate: utc(2026, 3, 1),
      terminateDate: utc(2026, 3, 15),
      freeMonths: 2,
      spaces: [{ ...ROOM, vatYn: false }],
    });
    expect(r.freeClawback).toBe(130_645); // round(270,000 × 15/31)
  });

  it('무상 기간을 다 쓰고 더 썼으면 무상 개월수까지만 환수한다', () => {
    // 무상 1개월인데 5개월 썼다 → 무상 환수는 1개월분뿐
    const r = computeClawback({
      startDate: utc(2026, 3, 1),
      terminateDate: utc(2026, 7, 31),
      freeMonths: 1,
      spaces: [{ ...ROOM, vatYn: false }],
    });
    expect(r.freeClawback).toBe(270_000);
  });
});

describe('computeClawback — 부가세', () => {
  it('★ 부가세 대상 호실만 환수액에 부가세가 붙는다', () => {
    const 과세 = computeClawback({
      startDate: utc(2026, 3, 1),
      terminateDate: utc(2026, 3, 31),
      freeMonths: 1,
      spaces: [{ ...ROOM, vatYn: true }],
    });
    const 면세 = computeClawback({
      startDate: utc(2026, 3, 1),
      terminateDate: utc(2026, 3, 31),
      freeMonths: 1,
      spaces: [{ ...ROOM, vatYn: false }],
    });
    expect(면세.total).toBe(300_000);
    expect(과세.total).toBe(300_000 + 3_000 + 27_000); // 할인 30,000 · 무상 270,000 의 10%
  });

  it('부가세는 버림이다 — 반올림이 아니다', () => {
    // 할인단가 999 × 1개월 = 999 → floor(99.9) = 99
    const r = computeClawback({
      startDate: utc(2026, 3, 1),
      terminateDate: utc(2026, 3, 31),
      freeMonths: 0,
      spaces: [{ seq: 1, standardFee: 1_999, monthlyFee: 1_000, vatYn: true }],
    });
    expect(r.discountClawback).toBe(999 + 99);
  });
});

describe('computeClawback — 호실 여러 개', () => {
  it('★ 줄마다 계산해서 더한다 — 합계에 한 번 매기지 않는다', () => {
    const r = computeClawback({
      startDate: utc(2026, 3, 1),
      terminateDate: utc(2026, 3, 31),
      freeMonths: 1,
      spaces: [
        { seq: 1, standardFee: 300_000, monthlyFee: 270_000, vatYn: true },
        { seq: 2, standardFee: 100_000, monthlyFee: 100_000, vatYn: false }, // 할인 없음·면세
      ],
    });
    // 1행 할인 30,000 + vat 3,000 / 2행 할인 0
    expect(r.discountClawback).toBe(33_000);
    // 1행 무상 270,000 + vat 27,000 / 2행 무상 100,000 (면세)
    expect(r.freeClawback).toBe(297_000 + 100_000);
  });

  it('호실이 없으면 전부 0 이다', () => {
    const r = computeClawback({
      startDate: utc(2026, 3, 1),
      terminateDate: utc(2026, 3, 31),
      freeMonths: 1,
      spaces: [],
    });
    expect(r).toMatchObject({ discountClawback: 0, freeClawback: 0, total: 0 });
  });
});
