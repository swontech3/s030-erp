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
  /**
   * 환수 합계 — 할인 환수 + 무상 환수. 순정산금에서 뺀다.
   *
   * ★ 두 가지를 **합쳐서** 받는다. 나누어 보관하는 것은 정산 원장의 일이고
   *   (`tb_s080_settlements` 의 두 칸), 계산은 `contract-clawback.ts` 가 한다.
   */
  clawbackTotal: number;
  /**
   * 무상 개월수 — 계약 시작월부터 이 달 수만큼.
   *
   * ★★★ **실이용료에서 무상 달이 빠지는 근거다.** 무상 달은 0원으로 청구됐으므로
   *    실이용료가 그 달을 정상 월액으로 세면 `rentNet` 이 그만큼 더 마이너스가 되고,
   *    거기에 무상 환수가 또 더해져 **같은 달을 두 번 받는다.**
   */
  freeMonths: number;
  /** 계약 총 수납액(임대료 수납 합계) */
  totalRentPaid: number;
};

export type TerminationSettlementResult = {
  /** 실이용료 (과거 온전 달 × 정상월액 + 해지달 일할, 부가세 포함) */
  usageCharge: number;
  /** 해지달 일할 이용료 (부가세 포함) */
  terminationMonthCharge: number;
  /** 해지달 이전의 온전히 사용한 달 수. ★ 무상 달도 **포함**한 실제 경과 달 수다. */
  fullUsedMonths: number;
  /** 임대료 순차액 = 총수납 − 실이용료 (양수=임대료 과납) */
  rentNet: number;
  /** 예치금 반환액 (= deposit) */
  depositReturn: number;
  /** 순정산금 = 예치금 + 임대료 순차액 − 환수 합계 (양수=환불 / 음수=추가청구) */
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

/** 실제로 쓴 기간. **무상 달도 포함한 경과 기간**이다. */
export type UsagePeriod = {
  /** 해지 달 이전에 온전히 지나간 달 수. */
  fullUsedMonths: number;
  /** 해지 달에 쓴 날 수. */
  usedDays: number;
  /** 해지 달의 일수. */
  monthDays: number;
  /** 사용 기간(개월, 소수) = `fullUsedMonths + usedDays / monthDays`. */
  usedMonths: number;
};

/**
 * 시작일~해지일이 며칠·몇 달인가.
 *
 * ★★ **한 곳에서만 센다.** 실이용료(여기)와 환수(`contract-clawback.ts`)가 같은
 *    기간을 봐야 한다. 두 벌로 세면 한쪽만 고쳐져 두 금액이 서로 다른 기간을 쓴다 —
 *    그게 「이중으로 받거나 빠지는」 모양이다.
 *
 * ★ 같은 달에 시작하고 끝나면 **시작일부터 해지일까지**(둘 다 포함), 다른 달이면
 *   그 달 1일부터 해지일까지다.
 */
export function usagePeriod(args: { startDate: Date; terminateDate: Date }): UsagePeriod {
  const { startDate, terminateDate } = args;

  const startIdx = startDate.getUTCFullYear() * 12 + startDate.getUTCMonth();
  const termIdx = terminateDate.getUTCFullYear() * 12 + terminateDate.getUTCMonth();

  const fullUsedMonths = Math.max(0, termIdx - startIdx);

  const monthDays = daysInMonth(terminateDate.getUTCFullYear(), terminateDate.getUTCMonth());
  const raw =
    startIdx === termIdx
      ? terminateDate.getUTCDate() - startDate.getUTCDate() + 1 // 같은 달: 시작~해지 포함
      : terminateDate.getUTCDate(); // 다른 달: 1일~해지일
  const usedDays = Math.min(Math.max(raw, 0), monthDays);

  return {
    fullUsedMonths,
    usedDays,
    monthDays,
    usedMonths: monthDays > 0 ? fullUsedMonths + usedDays / monthDays : fullUsedMonths,
  };
}

/**
 * 중도해지 정산 금액 산출 (순수 함수).
 * usageCharge·해지달 일할은 부가세 포함 정상월액 기준, 해지달은 해당 월 실제 일수로 일할.
 */
export function computeTerminationSettlement(
  input: TerminationSettlementInput
): TerminationSettlementResult {
  const { startDate, terminateDate, monthlyRent, taxFee, deposit, clawbackTotal, freeMonths, totalRentPaid } = input;
  const monthlyTotal = monthlyRent + taxFee;

  const { fullUsedMonths, usedDays, monthDays } = usagePeriod({ startDate, terminateDate });

  /*
   * ★★★ 무상 달을 **실이용료에서 뺀다.**
   *
   * 무상 달은 계약 시작월부터 `freeMonths` 개다. 그러므로
   *   · 해지 달의 위치(`fullUsedMonths`)가 `freeMonths` 보다 작으면 **해지 달 자체가
   *     무상**이다 → 일할이 0 이다
   *   · 온전히 지나간 달 중 앞의 `freeMonths` 개는 무상이다 → 유료 온전 달은 그만큼 적다
   *
   * 이 뺄셈이 없으면 무상 달이 실이용료에도 들어가고 무상 환수에도 들어가
   * **같은 달을 두 번 받는다.**
   */
  const terminationMonthIsFree = fullUsedMonths < freeMonths;
  const paidFullMonths = Math.max(0, fullUsedMonths - freeMonths);

  const terminationMonthCharge = terminationMonthIsFree
    ? 0
    : proratedDaily(monthlyTotal, usedDays, monthDays);
  const usageCharge = paidFullMonths * monthlyTotal + terminationMonthCharge;

  const rentNet = totalRentPaid - usageCharge;
  const netAmount = deposit + rentNet - clawbackTotal;
  const settleType: SettleType = netAmount > 0 ? "refund" : netAmount < 0 ? "charge" : "none";

  return {
    usageCharge,
    terminationMonthCharge,
    fullUsedMonths,
    rentNet,
    depositReturn: deposit,
    netAmount,
    settleType,
  };
}

