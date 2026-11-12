/**
 * 세무 월별 손익(s050400010) DB — 계산서 · 카드 · 현금 · 국세 · 지방세 · 대출 줄을 **읽기만** 한다(1-8). DB 변경 없음.
 *
 * ★★★ 모든 질의가 `org_id = $1`(세션 단체 ID)을 직접 건다 — 운영사 세션도 RLS 가 모든 단체를 보여 주기 때문이다(203 머리말).
 * ★ 날짜는 SQL 에서 글자로 바꾼다(시간대 영향 없음). 금액은 bigint 라 pg 가 글자로 준다 — 원 단위 정수라 Number 로 바꿔도 잃지 않는다.
 * ★ 계산(어느 줄을 어디에 넣는지)은 shared `tax-pl.ts` 한 곳 — 여기는 줄만 넘긴다. 4대보험은 읽지 않는다(1-8 결정 1).
 */
import { cardCost, type PlSources } from '@swonbiz/shared/domain/tax-pl';
import { TAX_INV_DIR_PURCHASE, TAX_INV_DIR_SALES } from '@swonbiz/shared/domain/tax-uploads';
import type { ScopedClient } from './withCompanyScope.ts';

interface Rows<T> {
  rows: T[];
}
const q = <T>(client: ScopedClient, sql: string, params?: unknown[]): Promise<Rows<T>> =>
  client.query(sql, params) as Promise<Rows<T>>;

/** 날짜 [첫날, 끝 다음 날)의 줄 — 막대(한 해)와 내역(그 달)을 한 번에 센다. */
export async function readPlSources(client: ScopedClient, orgId: number, range: [string, string]): Promise<PlSources> {
  const p = [orgId, range[0], range[1]];

  const sales = await q<{ d: string; supply: string; partner: string }>(
    client,
    `SELECT to_char(write_date, 'YYYY-MM-DD') AS d, supply_amount::text AS supply, partner_name_src AS partner
       FROM public.tb_s050_invoices
      WHERE org_id = $1 AND direction = $4 AND write_date >= $2::date AND write_date < $3::date`,
    [...p, TAX_INV_DIR_SALES],
  );
  const cash = await q<{ d: string; amount: string; dir: string; item: string | null }>(
    client,
    `SELECT to_char(use_date, 'YYYY-MM-DD') AS d, amount::text AS amount, direction AS dir, item_code AS item
       FROM public.tb_s050_cash_txns
      WHERE org_id = $1 AND use_date >= $2::date AND use_date < $3::date`,
    p,
  );
  const invP = await q<{ d: string; supply: string; item: string | null }>(
    client,
    `SELECT to_char(write_date, 'YYYY-MM-DD') AS d, supply_amount::text AS supply, item_code AS item
       FROM public.tb_s050_invoices
      WHERE org_id = $1 AND direction = $4 AND write_date >= $2::date AND write_date < $3::date`,
    [...p, TAX_INV_DIR_PURCHASE],
  );
  const cards = await q<{ d: string; total: string; tax: string; deduct: string | null; item: string | null }>(
    client,
    `SELECT to_char(use_date, 'YYYY-MM-DD') AS d, total_amount::text AS total, tax_amount::text AS tax,
            vat_deduct AS deduct, item_code AS item
       FROM public.tb_s050_card_txns
      WHERE org_id = $1 AND use_date >= $2::date AND use_date < $3::date`,
    p,
  );
  const pays = await q<{ d: string; item: string; amount: string }>(
    client,
    `SELECT to_char(pay_date, 'YYYY-MM-DD') AS d, tax_item_src AS item, amount::text AS amount
       FROM public.tb_s050_tax_payments
      WHERE org_id = $1 AND pay_date >= $2::date AND pay_date < $3::date`,
    p,
  );
  const loans = await q<{ d: string; i: string; fe: string }>(
    client,
    `SELECT to_char(txn_date, 'YYYY-MM-DD') AS d, interest_amount::text AS i, fee_amount::text AS fe
       FROM public.tb_s050_loan_txns
      WHERE org_id = $1 AND txn_date >= $2::date AND txn_date < $3::date`,
    p,
  );

  return {
    salesInvoices: sales.rows.map((r) => ({ date: r.d, supply: Number(r.supply), partner: r.partner })),
    cashSales: cash.rows.filter((r) => r.dir === TAX_INV_DIR_SALES).map((r) => ({ date: r.d, amount: Number(r.amount) })),
    purchases: [
      ...invP.rows.map((r) => ({ date: r.d, itemCode: r.item, cost: Number(r.supply) })),
      ...cards.rows.map((r) => ({ date: r.d, itemCode: r.item, cost: cardCost(Number(r.total), Number(r.tax), r.deduct) })),
      ...cash.rows.filter((r) => r.dir === TAX_INV_DIR_PURCHASE).map((r) => ({ date: r.d, itemCode: r.item, cost: Number(r.amount) })),
    ],
    taxPays: pays.rows.map((r) => ({ date: r.d, taxItem: r.item, amount: Number(r.amount) })),
    loans: loans.rows.map((r) => ({ date: r.d, interest: Number(r.i), fee: Number(r.fe) })),
  };
}
