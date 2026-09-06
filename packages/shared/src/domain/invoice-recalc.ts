import type { Prisma } from "@/generated/prisma/client";

/** 수납 합계로부터 저장용 청구 상태(P/E/C)를 계산한다. 취소(C)는 보존. */
export function computeStoredStatus(args: {
  paidAmount: number;
  totalAmount: number;
  current: string;
}): string {
  const { paidAmount, totalAmount, current } = args;
  if (current === "C") return "C";
  return paidAmount >= totalAmount ? "E" : "P";
}

/**
 * 청구서의 수납 합계를 다시 계산해 paidAmount/status를 갱신한다.
 * 수납 생성·수정·삭제 직후 같은 트랜잭션에서 호출한다.
 */
export async function recalcInvoice(
  tx: Prisma.TransactionClient,
  invoiceId: string
): Promise<void> {
  const invoice = await tx.tbS080Invoice.findUnique({
    where: { invoiceId },
    select: { totalAmount: true, status: true },
  });
  if (!invoice) return;

  const agg = await tx.tbS080Payment.aggregate({
    where: { invoiceId },
    _sum: { amount: true },
  });
  const paidAmount = agg._sum.amount ?? 0;
  const status = computeStoredStatus({
    paidAmount,
    totalAmount: invoice.totalAmount,
    current: invoice.status,
  });

  await tx.tbS080Invoice.update({
    where: { invoiceId },
    data: { paidAmount, status },
  });
}
