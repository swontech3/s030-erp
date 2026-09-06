import { randomUUID } from "crypto";
import type { Prisma } from "@/generated/prisma/client";
import { recalcInvoice } from "./invoice-recalc";

// 계약 중도해지(status S) 정산.
//  - 순수 계산: computeTerminationSettlement (DB 비의존, 단위테스트 대상)
//  - DB 반영:   settleTerminatedContract (트랜잭션 내 호출)
//
// 정산 원칙(대표자 명세):
//  · 예치금: 조건 없이 전액 반환  · 할인: 이용기간 무관 전액 환수
//  · 일시불(C): 미래 달 전액 + 해지달 남은일수 일할 환불
//  · 월납(M): 해지달만 일할 정산(과납 환불 / 미납 추가청구), 미래 청구 취소
//  · 순정산금 = (총수납 + 예치금) − 실이용료 − 할인총액  (양수=환불 / 음수=추가청구)
//  · 예치금·할인은 임대료 청구가 아니므로 tb_s080_settlements 원장에만 기록한다.

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

// ────────────────────────────────────────────────────────────────────────────
// DB 반영 — midterm 라우트의 트랜잭션 내에서 호출
// ────────────────────────────────────────────────────────────────────────────

/** yearMonth("YYYY-MM") → 월 인덱스(year*12+month0). 비교용. */
function yearMonthIndex(yearMonth: string): number {
  const [y, m] = yearMonth.split("-").map(Number);
  return y * 12 + (m - 1);
}

/**
 * 계약 중도해지 정산을 DB에 반영한다(같은 트랜잭션에서 호출).
 *  1) 미래 청구(해지달 이후) 삭제 — 데이터 자체 제거(상태변경 아님)
 *  2) 해지달/일시불 청구서를 실이용료로 감액 + 라인 갱신 + recalc
 *     - 임대료 과납분(rentNet>0)은 음수 수납으로 환불 정합, 미납분은 status P 미수금
 *  3) tb_s080_settlements 원장 1건 기록(예치금 반환·할인 환수·순정산금)
 * 예치금·할인은 임대료 청구가 아니므로 원장에만 기록한다.
 */
export async function settleTerminatedContract(
  tx: Prisma.TransactionClient,
  args: { contractId: string; terminateDate: Date; userId: string }
): Promise<TerminationSettlementResult | null> {
  const { contractId, terminateDate, userId } = args;

  const contract = await tx.tbS080Contract.findUnique({
    where: { contractId },
    select: {
      buildingId: true,
      companyId: true,
      monthlyRent: true,
      taxFee: true,
      deposit: true,
      discountAmount: true,
      startDate: true,
      paymentMethod: true,
    },
  });
  if (!contract) return null;

  const invoices = await tx.tbS080Invoice.findMany({
    where: { contractId },
    select: { invoiceId: true, yearMonth: true, status: true, totalAmount: true, paidAmount: true },
    orderBy: { yearMonth: "asc" },
  });

  // 청구서 미생성 계약(예: 대기 단계) → 정산 대상 없음 (E3)
  if (invoices.length === 0) return null;

  // 총 수납액(임대료) = 계약 모든 청구서의 수납 합계
  const paidAgg = await tx.tbS080Payment.aggregate({
    where: { invoice: { contractId } },
    _sum: { amount: true },
  });
  const totalRentPaid = paidAgg._sum.amount ?? 0;

  const result = computeTerminationSettlement({
    startDate:      contract.startDate,
    terminateDate,
    monthlyRent:    contract.monthlyRent,
    taxFee:         contract.taxFee,
    deposit:        contract.deposit,
    discountAmount: contract.discountAmount,
    totalRentPaid,
  });

  const monthlyTotal = contract.monthlyRent + contract.taxFee;
  const termYM = `${terminateDate.getUTCFullYear()}-${String(terminateDate.getUTCMonth() + 1).padStart(2, "0")}`;
  const termIdx = yearMonthIndex(termYM);
  const isLumpSum = contract.paymentMethod === "C";

  // 해지달 일할의 부가세 분리 (라인 갱신용)
  const termMonthDays = daysInMonth(terminateDate.getUTCFullYear(), terminateDate.getUTCMonth());
  const usedDaysSameMonth =
    contract.startDate.getUTCFullYear() * 12 + contract.startDate.getUTCMonth() === termIdx
      ? terminateDate.getUTCDate() - contract.startDate.getUTCDate() + 1
      : terminateDate.getUTCDate();
  const usedDays = Math.min(Math.max(usedDaysSameMonth, 0), termMonthDays);
  const termSupply = Math.round((contract.monthlyRent * usedDays) / termMonthDays);
  const termTax    = result.terminationMonthCharge - termSupply;

  if (isLumpSum) {
    // 일시불: 단일 청구서를 실이용료로 감액 + 음수 수납(임대료 과납분 환불)
    const inv = invoices[0];
    const supply = Math.round((result.usageCharge / monthlyTotal) * contract.monthlyRent) || 0;
    const tax    = result.usageCharge - supply;
    await tx.tbS080Invoice.update({
      where: { invoiceId: inv.invoiceId },
      data:  { subtotal: supply, taxAmount: tax, totalAmount: result.usageCharge, updatedBy: userId },
    });
    await tx.tbS080InvoiceLine.updateMany({
      where: { invoiceId: inv.invoiceId },
      data:  { supplyAmount: supply, taxAmount: tax, totalAmount: result.usageCharge, updatedBy: userId },
    });
    // 임대료 과납분(rentNet>0) 환불 — 예치금/할인은 제외(원장 기록)
    if (result.rentNet > 0) {
      await tx.tbS080Payment.create({
        data: {
          paymentId:   randomUUID(),
          buildingId:  contract.buildingId,
          invoiceId:   inv.invoiceId,
          companyId:   contract.companyId,
          paidAt:      terminateDate,
          amount:      -result.rentNet,
          payMethod:   "B",
          isConfirmed: true,
          confirmedAt: terminateDate,
          confirmedBy: userId,
          createdBy:   userId,
          updatedBy:   userId,
        },
      });
    }
    await recalcInvoice(tx, inv.invoiceId);
  } else {
    // 월납: 미래 청구 취소 + 해지달 일할 감액
    for (const inv of invoices) {
      const ymIdx = yearMonthIndex(inv.yearMonth);
      if (ymIdx > termIdx) {
        // 미래 달 → 데이터 삭제 (상태변경 아님). 라인은 cascade, 수납은 선삭제(미래월은 보통 없음).
        await tx.tbS080Payment.deleteMany({ where: { invoiceId: inv.invoiceId } });
        await tx.tbS080Invoice.delete({ where: { invoiceId: inv.invoiceId } });
      } else if (ymIdx === termIdx && inv.status !== "C") {
        // 해지달 → 일할 실이용료로 감액
        await tx.tbS080Invoice.update({
          where: { invoiceId: inv.invoiceId },
          data:  { subtotal: termSupply, taxAmount: termTax, totalAmount: result.terminationMonthCharge, updatedBy: userId },
        });
        await tx.tbS080InvoiceLine.updateMany({
          where: { invoiceId: inv.invoiceId },
          data:  { supplyAmount: termSupply, taxAmount: termTax, totalAmount: result.terminationMonthCharge, updatedBy: userId },
        });
        // 해지달 과납분 환불(음수 수납). 미납분은 recalc 시 status P(미수금)로 표시.
        const termOver = inv.paidAmount - result.terminationMonthCharge;
        if (termOver > 0) {
          await tx.tbS080Payment.create({
            data: {
              paymentId:   randomUUID(),
              buildingId:  contract.buildingId,
              invoiceId:   inv.invoiceId,
              companyId:   contract.companyId,
              paidAt:      terminateDate,
              amount:      -termOver,
              payMethod:   "B",
              isConfirmed: true,
              confirmedAt: terminateDate,
              confirmedBy: userId,
              createdBy:   userId,
              updatedBy:   userId,
            },
          });
        }
        await recalcInvoice(tx, inv.invoiceId);
      }
      // 해지달 이전 달 → 변경 없음(정상 채무/완납 유지)
    }
  }

  // 정산 원장 기록 (SSOT) — 예치금 반환·할인 환수·순정산금
  await tx.tbS080Settlement.create({
    data: {
      settlementId:     randomUUID(),
      buildingId:       contract.buildingId,
      companyId:        contract.companyId,
      contractId,
      terminateDate,
      paymentMethod:    contract.paymentMethod,
      totalRentPaid,
      depositReturn:    result.depositReturn,
      discountClawback: result.discountClawback,
      usageCharge:      result.usageCharge,
      netAmount:        result.netAmount,
      settleType:       result.settleType,
      createdBy:        userId,
    },
  });

  return result;
}
