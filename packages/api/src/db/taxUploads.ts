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
 * ★ 1-5(2026-11-01): 은행 거래내역 줄(212)도 파일 목록 · 파일 수 · 지울 줄 수에 든다. 이체 파일은 줄을 넣지 않고
 *   거래내역 줄에 덧붙이므로 그 달을 덧붙인 줄로 본다(`FILE_MONTH_SQL`). 은행 줄은 거래처를 가리키지 않는다.
 * ★ 1-6(2026-11-01): 국세 · 지방세 납부 · 4대보험 고지 · 대출 거래 줄(214)도 든다(`db/taxPaySocialLoan.ts`). 4대보험 파일은
 *   보험 종류 · 고지 연월을 파일 기록에 둔다(`social`). 이 줄들도 거래처를 가리키지 않는다.
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
 * 일곱 표의 (단체, 파일, 날짜) — 계산서 작성일 · 카드 사용일 · 현금 날짜 · 은행 거래일(1-5) ·
 * 국세 · 지방세 납부일 · 4대보험 고지 연월(달 첫날) · 대출 거래일(1-6). 지울 줄 수가 이것으로 센다.
 * ★ 바깥 질의가 `org_id = $1` 을 건다(이 조각은 단체를 거르지 않는다).
 */
const FILE_ROWS_SQL = `(SELECT org_id, file_id, write_date AS d FROM public.tb_s050_invoices
                       UNION ALL SELECT org_id, file_id, use_date FROM public.tb_s050_card_txns
                       UNION ALL SELECT org_id, file_id, use_date FROM public.tb_s050_cash_txns
                       UNION ALL SELECT org_id, file_id, txn_at::date FROM public.tb_s050_bank_txns
                       UNION ALL SELECT org_id, file_id, pay_date FROM public.tb_s050_tax_payments
                       UNION ALL SELECT org_id, file_id, notice_month FROM public.tb_s050_social_ins
                       UNION ALL SELECT org_id, file_id, txn_date FROM public.tb_s050_loan_txns)`;
/**
 * 파일 목록 · 파일 수가 그 달을 보는 줄 — 위에 더해 **이체 파일**은 덧붙인 출금 줄의 거래일로 본다(1-5).
 * ★ 지울 줄 수에는 쓰지 않는다 — 이체 파일을 지워도 그 줄은 빠지지 않는다(이체 칸만 비움).
 */
const FILE_MONTH_SQL = `(SELECT org_id, file_id, d FROM ${FILE_ROWS_SQL} r
                        UNION ALL SELECT org_id, xfer_file_id, txn_at::date FROM public.tb_s050_bank_txns WHERE xfer_file_id IS NOT NULL)`;

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
  bank_file_tp: string | null;
  bank_code: string | null;
  account_no: string | null;
  account_alias: string | null;
  social_ins_tp: string | null;
  notice_month: string | null;
}
const fileView = (r: FileRow): TaxUploadFileView => ({
  id: r.id,
  kind: r.kind,
  direction: r.direction,
  fileName: r.file_name,
  rowCount: r.row_count,
  insertedCount: r.inserted_count,
  uploadedAt: iso(r.uploaded_at),
  bankFileTp: r.bank_file_tp,
  account: r.bank_code !== null && r.account_no !== null ? { bankCode: r.bank_code, accountNo: r.account_no, alias: r.account_alias } : null,
  social: r.social_ins_tp !== null && r.notice_month !== null ? { insTp: r.social_ins_tp, noticeMonth: r.notice_month } : null,
});
/**
 * ★ 이체 파일(XFER)의 들어간 줄 수는 **지금 덧붙어 있는 줄**로 다시 센다(결정 14 — 거래내역 파일을 지우면 줄어든다).
 * ★ 은행 파일의 계좌 별칭은 세무 설정에서 번호로 찾는다(FK 없음 — 지웠거나 번호를 고쳤으면 null).
 */
const FILE_COLS = `f.id, f.kind, f.direction, f.file_name, f.row_count,
  CASE WHEN f.bank_file_tp = 'XFER'
       THEN (SELECT count(*)::int FROM public.tb_s050_bank_txns b WHERE b.org_id = f.org_id AND b.xfer_file_id = f.id)
       ELSE f.inserted_count END AS inserted_count,
  f.uploaded_at, f.bank_file_tp, f.bank_code, f.account_no,
  (SELECT a.alias FROM public.tb_s050_fin_accounts a
    WHERE a.org_id = f.org_id AND a.kind = 'B' AND a.number = f.account_no ORDER BY a.sort_order, a.id LIMIT 1) AS account_alias,
  f.social_ins_tp, to_char(f.notice_month, 'YYYY-MM') AS notice_month`;

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
        AND (EXISTS (SELECT 1 FROM ${FILE_MONTH_SQL} i
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
       JOIN ${FILE_MONTH_SQL} i ON i.org_id = f.org_id AND i.file_id = f.id
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
  /** 은행 파일만(212 CHECK) — 파일 종류 · 고른 계좌번호 · 은행. 다른 자료는 없음. */
  bank?: { fileTp: string; accountNo: string; bankCode: string };
  /** 4대보험 파일만(214 CHECK) — 고른 보험 종류 · 고지 연월(`YYYY-MM`). 다른 자료는 없음. */
  social?: { insTp: string; noticeMonth: string };
}

export async function insertUploadFile(client: ScopedClient, orgId: number, f: NewUploadFile, actor: string): Promise<TaxUploadFileView> {
  const { rows } = await q<FileRow>(
    client,
    `INSERT INTO public.tb_s050_upload_files AS f
       (id, org_id, kind, map_id, direction, file_name, file_hash, file_size, row_count, inserted_count, uploaded_by,
        bank_file_tp, account_no, bank_code, social_ins_tp, notice_month)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::date)
     RETURNING ${FILE_COLS}`,
    [randomUUID(), orgId, f.kind, f.mapId, f.direction, f.fileName, f.fileHash, f.fileSize, f.rowCount, f.insertedCount, actor,
      f.bank?.fileTp ?? null, f.bank?.accountNo ?? null, f.bank?.bankCode ?? null,
      f.social?.insTp ?? null, f.social ? `${f.social.noticeMonth}-01` : null],
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

/**
 * 지우는 파일 중 가장 먼저 올린 것보다 **뒤에** 올린 파일 중 건너뛴 줄이 있는 것.
 * ★ 이체 파일(XFER)은 뺀다 — 그 파일의 「건너뛴 줄」은 짝 못 찾은 이체 줄이라 겹침과 관계없다(1-5).
 */
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
        AND f.bank_file_tp IS DISTINCT FROM 'XFER'
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
  is_closed: boolean;
  first_month: string | null;
}
const vendorView = (r: VendorRow): TaxVendorView => ({
  id: r.id,
  name: r.name,
  bizNo: r.biz_no,
  vendorTp: r.vendor_tp,
  tpSetByUser: r.tp_set_by_user,
  closed: r.is_closed,
  firstMonth: r.first_month,
});

/**
 * 거래처 목록 — 먼저 생긴 순. `ids` 를 주면 그 거래처만.
 * ★ 첫 거래월 = 그 거래처가 붙은 계산서(작성일) · 카드(사용일) 줄 가운데 가장 이른 날짜의 달 — 읽을 때 셈한다(저장하지 않음, 2026-11-07).
 *   현금 경비는 거래처 연결 칸이 없어 세지 않는다(대표 결정). 줄이 없으면 null.
 */
export async function listVendors(client: ScopedClient, orgId: number, ids?: readonly string[]): Promise<TaxVendorView[]> {
  const { rows } = await q<VendorRow>(
    client,
    `SELECT v.id, v.name, v.biz_no, v.vendor_tp, v.tp_set_by_user, v.is_closed,
            to_char(min(i.d), 'YYYY-MM') AS first_month
       FROM public.tb_s050_vendors v
       LEFT JOIN (SELECT org_id, vendor_id, write_date AS d FROM public.tb_s050_invoices
                  UNION ALL SELECT org_id, vendor_id, use_date FROM public.tb_s050_card_txns) i
              ON i.org_id = v.org_id AND i.vendor_id = v.id
      WHERE v.org_id = $1 AND ($2::text[] IS NULL OR v.id = ANY($2::text[]))
      GROUP BY v.id
      ORDER BY v.created_at, v.id`,
    [orgId, ids ?? null],
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

/** 이름 · 번호 · 종료 여부 고치기 — 이름 null 은 그대로, 번호 · 종료 여부 undefined 는 그대로. */
export async function updateVendor(
  client: ScopedClient,
  orgId: number,
  id: string,
  edit: { name: string | null; bizNo?: string | null; closed?: boolean },
  actor: string,
): Promise<void> {
  await q(
    client,
    `UPDATE public.tb_s050_vendors
        SET name = COALESCE($3, name),
            biz_no = CASE WHEN $4::boolean THEN $5 ELSE biz_no END,
            is_closed = COALESCE($7::boolean, is_closed),
            updated_at = CURRENT_TIMESTAMP, updated_by = $6
      WHERE org_id = $1 AND id = $2`,
    [orgId, id, edit.name, edit.bizNo !== undefined, edit.bizNo ?? null, actor, edit.closed ?? null],
  );
}

/** [거래종료] — 고른 거래처를 종료로(지우지 않는다, 2026-11-07). 바꾼 수. */
export async function closeVendors(client: ScopedClient, orgId: number, ids: readonly string[], actor: string): Promise<number> {
  const r = await q(
    client,
    `UPDATE public.tb_s050_vendors
        SET is_closed = true, updated_at = CURRENT_TIMESTAMP, updated_by = $3
      WHERE org_id = $1 AND id = ANY($2::text[])`,
    [orgId, ids, actor],
  );
  return r.rowCount ?? 0;
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
