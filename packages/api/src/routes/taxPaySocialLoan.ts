/**
 * 세무 자료 올리기(s050200010) — 국세 · 지방세 납부 · 4대보험 고지 · 대출 거래 (1-6, 2026-11-01).
 * 라우트는 `taxUploads.ts` 가 종류로 나눠 부른다.
 *
 *   국세 NTAX · 지방세 LTAX  켜진 대응표(215 HOMETAX_NTAX_PAY · WETAX_LTAX_PAY)로 바꿔 납부 줄 표(214)에 넣는다
 *   4대보험 SOCIAL          `&insTp=NP|HI|EI|IA&noticeMonth=YYYY-MM` — 그 보험을 받는 대응표(SOCIAL_*)로 CSV · 엑셀을 읽는다
 *   대출 LOAN               켜진 대출 대응표(BANK_020_LOAN)로 읽는다 — 대출 기관 = 대응표의 은행
 *
 * ★★★ 운영사 세션도 **자기 단체만** — 줄 · 파일 모두 `org_id = 세션 단체 ID` 를 직접 건다(`db/taxPaySocialLoan.ts` · `db/taxUploads.ts`).
 *     네 파일 모두 사업자번호가 없어 「다른 회사 파일」을 내용으로 막지 않는다 — 단체 범위로만 받는다(결정 17).
 * ★★ 4대보험 주민번호 칸은 읽지 않는다(shared `convertSocialSheet` 가 대응표가 가리키는 칸만 읽는다). 로그에도 남기지 않는다.
 * ★ 1-2 · 1-4 · 1-5 방식 그대로: 대응표 · 파일 지문 중복 막기(409) · 미리보기 → 올리기 · 단체 잠금 · 5MB · 10,000줄 · 이미 올린 줄 위치.
 * ★ 중복: 국세 · 지방세는 납부번호(214 UNIQUE), 대출은 개수 맞추기, 4대보험은 같은 달 · 같은 보험 파일이 있으면 막는다(결정 11).
 * ★ 처음 보는 세목은 비용으로 넣고 경고한다(결정 19). 비용인지는 저장하지 않는다(읽을 때 코드로).
 */
import { createHash } from 'node:crypto';
import { countByUseMonth, pickNewByCount } from '@swonbiz/shared/domain/tax-card-cash';
import {
  TAX_KIND_LOAN,
  TAX_KIND_SOCIAL,
  TAX_SOCIAL_INS_CATEGORY,
  TAX_TAX_NOEXP_CATEGORY,
  convertLoanSheet,
  convertPaySheet,
  convertSocialSheet,
  firstSeenTaxItems,
  isExpenseTaxItem,
  loanDedupKey,
  socialTotals,
  taxItemWarnings,
  type PayMapColumns,
  type TaxPayKind,
} from '@swonbiz/shared/domain/tax-pay-social-loan';
import {
  summarizeAlreadyWhere,
  type TaxUploadFileView,
  type TaxUploadPreview,
  type TaxUploadResult,
} from '@swonbiz/shared/domain/tax-uploads';
import type { ScopedClient } from '../db/withCompanyScope.ts';
import { findFileByHash, insertUploadFile, loadImportMap, lockOrgUploads } from '../db/taxUploads.ts';
import {
  existingPayNoFiles,
  insertLoanRows,
  insertPayRows,
  insertSocialRows,
  loadLoanMap,
  loadSocialMap,
  loanKeyFiles,
  seenTaxItems,
  socialMonthFile,
} from '../db/taxPaySocialLoan.ts';
import { readSheetRows, readSocialRows } from '../tax/readSheet.ts';
import { loadCodeNames, skipReasonsFor, type TaxOp, type TaxOpFail } from './taxUploads.ts';

const PREVIEW_SAMPLE_ROWS = 5;
const fail = (status: 400 | 404 | 409, error: string, message: string): TaxOpFail => ({ ok: false, status, error, message });

/** 화면이 고른 4대보험 보험 종류 · 고지 연월(`YYYY-MM`). */
export interface SocialUploadChoice {
  insTp: string;
  noticeMonth: string;
}

const sameFileOf = (f: TaxUploadFileView | null) => (f ? { id: f.id, fileName: f.fileName, uploadedAt: f.uploadedAt } : null);
const hashOf = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const sameFail = (f: TaxUploadFileView) => fail(409, 'same_file', `이미 올린 파일입니다. ${f.fileName} — ${f.uploadedAt}에 올렸습니다`);
const countMismatch = (what: string, want: number, got: number) => new Error(`세무 ${what} 올리기 — 넣을 줄 ${want} 인데 ${got} 줄이 들어갔다`);

/* ── 국세 · 지방세 ────────────────────────────────────────────────────────── */

async function preparePay(client: ScopedClient, orgId: number, kind: TaxPayKind, bytes: Uint8Array) {
  const sheet = readSheetRows(bytes);
  if (!sheet.ok) return fail(400, sheet.code, sheet.message);
  const map = await loadImportMap<PayMapColumns>(client, kind);
  if (!map) return fail(400, 'no_import_map', '이 자료의 대응표가 없습니다');
  const converted = convertPaySheet(sheet.rows, map);
  if (!converted.ok) return fail(400, converted.error.code, converted.error.message);
  const existing = await existingPayNoFiles(client, orgId, kind, converted.rows.map((r) => r.payNo));
  const newRows = converted.rows.filter((r) => !existing.has(r.payNo));
  const noExp = ((await loadCodeNames(client, [TAX_TAX_NOEXP_CATEGORY])).get(TAX_TAX_NOEXP_CATEGORY) ?? []).map((c) => c.name);
  const fresh = firstSeenTaxItems(converted.rows.map((r) => r.taxItem), noExp, await seenTaxItems(client, orgId));
  const fileHash = hashOf(bytes);
  return {
    ok: true as const,
    data: {
      mapId: map.id, converted, newRows, noExp,
      alreadyWhere: summarizeAlreadyWhere(converted.rows.flatMap((r) => {
        const fileName = existing.get(r.payNo);
        return fileName === undefined ? [] : [{ date: r.payDate, fileName }];
      })),
      warnings: [...converted.warnings, ...taxItemWarnings(fresh)],
      fileHash, sameFile: await findFileByHash(client, orgId, fileHash),
    },
  };
}

export async function previewPayOp(
  client: ScopedClient, orgId: number, kind: TaxPayKind, fileName: string, bytes: Uint8Array,
): Promise<TaxOp<TaxUploadPreview>> {
  const p = await preparePay(client, orgId, kind, bytes);
  if (!p.ok) return p;
  const d = p.data;
  return {
    ok: true,
    data: {
      kind, direction: null, fileName, sameFile: sameFileOf(d.sameFile), totalRows: d.converted.totalRows,
      byMonth: countByUseMonth(d.newRows.map((r) => ({ useDate: r.payDate }))),
      sample: d.converted.rows.slice(0, PREVIEW_SAMPLE_ROWS).map((r) => ({ ...r, expense: isExpenseTaxItem(r.taxItem, d.noExp) })),
      toInsert: d.newRows.length, alreadyUploaded: d.converted.rows.length - d.newRows.length, alreadyWhere: d.alreadyWhere,
      excluded: d.converted.excluded, skipReasons: await skipReasonsFor(client, d.converted.excluded), warnings: d.warnings,
    },
  };
}

/** 한 트랜잭션 안에서 부른다. 같은 단체의 올리기는 한 줄로 선다(`lockOrgUploads`). */
export async function uploadPayOp(
  client: ScopedClient, orgId: number, kind: TaxPayKind, fileName: string, bytes: Uint8Array, actor: string,
): Promise<TaxOp<TaxUploadResult>> {
  await lockOrgUploads(client, orgId);
  const p = await preparePay(client, orgId, kind, bytes);
  if (!p.ok) return p;
  const d = p.data;
  if (d.sameFile) return sameFail(d.sameFile);
  const file = await insertUploadFile(client, orgId, {
    kind, mapId: d.mapId, direction: null, fileName, fileHash: d.fileHash, fileSize: bytes.length,
    rowCount: d.converted.totalRows, insertedCount: d.newRows.length,
  }, actor);
  const inserted = await insertPayRows(client, orgId, file.id, kind, d.newRows);
  // 단체 잠금 안에서 센 값이라 어긋날 수 없다 — 어긋나면 기록이 틀리므로 통째로 되돌린다
  if (inserted !== d.newRows.length) throw countMismatch('납부', d.newRows.length, inserted);
  return {
    ok: true,
    data: {
      file, insertedCount: inserted, alreadyUploaded: d.converted.rows.length - d.newRows.length, excluded: d.converted.excluded,
      vendorsCreated: 0, vendorsPromoted: 0, warnings: d.warnings,
    },
  };
}

/* ── 4대보험 ─────────────────────────────────────────────────────────────── */

async function prepareSocial(client: ScopedClient, orgId: number, choice: SocialUploadChoice, bytes: Uint8Array) {
  const sheet = readSocialRows(bytes);
  if (!sheet.ok) return fail(400, sheet.code, sheet.message);
  const map = await loadSocialMap(client, choice.insTp);
  if (!map) return fail(400, 'no_import_map', '이 보험의 대응표가 없습니다');
  const converted = convertSocialSheet(sheet.rows, map, choice.insTp);
  if (!converted.ok) return fail(400, converted.error.code, converted.error.message);
  // ★ 결정 11 — 같은 달 같은 보험 파일이 있으면 막고 먼저 지우게 한다(미리보기에서도 막는다)
  const month = await socialMonthFile(client, orgId, choice.insTp, choice.noticeMonth);
  if (month) {
    const insName = ((await loadCodeNames(client, [TAX_SOCIAL_INS_CATEGORY])).get(TAX_SOCIAL_INS_CATEGORY) ?? [])
      .find((c) => c.code === choice.insTp)?.name ?? choice.insTp;
    const [y, m] = choice.noticeMonth.split('-');
    return fail(409, 'social_month_exists',
      `이미 올린 ${y}년 ${Number(m)}월 ${insName} 고지 내역이 있습니다 — ${month.fileName}. 고친 파일이면 올린 파일을 먼저 지우세요`);
  }
  const fileHash = hashOf(bytes);
  return { ok: true as const, data: { mapId: map.id, converted, fileHash, sameFile: await findFileByHash(client, orgId, fileHash) } };
}

export async function previewSocialOp(
  client: ScopedClient, orgId: number, fileName: string, bytes: Uint8Array, choice: SocialUploadChoice,
): Promise<TaxOp<TaxUploadPreview>> {
  const p = await prepareSocial(client, orgId, choice, bytes);
  if (!p.ok) return p;
  const d = p.data;
  const c = d.converted;
  return {
    ok: true,
    data: {
      kind: TAX_KIND_SOCIAL, direction: null, socialInsTp: choice.insTp, noticeMonth: choice.noticeMonth, fileName,
      sameFile: sameFileOf(d.sameFile), totalRows: c.totalRows,
      byMonth: c.personCount > 0 ? [{ month: choice.noticeMonth, count: c.personCount }] : [],
      sample: c.rows.slice(0, PREVIEW_SAMPLE_ROWS), byInsTp: socialTotals(c.rows),
      toInsert: c.personCount, alreadyUploaded: 0, alreadyWhere: [],
      excluded: c.excluded, skipReasons: await skipReasonsFor(client, c.excluded), warnings: c.warnings,
    },
  };
}

export async function uploadSocialOp(
  client: ScopedClient, orgId: number, fileName: string, bytes: Uint8Array, actor: string, choice: SocialUploadChoice,
): Promise<TaxOp<TaxUploadResult>> {
  await lockOrgUploads(client, orgId);
  const p = await prepareSocial(client, orgId, choice, bytes);
  if (!p.ok) return p;
  const d = p.data;
  if (d.sameFile) return sameFail(d.sameFile);
  const c = d.converted;
  // 올린 파일의 「들어간 줄」은 사람 수 — 건강 파일은 한 사람이 건강 · 장기요양 두 줄이라 줄 수와 다르다
  const file = await insertUploadFile(client, orgId, {
    kind: TAX_KIND_SOCIAL, mapId: d.mapId, direction: null, fileName, fileHash: d.fileHash, fileSize: bytes.length,
    rowCount: c.totalRows, insertedCount: c.personCount, social: choice,
  }, actor);
  const inserted = await insertSocialRows(client, orgId, file.id, choice.noticeMonth, c.rows);
  if (inserted !== c.rows.length) throw countMismatch('4대보험', c.rows.length, inserted);
  return {
    ok: true,
    data: {
      file, insertedCount: c.personCount, alreadyUploaded: 0, excluded: c.excluded,
      vendorsCreated: 0, vendorsPromoted: 0, warnings: c.warnings,
    },
  };
}

/* ── 대출 ────────────────────────────────────────────────────────────────── */

async function prepareLoan(client: ScopedClient, orgId: number, bytes: Uint8Array) {
  const sheet = readSheetRows(bytes);
  if (!sheet.ok) return fail(400, sheet.code, sheet.message);
  const map = await loadLoanMap(client);
  if (!map) return fail(400, 'no_import_map', '이 자료의 대응표가 없습니다');
  const converted = convertLoanSheet(sheet.rows, map);
  if (!converted.ok) return fail(400, converted.error.code, converted.error.message);
  const { newRows, already, skipped } = pickNewByCount(
    converted.rows, loanDedupKey, await loanKeyFiles(client, orgId, map.bankCode, converted.loanNoLast4, converted.rows),
  );
  const fileHash = hashOf(bytes);
  return {
    ok: true as const,
    data: {
      mapId: map.id, bankCode: map.bankCode, converted, newRows, already,
      alreadyWhere: summarizeAlreadyWhere(skipped.map((s) => ({ date: s.row.txnDate, fileName: s.fileName }))),
      fileHash, sameFile: await findFileByHash(client, orgId, fileHash),
    },
  };
}

export async function previewLoanOp(client: ScopedClient, orgId: number, fileName: string, bytes: Uint8Array): Promise<TaxOp<TaxUploadPreview>> {
  const p = await prepareLoan(client, orgId, bytes);
  if (!p.ok) return p;
  const d = p.data;
  return {
    ok: true,
    data: {
      kind: TAX_KIND_LOAN, direction: null, bankCode: d.bankCode, loanNoLast4: d.converted.loanNoLast4, fileName,
      sameFile: sameFileOf(d.sameFile), totalRows: d.converted.totalRows,
      byMonth: countByUseMonth(d.newRows.map((r) => ({ useDate: r.txnDate }))),
      sample: d.converted.rows.slice(0, PREVIEW_SAMPLE_ROWS), toInsert: d.newRows.length, alreadyUploaded: d.already,
      alreadyWhere: d.alreadyWhere, excluded: d.converted.excluded, skipReasons: await skipReasonsFor(client, d.converted.excluded),
      warnings: d.converted.warnings,
    },
  };
}

export async function uploadLoanOp(
  client: ScopedClient, orgId: number, fileName: string, bytes: Uint8Array, actor: string,
): Promise<TaxOp<TaxUploadResult>> {
  await lockOrgUploads(client, orgId);
  const p = await prepareLoan(client, orgId, bytes);
  if (!p.ok) return p;
  const d = p.data;
  if (d.sameFile) return sameFail(d.sameFile);
  const file = await insertUploadFile(client, orgId, {
    kind: TAX_KIND_LOAN, mapId: d.mapId, direction: null, fileName, fileHash: d.fileHash, fileSize: bytes.length,
    rowCount: d.converted.totalRows, insertedCount: d.newRows.length,
  }, actor);
  const inserted = await insertLoanRows(client, orgId, file.id, { bankCode: d.bankCode, loanNoLast4: d.converted.loanNoLast4 }, d.newRows);
  if (inserted !== d.newRows.length) throw countMismatch('대출', d.newRows.length, inserted);
  return {
    ok: true,
    data: {
      file, insertedCount: inserted, alreadyUploaded: d.already, excluded: d.converted.excluded,
      vendorsCreated: 0, vendorsPromoted: 0, warnings: d.converted.warnings,
    },
  };
}
