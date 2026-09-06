import { describe, it, expect } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { generateMonthlyInvoices } from "./contract-invoices";

type Row = Record<string, unknown>;

// tx.create 호출을 캡처하는 가짜 트랜잭션 클라이언트
function makeTx() {
  const calls = { invoices: [] as Row[], lines: [] as Row[], payments: [] as Row[] };
  const tx = {
    tbS080Invoice:     { create: async ({ data }: { data: Row }) => { calls.invoices.push(data); } },
    tbS080InvoiceLine: { create: async ({ data }: { data: Row }) => { calls.lines.push(data); } },
    tbS080Payment:     { create: async ({ data }: { data: Row }) => { calls.payments.push(data); } },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, calls };
}

const base = {
  contractId: "c1",
  buildingId: "b1",
  companyId: "co1",
  startDate: new Date(Date.UTC(2026, 5, 7)), // 2026-06-07
  endDate:   new Date(Date.UTC(2026, 8, 7)), // 2026-09-07 → count 3 (6·7·8월)
  monthlyRent: 800000,
  taxFee: 80000,
  billingDay: 7,
  userId: "u1",
};

describe("generateMonthlyInvoices — 일시불(C)", () => {
  it("계약기간 전체를 시작월 1건으로 청구·완납한다", async () => {
    const { tx, calls } = makeTx();
    await generateMonthlyInvoices(tx, { ...base, paymentMethod: "C" });

    // 청구서 1건만
    expect(calls.invoices).toHaveLength(1);
    expect(calls.lines).toHaveLength(1);
    expect(calls.payments).toHaveLength(1);

    const inv = calls.invoices[0];
    expect(inv.yearMonth).toBe("2026-06");          // 시작월
    expect(inv.subtotal).toBe(800000 * 3);          // 월액 × 개월수
    expect(inv.taxAmount).toBe(80000 * 3);
    expect(inv.totalAmount).toBe(880000 * 3);       // 2,640,000
    expect(inv.paidAmount).toBe(880000 * 3);        // 완납
    expect(inv.status).toBe("E");

    expect(calls.lines[0].quantity).toBe(3);        // 개월수
    expect(calls.payments[0].amount).toBe(880000 * 3);
  });
});

describe("generateMonthlyInvoices — 월납(M)", () => {
  it("월 단위로 count건 생성, 첫 달만 완납·수납", async () => {
    const { tx, calls } = makeTx();
    await generateMonthlyInvoices(tx, { ...base, paymentMethod: "M" });

    expect(calls.invoices).toHaveLength(3);         // 6·7·8월
    expect(calls.lines).toHaveLength(3);
    expect(calls.payments).toHaveLength(1);         // 첫 달만 수납

    expect(calls.invoices.map((i) => i.yearMonth)).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(calls.invoices[0].status).toBe("E");     // 첫 달 완납
    expect(calls.invoices[0].paidAmount).toBe(880000);
    expect(calls.invoices[1].status).toBe("P");     // 나머지 대기
    expect(calls.invoices[1].paidAmount).toBe(0);
    expect(calls.invoices[2].status).toBe("P");

    // 월별 청구는 1개월분(중복 없음)
    expect(calls.invoices[0].totalAmount).toBe(880000);
  });
});
