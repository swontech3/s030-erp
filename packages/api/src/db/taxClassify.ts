/**
 * 세무 거래 분류(s050300010) DB — 계산서 표(203)의 분류 칸(207) · 카드 · 현금 줄 표(208, 1-4).
 *
 * ★★★ 모든 질의가 `org_id = $1`(세션 단체 ID)을 직접 건다 — 운영사 세션도 RLS 가 모든 단체를 보여 주기 때문이다(203 머리말).
 * ★ 「확인할 줄」은 `countClassify` 한 곳에서만 센다 — 화면 배지 · 칩 · 나중의 이번 달 할 일이 같은 값을 쓴다.
 *   1-4: 매입 계산서 + 카드 줄 + 현금 매입 줄(현금 매출은 매출 계산서처럼 항목이 없다).
 * ★ 금액은 bigint 라 pg 가 글자로 준다 — 원 단위 정수라 Number 로 바꿔도 잃지 않는다.
 * ★ 카드는 끝 4자리만 있다 — 카드 별칭은 세무 설정의 카드(201)를 끝 4자리로 찾는다(FK 없음, 208 머리말).
 */
import type { ClassifyRowKind, TaxClassifyRow } from '@swonbiz/shared/domain/tax-classify';
import { TAX_INV_DIR_PURCHASE } from '@swonbiz/shared/domain/tax-uploads';
import { monthRange } from './taxUploads.ts';
import type { ScopedClient } from './withCompanyScope.ts';

interface Rows<T> {
  rows: T[];
  rowCount: number | null;
}
const q = <T>(client: ScopedClient, sql: string, params?: unknown[]): Promise<Rows<T>> =>
  client.query(sql, params) as Promise<Rows<T>>;

/**
 * 코드 분류 이름(`tb_s080_code_masters.name`) — 엑셀 칸 이름을 글자로 박지 않고 코드 표에서 읽는다(1-4 보완).
 * ★ `listCodes` 처럼 건물(`build_id`)로 거르지 않는다(건물이 하나뿐).
 */
export async function listCategoryNames(client: ScopedClient, categories: readonly string[]): Promise<Map<string, string>> {
  const { rows } = await q<{ category: string; name: string }>(
    client,
    `SELECT category, name FROM public.tb_s080_code_masters WHERE category = ANY($1::text[])`,
    [categories],
  );
  return new Map(rows.map((r) => [r.category, r.name]));
}

/** 자료 종류 → 표. ★ 식별자라 파라미터로 묶을 수 없어 이 상수에서만 고른다. */
const TABLE_OF: Readonly<Record<ClassifyRowKind, string>> = {
  INVOICE: 'tb_s050_invoices',
  CARD: 'tb_s050_card_txns',
  CASH: 'tb_s050_cash_txns',
};

export interface ClassifyFilter {
  /** 날짜 [첫날, 끝 다음 날) — null 이면 날짜로 거르지 않는다(파일로 들어온 때). */
  range: [string, string] | null;
  fileId: string | null;
  /** P · S — null 이면 둘 다(계산서 · 현금만, 카드는 늘 P). */
  direction: string | null;
}

/** 날짜 칸(`col`) · 파일로 거르기 — 매개변수 $1~$4. */
const filterSql = (alias: string, col: string) => `${alias}.org_id = $1
        AND ($2::date IS NULL OR ${alias}.${col} >= $2::date)
        AND ($3::date IS NULL OR ${alias}.${col} < $3::date)
        AND ($4::text IS NULL OR ${alias}.file_id = $4)`;
const filterParams = (orgId: number, f: ClassifyFilter) => [orgId, f.range?.[0] ?? null, f.range?.[1] ?? null, f.fileId];

const NONE = {
  approvalNo: null, vendorId: null, description: null, bizNo: null, supplyAmount: null, taxAmount: null, invClass: null,
  cardLast4: null, cardAlias: null, vatDeduct: null, payMethod: null, proof: null, suggestedItemCode: null,
} as const;

/* ── 계산서 ──────────────────────────────────────────────────────────────── */

interface InvoiceRow {
  id: string;
  direction: string;
  write_date: string;
  approval_no: string;
  vendor_id: string;
  vendor_name: string;
  biz_no: string;
  supply_amount: string;
  tax_amount: string;
  total_amount: string;
  inv_class: string;
  file_id: string;
  item_code: string | null;
}

/** 거른 계산서 — 날짜 최신순(같은 날은 승인번호 역순). 거래처 기억(suggestedItemCode)은 비워 둔다. */
export async function listClassifyInvoices(client: ScopedClient, orgId: number, f: ClassifyFilter): Promise<TaxClassifyRow[]> {
  const { rows } = await q<InvoiceRow>(
    client,
    `SELECT i.id, i.direction, to_char(i.write_date, 'YYYY-MM-DD') AS write_date, i.approval_no,
            i.vendor_id, v.name AS vendor_name, i.partner_biz_no_src AS biz_no,
            i.supply_amount, i.tax_amount, i.total_amount, i.inv_class, i.file_id, i.item_code
       FROM public.tb_s050_invoices i
       JOIN public.tb_s050_vendors v ON v.org_id = i.org_id AND v.id = i.vendor_id
      WHERE ${filterSql('i', 'write_date')}
        AND ($5::text IS NULL OR i.direction = $5)
      ORDER BY i.write_date DESC, i.approval_no DESC`,
    [...filterParams(orgId, f), f.direction],
  );
  return rows.map((r) => ({
    ...NONE,
    kind: 'INVOICE',
    id: r.id,
    direction: r.direction,
    writeDate: r.write_date,
    approvalNo: r.approval_no,
    vendorId: r.vendor_id,
    vendorName: r.vendor_name,
    bizNo: r.biz_no,
    supplyAmount: Number(r.supply_amount),
    taxAmount: Number(r.tax_amount),
    totalAmount: Number(r.total_amount),
    invClass: r.inv_class,
    fileId: r.file_id,
    itemCode: r.item_code,
  }));
}

/** 거른 계산서의 구분별 수(「전체」 보기 자료 종류 칩) — 구분 거르기 전. */
export async function countInvoicesByDirection(client: ScopedClient, orgId: number, f: ClassifyFilter): Promise<Map<string, number>> {
  const { rows } = await q<{ direction: string; n: number }>(
    client,
    `SELECT i.direction, count(*)::int AS n FROM public.tb_s050_invoices i WHERE ${filterSql('i', 'write_date')} GROUP BY i.direction`,
    filterParams(orgId, f),
  );
  return new Map(rows.map((r) => [r.direction, r.n]));
}

/* ── 카드 · 현금(1-4) ─────────────────────────────────────────────────────── */

interface CardRow {
  id: string;
  use_date: string;
  vendor_id: string | null;
  vendor_name: string;
  biz_no: string | null;
  card_last4: string;
  card_alias: string | null;
  supply_amount: string;
  tax_amount: string;
  total_amount: string;
  vat_deduct: string | null;
  file_id: string;
  item_code: string | null;
}

/** 거른 카드 줄 — 날짜 최신순. 거래처가 있으면 거래처 표의 이름, 없으면 파일의 가맹점명. */
export async function listClassifyCards(client: ScopedClient, orgId: number, f: ClassifyFilter): Promise<TaxClassifyRow[]> {
  const { rows } = await q<CardRow>(
    client,
    `SELECT c.id, to_char(c.use_date, 'YYYY-MM-DD') AS use_date, c.vendor_id, COALESCE(v.name, c.merchant_name_src) AS vendor_name,
            c.merchant_biz_no_src AS biz_no, c.card_last4,
            (SELECT a.alias FROM public.tb_s050_fin_accounts a
              WHERE a.org_id = c.org_id AND a.kind = 'C' AND a.number = c.card_last4
              ORDER BY a.sort_order, a.created_at LIMIT 1) AS card_alias,
            c.supply_amount, c.tax_amount, c.total_amount, c.vat_deduct, c.file_id, c.item_code
       FROM public.tb_s050_card_txns c
       LEFT JOIN public.tb_s050_vendors v ON v.org_id = c.org_id AND v.id = c.vendor_id
      WHERE ${filterSql('c', 'use_date')}
      ORDER BY c.use_date DESC, c.created_at DESC, c.id`,
    filterParams(orgId, f),
  );
  return rows.map((r) => ({
    ...NONE,
    kind: 'CARD',
    id: r.id,
    direction: TAX_INV_DIR_PURCHASE,
    writeDate: r.use_date,
    vendorId: r.vendor_id,
    vendorName: r.vendor_name,
    bizNo: r.biz_no,
    supplyAmount: Number(r.supply_amount),
    taxAmount: Number(r.tax_amount),
    totalAmount: Number(r.total_amount),
    cardLast4: r.card_last4,
    cardAlias: r.card_alias,
    vatDeduct: r.vat_deduct,
    fileId: r.file_id,
    itemCode: r.item_code,
  }));
}

interface CashRow {
  id: string;
  direction: string;
  use_date: string;
  description: string;
  vendor_name: string | null;
  amount: string;
  pay_method: string;
  proof: string | null;
  file_id: string;
  item_code: string | null;
}

/** 거른 현금 줄 — 날짜 최신순. `f.direction` 이 P 면 매입 줄만. */
export async function listClassifyCash(client: ScopedClient, orgId: number, f: ClassifyFilter): Promise<TaxClassifyRow[]> {
  const { rows } = await q<CashRow>(
    client,
    `SELECT x.id, x.direction, to_char(x.use_date, 'YYYY-MM-DD') AS use_date, x.description, x.vendor_name_src AS vendor_name,
            x.amount, x.pay_method, x.proof, x.file_id, x.item_code
       FROM public.tb_s050_cash_txns x
      WHERE ${filterSql('x', 'use_date')}
        AND ($5::text IS NULL OR x.direction = $5)
      ORDER BY x.use_date DESC, x.created_at DESC, x.id`,
    [...filterParams(orgId, f), f.direction],
  );
  return rows.map((r) => ({
    ...NONE,
    kind: 'CASH',
    id: r.id,
    direction: r.direction,
    writeDate: r.use_date,
    vendorName: r.vendor_name ?? '',
    description: r.description,
    totalAmount: Number(r.amount),
    payMethod: r.pay_method,
    proof: r.proof,
    fileId: r.file_id,
    itemCode: r.item_code,
  }));
}

/** 거른 카드 · 현금 줄 수(「전체」 보기 자료 종류 칩). */
export async function countCardCash(client: ScopedClient, orgId: number, f: ClassifyFilter): Promise<{ card: number; cash: number }> {
  const { rows } = await q<{ card: number; cash: number }>(
    client,
    `SELECT (SELECT count(*) FROM public.tb_s050_card_txns c WHERE ${filterSql('c', 'use_date')})::int AS card,
            (SELECT count(*) FROM public.tb_s050_cash_txns x WHERE ${filterSql('x', 'use_date')})::int AS cash`,
    filterParams(orgId, f),
  );
  return rows[0] ?? { card: 0, cash: 0 };
}

/* ── 확인할 줄 셈 — 한 곳 ──────────────────────────────────────────────────── */

/**
 * ★ 「확인할 줄」 — 그 달 매입(계산서 작성일 · 카드 사용일 · 현금 날짜) 중 항목이 빈 줄(left) · 그 달 매입 줄 전부(total).
 *   매입 = 매입 계산서 + 카드 줄(취소 줄 포함) + 현금 매입 줄. 은행 · 짝 남은 금액은 그 자료를 만드는 단계에서 여기에 더한다.
 */
export async function countClassify(client: ScopedClient, orgId: number, month: string): Promise<{ left: number; total: number }> {
  const [from, to] = monthRange(month);
  const { rows } = await q<{ left: number; total: number }>(
    client,
    `SELECT count(*) FILTER (WHERE item_code IS NULL)::int AS left, count(*)::int AS total
       FROM (SELECT item_code FROM public.tb_s050_invoices
              WHERE org_id = $1 AND direction = $2 AND write_date >= $3::date AND write_date < $4::date
             UNION ALL
             SELECT item_code FROM public.tb_s050_card_txns
              WHERE org_id = $1 AND use_date >= $3::date AND use_date < $4::date
             UNION ALL
             SELECT item_code FROM public.tb_s050_cash_txns
              WHERE org_id = $1 AND direction = $2 AND use_date >= $3::date AND use_date < $4::date) t`,
    [orgId, TAX_INV_DIR_PURCHASE, from, to],
  );
  return rows[0] ?? { left: 0, total: 0 };
}

/* ── 지난번 항목(골라 두기만) ──────────────────────────────────────────────── */

/** 거래처마다 가장 최근에 확정한 항목 — 계산서 · 카드 줄을 함께 본다. */
export async function lastItemsOfVendors(client: ScopedClient, orgId: number, vendorIds: readonly string[]): Promise<Map<string, string>> {
  if (vendorIds.length === 0) return new Map();
  const { rows } = await q<{ vendor_id: string; item_code: string }>(
    client,
    `SELECT DISTINCT ON (vendor_id) vendor_id, item_code
       FROM (SELECT vendor_id, item_code, classified_at, id FROM public.tb_s050_invoices
              WHERE org_id = $1 AND vendor_id = ANY($2::text[]) AND item_code IS NOT NULL
             UNION ALL
             SELECT vendor_id, item_code, classified_at, id FROM public.tb_s050_card_txns
              WHERE org_id = $1 AND vendor_id = ANY($2::text[]) AND item_code IS NOT NULL) t
      ORDER BY vendor_id, classified_at DESC NULLS LAST, id DESC`,
    [orgId, vendorIds],
  );
  return new Map(rows.map((r) => [r.vendor_id, r.item_code]));
}

/** 현금 거래처 글마다 가장 최근에 확정한 항목 — 같은 글(앞뒤 공백을 걷은 것)의 현금 줄끼리(결정 8). */
export async function lastItemsOfCashVendors(client: ScopedClient, orgId: number, names: readonly string[]): Promise<Map<string, string>> {
  if (names.length === 0) return new Map();
  const { rows } = await q<{ name: string; item_code: string }>(
    client,
    `SELECT DISTINCT ON (btrim(vendor_name_src)) btrim(vendor_name_src) AS name, item_code
       FROM public.tb_s050_cash_txns
      WHERE org_id = $1 AND btrim(vendor_name_src) = ANY($2::text[]) AND item_code IS NOT NULL
      ORDER BY btrim(vendor_name_src), classified_at DESC NULLS LAST, id DESC`,
    [orgId, names],
  );
  return new Map(rows.map((r) => [r.name, r.item_code]));
}

/** 이 단체의 올린 파일 하나(파일 띠) — 없으면 null. */
export async function findUploadFileById(client: ScopedClient, orgId: number, id: string): Promise<{ id: string; fileName: string } | null> {
  const { rows } = await q<{ id: string; file_name: string }>(
    client,
    `SELECT id, file_name FROM public.tb_s050_upload_files WHERE org_id = $1 AND id = $2`,
    [orgId, id],
  );
  return rows[0] ? { id: rows[0].id, fileName: rows[0].file_name } : null;
}

/* ── 확정 ────────────────────────────────────────────────────────────────── */

/** 확정할 줄을 잠근다 — 이 단체 · 그 자료 종류 표의 것만. 카드 줄은 늘 매입(P). */
export async function lockClassifyRows(
  client: ScopedClient,
  orgId: number,
  kind: ClassifyRowKind,
  ids: readonly string[],
): Promise<{ id: string; direction: string }[]> {
  const dir = kind === 'CARD' ? `'${TAX_INV_DIR_PURCHASE}'::text` : 'direction';
  const { rows } = await q<{ id: string; direction: string }>(
    client,
    `SELECT id, ${dir} AS direction FROM public.${TABLE_OF[kind]} WHERE org_id = $1 AND id = ANY($2::text[]) FOR UPDATE`,
    [orgId, ids],
  );
  return rows;
}

/** 항목 확정 — 다시 확정하면 덮는다. 고친 줄 수. */
export async function setClassifyItems(
  client: ScopedClient,
  orgId: number,
  kind: ClassifyRowKind,
  rows: readonly { id: string; itemCode: string }[],
  actor: string,
): Promise<number> {
  const r = await q(
    client,
    `UPDATE public.${TABLE_OF[kind]} t
        SET item_code = w.item_code, classified_at = CURRENT_TIMESTAMP, classified_by = $4
       FROM unnest($2::text[], $3::text[]) AS w(id, item_code)
      WHERE t.org_id = $1 AND t.id = w.id`,
    [orgId, rows.map((x) => x.id), rows.map((x) => x.itemCode), actor],
  );
  return r.rowCount ?? 0;
}
