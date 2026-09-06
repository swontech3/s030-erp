import { randomUUID } from "crypto";
import type { Prisma } from "@/generated/prisma/client";

// PAY_ST: P=납부대기 / E=납부완료 / O=미납 / C=취소
const PAY_ST_PAID    = "E"; // 납부완료
const PAY_ST_PENDING = "P"; // 납부대기

/**
 * 계약확정 시 계약기간(시작~종료)에 대한 청구서/청구서라인/수납을 생성한다.
 * 납부방법(PAYMENT_METHOD)에 따라 분기:
 *  - 월납(M): 월 단위로 청구서 생성. 첫 달만 납부완료(수납 생성, 발행/납부기한/납부일=시작일),
 *            나머지 달은 납부대기(발행일=납부일 5일 전, 납부기한일=매월 납부일).
 *  - 일시불(C): 계약기간 전체를 **시작월 1건**으로 청구·완납 생성(금액=월액×개월수).
 *            (월별로 중복 생성하면 매월 청구총액·수납총액이 과다 계상되므로 1건으로 묶음.)
 */
export async function generateMonthlyInvoices(
  tx: Prisma.TransactionClient,
  args: {
    contractId: string;
    buildingId: string;
    companyId: string;
    startDate: Date;
    endDate: Date;
    monthlyRent: number;
    taxFee: number;
    billingDay: number;          // 납부일(매월 N일)
    paymentMethod: string | null; // PAYMENT_METHOD: M=월납 / C=일시불
    userId: string;
  }
): Promise<void> {
  const {
    contractId, buildingId, companyId, startDate, endDate,
    monthlyRent, taxFee, billingDay, paymentMethod, userId,
  } = args;

  const total = monthlyRent + taxFee;
  const isLumpSum = paymentMethod === "C"; // 일시불

  // 생성 건수 = 기간(월) = 시작월 포함, 종료월 미포함 (예: 6/7~8/7 → 6·7월 2건). 최소 1건.
  const startTotal = startDate.getUTCFullYear() * 12 + startDate.getUTCMonth();
  const endTotal   = endDate.getUTCFullYear() * 12 + endDate.getUTCMonth();
  const count = Math.max(1, endTotal - startTotal);

  // ── 일시불(C): 계약 전체를 1건으로 청구·완납 ──
  if (isLumpSum) {
    const yearMonth   = `${startDate.getUTCFullYear()}-${String(startDate.getUTCMonth() + 1).padStart(2, "0")}`;
    const subtotal    = monthlyRent * count;
    const taxAmount   = taxFee * count;
    const grandTotal  = total * count;

    const invoiceId = randomUUID();
    await tx.tbS080Invoice.create({
      data: {
        invoiceId,
        buildingId,
        companyId,
        contractId,
        yearMonth,
        issueDate:   startDate,
        dueDate:     startDate,
        subtotal,
        taxAmount,
        totalAmount: grandTotal,
        paidAmount:  grandTotal,
        status:      PAY_ST_PAID,
        createdBy:   userId,
        updatedBy:   userId,
      },
    });

    await tx.tbS080InvoiceLine.create({
      data: {
        invoiceLineId: randomUUID(),
        buildingId,
        invoiceId,
        payItem:      "M", // PAY_ITEM 월 임대료
        quantity:     count, // 계약 개월수
        unitPrice:    monthlyRent,
        supplyAmount: subtotal,
        taxRate:      10,
        taxAmount,
        totalAmount:  grandTotal,
        sortOrder:    0,
        createdBy:    userId,
        updatedBy:    userId,
      },
    });

    await tx.tbS080Payment.create({
      data: {
        paymentId:   randomUUID(),
        buildingId,
        invoiceId,
        companyId,
        paidAt:      startDate,
        amount:      grandTotal,
        payMethod:   "B", // PAY_METHOD 계좌이체
        isConfirmed: true,
        confirmedAt: startDate,
        confirmedBy: userId,
        createdBy:   userId,
        updatedBy:   userId,
      },
    });
    return;
  }

  // ── 월납(M): 월 단위 청구서 — 첫 달만 완납, 나머지 대기 ──
  for (let idx = 0; idx < count; idx++) {
    const cy = Math.floor((startTotal + idx) / 12);
    const cm = (startTotal + idx) % 12; // 0-based
    const yearMonth = `${cy}-${String(cm + 1).padStart(2, "0")}`;

    // 해당 월의 납부일 / 발행일(납부일 5일 전)
    const billDate  = new Date(Date.UTC(cy, cm, billingDay));
    const issueBefore = new Date(billDate);
    issueBefore.setUTCDate(issueBefore.getUTCDate() - 5);

    // 납부완료 대상: 첫 달만
    const isPaid = idx === 0;
    const status     = isPaid ? PAY_ST_PAID : PAY_ST_PENDING;
    const issueDate  = isPaid ? startDate : issueBefore;
    const dueDate    = isPaid ? startDate : billDate;
    const paidAmount = isPaid ? total : 0;

    const invoiceId = randomUUID();
    await tx.tbS080Invoice.create({
      data: {
        invoiceId,
        buildingId,
        companyId,
        contractId,
        yearMonth,
        issueDate,
        dueDate,
        subtotal:    monthlyRent,
        taxAmount:   taxFee,
        totalAmount: total,
        paidAmount,
        status,
        createdBy:   userId,
        updatedBy:   userId,
      },
    });

    await tx.tbS080InvoiceLine.create({
      data: {
        invoiceLineId: randomUUID(),
        buildingId,
        invoiceId,
        payItem:      "M", // PAY_ITEM 월 임대료
        quantity:     1,
        unitPrice:    monthlyRent,
        supplyAmount: monthlyRent,
        taxRate:      10,
        taxAmount:    taxFee,
        totalAmount:  total,
        sortOrder:    0,
        createdBy:    userId,
        updatedBy:    userId,
      },
    });

    // 납부완료 건은 수납(payment) 생성 — 납부일자 = 시작일자, 결제수단 계좌이체(B)
    if (isPaid) {
      await tx.tbS080Payment.create({
        data: {
          paymentId:   randomUUID(),
          buildingId,
          invoiceId,
          companyId,
          paidAt:      startDate,
          amount:      total,
          payMethod:   "B", // PAY_METHOD 계좌이체
          isConfirmed: true,
          confirmedAt: startDate,
          confirmedBy: userId,
          createdBy:   userId,
          updatedBy:   userId,
        },
      });
    }
  }
}
