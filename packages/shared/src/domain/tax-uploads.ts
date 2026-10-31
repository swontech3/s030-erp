/**
 * 세무(S05) 자료 올리기(s050200010) · 거래처(s050100020) — 표준 양식 변환 · 본문 검사와 응답 모양.
 *
 * 표는 203 의 넷이다 — 대응표(`tb_s050_import_maps`) · 올린 파일 · 거래처 · 세금계산서 줄.
 * 엑셀 바이트를 행(셀 배열)으로 푸는 것은 api 가 한다(SheetJS). 여기는 그 행을 받아 표준 양식으로 바꾼다 —
 * 라이브러리 없이 시험할 수 있게.
 *
 * ★★ 칸은 **대응표의 번호(1부터)**로 읽는다 — 홈택스 목록에는 「상호 · 대표자명 · 주소 · 종사업장번호」가
 *    공급자 쪽 · 공급받는자 쪽에 같은 이름으로 두 번 있다. 제목 줄은 대응표의 이름 전체와 **앞뒤 공백을 걷고**
 *    똑같아야 한다 — 아니면 저장하지 않고 「양식이 맞지 않습니다」.
 * ★★ 코드값(종류 · 세부 종류)은 **대응표의 바꾸기표**로 바꾼다. 여기에 「일반 → GEN」 같은 값을 박지 않는다.
 *    바꾸기표에 없는 세부 종류(수정 · 취소 등)는 넣지 않고 센다(결정 6).
 * ★ 매입 · 매출은 파일 1줄의 「사업자 등록번호」(우리 회사)로 정한다 — 그 번호가 공급자 칸이면 매출(S),
 *   공급받는자 칸이면 매입(P). DB 의 우리 번호가 있으면 서로 맞아야 하고(다르면 막음), 없으면 경고만(결정 5).
 * ★ 상대 사업자번호 끝자리가 틀리면 넣되 경고한다(결정 3).
 */
import { digitsOnly, formatBizNumber, isBizNumberChecksumOk, isBizNumberLength } from './tax-number.ts';
import type { CardExcluded, CardStdRow, CashExcluded, CashStdRow } from './tax-card-cash.ts';

export const TAX_INV_DIR_CATEGORY = 'TAX_INV_DIR';
export const TAX_INV_CLASS_CATEGORY = 'TAX_INV_CLASS';
export const TAX_INV_TYPE_CATEGORY = 'TAX_INV_TYPE';
export const TAX_VENDOR_TP_CATEGORY = 'TAX_VENDOR_TP';
/** 뺀 줄 종류(205) — 코드값 = `InvoiceExcluded` 의 키. ★ 고정 코드. */
export const TAX_SKIP_REASON_CATEGORY = 'TAX_SKIP_REASON';

/** 자료 종류 — 올릴 수 있는 것(TAX_KIND 코드값). 1-2 세금계산서 · 1-4 카드 사용 내역 · 현금 경비(tax-card-cash.ts). */
export const TAX_KIND_INVOICE = 'INVOICE';
export const TAX_UPLOADABLE_KINDS: readonly string[] = [TAX_KIND_INVOICE, 'CARD', 'CASH'];

/** 매입 · 매출 — ★ 고정 코드(code-usage.ts `PINNED_CODES`). 203 CHECK 가 기댄다. */
export const TAX_INV_DIR_PURCHASE = 'P';
export const TAX_INV_DIR_SALES = 'S';
export type TaxInvDir = typeof TAX_INV_DIR_PURCHASE | typeof TAX_INV_DIR_SALES;

/** 거래처 구분 — ★ 고정 코드. 세금계산서 거래처는 주거래처(M)로 만들고 올린다(결정 1). */
export const TAX_VENDOR_MAIN = 'M';
export const TAX_VENDOR_GENERAL = 'G';

/** 상한(결정 11). 203 CHECK 와 같은 값이다. */
export const TAX_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const TAX_UPLOAD_MAX_ROWS = 10_000;
/** 엑셀로 받는 본문 형식 — 화면이 확장자로 정해 보낸다. 서버는 파일 앞 바이트로 다시 본다. */
export const SPREADSHEET_MIME_TYPES = [
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

const VENDOR_NAME_MAX = 100;
const PREVIEW_SAMPLE_ROWS = 5;

/* ── 대응표 ──────────────────────────────────────────────────────────────── */

export interface ValueMapColumn {
  col: number;
  values: Record<string, string>;
}

export interface InvoiceMapColumns {
  ownBizNo: { row: number; label: string };
  writeDate: number;
  approvalNo: number;
  supplier: { bizNo: number; name: number };
  buyer: { bizNo: number; name: number };
  totalAmount: number;
  supplyAmount: number;
  taxAmount: number;
  invClass: ValueMapColumn;
  invType: ValueMapColumn;
}

/** `tb_s050_import_maps` 한 줄(세금계산서). */
export interface InvoiceImportMap {
  id: string;
  kind: string;
  headerRow: number;
  headerSignature: readonly string[];
  columns: InvoiceMapColumns;
}

/* ── 변환 결과 ───────────────────────────────────────────────────────────── */

/** 표준 양식 한 줄 — 상대방(거래처)은 매입이면 공급자, 매출이면 공급받는자. */
export interface InvoiceStdRow {
  writeDate: string;
  approvalNo: string;
  partnerName: string;
  partnerBizNo: string;
  supplyAmount: number;
  taxAmount: number;
  totalAmount: number;
  invClass: string;
  invType: string;
}

/** 넣지 않은 줄 — 종류별 수. */
export interface InvoiceExcluded {
  /** 세부 종류가 바꾸기표에 없음(수정 · 취소 등). */
  nonGeneral: number;
  /** 상대 사업자번호가 비었거나 10자리가 아님. */
  noBizNo: number;
  /** 금액(합계 · 공급가액 · 세액)이 숫자가 아님. */
  badAmount: number;
  noApproval: number;
  /** 파일 안에서 겹친 승인번호 — 첫 줄만 넣는다. */
  dupInFile: number;
  /** 종류가 바꾸기표에 없음(세금계산서가 아닌 줄). */
  otherClass: number;
  /** 작성일이 날짜가 아님. */
  badDate: number;
}

export interface TaxUploadWarning {
  code:
    | 'own_biz_no_unchecked'
    | 'partner_biz_no_checksum'
    // 카드 · 현금(1-4, tax-card-cash.ts) — 줄은 넣고 알린다
    | 'card_deduct_unknown'
    | 'card_unregistered'
    | 'cash_item_unknown'
    | 'cash_proof_unknown'
    | 'cash_sales_item_ignored';
  message: string;
  count?: number;
}

export type TaxUploadErrorCode =
  | 'format_mismatch'
  | 'too_many_rows'
  | 'no_rows'
  | 'own_biz_no_missing'
  | 'own_biz_no_mismatch'
  | 'direction_unknown';

export interface TaxUploadError {
  code: TaxUploadErrorCode;
  message: string;
}

export type InvoiceConverted =
  | {
      ok: true;
      direction: TaxInvDir;
      /** 파일 1줄의 우리 회사 번호(숫자만). */
      ownBizNo: string;
      /** 제목 줄 아래 빈 줄을 뺀 자료 줄 수. */
      totalRows: number;
      rows: InvoiceStdRow[];
      excluded: InvoiceExcluded;
      warnings: TaxUploadWarning[];
    }
  | { ok: false; error: TaxUploadError };

/* ── 칸 읽기 — 카드 · 현금 변환(tax-card-cash.ts)도 쓴다 ─────────────────────── */

export const textOf = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
};

export const cell = (row: readonly unknown[] | undefined, colNo: number): unknown => (row ? row[colNo - 1] : undefined);

export const isBlankRow = (row: readonly unknown[] | undefined): boolean => !row || row.every((v) => textOf(v) === '');

/** 금액 — 숫자 칸이거나 숫자 · 쉼표 글자. 원 단위 정수만. */
export function amountOf(v: unknown): number | null {
  if (typeof v === 'number') return Number.isSafeInteger(v) ? v : null;
  const t = textOf(v).replace(/,/g, '');
  if (!/^-?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}

const pad = (n: number) => String(n).padStart(2, '0');
function isRealDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** 작성일 — `YYYY-MM-DD` · `YYYYMMDD` · `YYYY.MM.DD` 글자이거나 날짜 값. */
export function dateOf(v: unknown): string | null {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  }
  const m = /^(\d{4})[-./]?(\d{2})[-./]?(\d{2})$/.exec(textOf(v));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return isRealDate(y, mo, d) ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** 그 줄에서 이름표 칸 오른쪽의 첫 값(숫자만). 없으면 null. */
function labeledDigits(row: readonly unknown[] | undefined, label: string): string | null {
  if (!row) return null;
  const at = row.findIndex((v) => textOf(v) === label);
  if (at < 0) return null;
  for (let i = at + 1; i < row.length; i++) {
    const t = textOf(row[i]);
    if (t !== '') return digitsOnly(t);
  }
  return null;
}

/* ── 변환 ────────────────────────────────────────────────────────────────── */

/**
 * 제목 줄 확인 → 자료 줄. 제목 줄은 이름 전체가 똑같아야 한다(앞뒤 공백 걷고). 뒤쪽 빈 칸은 엑셀이 붙이기도 하므로 걷는다.
 * 자료 줄은 제목 줄 아래, 빈 줄은 뺀다. 카드 · 현금 변환도 쓴다.
 */
export function readDataRows(
  sheetRows: readonly (readonly unknown[])[],
  headerRow: number,
  headerSignature: readonly string[],
): { ok: true; data: (readonly unknown[])[] } | { ok: false; error: TaxUploadError } {
  const fail = (code: TaxUploadErrorCode, message: string) => ({ ok: false as const, error: { code, message } });
  const header = [...(sheetRows[headerRow - 1] ?? [])].map(textOf);
  while (header.length > 0 && header[header.length - 1] === '') header.pop();
  const want = headerSignature.map((s) => s.trim());
  if (header.length !== want.length || header.some((h, i) => h !== want[i])) {
    return fail('format_mismatch', '양식이 맞지 않습니다');
  }
  const data = sheetRows.slice(headerRow).filter((r) => !isBlankRow(r));
  if (data.length > TAX_UPLOAD_MAX_ROWS) {
    return fail('too_many_rows', `한 파일은 ${TAX_UPLOAD_MAX_ROWS.toLocaleString('ko-KR')}줄까지 올릴 수 있습니다`);
  }
  if (data.length === 0) return fail('no_rows', '올릴 줄이 없습니다');
  return { ok: true, data };
}

/**
 * 시트 행(1줄 = 배열, 0번 = 엑셀 1줄) → 표준 양식.
 * `dbOwnBizNo` 는 DB 의 우리 회사 사업자번호(숫자만, 없으면 null).
 */
export function convertInvoiceSheet(
  sheetRows: readonly (readonly unknown[])[],
  map: InvoiceImportMap,
  dbOwnBizNo: string | null,
): InvoiceConverted {
  const fail = (code: TaxUploadErrorCode, message: string): InvoiceConverted => ({ ok: false, error: { code, message } });
  const c = map.columns;

  // 1 · 2. 제목 줄 · 자료 줄
  const read = readDataRows(sheetRows, map.headerRow, map.headerSignature);
  if (!read.ok) return read;
  const data = read.data;

  // 3. 우리 회사 번호 — 파일 1줄의 이름표 오른쪽
  const ownBizNo = labeledDigits(sheetRows[c.ownBizNo.row - 1], c.ownBizNo.label);
  if (!ownBizNo || !isBizNumberLength(ownBizNo)) {
    return fail('own_biz_no_missing', '파일에서 우리 회사 사업자번호를 찾지 못했습니다');
  }
  const warnings: TaxUploadWarning[] = [];
  if (dbOwnBizNo) {
    if (digitsOnly(dbOwnBizNo) !== ownBizNo) {
      return fail('own_biz_no_mismatch', '파일의 사업자번호가 우리 회사 사업자번호와 다릅니다');
    }
  } else {
    warnings.push({
      code: 'own_biz_no_unchecked',
      message: `우리 회사 사업자번호가 등록되어 있지 않아 파일의 번호(${formatBizNumber(ownBizNo)})로 매입 · 매출을 정했습니다`,
    });
  }

  // 4. 매입 · 매출 — 우리 번호가 모든 줄에서 같은 쪽에 있어야 한다
  const sideOf = (row: readonly unknown[]): 'S' | 'P' | null => {
    if (digitsOnly(textOf(cell(row, c.supplier.bizNo))) === ownBizNo) return TAX_INV_DIR_SALES;
    if (digitsOnly(textOf(cell(row, c.buyer.bizNo))) === ownBizNo) return TAX_INV_DIR_PURCHASE;
    return null;
  };
  const sides = new Set(data.map(sideOf));
  if (sides.size !== 1 || sides.has(null)) {
    return fail('direction_unknown', '파일의 줄이 우리 회사의 매입인지 매출인지 정할 수 없습니다');
  }
  const direction = [...sides][0] as TaxInvDir;
  const partner = direction === TAX_INV_DIR_SALES ? c.buyer : c.supplier;

  // 5. 줄마다 — 넣지 않는 줄은 종류별로 센다
  const excluded: InvoiceExcluded = {
    nonGeneral: 0, noBizNo: 0, badAmount: 0, noApproval: 0, dupInFile: 0, otherClass: 0, badDate: 0,
  };
  const rows: InvoiceStdRow[] = [];
  const seen = new Set<string>();
  let badChecksum = 0;
  for (const row of data) {
    const approvalNo = textOf(cell(row, c.approvalNo));
    if (approvalNo === '') { excluded.noApproval++; continue; }
    const invClass = c.invClass.values[textOf(cell(row, c.invClass.col))];
    if (invClass === undefined) { excluded.otherClass++; continue; }
    const invType = c.invType.values[textOf(cell(row, c.invType.col))];
    if (invType === undefined) { excluded.nonGeneral++; continue; }
    const partnerBizNo = digitsOnly(textOf(cell(row, partner.bizNo)));
    if (!isBizNumberLength(partnerBizNo)) { excluded.noBizNo++; continue; }
    const writeDate = dateOf(cell(row, c.writeDate));
    if (!writeDate) { excluded.badDate++; continue; }
    const totalAmount = amountOf(cell(row, c.totalAmount));
    const supplyAmount = amountOf(cell(row, c.supplyAmount));
    const taxAmount = amountOf(cell(row, c.taxAmount));
    if (totalAmount === null || supplyAmount === null || taxAmount === null) { excluded.badAmount++; continue; }
    if (seen.has(approvalNo)) { excluded.dupInFile++; continue; }
    seen.add(approvalNo);
    if (!isBizNumberChecksumOk(partnerBizNo)) badChecksum++;
    rows.push({
      writeDate,
      approvalNo,
      partnerName: textOf(cell(row, partner.name)),
      partnerBizNo,
      supplyAmount,
      taxAmount,
      totalAmount,
      invClass,
      invType,
    });
  }
  if (badChecksum > 0) {
    warnings.push({
      code: 'partner_biz_no_checksum',
      message: `거래처 사업자번호 끝자리가 맞지 않는 줄이 ${badChecksum}줄 있습니다 — 그대로 넣습니다`,
      count: badChecksum,
    });
  }
  return { ok: true, direction, ownBizNo, totalRows: data.length, rows, excluded, warnings };
}

/** 파일 앞 바이트로 형식을 본다 — xls(복합 문서 D0 CF 11 E0) · xlsx(zip PK 03 04). */
export function detectSpreadsheetFormat(bytes: Uint8Array): 'xls' | 'xlsx' | null {
  const at = (i: number) => bytes[i];
  if (bytes.length >= 8 && at(0) === 0xd0 && at(1) === 0xcf && at(2) === 0x11 && at(3) === 0xe0) return 'xls';
  if (bytes.length >= 4 && at(0) === 0x50 && at(1) === 0x4b && at(2) === 0x03 && at(3) === 0x04) return 'xlsx';
  return null;
}

/* ── 작업할 달 — 주소 `?month=` 로 세무 화면끼리 잇는다(결정 2026-10-26) ── */

/** 그 날의 달(`YYYY-MM`, 기기 시각). */
export const thisMonthOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

/** 달 더하기 · 빼기. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}

/** 지난달 — 작업할 달의 처음 값(결과서 0-2). */
export const previousMonthOf = (d: Date): string => addMonths(thisMonthOf(d), -1);

/** 주소의 달 — 없거나 틀리거나 이번 달보다 뒤면 지난달. */
export function workMonthOf(raw: unknown, today: Date): string {
  const m = parseMonth(raw);
  return m && m <= thisMonthOf(today) ? m : previousMonthOf(today);
}

/**
 * 이름 뒤 「로 / 으로」 — 코드 이름(주거래처 · 일반)을 버튼 · 토스트 문구에 붙일 때. 받침이 없거나 ㄹ 이면 「로」.
 * 한글이 아닌 글자로 끝나면 「(으)로」.
 */
export function withRo(name: string): string {
  const code = name.charCodeAt(name.length - 1) - 0xac00;
  if (Number.isNaN(code) || code < 0 || code > 11171) return `${name}(으)로`;
  const jong = code % 28;
  return jong === 0 || jong === 8 ? `${name}로` : `${name}으로`;
}

/** 줄의 달(`YYYY-MM`). */
export const monthOfDate = (date: string): string => date.slice(0, 7);

/** 미리보기 앞 줄 수. */
export const previewSample = (rows: readonly InvoiceStdRow[]): InvoiceStdRow[] => rows.slice(0, PREVIEW_SAMPLE_ROWS);

/** 달별 줄 수 — 달 순서. */
export function countByMonth(rows: readonly InvoiceStdRow[]): { month: string; count: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(monthOfDate(r.writeDate), (m.get(monthOfDate(r.writeDate)) ?? 0) + 1);
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, count]) => ({ month, count }));
}

/* ── 본문 검사 ───────────────────────────────────────────────────────────── */

export interface TaxFieldError {
  field: string;
  message: string;
}
export interface TaxFieldWarning {
  field: string;
  code: 'checksum';
  message: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `?month=` — `YYYY-MM` 만. */
export function parseMonth(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = /^(\d{4})-(\d{2})$/.exec(raw);
  if (!m) return null;
  const mo = Number(m[2]);
  return mo >= 1 && mo <= 12 ? raw : null;
}

/** 본문 id 목록 — 글자만, 겹치면 하나로. 비었거나 모양이 틀리면 null. */
function idsOf(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  if (!raw.every((v) => typeof v === 'string' && v.trim() !== '')) return null;
  return [...new Set((raw as string[]).map((v) => v.trim()))];
}

export interface VendorEdit {
  /** null = 원래 이름 유지(시안: 비우면 원래 이름). */
  name: string | null;
  /** 없음(undefined) = 그대로 · null = 번호 없음 · 숫자 10자리. */
  bizNo?: string | null;
}

export type VendorEditParsed =
  | { ok: true; value: VendorEdit; warnings: TaxFieldWarning[] }
  | { ok: false; errors: TaxFieldError[] };

/** 거래처 고치기 — 이름 · 사업자번호. 번호는 숫자만 저장하고, 끝자리 틀림은 경고만(결정 3). */
export function parseVendorEdit(raw: unknown): VendorEditParsed {
  if (!isObj(raw)) return { ok: false, errors: [{ field: 'body', message: '본문 형식이 올바르지 않습니다' }] };
  const errors: TaxFieldError[] = [];
  const warnings: TaxFieldWarning[] = [];

  let name: string | null = null;
  if (raw.name !== undefined && raw.name !== null) {
    if (typeof raw.name !== 'string') errors.push({ field: 'name', message: '거래처명 형식이 올바르지 않습니다' });
    else if (raw.name.trim().length > VENDOR_NAME_MAX) {
      errors.push({ field: 'name', message: `거래처명은 ${VENDOR_NAME_MAX}자 이내입니다` });
    } else name = raw.name.trim() === '' ? null : raw.name.trim();
  }

  // 칸을 안 보내면 번호는 그대로 — 지우려면 빈 글자 · null 을 보낸다
  let bizNo: string | null | undefined;
  if (raw.bizNo === null) bizNo = null;
  else if (raw.bizNo !== undefined) {
    if (typeof raw.bizNo !== 'string' || !/^[0-9\-\s]*$/.test(raw.bizNo)) {
      errors.push({ field: 'bizNo', message: '사업자번호가 맞지 않습니다 — 000-00-00000 모양입니다' });
    } else {
      const d = digitsOnly(raw.bizNo);
      if (d === '') bizNo = null;
      else if (!isBizNumberLength(d)) {
        errors.push({ field: 'bizNo', message: '사업자번호가 맞지 않습니다 — 000-00-00000 모양입니다' });
      } else {
        bizNo = d;
        if (!isBizNumberChecksumOk(d)) {
          warnings.push({ field: 'bizNo', code: 'checksum', message: '사업자번호 끝자리 검증 번호가 맞지 않습니다 — 그대로 저장합니다' });
        }
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: bizNo === undefined ? { name } : { name, bizNo }, warnings };
}

export type VendorTypeParsed = { ok: true; value: { ids: string[]; tp: string } } | { ok: false; errors: TaxFieldError[] };

/** 주거래처 / 일반 — 구분은 코드 표(TAX_VENDOR_TP)에 있는 값만. */
export function parseVendorType(raw: unknown, vendorTps: readonly string[]): VendorTypeParsed {
  if (!isObj(raw)) return { ok: false, errors: [{ field: 'body', message: '본문 형식이 올바르지 않습니다' }] };
  const errors: TaxFieldError[] = [];
  const ids = idsOf(raw.ids);
  if (!ids) errors.push({ field: 'ids', message: '거래처를 고르세요' });
  const tp = typeof raw.tp === 'string' && vendorTps.includes(raw.tp) ? raw.tp : null;
  if (!tp) errors.push({ field: 'tp', message: '구분이 올바르지 않습니다' });
  return ids && tp ? { ok: true, value: { ids, tp } } : { ok: false, errors };
}

export type VendorMergeParsed = { ok: true; value: { keepId: string; ids: string[] } } | { ok: false; errors: TaxFieldError[] };

/** 합치기 — 남길 곳(keepId) + 합칠 곳(ids, 하나 이상). 남길 곳은 합칠 곳에 없어야 한다. */
export function parseVendorMerge(raw: unknown): VendorMergeParsed {
  if (!isObj(raw)) return { ok: false, errors: [{ field: 'body', message: '본문 형식이 올바르지 않습니다' }] };
  const errors: TaxFieldError[] = [];
  const keepId = typeof raw.keepId === 'string' && raw.keepId.trim() !== '' ? raw.keepId.trim() : null;
  if (!keepId) errors.push({ field: 'keepId', message: '남길 거래처를 고르세요' });
  const ids = idsOf(raw.ids);
  if (!ids || (keepId !== null && ids.includes(keepId))) {
    errors.push({ field: 'ids', message: '합칠 거래처를 하나 이상 고르세요(남길 거래처 말고)' });
  }
  return keepId && ids && !ids.includes(keepId) ? { ok: true, value: { keepId, ids } } : { ok: false, errors };
}

export type VendorIdsParsed = { ok: true; value: string[] } | { ok: false; errors: TaxFieldError[] };

/** 거래처 지우기 `{ ids[] }`. */
export function parseVendorIds(raw: unknown): VendorIdsParsed {
  const ids = isObj(raw) ? idsOf(raw.ids) : null;
  return ids ? { ok: true, value: ids } : { ok: false, errors: [{ field: 'ids', message: '지울 거래처를 고르세요' }] };
}

export type FileIdsParsed = { ok: true; value: string[] } | { ok: false; errors: TaxFieldError[] };

/** 파일 지우기 `{ ids[] }`. */
export function parseFileIds(raw: unknown): FileIdsParsed {
  const ids = isObj(raw) ? idsOf(raw.ids) : null;
  return ids ? { ok: true, value: ids } : { ok: false, errors: [{ field: 'ids', message: '지울 파일을 고르세요' }] };
}

/* ── 이미 올린 줄이 어디 있는지 ──────────────────────────────────────────── */

/** 건너뛸 줄 묶음 — 그 줄 날짜의 달(YYYY-MM) · 이미 올린 파일 이름 · 줄 수. */
export interface TaxAlreadyWhere {
  month: string;
  fileName: string;
  count: number;
}

/** 건너뛸 줄(그 줄 날짜 · 이미 들어 있는 파일)을 달 · 파일마다 센다 — 달 순서, 같은 달은 처음 나온 파일 순서. */
export function summarizeAlreadyWhere(hits: readonly { date: string; fileName: string }[]): TaxAlreadyWhere[] {
  const by = new Map<string, TaxAlreadyWhere>();
  for (const h of hits) {
    const month = h.date.slice(0, 7);
    const k = JSON.stringify([month, h.fileName]);
    const got = by.get(k);
    if (got) got.count++;
    else by.set(k, { month, fileName: h.fileName, count: 1 });
  }
  return [...by.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/* ── 응답 모양 ───────────────────────────────────────────────────────────── */

export interface TaxCodeName {
  code: string;
  name: string;
}

export interface TaxUploadFileView {
  id: string;
  kind: string;
  /** 계산서 파일만 P · S — 카드 · 현금 파일은 null(208). */
  direction: string | null;
  fileName: string;
  /** 파일의 자료 줄 수. */
  rowCount: number;
  /** 새로 들어간 줄 수 — 나머지(row_count − inserted_count)는 건너뛰었거나 뺀 줄. */
  insertedCount: number;
  uploadedAt: string;
}

export interface TaxUploadKindCard {
  kind: string;
  /** 올릴 수 있는가(`TAX_UPLOADABLE_KINDS`) — 아니면 「준비 중」. */
  enabled: boolean;
  /** 세무 설정의 「쓰지 않는 자료」. */
  unused: boolean;
  /** 그 달에 줄이 들어간 파일 수. */
  fileCount: number;
}

export interface TaxUploadsResponse {
  month: string;
  /** 사업자 유형 이름(작업할 달 줄 오른쪽 안내) — 세무 설정을 아직 안 했으면 null. */
  bizTypeName: string | null;
  cards: TaxUploadKindCard[];
  files: TaxUploadFileView[];
  /** 자료 종류는 설명(카드 설명 — 코드 설명 칸, 비어 있으면 null)까지. */
  codes: { kinds: (TaxCodeName & { description: string | null })[]; invDirs: TaxCodeName[] };
}

/** 자료 종류마다 다른 부분 — 계산서는 매입/매출 · 계산서 줄, 카드 · 현금은 매입/매출 없이 그 줄. */
export type TaxUploadKindPart =
  | { kind: 'INVOICE'; direction: TaxInvDir; sample: InvoiceStdRow[]; excluded: InvoiceExcluded }
  | { kind: 'CARD'; direction: null; sample: CardStdRow[]; excluded: CardExcluded }
  | { kind: 'CASH'; direction: null; sample: CashStdRow[]; excluded: CashExcluded };

export type TaxUploadPreview = TaxUploadKindPart & {
  fileName: string;
  /** 같은 파일(지문)이 이미 있으면 그 파일 — 올리기는 409. */
  sameFile: { id: string; fileName: string; uploadedAt: string } | null;
  totalRows: number;
  /** 넣을 줄의 달별 수(이미 올린 줄은 뺀 뒤). */
  byMonth: { month: string; count: number }[];
  toInsert: number;
  /** 이미 올린 줄이라 건너뛸 줄 — 계산서는 승인번호, 카드 · 현금은 개수 맞추기. */
  alreadyUploaded: number;
  /** 건너뛸 줄이 어디 있는지 — 그 줄 날짜의 달 · 이미 올린 파일마다 한 줄(`summarizeAlreadyWhere`). 이 단체 것만. */
  alreadyWhere: TaxAlreadyWhere[];
  /** 뺀 줄 종류의 이름 — 코드 표(TAX_SKIP_REASON)에서 **이 자료의 `excluded` 키만**(코드값 = 키, 순서 = 코드 표). */
  skipReasons: TaxCodeName[];
  warnings: TaxUploadWarning[];
};

export interface TaxUploadResult {
  file: TaxUploadFileView;
  insertedCount: number;
  alreadyUploaded: number;
  excluded: InvoiceExcluded | CardExcluded | CashExcluded;
  vendorsCreated: number;
  vendorsPromoted: number;
  warnings: TaxUploadWarning[];
}

export interface TaxUploadDeleteResult {
  deletedFiles: number;
  deletedRows: number;
  /**
   * 지운 파일 **뒤에** 올린 파일 중 건너뛴 줄이 있는 것 — 그 파일과 겹쳐 함께 빠졌을 수 있다.
   * ★ 원본을 보관하지 않아(결정 10) 정확히 몇 줄이 겹쳤는지는 알 수 없다. 건너뛴 줄 수는 위쪽 한계다.
   */
  laterFilesWithSkips: { id: string; fileName: string; skippedRows: number }[];
}

export interface TaxVendorView {
  id: string;
  name: string;
  bizNo: string | null;
  vendorTp: string;
  tpSetByUser: boolean;
  firstKind: string;
  firstDirection: string | null;
  /** 작업할 달의 계산서 줄 수. */
  monthCount: number;
  /** 모든 달의 계산서 줄 수 — 합치기 창의 건수. */
  totalCount: number;
}

export interface TaxVendorsResponse {
  month: string;
  vendors: TaxVendorView[];
  /** 같은 사업자번호 거래처 묶음(id 목록, 먼저 생긴 순). */
  sameBizNoGroups: string[][];
  codes: { vendorTps: TaxCodeName[]; kinds: TaxCodeName[]; invDirs: TaxCodeName[] };
}
