/**
 * 세무 부가세 조회(s050400020) DB — 계산서 · 카드 · 현금 줄을 **읽기만** 한다(1-8). DB 변경 없음.
 *
 * ★★★ 모든 질의가 `org_id = $1`(세션 단체 ID)을 직접 건다 — 운영사 세션도 RLS 가 모든 단체를 보여 주기 때문이다(203 머리말).
 * ★ 계산은 shared `tax-vat.ts` 한 곳 — 여기는 신고 기간의 줄만 넘긴다.
 */
import type { VatSources } from '@swonbiz/shared/domain/tax-vat';
import { TAX_INV_DIR_PURCHASE, TAX_INV_DIR_SALES } from '@swonbiz/shared/domain/tax-uploads';
import type { ScopedClient } from './withCompanyScope.ts';

interface Rows<T> {
  rows: T[];
}
const q = <T>(client: ScopedClient, sql: string, params?: unknown[]): Promise<Rows<T>> =>
  client.query(sql, params) as Promise<Rows<T>>;

/** 날짜 [첫날, 끝 다음 날)의 줄 — 같은 날은 들어온 순서. */
export async function readVatSources(client: ScopedClient, orgId: number, range: [string, string]): Promise<VatSources> {
  const p = [orgId, range[0], range[1]];
  const inv = await q<{ dir: string; d: string; partner: string; biz: string; supply: string; tax: string; item: string | null }>(
    client,
    `SELECT direction AS dir, to_char(write_date, 'YYYY-MM-DD') AS d, partner_name_src AS partner, partner_biz_no_src AS biz,
            supply_amount::text AS supply, tax_amount::text AS tax, item_code AS item
       FROM public.tb_s050_invoices
      WHERE org_id = $1 AND write_date >= $2::date AND write_date < $3::date
      ORDER BY write_date, created_at, id`,
    p,
  );
  const cards = await q<{ d: string; merchant: string; biz: string | null; supply: string; tax: string; deduct: string | null; item: string | null }>(
    client,
    `SELECT to_char(use_date, 'YYYY-MM-DD') AS d, merchant_name_src AS merchant, merchant_biz_no_src AS biz,
            supply_amount::text AS supply, tax_amount::text AS tax, vat_deduct AS deduct, item_code AS item
       FROM public.tb_s050_card_txns
      WHERE org_id = $1 AND use_date >= $2::date AND use_date < $3::date
      ORDER BY use_date, created_at, id`,
    p,
  );
  const cash = await q<{ d: string; dir: string; amount: string; item: string | null }>(
    client,
    `SELECT to_char(use_date, 'YYYY-MM-DD') AS d, direction AS dir, amount::text AS amount, item_code AS item
       FROM public.tb_s050_cash_txns
      WHERE org_id = $1 AND use_date >= $2::date AND use_date < $3::date`,
    p,
  );
  return {
    invoices: inv.rows.map((r) => ({
      direction: r.dir, date: r.d, partner: r.partner, bizNo: r.biz, supply: Number(r.supply), tax: Number(r.tax), itemCode: r.item,
    })),
    cards: cards.rows.map((r) => ({
      date: r.d, merchant: r.merchant, bizNo: r.biz, supply: Number(r.supply), tax: Number(r.tax), vatDeduct: r.deduct, itemCode: r.item,
    })),
    cashSales: cash.rows.filter((r) => r.dir === TAX_INV_DIR_SALES).map((r) => ({ date: r.d, amount: Number(r.amount) })),
    cashPurchases: cash.rows.filter((r) => r.dir === TAX_INV_DIR_PURCHASE).map((r) => ({ date: r.d, itemCode: r.item })),
  };
}
