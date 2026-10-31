/**
 * 세무 자료 올리기(s050200010) — 카드 사용 내역 · 현금 경비 (1-4, 2026-10-30). 라우트는 `taxUploads.ts` 가 종류로 나눠 부른다.
 *
 *   카드  홈택스 사업용 신용카드 사용내역(대응표 HOMETAX_BIZ_CARD) → 카드 줄 표(208)
 *   현금  세무 표준 양식(대응표 TAX_CASH_STD — 210 부터 1줄 제목 · 구분 + 금액 한 칸) → 현금 줄 표(208). 양식은 `cashTemplateOp` 가 내려준다
 *
 * ★★★ 운영사 세션도 **자기 단체만** — 모든 조회 · 저장에 `org_id = 세션 단체 ID` 를 직접 건다(`db/taxCardCash.ts` · `db/taxUploads.ts`).
 * ★★ 카드번호는 끝 4자리만 — 변환(shared `convertCardSheet`)이 전체 번호를 버린 뒤의 줄만 여기로 온다. 로그에도 남기지 않는다.
 * ★ 1-2 방식 그대로: 대응표로 표준 양식 변환 · 파일 지문 중복 막기(409) · 미리보기 → 올리기 · 단체 잠금 · 5MB · 10,000줄.
 *   승인번호가 없어 줄 중복은 「개수 맞추기」(shared `pickNewByCount`).
 * ★ 카드 가맹점은 사업자번호가 있으면 거래처로 붙인다 — 먼저 생긴 곳, 없으면 **일반(G)** 으로 만든다(주거래처로 올리지 않는다, 결정 7).
 *   현금 거래처는 거래처 표에 넣지 않는다(글로만).
 */
import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';
import { formatBizNumber } from '@swonbiz/shared/domain/tax-number';
import {
  CASH_TEMPLATE_FILE_NAME,
  CASH_TEMPLATE_GUIDE,
  TAX_KIND_CARD,
  TAX_KIND_CASH,
  TAX_PAY_METHOD_CATEGORY,
  TAX_PROOF_CATEGORY,
  cardDedupKey,
  cashDedupKey,
  convertCardSheet,
  convertCashSheet,
  countByUseMonth,
  pickNewByCount,
  type CardExcluded,
  type CardMapColumns,
  type CardStdRow,
  type CashCodeNames,
  type CashExcluded,
  type CashMapColumns,
  type CashStdRow,
} from '@swonbiz/shared/domain/tax-card-cash';
import type { TaxItemOption } from '@swonbiz/shared/domain/tax-classify';
import {
  TAX_INV_DIR_CATEGORY,
  TAX_VENDOR_GENERAL,
  type TaxCodeName,
  type TaxUploadFileView,
  type TaxUploadPreview,
  type TaxUploadResult,
  type TaxUploadWarning,
} from '@swonbiz/shared/domain/tax-uploads';
import type { ScopedClient } from '../db/withCompanyScope.ts';
import {
  findFileByHash,
  insertUploadFile,
  insertVendor,
  loadImportMap,
  lockFirstVendorByBizNo,
  lockOrgUploads,
} from '../db/taxUploads.ts';
import { cardKeyCounts, cashKeyCounts, insertCardRows, insertCashRows, registeredCardLast4 } from '../db/taxCardCash.ts';
import { readSheetRows } from '../tax/readSheet.ts';
import { loadItems } from './taxClassify.ts';
import { loadCodeNames, skipReasonsFor, type TaxOp, type TaxOpFail } from './taxUploads.ts';

const PREVIEW_SAMPLE_ROWS = 5;
/** 양식의 항목 목록 시트 — 사업자 유형이 없어 항목이 빌 때의 안내 한 줄. */
const NO_ITEMS_NOTE = '세무 설정에서 사업자 유형을 고른 뒤 다시 내려받으면 항목 목록이 채워집니다';
const fail = (status: 400 | 404 | 409, error: string, message: string): TaxOpFail => ({ ok: false, status, error, message });

/* ── 검사(미리보기 · 올리기 공통) ──────────────────────────────────────────── */

interface Prepared<R, E> {
  mapId: string;
  totalRows: number;
  rows: R[];
  newRows: R[];
  alreadyUploaded: number;
  excluded: E;
  warnings: TaxUploadWarning[];
  fileHash: string;
  sameFile: TaxUploadFileView | null;
}

type CardPrepared = Prepared<CardStdRow, CardExcluded>;
type CashPrepared = Prepared<CashStdRow, CashExcluded>;

const NO_MAP = fail(400, 'no_import_map', '이 자료의 대응표가 없습니다');

async function prepareCard(client: ScopedClient, orgId: number, bytes: Uint8Array): Promise<TaxOp<CardPrepared>> {
  const sheet = readSheetRows(bytes);
  if (!sheet.ok) return fail(400, sheet.code, sheet.message);
  const map = await loadImportMap<CardMapColumns>(client, TAX_KIND_CARD);
  if (!map) return NO_MAP;
  const converted = convertCardSheet(sheet.rows, map, await registeredCardLast4(client, orgId));
  if (!converted.ok) return fail(400, converted.error.code, converted.error.message);
  const { newRows, already } = pickNewByCount(converted.rows, cardDedupKey, await cardKeyCounts(client, orgId, converted.rows));
  const fileHash = createHash('sha256').update(bytes).digest('hex');
  return {
    ok: true,
    data: {
      mapId: map.id, totalRows: converted.totalRows, rows: converted.rows, newRows, alreadyUploaded: already,
      excluded: converted.excluded, warnings: converted.warnings, fileHash, sameFile: await findFileByHash(client, orgId, fileHash),
    },
  };
}

/** 현금 이름 → 코드값에 쓰는 목록 — 구분(TAX_INV_DIR) · 항목은 그 회사 사업자 유형 파티션(세무 설정 전이면 빈 목록). */
async function cashNames(client: ScopedClient, orgId: number): Promise<CashCodeNames & { items: TaxItemOption[] }> {
  const { items } = await loadItems(client, orgId);
  const codes = await loadCodeNames(client, [TAX_INV_DIR_CATEGORY, TAX_PAY_METHOD_CATEGORY, TAX_PROOF_CATEGORY]);
  return {
    directions: codes.get(TAX_INV_DIR_CATEGORY) ?? [],
    items,
    payMethods: codes.get(TAX_PAY_METHOD_CATEGORY) ?? [],
    proofs: codes.get(TAX_PROOF_CATEGORY) ?? [],
  };
}

async function prepareCash(client: ScopedClient, orgId: number, bytes: Uint8Array): Promise<TaxOp<CashPrepared>> {
  const sheet = readSheetRows(bytes);
  if (!sheet.ok) return fail(400, sheet.code, sheet.message);
  const map = await loadImportMap<CashMapColumns>(client, TAX_KIND_CASH);
  if (!map) return NO_MAP;
  const converted = convertCashSheet(sheet.rows, map, await cashNames(client, orgId));
  if (!converted.ok) return fail(400, converted.error.code, converted.error.message);
  const { newRows, already } = pickNewByCount(converted.rows, cashDedupKey, await cashKeyCounts(client, orgId, converted.rows));
  const fileHash = createHash('sha256').update(bytes).digest('hex');
  return {
    ok: true,
    data: {
      mapId: map.id, totalRows: converted.totalRows, rows: converted.rows, newRows, alreadyUploaded: already,
      excluded: converted.excluded, warnings: converted.warnings, fileHash, sameFile: await findFileByHash(client, orgId, fileHash),
    },
  };
}

/* ── 미리보기 ────────────────────────────────────────────────────────────── */

/** 미리보기 — 쓰지 않는다. 카드 · 현금 모두 매입/매출(파일)은 없다. */
export async function previewCardCashOp(
  client: ScopedClient,
  orgId: number,
  kind: typeof TAX_KIND_CARD | typeof TAX_KIND_CASH,
  fileName: string,
  bytes: Uint8Array,
): Promise<TaxOp<TaxUploadPreview>> {
  const common = <R extends { useDate: string }, E extends object>(d: Prepared<R, E>) => ({
    fileName,
    sameFile: d.sameFile ? { id: d.sameFile.id, fileName: d.sameFile.fileName, uploadedAt: d.sameFile.uploadedAt } : null,
    totalRows: d.totalRows,
    byMonth: countByUseMonth(d.newRows),
    toInsert: d.newRows.length,
    alreadyUploaded: d.alreadyUploaded,
    warnings: d.warnings,
  });
  if (kind === TAX_KIND_CARD) {
    const p = await prepareCard(client, orgId, bytes);
    if (!p.ok) return p;
    const d = p.data;
    return {
      ok: true,
      data: {
        kind, direction: null, sample: d.rows.slice(0, PREVIEW_SAMPLE_ROWS), excluded: d.excluded,
        skipReasons: await skipReasonsFor(client, d.excluded), ...common(d),
      },
    };
  }
  const p = await prepareCash(client, orgId, bytes);
  if (!p.ok) return p;
  const d = p.data;
  return {
    ok: true,
    data: {
      kind, direction: null, sample: d.rows.slice(0, PREVIEW_SAMPLE_ROWS), excluded: d.excluded,
      skipReasons: await skipReasonsFor(client, d.excluded), ...common(d),
    },
  };
}

/* ── 올리기 ──────────────────────────────────────────────────────────────── */

/** 한 트랜잭션 안에서 부른다. 같은 단체의 올리기는 한 줄로 선다(`lockOrgUploads`). */
export async function uploadCardCashOp(
  client: ScopedClient,
  orgId: number,
  kind: typeof TAX_KIND_CARD | typeof TAX_KIND_CASH,
  fileName: string,
  bytes: Uint8Array,
  actor: string,
): Promise<TaxOp<TaxUploadResult>> {
  await lockOrgUploads(client, orgId);
  const p = kind === TAX_KIND_CARD ? await prepareCard(client, orgId, bytes) : await prepareCash(client, orgId, bytes);
  if (!p.ok) return p;
  const d = p.data;
  if (d.sameFile) {
    return fail(409, 'same_file', `이미 올린 파일입니다. ${d.sameFile.fileName} — ${d.sameFile.uploadedAt}에 올렸습니다`);
  }
  const file = await insertUploadFile(client, orgId, {
    kind,
    mapId: d.mapId,
    direction: null,
    fileName,
    fileHash: d.fileHash,
    fileSize: bytes.length,
    rowCount: d.totalRows,
    insertedCount: d.newRows.length,
  }, actor);

  let inserted: number;
  let vendorsCreated = 0;
  if (kind === TAX_KIND_CARD) {
    // 가맹점 거래처 — 사업자번호마다 한 번. 먼저 생긴 곳에 붙이고(구분은 건드리지 않는다), 없으면 일반(G)으로 만든다
    const rows = d.newRows as CardStdRow[];
    const vendorOf = new Map<string, string>();
    for (const row of rows) {
      if (!row.merchantBizNo || vendorOf.has(row.merchantBizNo)) continue;
      const found = await lockFirstVendorByBizNo(client, orgId, row.merchantBizNo);
      if (found) vendorOf.set(row.merchantBizNo, found.id);
      else {
        const id = await insertVendor(client, orgId, {
          name: row.merchantName !== '' ? row.merchantName.slice(0, 100) : formatBizNumber(row.merchantBizNo),
          bizNo: row.merchantBizNo,
          vendorTp: TAX_VENDOR_GENERAL,
          firstKind: TAX_KIND_CARD,
          firstDirection: null,
        }, actor);
        vendorOf.set(row.merchantBizNo, id);
        vendorsCreated++;
      }
    }
    inserted = await insertCardRows(client, orgId, file.id, rows.map((r) => ({
      ...r,
      vendorId: r.merchantBizNo ? vendorOf.get(r.merchantBizNo)! : null,
    })));
  } else {
    inserted = await insertCashRows(client, orgId, file.id, d.newRows as CashStdRow[], actor);
  }
  // 단체 잠금 안에서 센 값이라 어긋날 수 없다 — 어긋나면 기록이 틀리므로 통째로 되돌린다
  if (inserted !== d.newRows.length) {
    throw new Error(`세무 올리기 — 넣을 줄 ${d.newRows.length} 인데 ${inserted} 줄이 들어갔다`);
  }
  return {
    ok: true,
    data: {
      file, insertedCount: inserted, alreadyUploaded: d.alreadyUploaded, excluded: d.excluded,
      vendorsCreated, vendorsPromoted: 0, warnings: d.warnings,
    },
  };
}

/* ── 현금 경비 양식 내려받기(판단 14 · 15 · 210) ──────────────────────────── */

/** 양식에서 날짜 · 금액 서식을 걸어 두는 자료 줄 수(2~1,001줄). 그 아래도 적을 수 있다 — 서식만 없다. */
export const CASH_TEMPLATE_DATA_ROWS = 1000;
const DATE_FORMAT = 'yyyy-mm-dd';
const AMOUNT_FORMAT = '#,##0';

/**
 * 현금 경비 표준 양식 파일 — SheetJS 로 직접 만든다(칸 서식 때문 — 공통 부품 `xlsxExport` 는 칸 서식을 다루지 않아 그대로 둔다).
 * ★ 드롭다운(데이터 유효성 검사)은 없다 — SheetJS 무료판은 쓸 수 없고 ExcelJS 는 라이선스 문제로 미뤘다(2026-10-31). 목록 시트만.
 *   「현금 경비」(첫 시트 — 올리기는 첫 시트를 읽는다) 1줄 제목 줄(대응표 TAX_CASH_STD 그대로) · 자료 줄 없음 ·
 *               자료 줄 2~1,001줄의 날짜 칸 날짜 서식 · 금액 칸 「#,##0」(빈 칸에 서식만)
 *   「안내」     안내 문구 한 줄씩
 *   「구분 목록」 · 「항목 목록」(그 회사 출금 항목 · 풀이) · 「결제방법 목록」 · 「증빙 목록」 — 코드 표 이름 그대로.
 *               머리 · 시트 이름은 제목 줄의 그 칸 이름(코드 관리 · 대응표와 함께 바뀐다)
 */
export function buildCashTemplate(
  signature: readonly string[],
  columns: CashMapColumns,
  names: Omit<CashCodeNames, 'items'> & { items: readonly TaxItemOption[] },
): Uint8Array {
  const wb = XLSX.utils.book_new();
  const form = XLSX.utils.aoa_to_sheet([[...signature]]);
  for (let r = 1; r <= CASH_TEMPLATE_DATA_ROWS; r++) {
    form[XLSX.utils.encode_cell({ r, c: columns.useDate - 1 })] = { t: 'z', z: DATE_FORMAT };
    form[XLSX.utils.encode_cell({ r, c: columns.amount - 1 })] = { t: 'z', z: AMOUNT_FORMAT };
  }
  form['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: CASH_TEMPLATE_DATA_ROWS, c: signature.length - 1 } });
  XLSX.utils.book_append_sheet(wb, form, '현금 경비');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(CASH_TEMPLATE_GUIDE.map((l) => [l])), '안내');

  const head = (col: number) => signature[col - 1] ?? '';
  const list = (col: number, rows: readonly TaxCodeName[]) =>
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[head(col)], ...rows.map((x) => [x.name])]), `${head(col)} 목록`);
  list(columns.direction, names.directions);
  // 사업자 유형이 없으면(세무 설정 전) 항목이 비어 있다 — 안내 한 줄만 두고 양식은 그대로 내려준다(대표 2026-10-30)
  const items = names.items.length > 0 ? names.items.map((x) => [x.name, x.description ?? '']) : [[NO_ITEMS_NOTE, '']];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[head(columns.item), '풀이'], ...items]), `${head(columns.item)} 목록`);
  list(columns.payMethod, names.payMethods);
  list(columns.proof, names.proofs);
  return new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', sheetStubs: true }));
}

/** 현금 경비 양식 — 그 회사 항목 목록으로 만든다. 세무 설정 전이면 항목 목록 시트에 안내 한 줄(막지 않는다). */
export async function cashTemplateOp(client: ScopedClient, orgId: number): Promise<TaxOp<{ fileName: string; bytes: Uint8Array }>> {
  const map = await loadImportMap<CashMapColumns>(client, TAX_KIND_CASH);
  if (!map) return NO_MAP;
  const bytes = buildCashTemplate(map.headerSignature, map.columns, await cashNames(client, orgId));
  return { ok: true, data: { fileName: CASH_TEMPLATE_FILE_NAME, bytes } };
}
