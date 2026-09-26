import { describe, it, expect } from "vitest";
import { computeTerminationSettlement } from "./contract-settlement";

// 정상월액 = 1,000,000 + 100,000 = 1,100,000
const RENT = 1_000_000;
const TAX  = 100_000;
const MONTHLY = RENT + TAX;

function d(y: number, m1: number, day: number): Date {
  return new Date(Date.UTC(y, m1 - 1, day));
}

describe("computeTerminationSettlement — 일시불(C)", () => {
  it("6개월 사용 후 해지: 미래 6개월 + 해지달 잔여 환불, 예치금 반환·할인 환수", () => {
    // 2026-01-01 ~ 12개월, 2026-06-30 해지(6월 말일까지 사용)
    const r = computeTerminationSettlement({
      startDate: d(2026, 1, 1),
      terminateDate: d(2026, 6, 30),
      monthlyRent: RENT,
      taxFee: TAX,
      deposit: 1_000_000,
      clawbackTotal: 100_000,
      freeMonths: 0,
      totalRentPaid: MONTHLY * 12, // 일시불 전액 선납
    });
    expect(r.fullUsedMonths).toBe(5);                 // 1~5월 온전 사용
    expect(r.terminationMonthCharge).toBe(MONTHLY);   // 6월 30/30 = 전액
    expect(r.usageCharge).toBe(MONTHLY * 6);          // 1~6월
    expect(r.rentNet).toBe(MONTHLY * 6);              // 13.2M − 6.6M
    expect(r.netAmount).toBe(MONTHLY * 6 + 1_000_000 - 100_000); // +예치금 −할인
    expect(r.settleType).toBe("refund");
  });

  it("할인 환수액이 환불보다 크면 추가청구(charge)", () => {
    // 11개월 사용, 예치금 0, 할인 2,000,000
    const r = computeTerminationSettlement({
      startDate: d(2026, 1, 1),
      terminateDate: d(2026, 11, 30),
      monthlyRent: RENT,
      taxFee: TAX,
      deposit: 0,
      clawbackTotal: 2_000_000,
      freeMonths: 0,
      totalRentPaid: MONTHLY * 12,
    });
    expect(r.usageCharge).toBe(MONTHLY * 11);
    expect(r.rentNet).toBe(MONTHLY);                  // 1개월분 과납
    expect(r.netAmount).toBe(MONTHLY - 2_000_000);    // −900,000
    expect(r.settleType).toBe("charge");
  });
});

describe("computeTerminationSettlement — 월납(M)", () => {
  it("당월(첫 달) 중 해지: 일할 정산 → 과납 환불", () => {
    // 2026-01-01 시작, 2026-01-15 해지, 첫 달만 수납(1,100,000)
    const r = computeTerminationSettlement({
      startDate: d(2026, 1, 1),
      terminateDate: d(2026, 1, 15),
      monthlyRent: RENT,
      taxFee: TAX,
      deposit: 1_000_000,
      clawbackTotal: 100_000,
      freeMonths: 0,
      totalRentPaid: MONTHLY, // 첫 달만
    });
    // 1월 31일 중 15일 사용
    const termCharge = Math.round((MONTHLY * 15) / 31);
    expect(r.fullUsedMonths).toBe(0);
    expect(r.terminationMonthCharge).toBe(termCharge);
    expect(r.usageCharge).toBe(termCharge);
    expect(r.rentNet).toBe(MONTHLY - termCharge);     // 과납
    expect(r.netAmount).toBe(1_000_000 + (MONTHLY - termCharge) - 100_000);
    expect(r.settleType).toBe("refund");
  });

  it("미래 달까지 미납 상태로 해지: 추가청구(charge)", () => {
    // 2026-01-01 시작, 2026-03-20 해지, 첫 달만 수납 → 2·3월 미납
    const r = computeTerminationSettlement({
      startDate: d(2026, 1, 1),
      terminateDate: d(2026, 3, 20),
      monthlyRent: RENT,
      taxFee: TAX,
      deposit: 0,
      clawbackTotal: 0,
      freeMonths: 0,
      totalRentPaid: MONTHLY, // 첫 달만
    });
    const termCharge = Math.round((MONTHLY * 20) / 31); // 3월 20/31
    expect(r.fullUsedMonths).toBe(2);                   // 1·2월
    expect(r.usageCharge).toBe(MONTHLY * 2 + termCharge);
    expect(r.rentNet).toBe(MONTHLY - (MONTHLY * 2 + termCharge)); // 음수
    expect(r.netAmount).toBeLessThan(0);
    expect(r.settleType).toBe("charge");
  });
});

describe("computeTerminationSettlement — 경계", () => {
  it("해지일=시작일(같은 달, 1일 사용)", () => {
    const r = computeTerminationSettlement({
      startDate: d(2026, 1, 1),
      terminateDate: d(2026, 1, 1),
      monthlyRent: RENT,
      taxFee: TAX,
      deposit: 0,
      clawbackTotal: 0,
      freeMonths: 0,
      totalRentPaid: MONTHLY,
    });
    expect(r.fullUsedMonths).toBe(0);
    expect(r.terminationMonthCharge).toBe(Math.round((MONTHLY * 1) / 31)); // 1일분
    expect(r.usageCharge).toBe(r.terminationMonthCharge);
  });

  it("정산금 0 → settleType none", () => {
    // 예치금·할인 0, 총수납 = 실이용료가 되도록 구성: 1개월 온전 사용 후 말일 해지
    const r = computeTerminationSettlement({
      startDate: d(2026, 2, 1),
      terminateDate: d(2026, 2, 28), // 2월 28일(말일) 사용
      monthlyRent: RENT,
      taxFee: TAX,
      deposit: 0,
      clawbackTotal: 0,
      freeMonths: 0,
      totalRentPaid: MONTHLY, // 2월 한 달 완납
    });
    expect(r.terminationMonthCharge).toBe(MONTHLY); // 28/28 전액
    expect(r.usageCharge).toBe(MONTHLY);
    expect(r.netAmount).toBe(0);
    expect(r.settleType).toBe("none");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   ★★★ 무상 개월수 — **실이용료에서 빠져야 한다**
   ══════════════════════════════════════════════════════════════════════════
   무상 달은 0원으로 청구됐다. 실이용료가 그 달을 정상 월액으로 세면
   `rentNet = 총수납 − 실이용료` 가 그만큼 더 마이너스가 되고, 거기에 **무상 환수**가
   또 더해져 **같은 달을 두 번 받는다.**

   무상 달은 실이용료에서 0 이고, 그 달의 값은 `contract-clawback.ts` 의 무상 환수가
   따로 계산한다. 두 곳이 정확히 한 번씩 세는 것이 이 두 시험의 뜻이다.
   ══════════════════════════════════════════════════════════════════════════ */
describe("computeTerminationSettlement — 무상 개월수", () => {
  it("★ 무상 달에 해지하면 실이용료가 0 이다", () => {
    // 2026-01-01 시작, 1월이 무상. 1월 15일 해지 → 낼 것이 없다
    const r = computeTerminationSettlement({
      startDate: d(2026, 1, 1),
      terminateDate: d(2026, 1, 15),
      monthlyRent: RENT,
      taxFee: TAX,
      deposit: 500_000,
      clawbackTotal: 0,
      freeMonths: 1,
      totalRentPaid: 0, // 무상이라 확정 때 수납이 없다
    });
    expect(r.terminationMonthCharge).toBe(0);
    expect(r.usageCharge).toBe(0);
    expect(r.rentNet).toBe(0);
    expect(r.netAmount).toBe(500_000); // 예치금만 돌려준다
    expect(r.settleType).toBe("refund");
  });

  it("★ 무상 1개월 — 온전히 쓴 달에서 무상 달만큼을 뺀다", () => {
    // 2026-01-01 시작(1월 무상), 3월 15일 해지
    //   온전히 쓴 달 = 1·2월 2개월 → 그중 1개월이 무상 → 유료 온전 1개월(2월)
    //   3월 일할 = round(1,100,000 × 15/31) = 532,258
    const r = computeTerminationSettlement({
      startDate: d(2026, 1, 1),
      terminateDate: d(2026, 3, 15),
      monthlyRent: RENT,
      taxFee: TAX,
      deposit: 0,
      clawbackTotal: 0,
      freeMonths: 1,
      totalRentPaid: MONTHLY, // 2월분만 받았다
    });
    expect(r.fullUsedMonths).toBe(2); // 실제로 지나간 달 수는 그대로 2 다
    expect(r.terminationMonthCharge).toBe(532_258);
    expect(r.usageCharge).toBe(MONTHLY + 532_258);
    expect(r.rentNet).toBe(-532_258);
  });

  it("무상 0 이면 실이용료가 예전 그대로다", () => {
    const withFree = computeTerminationSettlement({
      startDate: d(2026, 1, 1),
      terminateDate: d(2026, 3, 15),
      monthlyRent: RENT,
      taxFee: TAX,
      deposit: 0,
      clawbackTotal: 0,
      freeMonths: 0,
      totalRentPaid: 0,
    });
    expect(withFree.usageCharge).toBe(MONTHLY * 2 + 532_258);
  });

  it("★ 환수 합계는 순정산금에서 빠진다", () => {
    const r = computeTerminationSettlement({
      startDate: d(2026, 1, 1),
      terminateDate: d(2026, 1, 31),
      monthlyRent: RENT,
      taxFee: TAX,
      deposit: 1_000_000,
      clawbackTotal: 300_000,
      freeMonths: 1,
      totalRentPaid: 0,
    });
    // 무상 달이라 실이용료 0, 총수납 0 → 예치금 1,000,000 − 환수 300,000
    expect(r.netAmount).toBe(700_000);
  });
});
