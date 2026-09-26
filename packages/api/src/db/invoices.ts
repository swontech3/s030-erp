/**
 * 청구·납부 저장소 — 청구 SQL 이 모여 있는 유일한 자리.
 *
 * `db/contracts.ts` 와 같은 규칙이다 — 전부 `withCompanyScope()` 가 연 트랜잭션
 * 안에서 돌고, 스스로 커넥션을 꺼내지 않는다.
 *
 * =============================================================================
 * ★★★ 날짜는 **문자열로 받는다** — 여기가 하루 어긋나는 자리다
 * =============================================================================
 * 이 DB 는 날짜를 두 가지 타입으로 들고 있고, pg 드라이버가 둘을 **서로 다른
 * 시각의 `Date`** 로 돌려준다(2026-09-24 실측, 기계 시간대 Asia/Seoul):
 *
 *   `tb_s080_contracts.start_date`  timestamp → `2026-09-18T00:00:00.000Z` (UTC 자정)
 *   `tb_s080_contracts.contract_date` date    → `2026-09-16T15:00:00.000Z` (로컬 자정)
 *
 * 즉 같은 「9월 18일」과 「9월 17일」인데 UTC 로 읽으면 한쪽만 하루 밀린다.
 * `toISOString().slice(0,10)` 을 두 값에 똑같이 쓰면 `date` 쪽이 **전날**이 된다.
 *
 * 그래서 청구 경로는 `Date` 를 아예 받지 않는다. SQL 에서 `to_char(..., 'YYYY-MM-DD')`
 * 로 **문자열**을 받고, 필요하면 `parseDay()` 로 UTC 자정 `Date` 를 만들어 쓴다.
 * 그러면 타입이 무엇이든 같은 답이 나온다.
 *
 * (같은 함정이 `day.ts` 머리말에 적혀 있다. 거기는 비교 규칙, 여기는 읽기 규칙이다.)
 */
import type { ScopedClient } from './withCompanyScope.ts';
import type { InvoicePlan, ProratedLine } from '@swonbiz/shared/domain/invoice-plan';
import type { TerminationSettlementResult } from '@swonbiz/shared/domain/contract-settlement';
import type { ClawbackResult } from '@swonbiz/shared/domain/contract-clawback';
import { computeStoredStatus } from '@swonbiz/shared/domain/invoice-recalc';

interface Rows<T> {
  rows: T[];
  rowCount: number | null;
}
const q = <T>(client: ScopedClient, sql: string, params?: unknown[]): Promise<Rows<T>> =>
  client.query(sql, params) as Promise<Rows<T>>;

/* ══════════════════════════════════════════════════════════════════════════
   읽기 — 청구서를 만들기 위해 계약에서 꺼내는 것
   ══════════════════════════════════════════════════════════════════════════ */

/** 청구서를 만드는 데 필요한 계약의 칸들. 날짜는 전부 문자열이다(머리말 참조). */
export interface BillingContract {
  contract_id: string;
  company_id: string;
  build_id: string;
  status: string;
  payment_method: string | null;
  period_months: number | null;
  /** 무상 개월수. 계약 시작월부터 이 달 수만큼 0원 청구다. */
  free_months: number;
  /** `YYYY-MM-DD`. */
  start_day: string;
  /** `YYYY-MM-DD`. */
  end_day: string;
  /** `YYYY-MM-DD`. 계약일자는 선택이라 NULL 일 수 있다. */
  contract_day: string | null;
}

export async function findBillingContract(
  client: ScopedClient,
  contractId: string,
): Promise<BillingContract | null> {
  const { rows } = await q<BillingContract>(
    client,
    `SELECT contract_id, company_id, build_id, status, payment_method, period_months, free_months,
            to_char(start_date,    'YYYY-MM-DD') AS start_day,
            to_char(end_date,      'YYYY-MM-DD') AS end_day,
            to_char(contract_date, 'YYYY-MM-DD') AS contract_day
       FROM public.tb_s080_contracts
      WHERE contract_id = $1`,
    [contractId],
  );
  return rows[0] ?? null;
}

export interface BillingSpace {
  contract_space_id: string;
  seq: number;
  /** 기준가 — **중도 해지 할인 환수**가 이 값과 계약가의 차이를 본다. */
  standard_fee: number;
  deposit: number;
  monthly_fee: number;
  vat_yn: boolean;
  vat_amount: number;
  payment_amount: number;
}

export async function findBillingSpaces(
  client: ScopedClient,
  contractId: string,
): Promise<BillingSpace[]> {
  const { rows } = await q<BillingSpace>(
    client,
    `SELECT contract_space_id, seq, standard_fee, deposit, monthly_fee, vat_yn, vat_amount, payment_amount
       FROM public.tb_s080_contract_spaces
      WHERE contract_id = $1
      ORDER BY seq`,
    [contractId],
  );
  return rows;
}

/**
 * 이 계약에 청구서가 이미 있는가.
 *
 * ★ 확정 경로가 여럿이라(신규 확정 · 대기→확정 · 재계약 확정) 두 번 도는 길이
 *   생길 수 있다. 유일 인덱스가 DB 에서 막긴 하지만, 그건 **500 으로 막는 것**이다.
 *   여기서 먼저 보고 조용히 건너뛴다.
 */
export async function countContractInvoices(
  client: ScopedClient,
  contractId: string,
): Promise<number> {
  const { rows } = await q<{ n: string }>(
    client,
    `SELECT count(*) AS n FROM public.tb_s080_invoices WHERE contract_id = $1`,
    [contractId],
  );
  return Number(rows[0]?.n ?? 0);
}

export interface InvoiceRow {
  invoice_id: string;
  company_id: string;
  build_id: string;
  contract_id: string | null;
  year_month: string;
  /** `YYYY-MM-DD`. */
  due_day: string;
  supply_amount: number;
  vat_amount: number;
  total_amount: number;
  paid_amount: number;
  status: string;
}

const INVOICE_COLUMNS = `
  invoice_id, company_id, build_id, contract_id, year_month,
  to_char(due_date, 'YYYY-MM-DD') AS due_day,
  supply_amount, vat_amount, total_amount, paid_amount, status`;

export async function findInvoice(
  client: ScopedClient,
  invoiceId: string,
): Promise<InvoiceRow | null> {
  const { rows } = await q<InvoiceRow>(
    client,
    `SELECT ${INVOICE_COLUMNS} FROM public.tb_s080_invoices WHERE invoice_id = $1`,
    [invoiceId],
  );
  return rows[0] ?? null;
}

export async function listContractInvoices(
  client: ScopedClient,
  contractId: string,
): Promise<InvoiceRow[]> {
  const { rows } = await q<InvoiceRow>(
    client,
    `SELECT ${INVOICE_COLUMNS}
       FROM public.tb_s080_invoices
      WHERE contract_id = $1
      ORDER BY year_month`,
    [contractId],
  );
  return rows;
}

export async function listInvoiceLines(
  client: ScopedClient,
  invoiceId: string,
): Promise<{ invoice_line_id: string; seq: number; pay_item: string; contract_space_id: string | null; is_free: boolean; quantity: number; unit_price: number; supply_amount: number; vat_amount: number; total_amount: number }[]> {
  const { rows } = await q<{
    invoice_line_id: string; seq: number; pay_item: string; contract_space_id: string | null;
    is_free: boolean;
    quantity: number; unit_price: number; supply_amount: number; vat_amount: number; total_amount: number;
  }>(
    client,
    `SELECT invoice_line_id, seq, pay_item, contract_space_id, is_free,
            quantity, unit_price, supply_amount, vat_amount, total_amount
       FROM public.tb_s080_invoice_lines
      WHERE invoice_id = $1
      ORDER BY seq, pay_item`,
    [invoiceId],
  );
  return rows;
}

export async function listInvoicePayments(
  client: ScopedClient,
  invoiceId: string,
): Promise<{ payment_id: string; paid_day: string; amount: number; pay_method: string; memo: string | null }[]> {
  const { rows } = await q<{ payment_id: string; paid_day: string; amount: number; pay_method: string; memo: string | null }>(
    client,
    `SELECT payment_id, to_char(paid_on, 'YYYY-MM-DD') AS paid_day, amount, pay_method, memo
       FROM public.tb_s080_payments
      WHERE invoice_id = $1
      ORDER BY paid_on, payment_id`,
    [invoiceId],
  );
  return rows;
}

/** 그 계약의 수납 합계. 환불(음수)도 그대로 더해진다 — 그게 순액이다. */
export async function sumContractPayments(
  client: ScopedClient,
  contractId: string,
): Promise<number> {
  const { rows } = await q<{ total: string }>(
    client,
    `SELECT COALESCE(SUM(p.amount), 0) AS total
       FROM public.tb_s080_payments p
       JOIN public.tb_s080_invoices i ON i.invoice_id = p.invoice_id
      WHERE i.contract_id = $1`,
    [contractId],
  );
  return Number(rows[0]?.total ?? 0);
}

/* ══════════════════════════════════════════════════════════════════════════
   쓰기
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * 계약 확정 시 만든 청구서 계획을 통째로 저장한다 — 머리 · 줄 · 첫 달 수납.
 *
 * ★ 부르는 쪽의 트랜잭션 안에서 돈다. 중간에 던지면 `withCompanyScope` 가
 *   ROLLBACK 하므로 **청구서만 절반 생기는 상태가 없다.**
 */
export async function insertInvoicePlans(
  client: ScopedClient,
  args: {
    plans: readonly InvoicePlan[];
    contractId: string;
    companyId: string;
    buildId: string;
    actor: string;
    newId: () => string;
  },
): Promise<void> {
  const { plans, contractId, companyId, buildId, actor, newId } = args;

  for (const plan of plans) {
    const invoiceId = newId();
    await q(
      client,
      `INSERT INTO public.tb_s080_invoices
         (invoice_id, build_id, company_id, contract_id, year_month, due_date,
          supply_amount, vat_amount, total_amount, paid_amount, status,
          created_at, updated_at, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10,$11, now(), now(), $12, $12)`,
      [
        invoiceId, buildId, companyId, contractId, plan.yearMonth, plan.dueDate,
        plan.supplyAmount, plan.vatAmount, plan.totalAmount,
        // ★ 첫 장은 수납을 같이 만드니 `paid_amount` 도 처음부터 채운다.
        plan.payment ? plan.payment.amount : 0,
        plan.status, actor,
      ],
    );

    for (const line of plan.lines) {
      await q(
        client,
        `INSERT INTO public.tb_s080_invoice_lines
           (invoice_line_id, invoice_id, company_id, seq, pay_item, contract_space_id, is_free,
            quantity, unit_price, supply_amount, vat_amount, total_amount,
            created_at, updated_at, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now(), now(), $13, $13)`,
        [
          newId(), invoiceId, companyId, line.seq, line.payItem, line.contractSpaceId, line.isFree,
          line.quantity, line.unitPrice, line.supplyAmount, line.vatAmount, line.totalAmount,
          actor,
        ],
      );
    }

    if (plan.payment) {
      await q(
        client,
        `INSERT INTO public.tb_s080_payments
           (payment_id, build_id, company_id, invoice_id, paid_on, amount, pay_method, memo,
            created_at, updated_at, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5::date,$6,'B',$7, now(), now(), $8, $8)`,
        [
          newId(), buildId, companyId, invoiceId, plan.payment.paidOn, plan.payment.amount,
          '계약 확정 첫 달 납부', actor,
        ],
      );
    }
  }
}

/**
 * 청구서의 수납 합계를 다시 세고 `paid_amount` · `status` 를 고친다.
 *
 * ★ 수납이 들어오고·바뀌고·지워질 때마다 **같은 트랜잭션에서** 부른다.
 * ★ 상태 규칙은 shared 의 `computeStoredStatus` 하나다 — 취소(C)는 보존된다.
 *   SQL 안에 CASE 로 다시 쓰지 않는 이유가 그것이다.
 */
export async function recalcInvoice(client: ScopedClient, invoiceId: string): Promise<void> {
  const { rows } = await q<{ total_amount: number; status: string; paid: string }>(
    client,
    `SELECT i.total_amount, i.status,
            COALESCE((SELECT SUM(p.amount) FROM public.tb_s080_payments p
                       WHERE p.invoice_id = i.invoice_id), 0) AS paid
       FROM public.tb_s080_invoices i
      WHERE i.invoice_id = $1`,
    [invoiceId],
  );
  const row = rows[0];
  if (!row) return;

  const paidAmount = Number(row.paid);
  const status = computeStoredStatus({
    paidAmount,
    totalAmount: row.total_amount,
    current: row.status,
  });

  await q(
    client,
    `UPDATE public.tb_s080_invoices
        SET paid_amount = $2, status = $3, updated_at = now()
      WHERE invoice_id = $1`,
    [invoiceId, paidAmount, status],
  );
}

/**
 * 청구서를 **취소**한다. 지우지 않는다.
 *
 * ★★ 레거시는 중도해지 때 미래 달 청구서를 DELETE 했다. 지우면 「얼마를 청구했다가
 *    왜 안 받았는지」가 사라진다 — 해지 분쟁에서 필요한 것이 바로 그 기록이다.
 */
export async function cancelInvoices(
  client: ScopedClient,
  args: { invoiceIds: readonly string[]; actor: string },
): Promise<void> {
  if (args.invoiceIds.length === 0) return;
  await q(
    client,
    `UPDATE public.tb_s080_invoices
        SET status = 'C', updated_at = now(), updated_by = $2
      WHERE invoice_id = ANY($1::text[])`,
    [[...args.invoiceIds], args.actor],
  );
}

/** 해지 달 청구서를 일할 금액으로 낮춘다 — 머리와 줄을 함께. */
export async function applyProrate(
  client: ScopedClient,
  args: {
    invoiceId: string;
    supplyAmount: number;
    vatAmount: number;
    totalAmount: number;
    lines: readonly ProratedLine[];
    actor: string;
  },
): Promise<void> {
  await q(
    client,
    `UPDATE public.tb_s080_invoices
        SET supply_amount = $2, vat_amount = $3, total_amount = $4,
            updated_at = now(), updated_by = $5
      WHERE invoice_id = $1`,
    [args.invoiceId, args.supplyAmount, args.vatAmount, args.totalAmount, args.actor],
  );

  for (const line of args.lines) {
    await q(
      client,
      `UPDATE public.tb_s080_invoice_lines
          SET supply_amount = $2, vat_amount = $3, total_amount = $4,
              updated_at = now(), updated_by = $5
        WHERE invoice_line_id = $1`,
      [line.invoiceLineId, line.supplyAmount, line.vatAmount, line.totalAmount, args.actor],
    );
  }
}

/** 정산 원장 한 줄. 계약당 하나이고 유일 인덱스가 그것을 강제한다. */
export async function insertSettlement(
  client: ScopedClient,
  args: {
    settlementId: string;
    buildId: string;
    companyId: string;
    contractId: string;
    /** `YYYY-MM-DD`. */
    terminateDay: string;
    paymentMethod: string | null;
    totalPaid: number;
    settlement: TerminationSettlementResult;
    /**
     * 중도 해지 환수 — 할인과 무상을 **나누어** 적는다.
     *
     * ★ 순정산금(`settlement.netAmount`)에서는 이미 둘의 합이 빠져 있다. 여기 적는
     *   것은 「얼마를 무엇으로 환수했는가」의 내역이고, 분쟁에서 필요한 것이 그것이다.
     */
    clawback: ClawbackResult;
    actor: string;
  },
): Promise<void> {
  const { settlement, clawback } = args;
  await q(
    client,
    `INSERT INTO public.tb_s080_settlements
       (settlement_id, build_id, company_id, contract_id, terminate_date, payment_method,
        total_paid, deposit_return, discount_clawback, free_clawback,
        usage_charge, net_amount, settle_type, created_at, created_by)
     VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10,$11,$12,$13, now(), $14)`,
    [
      args.settlementId, args.buildId, args.companyId, args.contractId, args.terminateDay,
      args.paymentMethod, args.totalPaid, settlement.depositReturn,
      clawback.discountClawback, clawback.freeClawback,
      settlement.usageCharge, settlement.netAmount, settlement.settleType, args.actor,
    ],
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   수납 — 운영자가 손으로 넣는다
   ══════════════════════════════════════════════════════════════════════════ */

export async function insertPayment(
  client: ScopedClient,
  args: {
    paymentId: string;
    buildId: string;
    companyId: string;
    invoiceId: string;
    /** `YYYY-MM-DD`. */
    paidOn: string;
    amount: number;
    payMethod: string;
    memo: string | null;
    actor: string;
  },
): Promise<void> {
  await q(
    client,
    `INSERT INTO public.tb_s080_payments
       (payment_id, build_id, company_id, invoice_id, paid_on, amount, pay_method, memo,
        created_at, updated_at, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8, now(), now(), $9, $9)`,
    [
      args.paymentId, args.buildId, args.companyId, args.invoiceId, args.paidOn,
      args.amount, args.payMethod, args.memo, args.actor,
    ],
  );
}

export async function findPayment(
  client: ScopedClient,
  paymentId: string,
): Promise<{ payment_id: string; invoice_id: string } | null> {
  const { rows } = await q<{ payment_id: string; invoice_id: string }>(
    client,
    `SELECT payment_id, invoice_id FROM public.tb_s080_payments WHERE payment_id = $1`,
    [paymentId],
  );
  return rows[0] ?? null;
}

export async function updatePayment(
  client: ScopedClient,
  args: {
    paymentId: string;
    paidOn: string;
    amount: number;
    payMethod: string;
    memo: string | null;
    actor: string;
  },
): Promise<void> {
  await q(
    client,
    `UPDATE public.tb_s080_payments
        SET paid_on = $2::date, amount = $3, pay_method = $4, memo = $5,
            updated_at = now(), updated_by = $6
      WHERE payment_id = $1`,
    [args.paymentId, args.paidOn, args.amount, args.payMethod, args.memo, args.actor],
  );
}

export async function deletePayment(client: ScopedClient, paymentId: string): Promise<void> {
  await q(client, `DELETE FROM public.tb_s080_payments WHERE payment_id = $1`, [paymentId]);
}
