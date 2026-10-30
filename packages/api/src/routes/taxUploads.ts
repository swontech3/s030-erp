/**
 * 세무 자료 올리기(s050200010, 세무 S05) — 세무 전용 엑셀 업로드 창구 (1-2, 2026-10-26).
 *
 *   GET  /tax/uploads?month=YYYY-MM        카드 상태 · 그 달 올린 파일 · 코드
 *   POST /tax/uploads/preview?kind=INVOICE 저장하지 않고 검사 결과(매입/매출 · 달별 줄 수 · 앞 5줄 · 넣을/건너뛸/뺀 줄 · 같은 파일 · 경고)
 *   POST /tax/uploads?kind=INVOICE         한 트랜잭션 — 올린 파일 기록 → 거래처 자동 등록 · 승격 → 계산서 넣기
 *   POST /tax/uploads/delete { ids[] }     파일 지우기(그 줄도 함께)
 *   POST /tax/uploads/delete-check { ids[] } 지우기 전 확인 — 지우기와 같은 계산(빠질 줄 · 겹쳤을 수 있는 파일), 지우지 않음
 *   GET  /tax/uploads/template?kind=CASH   현금 경비 표준 양식(1-4) — 1줄 안내 · 2줄 제목 줄 + 항목 · 지급방법 · 증빙 목록 시트
 *
 * ★ 1-4(2026-10-30): kind=CARD(홈택스 사업용 신용카드) · CASH(현금 경비 표준 양식)도 받는다 — 처리는 `taxCardCash.ts`.
 *
 * ★★★ 운영사 세션도 **자기 단체만** — 모든 조회 · 저장에 `org_id = 세션 단체 ID` 를 직접 건다(`db/taxUploads.ts`).
 *     DB 연결은 `scopeOfSession` — 회사 세션은 RLS(203)가 한 번 더 막는다. 역할로 403 을 내지 않는다(세무 설정과 같다).
 * ★★ 본문은 **엑셀 바이트 그대로**다(xls · xlsx 본문 형식, 5MB). 파일 이름은 `X-File-Name`(URI 인코딩).
 *    기존 첨부 업로드(사진 · PDF, `routes/files.ts`)와 본문 해석 · 상한이 다르다 — 그쪽은 고치지 않는다.
 * ★ 원본은 보관하지 않고 지문(SHA-256)만 둔다(결정 10). 같은 파일은 409.
 * ★ 거래처: 사업자번호로 **먼저 생긴 곳**에 붙인다. 없으면 주거래처(M)로 만들고, 일반(G)이면 사용자가 정한 것이 아닐 때만
 *   주거래처로 올린다. 이름 · 번호는 덮지 않는다(결정 1 · 8).
 */
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ErpSession } from '@swonbiz/shared';
import { digitsOnly, formatBizNumber } from '@swonbiz/shared/domain/tax-number';
import { TAX_BIZ_TP_CATEGORY, TAX_CODE_USE_TP, TAX_KIND_CATEGORY } from '@swonbiz/shared/domain/tax-settings';
import {
  SPREADSHEET_MIME_TYPES,
  TAX_INV_DIR_CATEGORY,
  TAX_KIND_INVOICE,
  TAX_SKIP_REASON_CATEGORY,
  TAX_UPLOADABLE_KINDS,
  TAX_UPLOAD_MAX_BYTES,
  TAX_VENDOR_MAIN,
  convertInvoiceSheet,
  countByMonth,
  parseFileIds,
  parseMonth,
  previewSample,
  type InvoiceExcluded,
  type InvoiceStdRow,
  type TaxCodeName,
  type TaxInvDir,
  type TaxUploadDeleteResult,
  type TaxUploadFileView,
  type TaxUploadPreview,
  type TaxUploadResult,
  type TaxUploadWarning,
  type TaxUploadsResponse,
} from '@swonbiz/shared/domain/tax-uploads';
import { requireSession } from '../session/hook.ts';
import { scopeOfSession, withCompanyScope, type ScopedClient } from '../db/withCompanyScope.ts';
import { listCodes } from '../db/lookups.ts';
import { readCompanySource } from '../db/corpChanges.ts';
import { listCodeDescriptions, readTaxSettingsRow } from '../db/taxSettings.ts';
import {
  countFilesByKind,
  countRowsOfFiles,
  deleteUploadFiles,
  existingApprovalNos,
  findFileByHash,
  insertInvoices,
  insertUploadFile,
  insertVendor,
  laterFilesWithSkips,
  listUploadFiles,
  loadImportMap,
  lockFirstVendorByBizNo,
  lockOrgUploads,
  lockUploadFiles,
  promoteVendor,
} from '../db/taxUploads.ts';
import { readSheetRows } from '../tax/readSheet.ts';
import { sendXlsx } from '../lib/xlsxExport.ts';
import { cashTemplateOp, previewCardCashOp, uploadCardCashOp } from './taxCardCash.ts';

/* ── 결과 모양 ───────────────────────────────────────────────────────────── */

export type TaxOpFail = { ok: false; status: 400 | 404 | 409; error: string; message: string };
export type TaxOp<T> = { ok: true; data: T } | TaxOpFail;
const fail = (status: 400 | 404 | 409, error: string, message: string): TaxOpFail => ({ ok: false, status, error, message });

/* ── 코드 ────────────────────────────────────────────────────────────────── */

/** 코드 이름 — 켜진 코드만, 순서대로. */
export async function loadCodeNames(client: ScopedClient, categories: readonly string[]): Promise<Map<string, TaxCodeName[]>> {
  const rows = await listCodes(client, categories.map((category) => ({ category, useTp: TAX_CODE_USE_TP })));
  const by = new Map<string, TaxCodeName[]>(categories.map((c) => [c, []]));
  for (const r of rows) by.get(r.category)?.push({ code: r.code, name: r.name });
  return by;
}

/**
 * 뺀 줄 종류의 이름 — 코드 표(TAX_SKIP_REASON)에서 **그 자료의 `excluded` 키만**, 코드 표 순서로.
 * ★ 209 가 카드 · 현금 종류를 더해 한 분류에 세 자료의 키가 섞여 있다 — 계산서 미리보기에 카드 이름이 끼지 않게 거른다.
 */
export async function skipReasonsFor(client: ScopedClient, excluded: object): Promise<TaxCodeName[]> {
  const keys = Object.keys(excluded);
  const codes = await loadCodeNames(client, [TAX_SKIP_REASON_CATEGORY]);
  return (codes.get(TAX_SKIP_REASON_CATEGORY) ?? []).filter((c) => keys.includes(c.code));
}

/* ── 읽기 ────────────────────────────────────────────────────────────────── */

export async function listUploadsOp(client: ScopedClient, orgId: number, month: string): Promise<TaxUploadsResponse> {
  const codes = await loadCodeNames(client, [TAX_KIND_CATEGORY, TAX_INV_DIR_CATEGORY, TAX_BIZ_TP_CATEGORY]);
  const descs = await listCodeDescriptions(client, [TAX_KIND_CATEGORY], TAX_CODE_USE_TP);
  const settings = await readTaxSettingsRow(client, orgId);
  const counts = await countFilesByKind(client, orgId, month);
  const files = await listUploadFiles(client, orgId, month);
  const kinds = (codes.get(TAX_KIND_CATEGORY) ?? []).map((k) => ({
    ...k,
    description: descs.find((d) => d.code === k.code)?.description ?? null,
  }));
  const bizType = settings ? (codes.get(TAX_BIZ_TP_CATEGORY) ?? []).find((b) => b.code === settings.bizType) : undefined;
  return {
    month,
    bizTypeName: bizType?.name ?? null,
    cards: kinds.map((k) => ({
      kind: k.code,
      enabled: TAX_UPLOADABLE_KINDS.includes(k.code),
      unused: settings?.unusedKinds.includes(k.code) ?? false,
      fileCount: counts.get(k.code) ?? 0,
    })),
    files,
    codes: { kinds, invDirs: codes.get(TAX_INV_DIR_CATEGORY) ?? [] },
  };
}

/* ── 검사(미리보기 · 올리기 공통) ──────────────────────────────────────────── */

interface Prepared {
  mapId: string;
  direction: TaxInvDir;
  totalRows: number;
  rows: InvoiceStdRow[];
  newRows: InvoiceStdRow[];
  alreadyUploaded: number;
  excluded: InvoiceExcluded;
  warnings: TaxUploadWarning[];
  fileHash: string;
  sameFile: TaxUploadFileView | null;
}

/** 엑셀 → 표준 양식 → 이미 올린 승인번호 거르기. 쓰지 않는다. */
export async function prepareInvoiceUpload(client: ScopedClient, orgId: number, bytes: Uint8Array): Promise<TaxOp<Prepared>> {
  const sheet = readSheetRows(bytes);
  if (!sheet.ok) return fail(400, sheet.code, sheet.message);

  const map = await loadImportMap(client, TAX_KIND_INVOICE);
  if (!map) return fail(400, 'no_import_map', '이 자료의 대응표가 없습니다');

  const company = await readCompanySource(client, orgId);
  const dbOwn = company.bizNumber && digitsOnly(company.bizNumber) !== '' ? digitsOnly(company.bizNumber) : null;
  const converted = convertInvoiceSheet(sheet.rows, map, dbOwn);
  if (!converted.ok) return fail(400, converted.error.code, converted.error.message);

  const existing = await existingApprovalNos(client, orgId, converted.rows.map((r) => r.approvalNo));
  const newRows = converted.rows.filter((r) => !existing.has(r.approvalNo));
  const fileHash = createHash('sha256').update(bytes).digest('hex');
  return {
    ok: true,
    data: {
      mapId: map.id,
      direction: converted.direction,
      totalRows: converted.totalRows,
      rows: converted.rows,
      newRows,
      alreadyUploaded: converted.rows.length - newRows.length,
      excluded: converted.excluded,
      warnings: converted.warnings,
      fileHash,
      sameFile: await findFileByHash(client, orgId, fileHash),
    },
  };
}

export async function previewUploadOp(
  client: ScopedClient,
  orgId: number,
  kind: string,
  fileName: string,
  bytes: Uint8Array,
): Promise<TaxOp<TaxUploadPreview>> {
  if (kind === 'CARD' || kind === 'CASH') return previewCardCashOp(client, orgId, kind, fileName, bytes);
  const p = await prepareInvoiceUpload(client, orgId, bytes);
  if (!p.ok) return p;
  const d = p.data;
  return {
    ok: true,
    data: {
      kind: TAX_KIND_INVOICE,
      fileName,
      direction: d.direction,
      sameFile: d.sameFile ? { id: d.sameFile.id, fileName: d.sameFile.fileName, uploadedAt: d.sameFile.uploadedAt } : null,
      totalRows: d.totalRows,
      byMonth: countByMonth(d.newRows),
      sample: previewSample(d.rows),
      toInsert: d.newRows.length,
      alreadyUploaded: d.alreadyUploaded,
      excluded: d.excluded,
      skipReasons: await skipReasonsFor(client, d.excluded),
      warnings: d.warnings,
    },
  };
}

/* ── 올리기 ──────────────────────────────────────────────────────────────── */

/** 올리기 — 자료 종류로 나눈다(계산서 · 카드 · 현금). 한 트랜잭션 안에서 부른다. */
export function uploadOp(
  client: ScopedClient,
  orgId: number,
  kind: string,
  fileName: string,
  bytes: Uint8Array,
  actor: string,
): Promise<TaxOp<TaxUploadResult>> {
  if (kind === 'CARD' || kind === 'CASH') return uploadCardCashOp(client, orgId, kind, fileName, bytes, actor);
  return uploadInvoicesOp(client, orgId, kind, fileName, bytes, actor);
}

/** 한 트랜잭션 안에서 부른다. 같은 단체의 올리기는 한 줄로 선다(`lockOrgUploads`). */
export async function uploadInvoicesOp(
  client: ScopedClient,
  orgId: number,
  kind: string,
  fileName: string,
  bytes: Uint8Array,
  actor: string,
): Promise<TaxOp<TaxUploadResult>> {
  await lockOrgUploads(client, orgId);
  const p = await prepareInvoiceUpload(client, orgId, bytes);
  if (!p.ok) return p;
  const d = p.data;
  if (d.sameFile) {
    return fail(409, 'same_file', `이미 올린 파일입니다. ${d.sameFile.fileName} — ${d.sameFile.uploadedAt}에 올렸습니다`);
  }

  const file = await insertUploadFile(client, orgId, {
    kind,
    mapId: d.mapId,
    direction: d.direction,
    fileName,
    fileHash: d.fileHash,
    fileSize: bytes.length,
    rowCount: d.totalRows,
    insertedCount: d.newRows.length,
  }, actor);

  // 거래처 — 사업자번호마다 한 번. 먼저 생긴 곳에 붙이고, 없으면 주거래처로 만든다.
  const vendorOf = new Map<string, string>();
  let vendorsCreated = 0;
  let vendorsPromoted = 0;
  for (const row of d.newRows) {
    if (vendorOf.has(row.partnerBizNo)) continue;
    const found = await lockFirstVendorByBizNo(client, orgId, row.partnerBizNo);
    if (found) {
      if (found.vendorTp !== TAX_VENDOR_MAIN && !found.tpSetByUser) {
        await promoteVendor(client, orgId, found.id, TAX_VENDOR_MAIN, actor);
        vendorsPromoted++;
      }
      vendorOf.set(row.partnerBizNo, found.id);
    } else {
      const id = await insertVendor(client, orgId, {
        // 상호가 빈 줄이면 번호를 이름으로 둔다(거래처명은 비울 수 없다 — 203 CHECK)
        name: row.partnerName !== '' ? row.partnerName.slice(0, 100) : formatBizNumber(row.partnerBizNo),
        bizNo: row.partnerBizNo,
        vendorTp: TAX_VENDOR_MAIN,
        firstKind: kind,
        firstDirection: d.direction,
      }, actor);
      vendorOf.set(row.partnerBizNo, id);
      vendorsCreated++;
    }
  }

  const inserted = await insertInvoices(
    client,
    orgId,
    file.id,
    d.direction,
    d.newRows.map((r) => ({ ...r, vendorId: vendorOf.get(r.partnerBizNo)! })),
  );
  // 단체 잠금 안에서 센 값이라 어긋날 수 없다 — 어긋나면 기록이 틀리므로 통째로 되돌린다
  if (inserted !== d.newRows.length) {
    throw new Error(`세무 올리기 — 넣을 줄 ${d.newRows.length} 인데 ${inserted} 줄이 들어갔다`);
  }
  return {
    ok: true,
    data: {
      file,
      insertedCount: inserted,
      alreadyUploaded: d.alreadyUploaded,
      excluded: d.excluded,
      vendorsCreated,
      vendorsPromoted,
      warnings: d.warnings,
    },
  };
}

/* ── 지우기 ──────────────────────────────────────────────────────────────── */

/**
 * 이 단체의 파일이 아닌 id 가 하나라도 있으면 **쓰기 전에** 404.
 * ★ `dryRun` 이면 같은 계산만 하고 지우지 않는다 — 지우기 전 확인 창이 이것을 부른다(확인과 실제가 같은 계산).
 */
export async function deleteUploadsOp(
  client: ScopedClient,
  orgId: number,
  ids: readonly string[],
  dryRun = false,
): Promise<TaxOp<TaxUploadDeleteResult>> {
  const locked = await lockUploadFiles(client, orgId, ids);
  if (locked.length !== ids.length) return fail(404, 'not_found', '없는 파일입니다');
  const deletedRows = await countRowsOfFiles(client, orgId, ids);
  const later = await laterFilesWithSkips(client, orgId, ids);
  const deletedFiles = dryRun ? locked.length : await deleteUploadFiles(client, orgId, ids);
  return { ok: true, data: { deletedFiles, deletedRows, laterFilesWithSkips: later } };
}

/* ── 라우트 ──────────────────────────────────────────────────────────────── */

/** 바꿔 끼울 수 있는 바깥 — 시험이 DB 없이 본문 · 400 · 404 · 409 를 본다. */
export interface TaxUploadsDeps {
  list(session: ErpSession, month: string): Promise<TaxUploadsResponse>;
  preview(session: ErpSession, kind: string, fileName: string, bytes: Uint8Array): Promise<TaxOp<TaxUploadPreview>>;
  upload(session: ErpSession, kind: string, fileName: string, bytes: Uint8Array): Promise<TaxOp<TaxUploadResult>>;
  /** `dryRun` = 지우기 전 확인(같은 계산, 지우지 않음). */
  remove(session: ErpSession, ids: string[], dryRun: boolean): Promise<TaxOp<TaxUploadDeleteResult>>;
  /** 표준 양식 내려받기 — 지금은 현금 경비(CASH)뿐. */
  template(session: ErpSession, kind: string): Promise<TaxOp<{ fileName: string; bytes: Uint8Array }>>;
}

const run = <T>(session: ErpSession, fn: (client: ScopedClient) => Promise<T>) =>
  withCompanyScope(scopeOfSession(session), fn);

/**
 * ★ 실패(400 · 409 · 404)도 트랜잭션을 되돌린다 — `withCompanyScope` 는 던질 때만 되돌리므로 실패 결과를
 *   던져 끝내고 바깥에서 다시 결과로 바꾼다. 409 앞에 쓴 것이 없어도, 나중에 순서가 바뀌어도 반쯤 남지 않게.
 */
class OpFailed extends Error {
  constructor(readonly result: TaxOpFail) {
    super(result.message);
  }
}
export async function runOp<T>(session: ErpSession, fn: (client: ScopedClient) => Promise<TaxOp<T>>): Promise<TaxOp<T>> {
  try {
    return await run(session, async (c) => {
      const r = await fn(c);
      if (!r.ok) throw new OpFailed(r);
      return r;
    });
  } catch (err) {
    if (err instanceof OpFailed) return err.result;
    // 같은 파일을 동시에 올리면 단체 잠금 뒤에도 UNIQUE(org_id, file_hash)가 마지막으로 막는다
    if ((err as { code?: string }).code === '23505') return fail(409, 'same_file', '이미 올린 파일입니다');
    throw err;
  }
}

const defaultDeps: TaxUploadsDeps = {
  list: (session, month) => run(session, (c) => listUploadsOp(c, session.s020OrgId, month)),
  preview: (session, kind, name, bytes) => runOp(session, (c) => previewUploadOp(c, session.s020OrgId, kind, name, bytes)),
  upload: (session, kind, name, bytes) =>
    runOp(session, (c) => uploadOp(c, session.s020OrgId, kind, name, bytes, String(session.s020MemberId))),
  remove: (session, ids, dryRun) => runOp(session, (c) => deleteUploadsOp(c, session.s020OrgId, ids, dryRun)),
  template: (session) => runOp(session, (c) => cashTemplateOp(c, session.s020OrgId)),
};

/** 표준 양식이 있는 자료 종류 — 계산서 · 카드는 홈택스 파일 그대로라 양식이 없다. */
const TEMPLATE_KINDS: readonly string[] = ['CASH'];

/**
 * 엑셀 본문 해석 — xls · xlsx 본문 형식을 바이트 그대로, 5MB 까지.
 * ★ 기존 사진 · PDF 해석(`index.ts`)과 형식이 겹치지 않아 따로 등록한다. 한 앱에 한 번만 부른다.
 */
export function registerSpreadsheetBodyParser(app: FastifyInstance): void {
  app.addContentTypeParser(
    [...SPREADSHEET_MIME_TYPES],
    { parseAs: 'buffer', bodyLimit: TAX_UPLOAD_MAX_BYTES },
    (_req, body, done) => done(null, body),
  );
}

/** `X-File-Name` — URI 인코딩된 원래 이름. 경로 문자는 걷는다(`routes/files.ts` 와 같은 규칙). */
function readFileName(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  let name: string;
  try {
    name = decodeURIComponent(raw);
  } catch {
    name = raw;
  }
  name = name.replace(/[\\/]/g, '_').replace(/\.{2,}/g, '.').trim();
  if (name === '' || name === '.') return null;
  return name.slice(0, 255);
}

const badRequest = (field: string, message: string) => ({ error: 'invalid_request', message, errors: [{ field, message }] });

export function registerTaxUploadRoutes(app: FastifyInstance, deps: TaxUploadsDeps = defaultDeps): void {
  app.get<{ Querystring: { month?: string } }>('/tax/uploads', async (req, reply) => {
    const session = requireSession(req);
    reply.header('Cache-Control', 'no-store');
    const month = parseMonth(req.query.month);
    if (!month) return reply.code(400).send(badRequest('month', '작업할 달은 YYYY-MM 입니다'));
    return reply.send(await deps.list(session, month));
  });

  /** 미리보기 · 올리기 공통 — 종류 · 파일 이름 · 바이트를 확인하고 넘긴다. */
  const fileRoute = <T>(
    path: string,
    call: (session: ErpSession, kind: string, fileName: string, bytes: Uint8Array) => Promise<TaxOp<T>>,
  ) =>
    app.post<{ Querystring: { kind?: string }; Body: unknown }>(path, async (req, reply) => {
      const session = requireSession(req);
      reply.header('Cache-Control', 'no-store');
      const kind = req.query.kind ?? '';
      if (!TAX_UPLOADABLE_KINDS.includes(kind)) {
        return reply.code(400).send(badRequest('kind', '올릴 수 없는 자료 종류입니다'));
      }
      const fileName = readFileName(req.headers['x-file-name']);
      if (!fileName) return reply.code(400).send(badRequest('fileName', '파일 이름이 없습니다'));
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return reply.code(400).send(badRequest('file', '엑셀 파일(.xls · .xlsx)을 보내 주세요'));
      }
      const r = await call(session, kind, fileName, new Uint8Array(req.body));
      if (!r.ok) return reply.code(r.status).send({ error: r.error, message: r.message });
      return reply.send(r.data);
    });

  fileRoute('/tax/uploads/preview', deps.preview);
  fileRoute('/tax/uploads', deps.upload);

  /** 지우기 · 지우기 전 확인 — 같은 처리(`deleteUploadsOp`)를 확인이면 지우지 않고 부른다. */
  const deleteRoute = (path: string, dryRun: boolean) =>
    app.post<{ Body: unknown }>(path, async (req, reply) => {
      const session = requireSession(req);
      reply.header('Cache-Control', 'no-store');
      const parsed = parseFileIds(req.body);
      if (!parsed.ok) {
        return reply.code(400).send({ error: 'invalid_request', message: parsed.errors[0]!.message, errors: parsed.errors });
      }
      const r = await deps.remove(session, parsed.value, dryRun);
      if (!r.ok) return reply.code(r.status).send({ error: r.error, message: r.message });
      return reply.send(r.data);
    });

  deleteRoute('/tax/uploads/delete', false);
  deleteRoute('/tax/uploads/delete-check', true);

  app.get<{ Querystring: { kind?: string } }>('/tax/uploads/template', async (req, reply) => {
    const session = requireSession(req);
    reply.header('Cache-Control', 'no-store');
    const kind = req.query.kind ?? '';
    if (!TEMPLATE_KINDS.includes(kind)) return reply.code(400).send(badRequest('kind', '표준 양식이 없는 자료 종류입니다'));
    const r = await deps.template(session, kind);
    if (!r.ok) return reply.code(r.status).send({ error: r.error, message: r.message });
    return sendXlsx(reply, r.data.fileName, r.data.bytes);
  });
}
