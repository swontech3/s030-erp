/**
 * 세무 자료 올리기(s050200010) — 은행 거래내역 · 이체 내역 (1-5, 2026-11-01). 라우트는 `taxUploads.ts` 가 종류로 나눠 부른다.
 *
 *   거래내역 TXN   고른 계좌의 은행 대응표(213 BANK_<은행>_TXN)로 바꿔 은행 줄 표(212)에 넣는다
 *   이체 내역 XFER 고른 계좌의 이체 대응표(BANK_020_XFER — 지금은 우리은행만)로 읽어 **그 계좌 출금 줄에 덧붙인다**(새 줄 없음)
 *
 * ★★★ 운영사 세션도 **자기 단체만** — 계좌 · 줄 · 파일 모두 `org_id = 세션 단체 ID` 를 직접 건다(`db/taxBank.ts` · `db/taxUploads.ts`).
 *     화면이 준 계좌 id 는 그 단체 · 은행 · 사용 중인 계좌일 때만 쓴다(아니면 400 no_account).
 * ★★ 받는 계좌번호는 끝 4자리만 — 변환(shared `convertBankXferSheet`)이 전체 번호를 버린 뒤의 줄만 여기로 온다. 로그에도 남기지 않는다.
 * ★ 1-2 · 1-4 방식 그대로: 대응표 · 파일 지문 중복 막기(409) · 미리보기 → 올리기 · 단체 잠금 · 5MB · 10,000줄 · 이미 올린 줄 위치.
 * ★ 이체 내역을 거래내역보다 먼저 올리면 막는다(결정 17). 짝 못 찾은 이체 줄은 경고만 · 보관하지 않는다(결정 13).
 */
import { createHash } from 'node:crypto';
import {
  TAX_BANK_FILE_TXN,
  TAX_KIND_BANK,
  XFER_MATCH_SECONDS,
  convertBankTxnSheet,
  convertBankXferSheet,
  bankTxnDedupKey,
  matchTransfers,
  xferWarnings,
  type TaxBankFileTp,
} from '@swonbiz/shared/domain/tax-bank';
import { countByUseMonth, pickNewByCount } from '@swonbiz/shared/domain/tax-card-cash';
import {
  summarizeAlreadyWhere,
  type TaxUploadFileView,
  type TaxUploadPreview,
  type TaxUploadResult,
} from '@swonbiz/shared/domain/tax-uploads';
import type { ScopedClient } from '../db/withCompanyScope.ts';
import { findFileByHash, insertUploadFile, lockOrgUploads } from '../db/taxUploads.ts';
import {
  attachXfers,
  bankOutCandidates,
  bankTxnKeyFiles,
  hasBankTxns,
  insertBankRows,
  loadBankMap,
  readBankAccount,
  type BankAccountRow,
} from '../db/taxBank.ts';
import { readSheetRows } from '../tax/readSheet.ts';
import { skipReasonsFor, type TaxOp, type TaxOpFail } from './taxUploads.ts';

const PREVIEW_SAMPLE_ROWS = 5;
const fail = (status: 400 | 404 | 409, error: string, message: string): TaxOpFail => ({ ok: false, status, error, message });

/** 화면이 고른 은행 계좌 · 파일 종류. */
export interface BankUploadChoice {
  accountId: string;
  fileTp: TaxBankFileTp;
}

const sameFileOf = (f: TaxUploadFileView | null) => (f ? { id: f.id, fileName: f.fileName, uploadedAt: f.uploadedAt } : null);
const hashOf = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const dayOf = (at: string) => at.slice(0, 10);

/** 「YYYY-MM-DD HH:MM:SS」 ± 초. */
function shift(at: string, seconds: number): string {
  const d = new Date(Date.parse(`${at.replace(' ', 'T')}Z`) + seconds * 1000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

async function accountOf(client: ScopedClient, orgId: number, accountId: string): Promise<TaxOp<BankAccountRow>> {
  const a = await readBankAccount(client, orgId, accountId);
  return a ? { ok: true, data: a } : fail(400, 'no_account', '세무 설정에 없는 계좌입니다(사용 안 함 · 다른 회사 계좌 포함)');
}

/* ── 거래내역 ────────────────────────────────────────────────────────────── */

async function prepareTxn(client: ScopedClient, orgId: number, account: BankAccountRow, bytes: Uint8Array) {
  const sheet = readSheetRows(bytes);
  if (!sheet.ok) return fail(400, sheet.code, sheet.message);
  const map = await loadBankMap(client, account.bankCode, TAX_BANK_FILE_TXN);
  if (!map) return fail(400, 'no_import_map', '이 은행의 거래내역은 아직 받지 못합니다');
  const converted = convertBankTxnSheet(sheet.rows, map, account.number);
  if (!converted.ok) return fail(400, converted.error.code, converted.error.message);
  const { newRows, already, skipped } = pickNewByCount(
    converted.rows, bankTxnDedupKey, await bankTxnKeyFiles(client, orgId, account.number, converted.rows),
  );
  const fileHash = hashOf(bytes);
  return {
    ok: true as const,
    data: {
      mapId: map.id, converted, newRows, already,
      alreadyWhere: summarizeAlreadyWhere(skipped.map((s) => ({ date: dayOf(s.row.txnAt), fileName: s.fileName }))),
      fileHash, sameFile: await findFileByHash(client, orgId, fileHash),
    },
  };
}

/* ── 이체 내역 ───────────────────────────────────────────────────────────── */

async function prepareXfer(client: ScopedClient, orgId: number, account: BankAccountRow, bytes: Uint8Array) {
  const sheet = readSheetRows(bytes);
  if (!sheet.ok) return fail(400, sheet.code, sheet.message);
  const map = await loadBankMap(client, account.bankCode, 'XFER');
  if (!map) return fail(400, 'no_import_map', '이 은행의 이체 내역은 아직 받지 못합니다');
  if (!(await hasBankTxns(client, orgId, account.number))) {
    return fail(400, 'no_bank_txns', '그 계좌 거래내역을 먼저 올리세요');
  }
  const converted = convertBankXferSheet(sheet.rows, map, account.number);
  if (!converted.ok) return fail(400, converted.error.code, converted.error.message);
  const times = converted.rows.map((r) => r.xferAt).sort();
  const outs = times.length === 0
    ? []
    : await bankOutCandidates(client, orgId, account.number, shift(times[0]!, -XFER_MATCH_SECONDS), shift(times[times.length - 1]!, XFER_MATCH_SECONDS));
  const match = matchTransfers(converted.rows, outs);
  const fileHash = hashOf(bytes);
  return {
    ok: true as const,
    data: {
      mapId: map.id, converted, match,
      alreadyWhere: summarizeAlreadyWhere(match.alreadyAttached.map((a) => ({ date: dayOf(a.xfer.xferAt), fileName: a.fileName }))),
      fileHash, sameFile: await findFileByHash(client, orgId, fileHash),
    },
  };
}

/* ── 미리보기 ────────────────────────────────────────────────────────────── */

/** 미리보기 — 쓰지 않는다. 은행 파일은 매입/매출이 없다. */
export async function previewBankOp(
  client: ScopedClient,
  orgId: number,
  fileName: string,
  bytes: Uint8Array,
  choice: BankUploadChoice,
): Promise<TaxOp<TaxUploadPreview>> {
  const a = await accountOf(client, orgId, choice.accountId);
  if (!a.ok) return a;
  if (choice.fileTp === TAX_BANK_FILE_TXN) {
    const p = await prepareTxn(client, orgId, a.data, bytes);
    if (!p.ok) return p;
    const d = p.data;
    return {
      ok: true,
      data: {
        kind: TAX_KIND_BANK, bankFileTp: 'TXN', direction: null, fileName, sameFile: sameFileOf(d.sameFile),
        totalRows: d.converted.totalRows, byMonth: countByUseMonth(d.newRows.map((r) => ({ useDate: dayOf(r.txnAt) }))),
        sample: d.converted.rows.slice(0, PREVIEW_SAMPLE_ROWS), toInsert: d.newRows.length, alreadyUploaded: d.already,
        alreadyWhere: d.alreadyWhere, excluded: d.converted.excluded, skipReasons: await skipReasonsFor(client, d.converted.excluded),
        warnings: d.converted.warnings,
      },
    };
  }
  const p = await prepareXfer(client, orgId, a.data, bytes);
  if (!p.ok) return p;
  const d = p.data;
  return {
    ok: true,
    data: {
      kind: TAX_KIND_BANK, bankFileTp: 'XFER', direction: null, fileName, sameFile: sameFileOf(d.sameFile),
      totalRows: d.converted.totalRows, byMonth: countByUseMonth(d.match.pairs.map((x) => ({ useDate: dayOf(x.xfer.xferAt) }))),
      // ★ 받는 계좌 전체 번호(225)는 미리보기 응답에 싣지 않는다 — 화면은 끝 4자리만
      sample: d.converted.rows.slice(0, PREVIEW_SAMPLE_ROWS).map(({ toAccountNo: _full, ...r }, i) => ({ ...r, status: d.match.statuses[i]! })),
      toInsert: d.match.pairs.length, alreadyUploaded: d.match.alreadyAttached.length, alreadyWhere: d.alreadyWhere,
      excluded: d.converted.excluded, skipReasons: await skipReasonsFor(client, d.converted.excluded),
      warnings: [...d.converted.warnings, ...xferWarnings(d.match)],
    },
  };
}

/* ── 올리기 ──────────────────────────────────────────────────────────────── */

/** 한 트랜잭션 안에서 부른다. 같은 단체의 올리기는 한 줄로 선다(`lockOrgUploads`). */
export async function uploadBankOp(
  client: ScopedClient,
  orgId: number,
  fileName: string,
  bytes: Uint8Array,
  actor: string,
  choice: BankUploadChoice,
): Promise<TaxOp<TaxUploadResult>> {
  await lockOrgUploads(client, orgId);
  const a = await accountOf(client, orgId, choice.accountId);
  if (!a.ok) return a;
  const account = a.data;
  const bank = { fileTp: choice.fileTp, accountNo: account.number, bankCode: account.bankCode };
  const same = (f: TaxUploadFileView) => fail(409, 'same_file', `이미 올린 파일입니다. ${f.fileName} — ${f.uploadedAt}에 올렸습니다`);

  if (choice.fileTp === TAX_BANK_FILE_TXN) {
    const p = await prepareTxn(client, orgId, account, bytes);
    if (!p.ok) return p;
    const d = p.data;
    if (d.sameFile) return same(d.sameFile);
    const file = await insertUploadFile(client, orgId, {
      kind: TAX_KIND_BANK, mapId: d.mapId, direction: null, fileName, fileHash: d.fileHash, fileSize: bytes.length,
      rowCount: d.converted.totalRows, insertedCount: d.newRows.length, bank,
    }, actor);
    const inserted = await insertBankRows(client, orgId, file.id, { accountNo: account.number, bankCode: account.bankCode }, d.newRows);
    // 단체 잠금 안에서 센 값이라 어긋날 수 없다 — 어긋나면 기록이 틀리므로 통째로 되돌린다
    if (inserted !== d.newRows.length) throw new Error(`세무 은행 올리기 — 넣을 줄 ${d.newRows.length} 인데 ${inserted} 줄이 들어갔다`);
    return {
      ok: true,
      data: {
        file, insertedCount: inserted, alreadyUploaded: d.already, excluded: d.converted.excluded,
        vendorsCreated: 0, vendorsPromoted: 0, warnings: d.converted.warnings,
      },
    };
  }

  const p = await prepareXfer(client, orgId, account, bytes);
  if (!p.ok) return p;
  const d = p.data;
  if (d.sameFile) return same(d.sameFile);
  const file = await insertUploadFile(client, orgId, {
    kind: TAX_KIND_BANK, mapId: d.mapId, direction: null, fileName, fileHash: d.fileHash, fileSize: bytes.length,
    rowCount: d.converted.totalRows, insertedCount: d.match.pairs.length, bank,
  }, actor);
  const attached = await attachXfers(client, orgId, account.number, file.id, d.match.pairs);
  if (attached !== d.match.pairs.length) {
    throw new Error(`세무 이체 덧붙이기 — 덧붙일 줄 ${d.match.pairs.length} 인데 ${attached} 줄에 덧붙었다`);
  }
  return {
    ok: true,
    data: {
      // 파일 기록은 덧붙이기 전에 읽었다 — 덧붙인 수는 지금 값으로
      file: { ...file, insertedCount: attached }, insertedCount: attached, alreadyUploaded: d.match.alreadyAttached.length,
      excluded: d.converted.excluded, vendorsCreated: 0, vendorsPromoted: 0,
      warnings: [...d.converted.warnings, ...xferWarnings(d.match)],
    },
  };
}
