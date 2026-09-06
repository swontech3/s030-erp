import { describe, it, expect } from "vitest";
import {
  validateReservation,
  computeUsageFee,
  generateSlotStarts,
  timeToMinutes,
  OPEN_MINUTES,
  CLOSE_MINUTES,
  chunkPairs,
} from "./reservation-validation";

const base = {
  openMin: OPEN_MINUTES,   // 360 (06:00)
  closeMin: CLOSE_MINUTES, // 1440 (24:00)
  minDuration: 30,
  maxDuration: 240,
  existing: [] as { startMin: number; endMin: number }[],
};

describe("timeToMinutes", () => {
  it("06:00 → 360", () => expect(timeToMinutes("06:00")).toBe(360));
  it("09:30 → 570", () => expect(timeToMinutes("09:30")).toBe(570));
  it("24:00 → 1440", () => expect(timeToMinutes("24:00")).toBe(1440));
});

describe("validateReservation", () => {
  it("정상 예약 통과", () => {
    expect(validateReservation({ ...base, startMin: 540, endMin: 600 }).ok).toBe(true);
  });
  it("06:00 시작 경계 통과", () => {
    expect(validateReservation({ ...base, startMin: 360, endMin: 390 }).ok).toBe(true);
  });
  it("23:30~24:00 종료 경계 통과", () => {
    expect(validateReservation({ ...base, startMin: 1410, endMin: 1440 }).ok).toBe(true);
  });
  it("운영 시작 전(05:30) 거부", () => {
    const r = validateReservation({ ...base, startMin: 330, endMin: 390 });
    expect(r).toEqual({ ok: false, reason: "OUT_OF_HOURS" });
  });
  it("운영 종료 후(24:30) 거부", () => {
    const r = validateReservation({ ...base, startMin: 1410, endMin: 1470 });
    expect(r).toEqual({ ok: false, reason: "OUT_OF_HOURS" });
  });
  it("30분 미정렬 거부", () => {
    const r = validateReservation({ ...base, startMin: 545, endMin: 600 });
    expect(r).toEqual({ ok: false, reason: "NOT_ALIGNED" });
  });
  it("최소시간 미만 거부", () => {
    const r = validateReservation({ ...base, minDuration: 60, startMin: 540, endMin: 570 });
    expect(r).toEqual({ ok: false, reason: "TOO_SHORT" });
  });
  it("최대시간 초과 거부", () => {
    const r = validateReservation({ ...base, maxDuration: 60, startMin: 540, endMin: 660 });
    expect(r).toEqual({ ok: false, reason: "TOO_LONG" });
  });
  it("start >= end 거부", () => {
    const r = validateReservation({ ...base, startMin: 600, endMin: 540 });
    expect(r).toEqual({ ok: false, reason: "INVALID_RANGE" });
  });
  it("겹침 거부 (1분이라도 겹치면)", () => {
    const r = validateReservation({
      ...base, startMin: 540, endMin: 600,
      existing: [{ startMin: 570, endMin: 630 }],
    });
    expect(r).toEqual({ ok: false, reason: "OVERLAP" });
  });
  it("인접(끝=시작)은 겹침 아님", () => {
    const r = validateReservation({
      ...base, startMin: 540, endMin: 600,
      existing: [{ startMin: 600, endMin: 660 }],
    });
    expect(r.ok).toBe(true);
  });
});

describe("computeUsageFee", () => {
  it("30분당 10000, 1시간 → 20000", () => expect(computeUsageFee(10000, 540, 600)).toBe(20000));
  it("30분당 10000, 30분 → 10000", () => expect(computeUsageFee(10000, 540, 570)).toBe(10000));
  it("요금 없으면 0", () => expect(computeUsageFee(null, 540, 600)).toBe(0));
});

describe("generateSlotStarts", () => {
  it("06:00~24:00은 36개 슬롯, 마지막 23:30", () => {
    const slots = generateSlotStarts(OPEN_MINUTES, CLOSE_MINUTES);
    expect(slots.length).toBe(36);
    expect(slots[0]).toBe(360);
    expect(slots[1]).toBe(390);
    expect(slots[slots.length - 1]).toBe(1410);
  });
});

describe("chunkPairs", () => {
  it("빈 배열은 빈 배열", () => {
    expect(chunkPairs([])).toEqual([]);
  });
  it("짝수 개는 2개씩 묶음", () => {
    expect(chunkPairs([1, 2, 3, 4])).toEqual([[1, 2], [3, 4]]);
  });
  it("홀수 개는 마지막 행이 1칸", () => {
    expect(chunkPairs([1, 2, 3])).toEqual([[1, 2], [3]]);
  });
  it("1개는 1칸 행 하나", () => {
    expect(chunkPairs(["a"])).toEqual([["a"]]);
  });
});
