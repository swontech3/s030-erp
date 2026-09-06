import { describe, it, expect } from "vitest";
import { computeStoredStatus } from "./invoice-recalc";

describe("computeStoredStatus", () => {
  it("취소(C)는 그대로 유지", () => {
    expect(computeStoredStatus({ paidAmount: 500, totalAmount: 500, current: "C" })).toBe("C");
  });
  it("완납이면 E", () => {
    expect(computeStoredStatus({ paidAmount: 500, totalAmount: 500, current: "P" })).toBe("E");
  });
  it("초과납부도 E", () => {
    expect(computeStoredStatus({ paidAmount: 600, totalAmount: 500, current: "P" })).toBe("E");
  });
  it("부분납부면 P", () => {
    expect(computeStoredStatus({ paidAmount: 200, totalAmount: 500, current: "E" })).toBe("P");
  });
  it("0원이면 P", () => {
    expect(computeStoredStatus({ paidAmount: 0, totalAmount: 500, current: "E" })).toBe("P");
  });
});
