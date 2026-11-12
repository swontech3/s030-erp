/**
 * 세무(S05) 카드 사용 내역 · 현금 경비 줄의 DB 쪽 — 208 의 표 둘 (1-4, 2026-10-30).
 *
 * ★★★ 모든 질의가 `org_id = $1`(세션 단체 ID)을 직접 건다 — 운영사 세션도 RLS 가 모든 단체를 보여 주기 때문이다(203 머리말).
 * ★★ 카드번호는 끝 4자리만 다룬다 — 이 파일에 전체 번호가 들어올 길이 없다(shared `convertCardSheet` 가 이미 걸렀다).
 * ★ 중복 막기는 「개수 맞추기」 — 여기는 열쇠마다 DB 줄이 든 파일 이름(먼저 올린 줄부터)만 읽는다. 줄 수 = 이름 수.
 *   열쇠는 shared 의 `cardDedupKey` · `cashDedupKey`. 파일 이름은 미리보기의 「이미 올린 줄 위치」에 쓴다(1-4 보완).
 * ★ 금액은 bigint 라 pg 가 글자로 준다 — 원 단위 정수라 Number 로 바꿔도 잃지 않는다.
 */
import { cardDedupKey, cashDedupKey, type CardStdRow, type CashStdRow } from '@swonbiz/shared/domain/tax-card-cash';
import type { TaxInvDir } from '@swonbiz/shared/domain/tax-uploads';
import type { ScopedClient } from './withCompanyScope.ts';

interface Rows<T> {
  rows: T[];
  rowCount: number | null;
}
const q = <T>(client: ScopedClient, sql: string, params?: unknown[]): Promise<Rows<T>> =>
  client.query(sql, params) as Promise<Rows<T>>;

/** 세무 설정에 등록한 카드의 끝 4자리 — 「사용 안 함」 포함(201, 카드는 number 가 끝 4자리). */
export async function registeredCardLast4(client: ScopedClient, orgId: number): Promise<string[]> {
  const { rows } = await q<{ number: string }>(
    client,
    `SELECT DISTINCT number FROM public.tb_s050_fin_accounts WHERE org_id = $1 AND kind = 'C'`,
    [orgId],
  );
  return rows.map((r) => r.number);
}

const datesOf = (rows: readonly { useDate: string }[]) => [...new Set(rows.map((r) => r.useDate))];

/** 카드 열쇠마다 DB 줄이 든 파일 이름(먼저 올린 줄부터) — 파일의 사용일들만 본다. */
export async function cardKeyFiles(client: ScopedClient, orgId: number, rows: readonly CardStdRow[]): Promise<Map<string, string[]>> {
  if (rows.length === 0) return new Map();
  const { rows: got } = await q<{ card_last4: string; use_date: string; biz: string | null; total: string; files: string[] }>(
    client,
    `SELECT t.card_last4, to_char(t.use_date, 'YYYY-MM-DD') AS use_date, t.merchant_biz_no_src AS biz, t.total_amount AS total,
            array_agg(f.file_name ORDER BY f.uploaded_at, f.id, t.id) AS files
       FROM public.tb_s050_card_txns t
       JOIN public.tb_s050_upload_files f ON f.id = t.file_id AND f.org_id = $1
      WHERE t.org_id = $1 AND t.use_date = ANY($2::date[])
      GROUP BY 1, 2, 3, 4`,
    [orgId, datesOf(rows)],
  );
  return new Map(
    got.map((r) => [cardDedupKey({ ...EMPTY_CARD, cardLast4: r.card_last4, useDate: r.use_date, merchantBizNo: r.biz, totalAmount: Number(r.total) }), r.files]),
  );
}
const EMPTY_CARD: CardStdRow = {
  useDate: '', cardLast4: '', merchantName: '', merchantBizNo: null,
  supplyAmount: 0, taxAmount: 0, nontaxAmount: 0, totalAmount: 0, vatDeduct: null, deductNote: null,
};

/** 현금 열쇠마다 DB 줄이 든 파일 이름(먼저 올린 줄부터) — 파일의 날짜들만 본다. */
export async function cashKeyFiles(client: ScopedClient, orgId: number, rows: readonly CashStdRow[]): Promise<Map<string, string[]>> {
  if (rows.length === 0) return new Map();
  const { rows: got } = await q<{ use_date: string; description: string; vendor: string | null; direction: string; amount: string; pay_method: string; files: string[] }>(
    client,
    `SELECT to_char(t.use_date, 'YYYY-MM-DD') AS use_date, t.description, t.vendor_name_src AS vendor, t.direction, t.amount, t.pay_method,
            array_agg(f.file_name ORDER BY f.uploaded_at, f.id, t.id) AS files
       FROM public.tb_s050_cash_txns t
       JOIN public.tb_s050_upload_files f ON f.id = t.file_id AND f.org_id = $1
      WHERE t.org_id = $1 AND t.use_date = ANY($2::date[])
      GROUP BY 1, 2, 3, 4, 5, 6`,
    [orgId, datesOf(rows)],
  );
  return new Map(
    got.map((r) => [
      cashDedupKey({
        useDate: r.use_date, description: r.description, vendorName: r.vendor, direction: r.direction as TaxInvDir,
        amount: Number(r.amount), payMethod: r.pay_method, proof: null, itemCode: null,
      }),
      r.files,
    ]),
  );
}

/** 카드 줄을 한 번에 넣는다. 넣은 줄 수. */
export async function insertCardRows(
  client: ScopedClient,
  orgId: number,
  fileId: string,
  rows: readonly (CardStdRow & { vendorId: string | null })[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const col = <K extends keyof (CardStdRow & { vendorId: string | null })>(k: K) => rows.map((r) => r[k]);
  const r = await q(
    client,
    `INSERT INTO public.tb_s050_card_txns
       (id, org_id, file_id, vendor_id, card_last4, use_date, merchant_name_src, merchant_biz_no_src,
        supply_amount, tax_amount, nontax_amount, total_amount, vat_deduct, deduct_note_src)
     SELECT gen_random_uuid()::text, $1, $2, u.vendor_id, u.card_last4, u.use_date, u.merchant_name, u.merchant_biz_no,
            u.supply_amount, u.tax_amount, u.nontax_amount, u.total_amount, u.vat_deduct, u.deduct_note
       FROM unnest($3::text[], $4::text[], $5::date[], $6::text[], $7::text[], $8::bigint[], $9::bigint[], $10::bigint[],
                   $11::bigint[], $12::text[], $13::text[])
            AS u(vendor_id, card_last4, use_date, merchant_name, merchant_biz_no, supply_amount, tax_amount, nontax_amount,
                 total_amount, vat_deduct, deduct_note)`,
    [
      orgId, fileId,
      col('vendorId'), col('cardLast4'), col('useDate'), col('merchantName'), col('merchantBizNo'),
      col('supplyAmount'), col('taxAmount'), col('nontaxAmount'), col('totalAmount'), col('vatDeduct'), col('deductNote'),
    ],
  );
  return r.rowCount ?? 0;
}

/** 현금 줄을 한 번에 넣는다. 파일에 항목이 있는 줄은 올린 사람 · 때로 바로 확정한다. 넣은 줄 수. */
export async function insertCashRows(
  client: ScopedClient,
  orgId: number,
  fileId: string,
  rows: readonly CashStdRow[],
  actor: string,
): Promise<number> {
  if (rows.length === 0) return 0;
  const col = <K extends keyof CashStdRow>(k: K) => rows.map((r) => r[k]);
  const r = await q(
    client,
    `INSERT INTO public.tb_s050_cash_txns
       (id, org_id, file_id, use_date, description, vendor_name_src, direction, amount, pay_method, proof,
        item_code, classified_at, classified_by)
     SELECT gen_random_uuid()::text, $1, $2, u.use_date, u.description, u.vendor_name, u.direction, u.amount, u.pay_method, u.proof,
            u.item_code,
            CASE WHEN u.item_code IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END,
            CASE WHEN u.item_code IS NULL THEN NULL ELSE $3 END
       FROM unnest($4::date[], $5::text[], $6::text[], $7::text[], $8::bigint[], $9::text[], $10::text[], $11::text[])
            AS u(use_date, description, vendor_name, direction, amount, pay_method, proof, item_code)`,
    [
      orgId, fileId, actor,
      col('useDate'), col('description'), col('vendorName'), col('direction'), col('amount'), col('payMethod'), col('proof'), col('itemCode'),
    ],
  );
  return r.rowCount ?? 0;
}
