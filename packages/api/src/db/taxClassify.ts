/**
 * 세무 거래 분류(s050300010) DB — 계산서 표(203)의 분류 칸(207).
 *
 * ★★★ 모든 질의가 `org_id = $1`(세션 단체 ID)을 직접 건다 — 운영사 세션도 RLS 가 모든 단체를 보여 주기 때문이다(203 머리말).
 * ★ 「확인할 줄」은 `countClassify` 한 곳에서만 센다 — 화면 배지 · 칩 · 나중의 이번 달 할 일이 같은 값을 쓴다.
 * ★ 금액은 bigint 라 pg 가 글자로 준다 — 원 단위 정수라 Number 로 바꿔도 잃지 않는다.
 */
import type { TaxClassifyRow } from '@swonbiz/shared/domain/tax-classify';
import { TAX_INV_DIR_PURCHASE } from '@swonbiz/shared/domain/tax-uploads';
import { monthRange } from './taxUploads.ts';
import type { ScopedClient } from './withCompanyScope.ts';

interface Rows<T> {
  rows: T[];
  rowCount: number | null;
}
const q = <T>(client: ScopedClient, sql: string, params?: unknown[]): Promise<Rows<T>> =>
  client.query(sql, params) as Promise<Rows<T>>;

export interface ClassifyFilter {
  /** 작성일 [첫날, 끝 다음 날) — null 이면 날짜로 거르지 않는다(파일로 들어온 때). */
  range: [string, string] | null;
  fileId: string | null;
  /** 계산서 구분(P · S) — null 이면 둘 다. */
  direction: string | null;
}

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

const FILTER_SQL = `i.org_id = $1
        AND ($2::date IS NULL OR i.write_date >= $2::date)
        AND ($3::date IS NULL OR i.write_date < $3::date)
        AND ($4::text IS NULL OR i.file_id = $4)`;
const filterParams = (orgId: number, f: ClassifyFilter) => [orgId, f.range?.[0] ?? null, f.range?.[1] ?? null, f.fileId];

/** 거른 계산서 — 날짜 최신순(같은 날은 승인번호 역순). 거래처 기억(suggestedItemCode)은 비워 둔다. */
export async function listClassifyInvoices(client: ScopedClient, orgId: number, f: ClassifyFilter): Promise<TaxClassifyRow[]> {
  const { rows } = await q<InvoiceRow>(
    client,
    `SELECT i.id, i.direction, to_char(i.write_date, 'YYYY-MM-DD') AS write_date, i.approval_no,
            i.vendor_id, v.name AS vendor_name, i.partner_biz_no_src AS biz_no,
            i.supply_amount, i.tax_amount, i.total_amount, i.inv_class, i.file_id, i.item_code
       FROM public.tb_s050_invoices i
       JOIN public.tb_s050_vendors v ON v.org_id = i.org_id AND v.id = i.vendor_id
      WHERE ${FILTER_SQL}
        AND ($5::text IS NULL OR i.direction = $5)
      ORDER BY i.write_date DESC, i.approval_no DESC`,
    [...filterParams(orgId, f), f.direction],
  );
  return rows.map((r) => ({
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
    suggestedItemCode: null,
  }));
}

/** 거른 계산서의 구분별 수(「전체」 보기 자료 종류 칩) — 구분 거르기 전. */
export async function countInvoicesByDirection(client: ScopedClient, orgId: number, f: ClassifyFilter): Promise<Map<string, number>> {
  const { rows } = await q<{ direction: string; n: number }>(
    client,
    `SELECT i.direction, count(*)::int AS n FROM public.tb_s050_invoices i WHERE ${FILTER_SQL} GROUP BY i.direction`,
    filterParams(orgId, f),
  );
  return new Map(rows.map((r) => [r.direction, r.n]));
}

/**
 * ★ 「확인할 줄」 — 그 달(작성일) 매입 계산서 중 항목이 빈 줄(left) · 그 달 매입 계산서 전부(total).
 *   은행 · 현금 · 짝 남은 금액은 그 자료를 만드는 단계에서 여기에 더한다.
 */
export async function countClassify(client: ScopedClient, orgId: number, month: string): Promise<{ left: number; total: number }> {
  const [from, to] = monthRange(month);
  const { rows } = await q<{ left: number; total: number }>(
    client,
    `SELECT count(*) FILTER (WHERE item_code IS NULL)::int AS left, count(*)::int AS total
       FROM public.tb_s050_invoices
      WHERE org_id = $1 AND direction = $2 AND write_date >= $3::date AND write_date < $4::date`,
    [orgId, TAX_INV_DIR_PURCHASE, from, to],
  );
  return rows[0] ?? { left: 0, total: 0 };
}

/** 거래처마다 가장 최근에 확정한 항목(거래처 기억 — 골라 두기만). */
export async function lastItemsOfVendors(client: ScopedClient, orgId: number, vendorIds: readonly string[]): Promise<Map<string, string>> {
  if (vendorIds.length === 0) return new Map();
  const { rows } = await q<{ vendor_id: string; item_code: string }>(
    client,
    `SELECT DISTINCT ON (vendor_id) vendor_id, item_code
       FROM public.tb_s050_invoices
      WHERE org_id = $1 AND vendor_id = ANY($2::text[]) AND item_code IS NOT NULL
      ORDER BY vendor_id, classified_at DESC NULLS LAST, id DESC`,
    [orgId, vendorIds],
  );
  return new Map(rows.map((r) => [r.vendor_id, r.item_code]));
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

/** 확정할 계산서를 잠근다 — 이 단체의 것만. */
export async function lockInvoices(client: ScopedClient, orgId: number, ids: readonly string[]): Promise<{ id: string; direction: string }[]> {
  const { rows } = await q<{ id: string; direction: string }>(
    client,
    `SELECT id, direction FROM public.tb_s050_invoices WHERE org_id = $1 AND id = ANY($2::text[]) FOR UPDATE`,
    [orgId, ids],
  );
  return rows;
}

/** 항목 확정 — 다시 확정하면 덮는다. 고친 줄 수. */
export async function setInvoiceItems(
  client: ScopedClient,
  orgId: number,
  rows: readonly { id: string; itemCode: string }[],
  actor: string,
): Promise<number> {
  const r = await q(
    client,
    `UPDATE public.tb_s050_invoices i
        SET item_code = w.item_code, classified_at = CURRENT_TIMESTAMP, classified_by = $4
       FROM unnest($2::text[], $3::text[]) AS w(id, item_code)
      WHERE i.org_id = $1 AND i.id = w.id`,
    [orgId, rows.map((x) => x.id), rows.map((x) => x.itemCode), actor],
  );
  return r.rowCount ?? 0;
}
