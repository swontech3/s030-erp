/**
 * 세무(S05) 국세 · 지방세 납부 · 4대보험 고지 · 대출 거래의 DB 쪽 — 214 의 표 셋 · 215 의 대응표 여섯 (1-6, 2026-11-01).
 *
 * ★★★ 모든 회사 자료 질의가 `org_id = $1`(세션 단체 ID)을 직접 건다 — 운영사 세션도 RLS 가 모든 단체를 보여 주기 때문이다(203 머리말).
 * ★ 중복 막기: 국세 · 지방세는 (단체, 종류, 납부번호) UNIQUE(214) — 이미 있는 번호는 건너뛴다(ON CONFLICT DO NOTHING).
 *   4대보험은 같은 단체 · 보험 · 고지 연월 파일이 있으면 막는다(214 UNIQUE 부분 색인 — 앞에서 먼저 찾아 알린다).
 *   대출은 「개수 맞추기」 — 열쇠(shared `loanDedupKey`)마다 DB 줄이 든 파일 이름(먼저 올린 줄부터)만 읽는다.
 * ★ 4대보험 줄에는 이름 · 가입자 번호 끝 4자리만 들어온다 — 주민번호는 이 파일에 들어올 길이 없다.
 * ★ 금액은 bigint 라 pg 가 글자로 준다 — 원 단위 정수라 Number 로 바꿔도 잃지 않는다.
 */
import {
  TAX_KIND_LOAN,
  TAX_KIND_SOCIAL,
  loanDedupKey,
  type LoanMapColumns,
  type LoanStdRow,
  type PayStdRow,
  type SocialMapColumns,
  type SocialStdRow,
} from '@swonbiz/shared/domain/tax-pay-social-loan';
import type { ScopedClient } from './withCompanyScope.ts';

interface Rows<T> {
  rows: T[];
  rowCount: number | null;
}
const q = <T>(client: ScopedClient, sql: string, params?: unknown[]): Promise<Rows<T>> =>
  client.query(sql, params) as Promise<Rows<T>>;

const iso = (v: Date | string): string => (v instanceof Date ? v.toISOString() : String(v));

/* ── 대응표 ──────────────────────────────────────────────────────────────── */

interface MapRow<C> {
  id: string;
  kind: string;
  header_row: number;
  header_signature: string[];
  columns: C;
  bank_code: string | null;
  social_ins_tps: string[] | null;
}
const MAP_COLS = 'id, kind, header_row, header_signature, columns, bank_code, social_ins_tps';

/** 그 보험 종류를 받는 켜진 4대보험 대응표(215 — 고용 · 산재는 한 줄). 없으면 null. */
export async function loadSocialMap(client: ScopedClient, insTp: string) {
  const { rows } = await q<MapRow<SocialMapColumns>>(
    client,
    `SELECT ${MAP_COLS} FROM public.tb_s050_import_maps
      WHERE kind = $1 AND is_active = true AND $2 = ANY(social_ins_tps) ORDER BY id LIMIT 1`,
    [TAX_KIND_SOCIAL, insTp],
  );
  const r = rows[0];
  return r
    ? { id: r.id, kind: r.kind, headerRow: r.header_row, headerSignature: r.header_signature, socialInsTps: r.social_ins_tps ?? [], columns: r.columns }
    : null;
}

/** 켜진 대출 대응표(215 — 지금은 우리은행 하나). 없으면 null. */
export async function loadLoanMap(client: ScopedClient) {
  const { rows } = await q<MapRow<LoanMapColumns>>(
    client,
    `SELECT ${MAP_COLS} FROM public.tb_s050_import_maps WHERE kind = $1 AND is_active = true ORDER BY id LIMIT 1`,
    [TAX_KIND_LOAN],
  );
  const r = rows[0];
  return r && r.bank_code
    ? { id: r.id, kind: r.kind, bankCode: r.bank_code, headerRow: r.header_row, headerSignature: r.header_signature, columns: r.columns }
    : null;
}

/* ── 국세 · 지방세 ────────────────────────────────────────────────────────── */

/** 이 단체 · 종류에 이미 있는 납부번호 → 그 줄이 든 파일 이름(미리보기의 「이미 올린 줄 위치」). */
export async function existingPayNoFiles(
  client: ScopedClient,
  orgId: number,
  kind: string,
  payNos: readonly string[],
): Promise<Map<string, string>> {
  if (payNos.length === 0) return new Map();
  const { rows } = await q<{ pay_no: string; file_name: string }>(
    client,
    `SELECT p.pay_no, f.file_name
       FROM public.tb_s050_tax_payments p
       JOIN public.tb_s050_upload_files f ON f.id = p.file_id AND f.org_id = $1
      WHERE p.org_id = $1 AND p.kind = $2 AND p.pay_no = ANY($3::text[])`,
    [orgId, kind, [...new Set(payNos)]],
  );
  return new Map(rows.map((r) => [r.pay_no, r.file_name]));
}

/** 이 단체 줄에 있는 세목 글자(국세 · 지방세 모두) — 「처음 보는 세목」을 가른다(결정 19). */
export async function seenTaxItems(client: ScopedClient, orgId: number): Promise<string[]> {
  const { rows } = await q<{ t: string }>(
    client,
    `SELECT DISTINCT tax_item_src AS t FROM public.tb_s050_tax_payments WHERE org_id = $1`,
    [orgId],
  );
  return rows.map((r) => r.t);
}

/** 납부 줄을 한 번에 넣는다. 이미 있는 납부번호는 건너뛴다. 넣은 줄 수. */
export async function insertPayRows(
  client: ScopedClient,
  orgId: number,
  fileId: string,
  kind: string,
  rows: readonly PayStdRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const col = <K extends keyof PayStdRow>(k: K) => rows.map((r) => r[k]);
  const r = await q(
    client,
    `INSERT INTO public.tb_s050_tax_payments
       (id, org_id, file_id, kind, pay_date, tax_item_src, pay_no, amount, penalty_amount, belong_month, office_src, pay_method_src)
     SELECT gen_random_uuid()::text, $1, $2, $3, u.pay_date, u.tax_item, u.pay_no, u.amount, u.penalty,
            CASE WHEN u.belong IS NULL THEN NULL ELSE (u.belong || '-01')::date END, u.office, u.pay_method
       FROM unnest($4::date[], $5::text[], $6::text[], $7::bigint[], $8::bigint[], $9::text[], $10::text[], $11::text[])
            AS u(pay_date, tax_item, pay_no, amount, penalty, belong, office, pay_method)
     ON CONFLICT (org_id, kind, pay_no) DO NOTHING`,
    [
      orgId, fileId, kind,
      col('payDate'), col('taxItem'), col('payNo'), col('amount'), col('penalty'), col('belongMonth'), col('office'), col('payMethod'),
    ],
  );
  return r.rowCount ?? 0;
}

/* ── 4대보험 ─────────────────────────────────────────────────────────────── */

/** 같은 단체 · 보험 · 고지 연월로 이미 올린 파일(결정 11 — 있으면 막는다). 없으면 null. */
export async function socialMonthFile(
  client: ScopedClient,
  orgId: number,
  insTp: string,
  noticeMonth: string,
): Promise<{ id: string; fileName: string; uploadedAt: string } | null> {
  const { rows } = await q<{ id: string; file_name: string; uploaded_at: Date | string }>(
    client,
    `SELECT id, file_name, uploaded_at FROM public.tb_s050_upload_files
      WHERE org_id = $1 AND kind = $2 AND social_ins_tp = $3 AND notice_month = $4::date`,
    [orgId, TAX_KIND_SOCIAL, insTp, `${noticeMonth}-01`],
  );
  const r = rows[0];
  return r ? { id: r.id, fileName: r.file_name, uploadedAt: iso(r.uploaded_at) } : null;
}

/** 4대보험 줄을 한 번에 넣는다. 넣은 줄 수. */
export async function insertSocialRows(
  client: ScopedClient,
  orgId: number,
  fileId: string,
  noticeMonth: string,
  rows: readonly SocialStdRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const col = <K extends keyof SocialStdRow>(k: K) => rows.map((r) => r[k]);
  const r = await q(
    client,
    `INSERT INTO public.tb_s050_social_ins
       (id, org_id, file_id, notice_month, ins_tp, member_name_src, member_no_last4, notice_amount, pay_base)
     SELECT gen_random_uuid()::text, $1, $2, $3::date, u.ins_tp, u.name, u.last4, u.amount, u.base
       FROM unnest($4::text[], $5::text[], $6::text[], $7::bigint[], $8::bigint[]) AS u(ins_tp, name, last4, amount, base)`,
    [orgId, fileId, `${noticeMonth}-01`, col('insTp'), col('memberName'), col('memberNoLast4'), col('noticeAmount'), col('payBase')],
  );
  return r.rowCount ?? 0;
}

/* ── 대출 ────────────────────────────────────────────────────────────────── */

/** 열쇠마다 DB 줄이 든 파일 이름(먼저 올린 줄부터) — 그 기관 · 대출번호 끝 4자리 · 파일의 거래일들만 본다. */
export async function loanKeyFiles(
  client: ScopedClient,
  orgId: number,
  bankCode: string,
  loanNoLast4: string,
  rows: readonly LoanStdRow[],
): Promise<Map<string, string[]>> {
  if (rows.length === 0) return new Map();
  const { rows: got } = await q<{
    d: string; tp: string; ty: string | null; p: string; i: string; fe: string; b: string; files: string[];
  }>(
    client,
    `SELECT to_char(t.txn_date, 'YYYY-MM-DD') AS d, t.txn_tp AS tp, t.txn_type_src AS ty, t.principal_amount AS p,
            t.interest_amount AS i, t.fee_amount AS fe, t.balance AS b,
            array_agg(f.file_name ORDER BY f.uploaded_at, f.id, t.id) AS files
       FROM public.tb_s050_loan_txns t
       JOIN public.tb_s050_upload_files f ON f.id = t.file_id AND f.org_id = $1
      WHERE t.org_id = $1 AND t.bank_code = $2 AND t.loan_no_last4 = $3 AND t.txn_date = ANY($4::date[])
      GROUP BY 1, 2, 3, 4, 5, 6, 7`,
    [orgId, bankCode, loanNoLast4, [...new Set(rows.map((r) => r.txnDate))]],
  );
  return new Map(got.map((r) => [
    loanDedupKey({ txnDate: r.d, txnTp: r.tp, txnType: r.ty, principal: Number(r.p), interest: Number(r.i), fee: Number(r.fe), balance: Number(r.b) }),
    r.files,
  ]));
}

/** 대출 줄을 한 번에 넣는다. 넣은 줄 수. */
export async function insertLoanRows(
  client: ScopedClient,
  orgId: number,
  fileId: string,
  loan: { bankCode: string; loanNoLast4: string },
  rows: readonly LoanStdRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const col = <K extends keyof LoanStdRow>(k: K) => rows.map((r) => r[k]);
  const r = await q(
    client,
    `INSERT INTO public.tb_s050_loan_txns
       (id, org_id, file_id, bank_code, loan_no_last4, txn_date, txn_tp, txn_type_src, principal_amount, interest_amount, fee_amount, balance)
     SELECT gen_random_uuid()::text, $1, $2, $3, $4, u.d, u.tp, u.ty, u.p, u.i, u.fe, u.b
       FROM unnest($5::date[], $6::text[], $7::text[], $8::bigint[], $9::bigint[], $10::bigint[], $11::bigint[])
            AS u(d, tp, ty, p, i, fe, b)`,
    [
      orgId, fileId, loan.bankCode, loan.loanNoLast4,
      col('txnDate'), col('txnTp'), col('txnType'), col('principal'), col('interest'), col('fee'), col('balance'),
    ],
  );
  return r.rowCount ?? 0;
}
