/**
 * 세무(S05) 은행 거래내역 · 이체 내역의 DB 쪽 — 212 의 `tb_s050_bank_txns` · 대응표 은행 칸 (1-5, 2026-11-01).
 *
 * ★★★ 모든 회사 자료 질의가 `org_id = $1`(세션 단체 ID)을 직접 건다 — 운영사 세션도 RLS 가 모든 단체를 보여 주기 때문이다(203 머리말).
 *     계좌도 그 단체 · 은행(B) · 「사용 안 함」이 아닌 것만 고를 수 있다(`readBankAccount`).
 * ★★ 받는 계좌번호는 끝 4자리(xfer_account_last4)와 전체 번호(xfer_account_no, 225 — 2026-11-08 대표 결정)를 함께 저장 · 비운다.
 *    전체 번호는 세무사 전달 「이체내역」 시트만 읽는다(db/taxHandoff.ts). 다른 화면 응답은 끝 4자리만.
 * ★ 중복 막기는 「개수 맞추기」 — 열쇠(shared `bankTxnDedupKey`)마다 DB 줄이 든 파일 이름(먼저 올린 줄부터)만 읽는다.
 * ★ 이체 덧붙이기는 이체 칸 여섯만 고친다(212 권한). 이미 덧붙은 줄은 덮지 않는다(`xfer_file_id IS NULL`).
 * ★ 금액은 bigint 라 pg 가 글자로 준다 — 원 단위 정수라 Number 로 바꿔도 잃지 않는다.
 */
import {
  TAX_KIND_BANK,
  bankTxnDedupKey,
  type BankOutCandidate,
  type BankTxnMapColumns,
  type BankTxnStdRow,
  type BankXferMapColumns,
  type BankXferStdRow,
  type TaxBankFileTp,
} from '@swonbiz/shared/domain/tax-bank';
import type { ScopedClient } from './withCompanyScope.ts';

interface Rows<T> {
  rows: T[];
  rowCount: number | null;
}
const q = <T>(client: ScopedClient, sql: string, params?: unknown[]): Promise<Rows<T>> =>
  client.query(sql, params) as Promise<Rows<T>>;

/** 거래일시를 글자로 — shared 의 `YYYY-MM-DD HH:MM:SS` 와 같은 모양. */
const AT = (col: string) => `to_char(${col}, 'YYYY-MM-DD HH24:MI:SS')`;

/* ── 계좌 · 대응표 ───────────────────────────────────────────────────────── */

export interface BankAccountRow {
  id: string;
  bankCode: string;
  number: string;
  alias: string | null;
}

/** 고를 수 있는 은행 계좌 — 그 단체 · 은행(B) · 사용 중. 세무 설정 순서. */
export async function listBankAccounts(client: ScopedClient, orgId: number): Promise<BankAccountRow[]> {
  const { rows } = await q<{ id: string; bank_code: string; number: string; alias: string | null }>(
    client,
    `SELECT id, bank_code, number, alias FROM public.tb_s050_fin_accounts
      WHERE org_id = $1 AND kind = 'B' AND is_active = true
      ORDER BY sort_order, id`,
    [orgId],
  );
  return rows.map((r) => ({ id: r.id, bankCode: r.bank_code, number: r.number, alias: r.alias }));
}

/** 올릴 때 고른 계좌 — 그 단체 · 은행 · 사용 중이 아니면 null(남의 단체 id · 카드 · 「사용 안 함」). */
export async function readBankAccount(client: ScopedClient, orgId: number, id: string): Promise<BankAccountRow | null> {
  return (await listBankAccounts(client, orgId)).find((a) => a.id === id) ?? null;
}

/** 켜진 은행 대응표가 있는 (은행, 파일 종류) — 업로드 창의 파일 종류 선택지. */
export async function listBankMaps(client: ScopedClient): Promise<{ bankCode: string; bankFileTp: string }[]> {
  const { rows } = await q<{ bank_code: string; bank_file_tp: string }>(
    client,
    `SELECT bank_code, bank_file_tp FROM public.tb_s050_import_maps
      WHERE kind = $1 AND is_active = true ORDER BY bank_code, bank_file_tp`,
    [TAX_KIND_BANK],
  );
  return rows.map((r) => ({ bankCode: r.bank_code, bankFileTp: r.bank_file_tp }));
}

interface MapOf<C, T extends TaxBankFileTp> {
  id: string;
  kind: string;
  bankCode: string;
  bankFileTp: T;
  headerRow: number;
  headerSignature: readonly string[];
  columns: C;
}

/** 그 은행 · 파일 종류의 켜진 대응표(213 · UNIQUE 부분 색인으로 하나). 없으면 null. */
export async function loadBankMap(client: ScopedClient, bankCode: string, fileTp: 'TXN'): Promise<MapOf<BankTxnMapColumns, 'TXN'> | null>;
export async function loadBankMap(client: ScopedClient, bankCode: string, fileTp: 'XFER'): Promise<MapOf<BankXferMapColumns, 'XFER'> | null>;
export async function loadBankMap(client: ScopedClient, bankCode: string, fileTp: TaxBankFileTp): Promise<MapOf<unknown, TaxBankFileTp> | null> {
  const { rows } = await q<{ id: string; kind: string; header_row: number; header_signature: string[]; columns: unknown }>(
    client,
    `SELECT id, kind, header_row, header_signature, columns FROM public.tb_s050_import_maps
      WHERE kind = $1 AND bank_code = $2 AND bank_file_tp = $3 AND is_active = true`,
    [TAX_KIND_BANK, bankCode, fileTp],
  );
  const r = rows[0];
  return r ? { id: r.id, kind: r.kind, bankCode, bankFileTp: fileTp, headerRow: r.header_row, headerSignature: r.header_signature, columns: r.columns } : null;
}

/* ── 거래내역 ────────────────────────────────────────────────────────────── */

/** 그 계좌의 거래내역 줄이 하나라도 있는가 — 이체 내역을 먼저 올리면 막는다(결정 17). */
export async function hasBankTxns(client: ScopedClient, orgId: number, accountNo: string): Promise<boolean> {
  const { rows } = await q<{ ok: boolean }>(
    client,
    `SELECT EXISTS (SELECT 1 FROM public.tb_s050_bank_txns WHERE org_id = $1 AND account_no = $2) AS ok`,
    [orgId, accountNo],
  );
  return rows[0]?.ok === true;
}

/** 열쇠마다 DB 줄이 든 파일 이름(먼저 올린 줄부터) — 그 계좌 · 파일의 거래일시들만 본다. */
export async function bankTxnKeyFiles(
  client: ScopedClient,
  orgId: number,
  accountNo: string,
  rows: readonly BankTxnStdRow[],
): Promise<Map<string, string[]>> {
  if (rows.length === 0) return new Map();
  const { rows: got } = await q<{ at: string; i: string; o: string; b: string; files: string[] }>(
    client,
    `SELECT ${AT('t.txn_at')} AS at, t.in_amount AS i, t.out_amount AS o, t.balance AS b,
            array_agg(f.file_name ORDER BY f.uploaded_at, f.id, t.id) AS files
       FROM public.tb_s050_bank_txns t
       JOIN public.tb_s050_upload_files f ON f.id = t.file_id AND f.org_id = $1
      WHERE t.org_id = $1 AND t.account_no = $2 AND t.txn_at = ANY($3::timestamp[])
      GROUP BY 1, 2, 3, 4`,
    [orgId, accountNo, [...new Set(rows.map((r) => r.txnAt))]],
  );
  return new Map(got.map((r) => [
    bankTxnDedupKey({ txnAt: r.at, inAmount: Number(r.i), outAmount: Number(r.o), balance: Number(r.b) }),
    r.files,
  ]));
}

/** 거래내역 줄을 한 번에 넣는다. 넣은 줄 수. */
export async function insertBankRows(
  client: ScopedClient,
  orgId: number,
  fileId: string,
  account: { accountNo: string; bankCode: string },
  rows: readonly BankTxnStdRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const col = <K extends keyof BankTxnStdRow>(k: K) => rows.map((r) => r[k]);
  const r = await q(
    client,
    `INSERT INTO public.tb_s050_bank_txns
       (id, org_id, file_id, account_no, bank_code, txn_at, description_src, counterparty_src, my_note_src, memo_src,
        in_amount, out_amount, balance)
     SELECT gen_random_uuid()::text, $1, $2, $3, $4, u.txn_at, u.description, u.counterparty, u.my_note, u.memo,
            u.in_amount, u.out_amount, u.balance
       FROM unnest($5::timestamp[], $6::text[], $7::text[], $8::text[], $9::text[], $10::bigint[], $11::bigint[], $12::bigint[])
            AS u(txn_at, description, counterparty, my_note, memo, in_amount, out_amount, balance)`,
    [
      orgId, fileId, account.accountNo, account.bankCode,
      col('txnAt'), col('description'), col('counterparty'), col('myNote'), col('memo'),
      col('inAmount'), col('outAmount'), col('balance'),
    ],
  );
  return r.rowCount ?? 0;
}

/* ── 이체 ────────────────────────────────────────────────────────────────── */

/** 짝 후보 — 그 계좌의 출금 줄 중 [from, to] 사이. 이미 덧붙은 줄은 그 이체 파일 이름과 함께. */
export async function bankOutCandidates(
  client: ScopedClient,
  orgId: number,
  accountNo: string,
  from: string,
  to: string,
): Promise<BankOutCandidate[]> {
  const { rows } = await q<{ id: string; at: string; o: string; file_name: string | null }>(
    client,
    `SELECT t.id, ${AT('t.txn_at')} AS at, t.out_amount AS o, xf.file_name
       FROM public.tb_s050_bank_txns t
       LEFT JOIN public.tb_s050_upload_files xf ON xf.id = t.xfer_file_id AND xf.org_id = $1
      WHERE t.org_id = $1 AND t.account_no = $2 AND t.out_amount > 0
        AND t.txn_at BETWEEN $3::timestamp AND $4::timestamp
      ORDER BY t.txn_at, t.id`,
    [orgId, accountNo, from, to],
  );
  return rows.map((r) => ({ id: r.id, txnAt: r.at, outAmount: Number(r.o), attachedFile: r.file_name }));
}

/** 출금 줄에 이체 정보를 덧붙인다 — 그 단체 · 계좌 · 출금 줄이고 아직 덧붙지 않은 줄만. 덧붙인 줄 수. */
export async function attachXfers(
  client: ScopedClient,
  orgId: number,
  accountNo: string,
  xferFileId: string,
  pairs: readonly { txnId: string; xfer: BankXferStdRow }[],
): Promise<number> {
  if (pairs.length === 0) return 0;
  const col = <K extends keyof BankXferStdRow>(k: K) => pairs.map((p) => p.xfer[k]);
  const r = await q(
    client,
    `UPDATE public.tb_s050_bank_txns AS t
        SET xfer_file_id = $3, xfer_bank_src = u.to_bank, xfer_account_last4 = u.last4, xfer_holder_src = u.holder,
            xfer_to_memo_src = u.to_memo, xfer_from_memo_src = u.from_memo, xfer_account_no = u.account_no
       FROM unnest($4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[])
            AS u(id, to_bank, last4, holder, to_memo, from_memo, account_no)
      WHERE t.org_id = $1 AND t.account_no = $2 AND t.id = u.id AND t.out_amount > 0 AND t.xfer_file_id IS NULL`,
    [
      orgId, accountNo, xferFileId,
      pairs.map((p) => p.txnId), col('toBank'), col('toAccountLast4'), col('holder'), col('toMemo'), col('fromMemo'), col('toAccountNo'),
    ],
  );
  return r.rowCount ?? 0;
}

/** 덧붙인 이체 정보가 빠질 출금 줄 수 — 그 파일이 이체 파일이거나(비움) 거래내역 파일이거나(줄째 빠짐). */
export async function countXferDetached(client: ScopedClient, orgId: number, fileIds: readonly string[]): Promise<number> {
  const { rows } = await q<{ n: number }>(
    client,
    `SELECT count(*)::int AS n FROM public.tb_s050_bank_txns
      WHERE org_id = $1 AND xfer_file_id IS NOT NULL AND (xfer_file_id = ANY($2::text[]) OR file_id = ANY($2::text[]))`,
    [orgId, fileIds],
  );
  return rows[0]?.n ?? 0;
}

/** 그 이체 파일들로 덧붙인 칸을 비운다 — 이체 파일을 지우기 전에(212 FK RESTRICT, 결정 6). 비운 줄 수. */
export async function clearXfers(client: ScopedClient, orgId: number, xferFileIds: readonly string[]): Promise<number> {
  const r = await q(
    client,
    `UPDATE public.tb_s050_bank_txns
        SET xfer_file_id = NULL, xfer_bank_src = NULL, xfer_account_last4 = NULL, xfer_holder_src = NULL,
            xfer_to_memo_src = NULL, xfer_from_memo_src = NULL, xfer_account_no = NULL
      WHERE org_id = $1 AND xfer_file_id = ANY($2::text[])`,
    [orgId, xferFileIds],
  );
  return r.rowCount ?? 0;
}
