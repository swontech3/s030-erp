/**
 * 중도해지 정산 계산 — 순수 함수.
 *
 * =============================================================================
 * ★ 레거시 S-WonERP `src/lib/contract-settlement.ts` 에서 **규칙 그대로** 가져왔다
 * =============================================================================
 * 대표자 명세로 굳은 정책이라 재해석하지 않는다. 시험(`contract-settlement.test.ts`)도
 * 함께 옮겼다 — 규칙의 기록은 그 파일이다.
 *
 * 레거시에서 **떼어낸 것**: `settleTerminatedContract` (Prisma 로 DB 를 고치던 절반).
 * 이유 둘 —
 *   ① 이 저장소는 Drizzle/생 SQL 이다. Prisma 트랜잭션 핸들을 받을 자리가 없다
 *   ② 레거시는 미래 달 청구서를 **삭제**했다. 새 규칙은 **취소**다(`invoice-plan.ts`).
 *      지우면 "얼마를 청구했다가 왜 안 받았는지"가 사라진다
 * DB 를 고치는 쪽은 `packages/api/src/db/invoices.ts` 가 한다.
 *
 * =============================================================================
 * 정산 원칙 (대표자 명세)
 * =============================================================================
 *  · 예치금: 조건 없이 전액 반환   · 할인: 이용기간 무관 전액 환수
 *  · 일시불(C): 미래 달 전액 + 해지달 남은일수 일할 환불
 *  · 월납(M): 해지달만 일할 정산(과납 환불 / 미납 추가청구), 미래 청구 취소
 *  · 순정산금 = (총수납 + 예치금) − 실이용료 − 할인총액  (양수=환불 / 음수=추가청구)
 *  · 예치금·할인은 임대료 청구가 아니므로 정산 원장에만 기록한다
 *
 * ★★ **지금 이 저장소에 「할인」이 없다.** 레거시의 `contracts.discount_amount` 는
 *    008 에서 드롭됐고 `tb_s080_contract_spaces` 에도 대응 칸이 없다. 그래서 부르는
 *    쪽이 `discountAmount: 0` 을 넘긴다. 인자를 **지우지 않고 남겨 둔** 이유는,
 *    할인이 생기는 날 이 함수가 아니라 부르는 쪽 한 줄만 고치면 되기 때문이다.
 *    (`tb_s080_settlements` 에 `discount_clawback` 칸을 만들지 않은 것도 같은 이유다 —
 *     늘 0 인 칸을 두면 언젠가 누가 그 0 을 믿는다.)
 */

export type SettleType = "refund" | "charge" | "none";

export type TerminationSettlementInput = {
  /** 계약 시작일 */
  startDate: Date;
  /** 해지일 (이 날까지 이용) */
  terminateDate: Date;
  /** 월 임대료 (부가세 제외) */
  monthlyRent: number;
  /** 부가세액 */
  taxFee: number;
  /** 예치금(보증금) */
  deposit: number;
  /** 총 할인금액 */
  discountAmount: number;
  /** 계약 총 수납액(임대료 수납 합계) */
  totalRentPaid: number;
};

export type TerminationSettlementResult = {
  /** 실이용료 (과거 온전 달 × 정상월액 + 해지달 일할, 부가세 포함) */
  usageCharge: number;
  /** 해지달 일할 이용료 (부가세 포함) */
  terminationMonthCharge: number;
  /** 해지달 이전의 온전히 사용한 달 수 */
  fullUsedMonths: number;
  /** 임대료 순차액 = 총수납 − 실이용료 (양수=임대료 과납) */
  rentNet: number;
  /** 예치금 반환액 (= deposit) */
  depositReturn: number;
  /** 할인 환수액 (= discountAmount) */
  discountClawback: number;
  /** 순정산금 = 예치금 + 임대료 순차액 − 할인 (양수=환불 / 음수=추가청구) */
  netAmount: number;
  /** 정산 유형 */
  settleType: SettleType;
};

/** 해당 연·월(0-based month)의 일수 */
function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/** 일할 금액 = round(월정상액 × 사용일수 / 그달일수) */
function proratedDaily(monthlyTotal: number, usedDays: number, monthDays: number): number {
  if (monthDays <= 0) return 0;
  return Math.round((monthlyTotal * usedDays) / monthDays);
}

/**
 * 중도해지 정산 금액 산출 (순수 함수).
 * usageCharge·해지달 일할은 부가세 포함 정상월액 기준, 해지달은 해당 월 실제 일수로 일할.
 */
export function computeTerminationSettlement(
  input: TerminationSettlementInput
): TerminationSettlementResult {
  const { startDate, terminateDate, monthlyRent, taxFee, deposit, discountAmount, totalRentPaid } = input;
  const monthlyTotal = monthlyRent + taxFee;

  const startIdx = startDate.getUTCFullYear() * 12 + startDate.getUTCMonth();
  const termIdx  = terminateDate.getUTCFullYear() * 12 + terminateDate.getUTCMonth();

  // 해지달 이전의 온전히 사용한 달 수 (음수 방지)
  const fullUsedMonths = Math.max(0, termIdx - startIdx);

  // 해지달 사용일수 / 그달 일수
  const termMonthDays = daysInMonth(terminateDate.getUTCFullYear(), terminateDate.getUTCMonth());
  const usedDays =
    startIdx === termIdx
      ? terminateDate.getUTCDate() - startDate.getUTCDate() + 1 // 같은 달: 시작~해지 포함
      : terminateDate.getUTCDate();                             // 다른 달: 1일~해지일
  const usedDaysClamped = Math.min(Math.max(usedDays, 0), termMonthDays);

  const terminationMonthCharge = proratedDaily(monthlyTotal, usedDaysClamped, termMonthDays);
  const usageCharge = fullUsedMonths * monthlyTotal + terminationMonthCharge;

  const rentNet = totalRentPaid - usageCharge;
  const netAmount = deposit + rentNet - discountAmount;
  const settleType: SettleType = netAmount > 0 ? "refund" : netAmount < 0 ? "charge" : "none";

  return {
    usageCharge,
    terminationMonthCharge,
    fullUsedMonths,
    rentNet,
    depositReturn: deposit,
    discountClawback: discountAmount,
    netAmount,
    settleType,
  };
}
