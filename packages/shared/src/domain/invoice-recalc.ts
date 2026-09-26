/**
 * 수납 합계 → 저장할 청구 상태 — 순수 함수.
 *
 * 레거시 S-WonERP `src/lib/invoice-recalc.ts` 에서 **규칙 그대로** 가져왔다.
 * 시험(`invoice-recalc.test.ts`)도 함께 옮겼다.
 *
 * 레거시에서 **떼어낸 것**: `recalcInvoice` (Prisma 로 청구서 행을 고치던 절반).
 * 같은 일을 `packages/api/src/db/invoices.ts` 의 `recalcInvoice` 가 생 SQL 로 한다.
 *
 * =============================================================================
 * ★★ 저장되는 상태는 셋뿐이다 — P 납부대기 / E 납부완료 / C 취소
 * =============================================================================
 * 코드 `PAY_ST` 에는 **O(미납)** 도 있지만 **저장하지 않는다.** 미납은 「납부일이
 * 지났는데 안 들어왔다」이고, 그건 시간이 지나면 저절로 참이 되는 사실이다.
 * 저장하면 그 순간부터 배치가 매일 돌며 P 를 O 로 바꿔 줘야 하고, 배치가 하루
 * 멈추면 청구서가 조용히 거짓말을 한다. 화면이 `displayInvoiceStatus` 로 계산한다.
 */

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
