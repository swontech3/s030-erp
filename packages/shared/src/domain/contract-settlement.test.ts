import { describe, it, expect } from "vitest";
import { SETTLE_TRIM_UNIT, computeTerminationSettlement, trimSettlementNet } from "./contract-settlement";

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
    // ★ 10원 미만은 버린다 — 1,467,742 → 1,467,740. 버리기 전 값은 netAmountRaw 다.
    expect(r.netAmountRaw).toBe(1_000_000 + (MONTHLY - termCharge) - 100_000); // 1,467,742
    expect(r.netAmount).toBe(1_467_740);
    expect(r.netTrim).toBe(2);
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

/* ══════════════════════════════════════════════════════════════════════════
   ★★★ 순정산금 절사 — **10원 미만을 버린다** (2026-09-26)
   ══════════════════════════════════════════════════════════════════════════
   실제로 계좌로 주고받는 금액이라 1원 잔돈을 남기지 않는다. 원장에 들어가는 값이
   이 값이고, 정산서·정산 카드·정산 처리 기본값이 모두 원장을 읽는다 — 그래서 **여기서
   한 번만** 버린다. 화면이 따로 버리면 원장과 화면이 갈린다.

   ★★ `rentNet` 은 버리지 않는다. 그것은 청구서에 들어가는 몫이고, 정산 처리가
      청구서마다 남은 금액의 합이 `-rentNet` 과 같은지 검사한다(다르면 409).
   ══════════════════════════════════════════════════════════════════════════ */
describe("computeTerminationSettlement — 순정산금 절사", () => {
  /** 환불 466,667 → 466,660. 지시서의 그 금액이다. */
  it("★ 환불은 10원 미만을 버린다", () => {
    const r = computeTerminationSettlement({
      startDate: d(2026, 9, 1),
      terminateDate: d(2026, 9, 10),
      monthlyRent: 1_000_000,
      taxFee: 100_000,
      deposit: 0,
      clawbackTotal: 0,
      freeMonths: 0,
      totalRentPaid: MONTHLY, // 9월 한 달 완납 후 10일에 해지
    });
    // 9월 30일 중 10일 사용 → round(1,100,000 × 10/30) = 366,667
    expect(r.usageCharge).toBe(366_667);
    expect(r.netAmountRaw).toBe(733_333);
    expect(r.netAmount).toBe(733_330);
    expect(r.netTrim).toBe(3);
    expect(r.settleType).toBe("refund");
  });

  /**
   * ★★★ 추가청구도 **버린다 — 고객이 덜 낸다.** 음수에 `Math.floor` 를 쓰면
   *    −819,677 이 −819,680 이 되어 고객이 **더 내는** 쪽으로 버려진다.
   */
  it("★★★ 추가청구는 고객이 덜 내는 쪽으로 버린다", () => {
    const r = computeTerminationSettlement({
      startDate: d(2026, 1, 1),
      terminateDate: d(2026, 1, 15),
      monthlyRent: 1_000_000,
      taxFee: 100_000,
      deposit: 0,
      // 실이용료만큼 받아 두었으니 rentNet 은 0 이다 — 환수가 그대로 추가청구가 된다
      clawbackTotal: 819_677,
      freeMonths: 0,
      totalRentPaid: Math.round((MONTHLY * 15) / 31),
    });
    expect(r.netAmountRaw).toBe(-819_677);
    expect(r.netAmount).toBe(-819_670); // −819,680 이 아니다
    expect(r.netTrim).toBe(7);
    expect(r.settleType).toBe("charge");
  });

  /** ★ 버려서 0 이 되면 방향도 「없음」이다 — 7원을 돌려주러 은행에 가지 않는다. */
  it("★ 10원이 안 되는 정산은 주고받을 금액이 없다", () => {
    const r = computeTerminationSettlement({
      startDate: d(2026, 2, 1),
      terminateDate: d(2026, 2, 28),
      monthlyRent: 1_000_000,
      taxFee: 100_000,
      deposit: 0,
      clawbackTotal: 0,
      freeMonths: 0,
      totalRentPaid: MONTHLY + 7, // 7원 더 받았다
    });
    expect(r.netAmountRaw).toBe(7);
    expect(r.netAmount).toBe(0);
    expect(r.settleType).toBe("none");
  });

  it("★ 10원 단위로 딱 맞으면 버릴 것이 없다", () => {
    const r = computeTerminationSettlement({
      startDate: d(2026, 2, 1),
      terminateDate: d(2026, 2, 28),
      monthlyRent: 1_000_000,
      taxFee: 100_000,
      deposit: 500_000,
      clawbackTotal: 0,
      freeMonths: 0,
      totalRentPaid: MONTHLY,
    });
    expect(r.netAmount).toBe(500_000);
    expect(r.netTrim).toBe(0);
  });
});

describe("trimSettlementNet", () => {
  it("절댓값을 10원 단위로 내린다 — 부호는 그대로", () => {
    expect(trimSettlementNet(466_667)).toBe(466_660);
    expect(trimSettlementNet(-466_667)).toBe(-466_660);
    expect(trimSettlementNet(466_660)).toBe(466_660);
    expect(trimSettlementNet(-9)).toBe(0);
    expect(trimSettlementNet(9)).toBe(0);
    expect(trimSettlementNet(0)).toBe(0);
  });

  it("단위는 바꿔 부를 수 있다 — 규칙은 하나지만 시험은 단위를 건다", () => {
    expect(trimSettlementNet(466_667, 100)).toBe(466_600);
    expect(trimSettlementNet(466_667, 1_000)).toBe(466_000);
    expect(trimSettlementNet(466_667, 1)).toBe(466_667);
  });

  it("★ 절사 단위는 10원이다", () => {
    expect(SETTLE_TRIM_UNIT).toBe(10);
  });
});
