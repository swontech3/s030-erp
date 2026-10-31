/**
 * 세무(S05) 자료 올리기(s050200010) · 거래처(s050100020)의 DB 쪽 — 203 의 표 넷.
 *
 * ★★★ 회사 자료 표(올린 파일 · 거래처 · 계산서)를 읽고 쓰는 모든 함수가 `orgId` 를 받아
 *     **`WHERE org_id = $1` 을 직접 건다.** 운영사 세션은 RLS 로는 모든 단체가 보인다 — 운영사도 자기
 *     단체만 다루게 하는 것은 이 조건이다. RLS(erp_org_scope)는 두 번째 겹이다.
 *     `orgId` 는 라우트가 **세션의 단체 ID**(`s020OrgId`)로만 넣는다. 화면이 준 값을 넣지 않는다.
 * ★ 대응표(`tb_s050_import_maps`)는 공용이라 단체 조건이 없다(203 — RLS 없음 · erp_app 읽기만).
 * ★ 계산서 FK 는 (org_id, file_id) · (org_id, vendor_id) 로 단체까지 묶여 있다 — 남의 단체 id 는 DB 가 막는다.
 * ★ 1-4(2026-10-30): 올린 파일의 줄은 세 표(계산서 · 카드 208 · 현금 208)에 있다 — 파일 목록 · 파일 수 · 지울 줄 수 ·
 *   거래처 건수 · 합치기는 세 표를 함께 본다(`FILE_ROWS_SQL`). 현금 줄은 거래처를 가리키지 않는다.
 */
import { randomUUID } from 'node:crypto';
import type {
  InvoiceMapColumns,
  InvoiceStdRow,
  TaxUploadFileView,
  TaxVendorView,
} from '@swonbiz/shared/domain/tax-uploads';
import type { ScopedClient } from './withCompanyScope.ts';

interface Rows<T> {
  rows: T[];
  rowCount: number | null;
}
const q = <T>(client: ScopedClient, sql: string, params?: unknown[]): Promise<Rows<T>> =>
  client.query(sql, params) as Promise<Rows<T>>;

const iso = (v: Date | string): string => (v instanceof Date ? v.toISOString() : String(v));

/** 달(`YYYY-MM`)의 [첫날, 다음 달 첫날). */
export function monthRange(month: string): [string, string] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return [`${month}-01`, `${next}-01`];
}

/**
 * 세 표의 (단체, 파일, 날짜) — 계산서 작성일 · 카드 사용일 · 현금 날짜. 파일 목록 · 파일 수가 이것으로 그 달을 본다.
 * ★ 바깥 질의가 `org_id = $1` 을 건다(이 조각은 단체를 거르지 않는다).
 */
const FILE_ROWS_SQL = `(SELECT org_id, file_id, write_date AS d FROM public.tb_s050_invoices
                       UNION ALL SELECT org_id, file_id, use_date FROM public.tb_s050_card_txns
                       UNION ALL SELECT org_id, file_id, use_date FROM public.tb_s050_cash_txns)`;

/* ── 대응표 ──────────────────────────────────────────────────────────────── */

/** `tb_s050_import_maps` 한 줄 — 칸 모양(`columns`)은 자료 종류마다 다르다(계산서 · 카드 · 현금). */
export interface ImportMapRow<C> {
  id: string;
  kind: string;
  headerRow: number;
  headerSignature: readonly string[];
  columns: C;
}

/** 켜진 대응표 — 자료 종류마다 하나. 없으면 null. 칸 모양은 부르는 쪽이 정한다(기본 계산서). */
export async function loadImportMap<C = InvoiceMapColumns>(client: ScopedClient, kind: string): Promise<ImportMapRow<C> | null> {
  const { rows } = await q<{ id: string; kind: string; header_row: number; header_signature: string[]; columns: C }>(
    client,
    `SELECT id, kind, header_row, header_signature, columns
       FROM public.tb_s050_import_maps
      WHERE kind = $1 AND is_active = true
      ORDER BY id
      LIMIT 1`,
    [kind],
  );
  const r = rows[0];
  return r ? { id: r.id, kind: r.kind, headerRow: r.header_row, headerSignature: r.header_signature, columns: r.columns } : null;
}

/* ── 올린 파일 ───────────────────────────────────────────────────────────── */

interface FileRow {
  id: string;
  kind: string;
  direction: string | null;
  file_name: string;
  row_count: number;
  inserted_count: number;
  uploaded_at: Date | string;
}
const fileView = (r: FileRow): TaxUploadFileView => ({
  id: r.id,
  kind: r.kind,
  direction: r.direction,
  fileName: r.file_name,
  rowCount: r.row_count,
  insertedCount: r.inserted_count,
  uploadedAt: iso(r.uploaded_at),
});
const FILE_COLS = 'f.id, f.kind, f.direction, f.file_name, f.row_count, f.inserted_count, f.uploaded_at';

/** 같은 파일(지문). */
export async function findFileByHash(client: ScopedClient, orgId: number, hash: string): Promise<TaxUploadFileView | null> {
  const { rows } = await q<FileRow>(
    client,
    `SELECT ${FILE_COLS} FROM public.tb_s050_upload_files f WHERE f.org_id = $1 AND f.file_hash = $2`,
    [orgId, hash],
  );
  return rows[0] ? fileView(rows[0]) : null;
}

/**
 * 그 달의 올린 파일 — 그 달 줄이 들어간 파일, 그리고 들어간 줄이 0인 파일은 올린 때가 그 달인 것. 최신순.
 */
export async function listUploadFiles(client: ScopedClient, orgId: number, month: string): Promise<TaxUploadFileView[]> {
  const [from, to] = monthRange(month);
  const { rows } = await q<FileRow>(
    client,
    `SELECT ${FILE_COLS}
       FROM public.tb_s050_upload_files f
      WHERE f.org_id = $1
        AND (EXISTS (SELECT 1 FROM ${FILE_ROWS_SQL} i
                      WHERE i.org_id = f.org_id AND i.file_id = f.id AND i.d >= $2::date AND i.d < $3::date)
             OR (f.inserted_count = 0 AND f.uploaded_at >= $2::date AND f.uploaded_at < $3::date))
      ORDER BY f.uploaded_at DESC, f.id`,
    [orgId, from, to],
  );
  return rows.map(fileView);
}

/** 자료 종류별 — 그 달 줄이 들어간 파일 수. */
export async function countFilesByKind(client: ScopedClient, orgId: number, month: string): Promise<Map<string, number>> {
  const [from, to] = monthRange(month);
  const { rows } = await q<{ kind: string; n: number }>(
    client,
    `SELECT f.kind, count(DISTINCT f.id)::int AS n
       FROM public.tb_s050_upload_files f
       JOIN ${FILE_ROWS_SQL} i ON i.org_id = f.org_id AND i.file_id = f.id
      WHERE f.org_id = $1 AND i.d >= $2::date AND i.d < $3::date
      GROUP BY f.kind`,
    [orgId, from, to],
  );
  return new Map(rows.map((r) => [r.kind, r.n]));
}

/** 같은 단체의 올리기를 한 줄로 세운다 — 「이미 올린 승인번호」를 센 값과 실제 넣은 수가 어긋나지 않게. */
export async function lockOrgUploads(client: ScopedClient, orgId: number): Promise<void> {
  await q(client, `SELECT pg_advisory_xact_lock(hashtext('tb_s050_upload_files'), $1)`, [orgId]);
}

/** 이 단체에 이미 있는 승인번호 → 그 계산서 줄이 든 파일 이름(미리보기의 「이미 올린 줄 위치」). */
export async function existingApprovalFiles(
  client: ScopedClient,
  orgId: number,
  approvalNos: readonly string[],
): Promise<Map<string, string>> {
  if (approvalNos.length === 0) return new Map();
  const { rows } = await q<{ approval_no: string; file_name: string }>(
    client,
    `SELECT i.approval_no, f.file_name
       FROM public.tb_s050_invoices i
       JOIN public.tb_s050_upload_files f ON f.id = i.file_id AND f.org_id = $1
      WHERE i.org_id = $1 AND i.approval_no = ANY($2::text[])`,
    [orgId, approvalNos],
  );
  return new Map(rows.map((r) => [r.approval_no, r.file_name]));
}

export interface NewUploadFile {
  kind: string;
  mapId: string;
  /** 계산서 파일만 P · S — 카드 · 현금 파일은 null(208 CHECK). */
  direction: string | null;
  fileName: string;
  fileHash: string;
  fileSize: number;
  rowCount: number;
  insertedCount: number;
}

export async function insertUploadFile(client: ScopedClient, orgId: number, f: NewUploadFile, actor: string): Promise<TaxUploadFileView> {
  const { rows } = await q<FileRow>(
    client,
    `INSERT INTO public.tb_s050_upload_files AS f
       (id, org_id, kind, map_id, direction, file_name, file_hash, file_size, row_count, inserted_count, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING ${FILE_COLS}`,
    [randomUUID(), orgId, f.kind, f.mapId, f.direction, f.fileName, f.fileHash, f.fileSize, f.rowCount, f.insertedCount, actor],
  );
  return fileView(rows[0]!);
}

/** 계산서 줄을 한 번에 넣는다. 승인번호가 이미 있으면 건너뛴다. 넣은 줄 수를 돌려준다. */
export async function insertInvoices(
  client: ScopedClient,
  orgId: number,
  fileId: string,
  direction: string,
  rows: readonly (InvoiceStdRow & { vendorId: string })[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const col = <K extends keyof (InvoiceStdRow & { vendorId: string })>(k: K) => rows.map((r) => r[k]);
  const r = await q(
    client,
    `INSERT INTO public.tb_s050_invoices
       (id, org_id, file_id, vendor_id, direction, approval_no, write_date, partner_name_src, partner_biz_no_src,
        supply_amount, tax_amount, total_amount, inv_class, inv_type)
     SELECT gen_random_uuid()::text, $1, $2, u.vendor_id, $3, u.approval_no, u.write_date, u.partner_name, u.partner_biz_no,
            u.supply_amount, u.tax_amount, u.total_amount, u.inv_class, u.inv_type
       FROM unnest($4::text[], $5::text[], $6::date[], $7::text[], $8::text[], $9::bigint[], $10::bigint[], $11::bigint[],
                   $12::text[], $13::text[])
            AS u(vendor_id, approval_no, write_date, partner_name, partner_biz_no, supply_amount, tax_amount, total_amount,
                 inv_class, inv_type)
     ON CONFLICT (org_id, approval_no) DO NOTHING`,
    [
      orgId, fileId, direction,
      col('vendorId'), col('approvalNo'), col('writeDate'), col('partnerName'), col('partnerBizNo'),
      col('supplyAmount'), col('taxAmount'), col('totalAmount'), col('invClass'), col('invType'),
    ],
  );
  return r.rowCount ?? 0;
}

/** 지울 파일을 잠근다 — 이 단체의 것만. 넘긴 id 중 없는 것이 있으면 호출한 쪽이 404. */
export async function lockUploadFiles(
  client: ScopedClient,
  orgId: number,
  ids: readonly string[],
): Promise<{ id: string; uploadedAt: string }[]> {
  const { rows } = await q<{ id: string; uploaded_at: Date | string }>(
    client,
    `SELECT id, uploaded_at FROM public.tb_s050_upload_files WHERE org_id = $1 AND id = ANY($2::text[])`,
    [orgId, ids],
  );
  return rows.map((r) => ({ id: r.id, uploadedAt: iso(r.uploaded_at) }));
}

/** 그 파일들로 들어온 줄 수 — 계산서 · 카드 · 현금 세 표. 파일을 지우면 모두 CASCADE 로 빠진다. */
export async function countRowsOfFiles(client: ScopedClient, orgId: number, ids: readonly string[]): Promise<number> {
  const { rows } = await q<{ n: number }>(
    client,
    `SELECT count(*)::int AS n FROM ${FILE_ROWS_SQL} i WHERE i.org_id = $1 AND i.file_id = ANY($2::text[])`,
    [orgId, ids],
  );
  return rows[0]?.n ?? 0;
}

/** 지우는 파일 중 가장 먼저 올린 것보다 **뒤에** 올린 파일 중 건너뛴 줄이 있는 것. */
export async function laterFilesWithSkips(
  client: ScopedClient,
  orgId: number,
  ids: readonly string[],
): Promise<{ id: string; fileName: string; skippedRows: number }[]> {
  const { rows } = await q<{ id: string; file_name: string; skipped: number }>(
    client,
    `SELECT f.id, f.file_name, (f.row_count - f.inserted_count)::int AS skipped
       FROM public.tb_s050_upload_files f
      WHERE f.org_id = $1
        AND f.id <> ALL($2::text[])
        AND f.row_count > f.inserted_count
        AND f.uploaded_at >= (SELECT min(d.uploaded_at) FROM public.tb_s050_upload_files d
                              WHERE d.org_id = $1 AND d.id = ANY($2::text[]))
      ORDER BY f.uploaded_at, f.id`,
    [orgId, ids],
  );
  return rows.map((r) => ({ id: r.id, fileName: r.file_name, skippedRows: r.skipped }));
}

/** 파일 지우기 — 그 파일의 계산서 · 카드 · 현금 줄은 FK CASCADE 로 함께 지워진다. */
export async function deleteUploadFiles(client: ScopedClient, orgId: number, ids: readonly string[]): Promise<number> {
  const r = await q(client, `DELETE FROM public.tb_s050_upload_files WHERE org_id = $1 AND id = ANY($2::text[])`, [orgId, ids]);
  return r.rowCount ?? 0;
}

/* ── 거래처 ──────────────────────────────────────────────────────────────── */

/** 이 사업자번호의 **먼저 생긴** 거래처(결정 8). 잠근다. */
export async function lockFirstVendorByBizNo(
  client: ScopedClient,
  orgId: number,
  bizNo: string,
): Promise<{ id: string; vendorTp: string; tpSetByUser: boolean } | null> {
  const { rows } = await q<{ id: string; vendor_tp: string; tp_set_by_user: boolean }>(
    client,
    `SELECT id, vendor_tp, tp_set_by_user FROM public.tb_s050_vendors
      WHERE org_id = $1 AND biz_no = $2
      ORDER BY created_at, id
      LIMIT 1
      FOR UPDATE`,
    [orgId, bizNo],
  );
  const r = rows[0];
  return r ? { id: r.id, vendorTp: r.vendor_tp, tpSetByUser: r.tp_set_by_user } : null;
}

export async function insertVendor(
  client: ScopedClient,
  orgId: number,
  v: { name: string; bizNo: string; vendorTp: string; firstKind: string; firstDirection: string | null },
  actor: string,
): Promise<string> {
  const id = randomUUID();
  await q(
    client,
    `INSERT INTO public.tb_s050_vendors (id, org_id, name, biz_no, vendor_tp, first_kind, first_direction, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
    [id, orgId, v.name, v.bizNo, v.vendorTp, v.firstKind, v.firstDirection, actor],
  );
  return id;
}

/** 업로드의 승격 — 구분만 바꾼다. 사용자가 정한 구분(tp_set_by_user)은 건드리지 않는다. */
export async function promoteVendor(client: ScopedClient, orgId: number, id: string, vendorTp: string, actor: string): Promise<void> {
  await q(
    client,
    `UPDATE public.tb_s050_vendors SET vendor_tp = $3, updated_at = CURRENT_TIMESTAMP, updated_by = $4
      WHERE org_id = $1 AND id = $2 AND tp_set_by_user = false`,
    [orgId, id, vendorTp, actor],
  );
}

interface VendorRow {
  id: string;
  name: string;
  biz_no: string | null;
  vendor_tp: string;
  tp_set_by_user: boolean;
  first_kind: string;
  first_direction: string | null;
  month_count: number;
  total_count: number;
}
const vendorView = (r: VendorRow): TaxVendorView => ({
  id: r.id,
  name: r.name,
  bizNo: r.biz_no,
  vendorTp: r.vendor_tp,
  tpSetByUser: r.tp_set_by_user,
  firstKind: r.first_kind,
  firstDirection: r.first_direction,
  monthCount: r.month_count,
  totalCount: r.total_count,
});

/** 거래처 목록 — 먼저 생긴 순. `ids` 를 주면 그 거래처만. */
export async function listVendors(
  client: ScopedClient,
  orgId: number,
  month: string,
  ids?: readonly string[],
): Promise<TaxVendorView[]> {
  const [from, to] = monthRange(month);
  const { rows } = await q<VendorRow>(
    client,
    `SELECT v.id, v.name, v.biz_no, v.vendor_tp, v.tp_set_by_user, v.first_kind, v.first_direction,
            count(i.vendor_id) FILTER (WHERE i.d >= $2::date AND i.d < $3::date)::int AS month_count,
            count(i.vendor_id)::int AS total_count
       FROM public.tb_s050_vendors v
       LEFT JOIN (SELECT org_id, vendor_id, write_date AS d FROM public.tb_s050_invoices
                  UNION ALL SELECT org_id, vendor_id, use_date FROM public.tb_s050_card_txns) i
              ON i.org_id = v.org_id AND i.vendor_id = v.id
      WHERE v.org_id = $1 AND ($4::text[] IS NULL OR v.id = ANY($4::text[]))
      GROUP BY v.id
      ORDER BY v.created_at, v.id`,
    [orgId, from, to, ids ?? null],
  );
  return rows.map(vendorView);
}

/** 고칠 거래처를 잠근다 — 이 단체의 것만. */
export async function lockVendors(
  client: ScopedClient,
  orgId: number,
  ids: readonly string[],
): Promise<{ id: string; bizNo: string | null; vendorTp: string; tpSetByUser: boolean }[]> {
  const { rows } = await q<{ id: string; biz_no: string | null; vendor_tp: string; tp_set_by_user: boolean }>(
    client,
    `SELECT id, biz_no, vendor_tp, tp_set_by_user FROM public.tb_s050_vendors
      WHERE org_id = $1 AND id = ANY($2::text[])
      FOR UPDATE`,
    [orgId, ids],
  );
  return rows.map((r) => ({ id: r.id, bizNo: r.biz_no, vendorTp: r.vendor_tp, tpSetByUser: r.tp_set_by_user }));
}

/** 이름 · 번호 고치기 — 이름 null 은 그대로, 번호 undefined 는 그대로. */
export async function updateVendor(
  client: ScopedClient,
  orgId: number,
  id: string,
  edit: { name: string | null; bizNo?: string | null },
  actor: string,
): Promise<void> {
  await q(
    client,
    `UPDATE public.tb_s050_vendors
        SET name = COALESCE($3, name),
            biz_no = CASE WHEN $4::boolean THEN $5 ELSE biz_no END,
            updated_at = CURRENT_TIMESTAMP, updated_by = $6
      WHERE org_id = $1 AND id = $2`,
    [orgId, id, edit.name, edit.bizNo !== undefined, edit.bizNo ?? null, actor],
  );
}

/** 사용자가 정한 구분 — tp_set_by_user = true(그 뒤로 업로드가 바꾸지 않는다). */
export async function setVendorType(client: ScopedClient, orgId: number, ids: readonly string[], tp: string, actor: string): Promise<number> {
  const r = await q(
    client,
    `UPDATE public.tb_s050_vendors
        SET vendor_tp = $3, tp_set_by_user = true, updated_at = CURRENT_TIMESTAMP, updated_by = $4
      WHERE org_id = $1 AND id = ANY($2::text[])`,
    [orgId, ids, tp, actor],
  );
  return r.rowCount ?? 0;
}

/** 합치기 ① — 계산서 · 카드 줄(1-4)을 남길 곳으로 옮긴다. 옮긴 줄 수. */
export async function moveInvoicesToVendor(client: ScopedClient, orgId: number, keepId: string, fromIds: readonly string[]): Promise<number> {
  let moved = 0;
  for (const table of ['tb_s050_invoices', 'tb_s050_card_txns']) {
    const r = await q(
      client,
      `UPDATE public.${table} SET vendor_id = $2 WHERE org_id = $1 AND vendor_id = ANY($3::text[])`,
      [orgId, keepId, fromIds],
    );
    moved += r.rowCount ?? 0;
  }
  return moved;
}

/** 합치기 ② — 남길 곳의 구분 · 번호. */
export async function updateMergedVendor(
  client: ScopedClient,
  orgId: number,
  keepId: string,
  v: { vendorTp: string; tpSetByUser: boolean; bizNo: string | null },
  actor: string,
): Promise<void> {
  await q(
    client,
    `UPDATE public.tb_s050_vendors
        SET vendor_tp = $3, tp_set_by_user = $4, biz_no = $5, updated_at = CURRENT_TIMESTAMP, updated_by = $6
      WHERE org_id = $1 AND id = $2`,
    [orgId, keepId, v.vendorTp, v.tpSetByUser, v.bizNo, actor],
  );
}

/** 합치기 ③ — 합친 곳 지우기. 계산서가 남아 있으면 FK RESTRICT 가 막는다. */
export async function deleteVendors(client: ScopedClient, orgId: number, ids: readonly string[]): Promise<number> {
  const r = await q(client, `DELETE FROM public.tb_s050_vendors WHERE org_id = $1 AND id = ANY($2::text[])`, [orgId, ids]);
  return r.rowCount ?? 0;
}
