/**
 * 세무(S05) 자료 올리기 — 카드 사용 내역 · 현금 경비 표준 양식 변환 (1-4, 2026-10-30).
 *
 * 표는 208 의 둘(`tb_s050_card_txns` · `tb_s050_cash_txns`), 대응표는 209 의 두 줄이다.
 *
 * ★ 결정(2026-10-30 대표):
 *   - 카드는 홈택스 「사업용 신용카드 사용내역」만 받는다(카드사 양식 없음). 1줄은 「총 사용금액」, 2줄이 제목 줄
 *   - ★★ 카드번호는 **끝 4자리만** 남긴다 — 변환 결과 · 응답 · 로그 어디에도 전체 번호를 싣지 않는다
 *   - 카드 공제 여부가 「공제 · 불공제」가 아니면 줄을 빼지 않고 공제 여부를 비워서 넣고 경고한다
 *   - 세무 설정에 없는 카드 끝 4자리 줄은 넣고 경고한다
 *   - 현금은 세무 표준 양식(1줄 제목, 안내는 「안내」 시트 — 210, 2026-10-31). 필수 = 날짜 · 구분 · 품명 · 금액 · 결제방법
 *   - 구분 · 항목 · 결제방법 · 증빙은 **코드 표 이름**으로 코드값을 찾는다(대응표에 바꾸기표 없음, 결정 18).
 *     구분 = TAX_INV_DIR 이름(매입 · 매출). 구분 · 결제방법이 비었거나 목록에 없으면 뺀 줄
 *   - 날짜에 시각이 붙어도 받는다 — 날짜 부분만(현금만. 계산서 · 카드의 `dateOf` 는 그대로)
 *   - 목록에 없는 항목 · 증빙은 비워서 넣고 경고 · 매출 줄에 적힌 항목은 무시하고 경고(매출에는 항목이 없다)
 *   - 승인번호가 없어 중복은 「개수 맞추기」로 막는다 — 열쇠마다 파일 안 n개 · DB m개면 n−m개만 넣는다
 */
import { digitsOnly, isBizNumberLength } from './tax-number.ts';
import {
  TAX_INV_DIR_PURCHASE,
  TAX_INV_DIR_SALES,
  amountOf,
  cell,
  dateOf,
  readDataRows,
  textOf,
  type TaxCodeName,
  type TaxInvDir,
  type TaxUploadError,
  type TaxUploadWarning,
  type ValueMapColumn,
} from './tax-uploads.ts';

export const TAX_KIND_CARD = 'CARD';
export const TAX_KIND_CASH = 'CASH';
export const TAX_PAY_METHOD_CATEGORY = 'TAX_PAY_METHOD';
export const TAX_PROOF_CATEGORY = 'TAX_PROOF';
export const TAX_CARD_DEDUCT_CATEGORY = 'TAX_CARD_DEDUCT';
/** ★ 고정 — 계좌이체(직원 정산). 뒤 단계 은행 짝 맞추기가 이 값으로 직원 정산 줄을 찾는다(code-usage `PINNED_CODES`). */
export const TAX_PAY_METHOD_TRANSFER = 'TRANSFER';

/** 현금 경비 양식 안내(판단 15 · 210) — 양식 내려받기가 「안내」 시트에 한 줄씩 둔다. */
export const CASH_TEMPLATE_GUIDE: readonly string[] = [
  '회사 사업용 카드로 낸 것은 적지 않습니다(카드 사용 내역으로 올립니다).',
  '「현금 경비」 시트 1줄의 제목은 고치지 말고, 2줄부터 한 줄에 한 건씩 적습니다.',
  '날짜 · 구분 · 품명 · 금액 · 결제방법은 꼭 적습니다. 거래처 · 항목 · 증빙은 비워도 됩니다.',
  '구분 · 항목 · 결제방법 · 증빙은 목록에 있는 이름 그대로 적으세요(구분 목록 · 항목 목록 · 결제방법 목록 · 증빙 목록 시트).',
  '금액은 원 단위 숫자만 적습니다(0 보다 큰 정수).',
  '항목을 비우면 매출 · 매입 항목 지정에서 붙입니다. 매출 줄에는 항목을 붙이지 않습니다.',
];

/** 현금 경비 양식 파일 이름. */
export const CASH_TEMPLATE_FILE_NAME = '현금경비_양식.xlsx';

const NAME_MAX = 200;
const NOTE_MAX = 50;

/* ── 대응표 ──────────────────────────────────────────────────────────────── */

export interface CardMapColumns {
  useDate: number;
  cardNo: number;
  merchantBizNo: number;
  merchantName: number;
  supplyAmount: number;
  taxAmount: number;
  nontaxAmount: number;
  totalAmount: number;
  vatDeduct: ValueMapColumn;
  deductNote: number;
}

export interface CashMapColumns {
  useDate: number;
  direction: number;
  description: number;
  vendorName: number;
  item: number;
  amount: number;
  payMethod: number;
  proof: number;
}

interface ImportMapOf<C> {
  id: string;
  kind: string;
  headerRow: number;
  headerSignature: readonly string[];
  columns: C;
}
export type CardImportMap = ImportMapOf<CardMapColumns>;
export type CashImportMap = ImportMapOf<CashMapColumns>;

/* ── 변환 결과 ───────────────────────────────────────────────────────────── */

export interface CardStdRow {
  useDate: string;
  /** 카드번호 끝 4자리(숫자). ★ 전체 번호는 없다. */
  cardLast4: string;
  merchantName: string;
  /** 가맹점 사업자번호(숫자 10자리) — 아니면 null. */
  merchantBizNo: string | null;
  supplyAmount: number;
  taxAmount: number;
  nontaxAmount: number;
  totalAmount: number;
  /** 공제 여부 — TAX_CARD_DEDUCT 코드값(Y · N). 모르는 값이면 null. */
  vatDeduct: string | null;
  /** 비고(불공제 사유) — 파일 글 그대로, 없으면 null. */
  deductNote: string | null;
}

export interface CashStdRow {
  useDate: string;
  description: string;
  vendorName: string | null;
  /** P 매입 · S 매출(구분 칸 — TAX_INV_DIR 이름). */
  direction: TaxInvDir;
  amount: number;
  /** TAX_PAY_METHOD 코드값. */
  payMethod: string;
  /** TAX_PROOF 코드값 — 비었거나 목록에 없으면 null. */
  proof: string | null;
  /** TAX_ITEM_OUT 코드값 — 비었거나 목록에 없거나 매출 줄이면 null(미지정). */
  itemCode: string | null;
}

/** 넣지 않은 카드 줄 — 키 = 코드 TAX_SKIP_REASON 코드값(205 · 209). */
export interface CardExcluded {
  noCardNo: number;
  badDate: number;
  badAmount: number;
}

/** 넣지 않은 현금 줄 — 키 = 코드 TAX_SKIP_REASON 코드값(205 · 209). */
export interface CashExcluded {
  badDate: number;
  badDirection: number;
  noDescription: number;
  noAmount: number;
  badAmount: number;
  badPayMethod: number;
}

type Converted<R, E> =
  | { ok: true; totalRows: number; rows: R[]; excluded: E; warnings: TaxUploadWarning[] }
  | { ok: false; error: TaxUploadError };
export type CardConverted = Converted<CardStdRow, CardExcluded>;
export type CashConverted = Converted<CashStdRow, CashExcluded>;

/* ── 카드 ────────────────────────────────────────────────────────────────── */

/**
 * 홈택스 사업용 신용카드 사용내역 → 표준 양식.
 * `registeredLast4` = 세무 설정에 등록한 카드의 끝 4자리(「사용 안 함」 포함) — 없는 카드 줄은 넣고 경고.
 */
export function convertCardSheet(
  sheetRows: readonly (readonly unknown[])[],
  map: CardImportMap,
  registeredLast4: readonly string[],
): CardConverted {
  const read = readDataRows(sheetRows, map.headerRow, map.headerSignature);
  if (!read.ok) return read;
  const c = map.columns;
  const excluded: CardExcluded = { noCardNo: 0, badDate: 0, badAmount: 0 };
  const rows: CardStdRow[] = [];
  let deductUnknown = 0;
  for (const row of read.data) {
    // ★ 숫자만 걷어 끝 4자리 — 가려진 번호(****-****-****-1234)도 끝 4자리만 남는다
    const digits = digitsOnly(textOf(cell(row, c.cardNo)));
    if (digits.length < 4) { excluded.noCardNo++; continue; }
    const useDate = dateOf(cell(row, c.useDate));
    if (!useDate) { excluded.badDate++; continue; }
    const supplyAmount = amountOf(cell(row, c.supplyAmount));
    const taxAmount = amountOf(cell(row, c.taxAmount));
    const nontaxAmount = amountOf(cell(row, c.nontaxAmount));
    const totalAmount = amountOf(cell(row, c.totalAmount));
    if (supplyAmount === null || taxAmount === null || nontaxAmount === null || totalAmount === null) {
      excluded.badAmount++;
      continue;
    }
    const bizNo = digitsOnly(textOf(cell(row, c.merchantBizNo)));
    const vatDeduct = c.vatDeduct.values[textOf(cell(row, c.vatDeduct.col))] ?? null;
    if (vatDeduct === null) deductUnknown++;
    const note = textOf(cell(row, c.deductNote));
    rows.push({
      useDate,
      cardLast4: digits.slice(-4),
      merchantName: textOf(cell(row, c.merchantName)).slice(0, NAME_MAX),
      merchantBizNo: isBizNumberLength(bizNo) ? bizNo : null,
      supplyAmount,
      taxAmount,
      nontaxAmount,
      totalAmount,
      vatDeduct,
      deductNote: note === '' ? null : note.slice(0, NOTE_MAX),
    });
  }

  const warnings: TaxUploadWarning[] = [];
  if (deductUnknown > 0) {
    warnings.push({
      code: 'card_deduct_unknown',
      message: `공제 여부를 알 수 없는 줄 ${deductUnknown}줄 — 공제 여부를 비워 넣습니다`,
      count: deductUnknown,
    });
  }
  const unregistered = new Map<string, number>();
  for (const r of rows) {
    if (!registeredLast4.includes(r.cardLast4)) unregistered.set(r.cardLast4, (unregistered.get(r.cardLast4) ?? 0) + 1);
  }
  if (unregistered.size > 0) {
    const count = [...unregistered.values()].reduce((a, b) => a + b, 0);
    warnings.push({
      code: 'card_unregistered',
      message: `세무 설정에 없는 카드(끝 ${[...unregistered.keys()].join(' · ')}) ${count}줄 — 그대로 넣습니다`,
      count,
    });
  }
  return { ok: true, totalRows: read.data.length, rows, excluded, warnings };
}

/* ── 현금 ────────────────────────────────────────────────────────────────── */

export interface CashCodeNames {
  /** 구분(TAX_INV_DIR) — P 매입 · S 매출. */
  directions: readonly TaxCodeName[];
  /** 그 회사 사업자 유형 파티션의 켜진 출금 항목(TAX_ITEM_OUT) — 세무 설정 전이면 빈 목록. */
  items: readonly TaxCodeName[];
  payMethods: readonly TaxCodeName[];
  proofs: readonly TaxCodeName[];
}

const codeByName = (list: readonly TaxCodeName[], name: string): string | null =>
  list.find((x) => x.name.trim() === name)?.code ?? null;

/** 현금 날짜 — `dateOf` 에 더해 날짜 뒤에 시각이 붙은 글자(`2026-09-05 14:30` · `…T14:30:00`)도 받고 날짜 부분만 쓴다. */
function cashDateOf(v: unknown): string | null {
  if (v instanceof Date) return dateOf(v);
  const m = /^(\d{4}[-./]?\d{2}[-./]?\d{2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(textOf(v));
  if (!m) return null;
  if (m[2] !== undefined && (Number(m[2]) > 23 || Number(m[3]) > 59 || Number(m[4] ?? 0) > 59)) return null;
  return dateOf(m[1]);
}

/** 현금 경비 표준 양식 → 표준 줄. */
export function convertCashSheet(
  sheetRows: readonly (readonly unknown[])[],
  map: CashImportMap,
  names: CashCodeNames,
): CashConverted {
  const read = readDataRows(sheetRows, map.headerRow, map.headerSignature);
  if (!read.ok) return read;
  const c = map.columns;
  const excluded: CashExcluded = { badDate: 0, badDirection: 0, noDescription: 0, noAmount: 0, badAmount: 0, badPayMethod: 0 };
  const rows: CashStdRow[] = [];
  let itemUnknown = 0;
  let proofUnknown = 0;
  let salesItem = 0;
  for (const row of read.data) {
    const useDate = cashDateOf(cell(row, c.useDate));
    if (!useDate) { excluded.badDate++; continue; }
    const dirCode = codeByName(names.directions, textOf(cell(row, c.direction)));
    if (dirCode !== TAX_INV_DIR_PURCHASE && dirCode !== TAX_INV_DIR_SALES) { excluded.badDirection++; continue; }
    const direction: TaxInvDir = dirCode;
    const description = textOf(cell(row, c.description));
    if (description === '') { excluded.noDescription++; continue; }
    if (textOf(cell(row, c.amount)) === '') { excluded.noAmount++; continue; }
    const amount = amountOf(cell(row, c.amount));
    if (amount === null || amount <= 0) { excluded.badAmount++; continue; }
    const payMethod = codeByName(names.payMethods, textOf(cell(row, c.payMethod)));
    if (!payMethod) { excluded.badPayMethod++; continue; }

    const proofText = textOf(cell(row, c.proof));
    const proof = proofText === '' ? null : codeByName(names.proofs, proofText);
    if (proofText !== '' && !proof) proofUnknown++;

    const itemText = textOf(cell(row, c.item));
    let itemCode: string | null = null;
    if (itemText !== '') {
      if (direction === TAX_INV_DIR_SALES) salesItem++;
      else {
        itemCode = codeByName(names.items, itemText);
        if (!itemCode) itemUnknown++;
      }
    }
    const vendor = textOf(cell(row, c.vendorName));
    rows.push({
      useDate,
      description: description.slice(0, NAME_MAX),
      vendorName: vendor === '' ? null : vendor.slice(0, NAME_MAX),
      direction,
      amount,
      payMethod,
      proof,
      itemCode,
    });
  }

  const warnings: TaxUploadWarning[] = [];
  if (itemUnknown > 0) {
    warnings.push({ code: 'cash_item_unknown', message: `항목 목록에 없는 항목 ${itemUnknown}줄 — 항목을 비워 넣습니다(매출 · 매입 항목 지정에서 붙입니다)`, count: itemUnknown });
  }
  if (proofUnknown > 0) {
    warnings.push({ code: 'cash_proof_unknown', message: `증빙 목록에 없는 증빙 ${proofUnknown}줄 — 증빙을 비워 넣습니다`, count: proofUnknown });
  }
  if (salesItem > 0) {
    warnings.push({ code: 'cash_sales_item_ignored', message: `매출 줄에 적은 항목 ${salesItem}줄 — 매출에는 항목을 붙이지 않아 넣지 않습니다`, count: salesItem });
  }
  return { ok: true, totalRows: read.data.length, rows, excluded, warnings };
}

/* ── 개수 맞추기 ─────────────────────────────────────────────────────────── */

/** 카드 열쇠 — 끝 4자리 · 사용일 · 가맹점 사업자번호 · 합계(설계 4, 카드사 파일에도 있을 칸만). */
export const cardDedupKey = (r: CardStdRow): string =>
  JSON.stringify([r.cardLast4, r.useDate, r.merchantBizNo, r.totalAmount]);

/** 현금 열쇠 — 날짜 · 품명 · 거래처 · 매출/매입 · 금액 · 지급방법(설계 4 나). */
export const cashDedupKey = (r: CashStdRow): string =>
  JSON.stringify([r.useDate, r.description, r.vendorName, r.direction, r.amount, r.payMethod]);

/**
 * 열쇠마다 파일 안 n개 · DB(`existing`) m개면 **뒤쪽** n−m개만 넣는다. 겹친 파일(1~96 뒤 1~120)은 겹친 줄을 건너뛰고,
 * 같은 날 같은 가게 같은 금액 두 번은 두 줄 그대로 남는다. `already` = 건너뛴 줄 수.
 * `existing` 은 열쇠마다 DB 줄이 들어 있는 파일 이름(먼저 올린 줄부터) — 건너뛴 k번째 줄은 그 k번째 파일과 짝짓는다(`skipped`).
 */
export function pickNewByCount<T>(
  rows: readonly T[],
  keyOf: (r: T) => string,
  existing: ReadonlyMap<string, readonly string[]>,
): { newRows: T[]; already: number; skipped: { row: T; fileName: string }[] } {
  const used = new Map<string, number>();
  const newRows: T[] = [];
  const skipped: { row: T; fileName: string }[] = [];
  for (const r of rows) {
    const k = keyOf(r);
    const n = used.get(k) ?? 0;
    used.set(k, n + 1);
    const fileName = existing.get(k)?.[n];
    if (fileName === undefined) newRows.push(r);
    else skipped.push({ row: r, fileName });
  }
  return { newRows, already: skipped.length, skipped };
}

/** 사용일의 달별 줄 수 — 달 순서. */
export function countByUseMonth(rows: readonly { useDate: string }[]): { month: string; count: number }[] {
  const by = new Map<string, number>();
  for (const r of rows) by.set(r.useDate.slice(0, 7), (by.get(r.useDate.slice(0, 7)) ?? 0) + 1);
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, count]) => ({ month, count }));
}
