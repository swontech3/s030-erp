/**
 * 세무(S05) 자료 올리기 — 은행 거래내역 · 이체 내역 표준 양식 변환 · 이체 짝 짓기 (1-5, 2026-11-01).
 *
 * 표는 212 의 `tb_s050_bank_txns`, 대응표는 213 의 네 줄(국민 · 우리 · 하나 거래내역 · 우리 이체 결과)이다.
 *
 * ★ 결정(2026-11-01 대표):
 *   - 올릴 때 세무 설정의 은행 계좌를 고른다 → 그 계좌의 은행 대응표로 바꾼다(기관을 따로 고르지 않는다)
 *   - 파일 속 계좌번호가 고른 계좌와 다르면 막는다. 파일에 계좌번호가 없으면(하나) 경고하고 받는다
 *   - 은행 파일에는 거래번호가 없다 → 중복은 「개수 맞추기」(tax-card-cash `pickNewByCount`). 열쇠 = 거래일시 · 입금 · 출금 · 잔액
 *     (계좌는 고른 계좌 하나라 DB 쪽에서 거른다)
 *   - 이체 내역은 따로 저장하지 않는다 — 거래내역의 **출금 줄**에 받는 은행 · 받는 계좌 끝 4자리 · 받는분 · 메모 둘을 덧붙인다
 *   - ★★ 받는 계좌번호는 **끝 4자리만** — 변환 결과 · 응답 · 로그 어디에도 전체 번호를 싣지 않는다
 *   - 짝: 같은 계좌 · 이체금액 = 출금액 · 시각 차 ±60초 · 가장 가까운 줄 하나(둘이면 덧붙이지 않음). 수수료 · 이체일시는 저장하지 않는다
 *   - 고른 계좌가 아닌 출금계좌 줄은 그 줄만 뺀다 · 짝 못 찾은 이체 줄은 경고만(보관하지 않음)
 * ★ 합계 줄 — 대응표에 적지 않는다. 「마지막 줄이고 No 칸이 숫자가 아님」이면 조용히 뺀다(우리 「총 N건」 · 하나 「합 계」).
 *   그 밖의 줄은 No 칸과 상관없이 똑같이 읽는다(날짜가 아니면 badDate 로 센다).
 * ★ 하나 파일은 빈 칸을 글자 「null」로 적기도 한다 — 글자 칸에서 빈 칸으로 본다. 빈 금액 칸은 0.
 */
import { digitsOnly } from './tax-number.ts';
import {
  amountOf,
  cell,
  readDataRows,
  textOf,
  type TaxFieldError,
  type TaxUploadError,
  type TaxUploadWarning,
} from './tax-uploads.ts';

export const TAX_KIND_BANK = 'BANK';
/** 은행 파일 종류(213) — ★ 고정 코드. 212 CHECK 가 TXN · XFER 에 기댄다. */
export const TAX_BANK_FILE_CATEGORY = 'TAX_BANK_FILE';
export const TAX_BANK_FILE_TXN = 'TXN';
export const TAX_BANK_FILE_XFER = 'XFER';
export type TaxBankFileTp = typeof TAX_BANK_FILE_TXN | typeof TAX_BANK_FILE_XFER;
export const TAX_BANK_FILE_TPS: readonly TaxBankFileTp[] = [TAX_BANK_FILE_TXN, TAX_BANK_FILE_XFER];
/** 이체 ↔ 출금 허용 시각 차(초) — 대표 결정 11. */
export const XFER_MATCH_SECONDS = 60;

const TEXT_MAX = 200;
const XFER_BANK_MAX = 50;
const XFER_TEXT_MAX = 100;

/* ── 대응표 ──────────────────────────────────────────────────────────────── */

export interface BankAccountNoAt {
  row: number;
  label: string;
  /** 이 글자 앞까지가 번호(우리 「… 예금주 : …」). 없으면 null. */
  stopAt: string | null;
}

export interface BankTxnMapColumns {
  seq: number;
  txnAt: number;
  description: number;
  counterparty: number;
  /** 내 통장 표시 — 국민만. 없으면 null. */
  myNote: number | null;
  memo: number;
  inAmount: number;
  outAmount: number;
  balance: number;
  /** 파일 머리의 계좌번호 자리 — 없으면 null(하나). */
  accountNo: BankAccountNoAt | null;
}

export interface BankXferMapColumns {
  seq: number;
  xferAt: number;
  fromAccount: number;
  toBank: number;
  toAccount: number;
  amount: number;
  holder: number;
  toMemo: number;
  fromMemo: number;
  /** 그 칸 글자가 values 중 하나여야 넣는다(아니면 xferNotDone). */
  done: { col: number; values: readonly string[] };
}

interface BankImportMapOf<C, T extends TaxBankFileTp> {
  id: string;
  kind: string;
  bankCode: string;
  bankFileTp: T;
  headerRow: number;
  headerSignature: readonly string[];
  columns: C;
}
export type BankTxnImportMap = BankImportMapOf<BankTxnMapColumns, typeof TAX_BANK_FILE_TXN>;
export type BankXferImportMap = BankImportMapOf<BankXferMapColumns, typeof TAX_BANK_FILE_XFER>;

/* ── 변환 결과 ───────────────────────────────────────────────────────────── */

export interface BankTxnStdRow {
  /** `YYYY-MM-DD HH:MM:SS` — 파일에 적힌 은행 시각 그대로(시간대 없음). */
  txnAt: string;
  description: string | null;
  counterparty: string | null;
  myNote: string | null;
  memo: string | null;
  inAmount: number;
  outAmount: number;
  balance: number;
}

/** 넣지 않은 거래내역 줄 — 키 = 코드 TAX_SKIP_REASON 코드값(205 · 209 · 213). */
export interface BankTxnExcluded {
  badDate: number;
  badAmount: number;
  noAmount: number;
  bothInOut: number;
  noBalance: number;
}

export interface BankXferStdRow {
  /** `YYYY-MM-DD HH:MM:SS` — 짝 찾기에만 쓴다(저장하지 않음). */
  xferAt: string;
  amount: number;
  toBank: string;
  /** 받는 계좌번호 끝 4자리(숫자). ★ 전체 번호는 없다. */
  toAccountLast4: string;
  holder: string;
  toMemo: string | null;
  fromMemo: string | null;
}

/** 넣지 않은 이체 줄 — 키 = 코드 TAX_SKIP_REASON 코드값(205 · 209 · 213). */
export interface BankXferExcluded {
  badDate: number;
  badAmount: number;
  noAmount: number;
  xferNotDone: number;
  otherAccount: number;
  noToAccount: number;
}

type Converted<R, E> =
  | { ok: true; totalRows: number; rows: R[]; excluded: E; warnings: TaxUploadWarning[] }
  | { ok: false; error: TaxUploadError };
export type BankTxnConverted = Converted<BankTxnStdRow, BankTxnExcluded>;
export type BankXferConverted = Converted<BankXferStdRow, BankXferExcluded>;

/* ── 칸 읽기 ─────────────────────────────────────────────────────────────── */

/** 글자 칸 — 빈 칸 · 글자 「null」은 null, 길면 자른다. */
function bankText(v: unknown, max: number): string | null {
  const t = textOf(v);
  return t === '' || t.toLowerCase() === 'null' ? null : t.slice(0, max);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 거래일시 — `YYYY.MM.DD hh:mm:ss` · `YYYY-MM-DD hh:mm:ss`(초는 없어도 됨) 글자이거나 날짜 값(UTC 로 읽은 것). */
export function dateTimeOf(v: unknown): string | null {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())} ` +
      `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}`;
  }
  const m = /^(\d{4})[-./](\d{2})[-./](\d{2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(textOf(v));
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? '00'].map(Number) as [number, number, number, number, number, number];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  if (h > 23 || mi > 59 || s > 59) return null;
  return `${m[1]}-${m[2]}-${m[3]} ${pad(h)}:${pad(mi)}:${pad(s)}`;
}

const secondsOf = (at: string): number => Date.parse(`${at.replace(' ', 'T')}Z`) / 1000;

/** 금액 — 빈 칸은 0, 글자 · 소수는 null. */
function moneyOf(v: unknown): number | null {
  return textOf(v) === '' ? 0 : amountOf(v);
}

/** 마지막 줄이 합계 줄(No 칸이 숫자가 아님)이면 뺀다. */
function dropFooter(data: (readonly unknown[])[], seqCol: number): (readonly unknown[])[] {
  const last = data[data.length - 1];
  return last && typeof cell(last, seqCol) !== 'number' ? data.slice(0, -1) : data;
}

/** 파일 머리의 계좌번호(숫자만) — 그 줄에서 이름표로 시작하는 칸의 「:」 뒤, stopAt 앞까지. 못 찾으면 null. */
function fileAccountNo(sheetRows: readonly (readonly unknown[])[], at: BankAccountNoAt): string | null {
  const row = sheetRows[at.row - 1] ?? [];
  const t = row.map(textOf).find((x) => x.startsWith(at.label));
  if (t === undefined) return null;
  let rest = t.slice(at.label.length);
  if (at.stopAt !== null && rest.includes(at.stopAt)) rest = rest.slice(0, rest.indexOf(at.stopAt));
  const d = digitsOnly(rest);
  return d === '' ? null : d;
}

const UNCHECKED: TaxUploadWarning = {
  code: 'bank_account_unchecked',
  message: '파일에 계좌번호가 없어 고른 계좌의 파일인지 확인하지 못했습니다 — 그대로 넣습니다',
};

/* ── 거래내역 ────────────────────────────────────────────────────────────── */

/** 은행 거래내역 → 표준 양식. `accountNo` = 고른 세무 설정 계좌번호(숫자만). */
export function convertBankTxnSheet(
  sheetRows: readonly (readonly unknown[])[],
  map: BankTxnImportMap,
  accountNo: string,
): BankTxnConverted {
  const read = readDataRows(sheetRows, map.headerRow, map.headerSignature);
  if (!read.ok) return read;
  const c = map.columns;
  const warnings: TaxUploadWarning[] = [];
  const inFile = c.accountNo ? fileAccountNo(sheetRows, c.accountNo) : null;
  if (inFile === null) warnings.push(UNCHECKED);
  else if (inFile !== digitsOnly(accountNo)) {
    return { ok: false, error: { code: 'account_mismatch', message: '파일의 계좌번호가 고른 계좌와 다릅니다' } };
  }

  const data = dropFooter(read.data, c.seq);
  if (data.length === 0) return { ok: false, error: { code: 'no_rows', message: '올릴 줄이 없습니다' } };
  const excluded: BankTxnExcluded = { badDate: 0, badAmount: 0, noAmount: 0, bothInOut: 0, noBalance: 0 };
  const rows: BankTxnStdRow[] = [];
  for (const row of data) {
    const txnAt = dateTimeOf(cell(row, c.txnAt));
    if (!txnAt) { excluded.badDate++; continue; }
    const inAmount = moneyOf(cell(row, c.inAmount));
    const outAmount = moneyOf(cell(row, c.outAmount));
    if (inAmount === null || outAmount === null || inAmount < 0 || outAmount < 0) { excluded.badAmount++; continue; }
    if (inAmount === 0 && outAmount === 0) { excluded.noAmount++; continue; }
    if (inAmount > 0 && outAmount > 0) { excluded.bothInOut++; continue; }
    const balance = textOf(cell(row, c.balance)) === '' ? null : amountOf(cell(row, c.balance));
    if (balance === null) { excluded.noBalance++; continue; }
    rows.push({
      txnAt,
      description: bankText(cell(row, c.description), TEXT_MAX),
      counterparty: bankText(cell(row, c.counterparty), TEXT_MAX),
      myNote: c.myNote === null ? null : bankText(cell(row, c.myNote), TEXT_MAX),
      memo: bankText(cell(row, c.memo), TEXT_MAX),
      inAmount,
      outAmount,
      balance,
    });
  }
  return { ok: true, totalRows: data.length, rows, excluded, warnings };
}

/** 거래내역 열쇠 — 거래일시 · 입금 · 출금 · 잔액(설계 3). 계좌는 DB 쪽이 고른 계좌로 거른다. */
export const bankTxnDedupKey = (r: Pick<BankTxnStdRow, 'txnAt' | 'inAmount' | 'outAmount' | 'balance'>): string =>
  JSON.stringify([r.txnAt, r.inAmount, r.outAmount, r.balance]);

/* ── 이체 내역 ───────────────────────────────────────────────────────────── */

/** 은행 이체 결과 → 이체 줄. 고른 계좌(`accountNo`)가 아닌 출금계좌 줄은 뺀다(otherAccount). */
export function convertBankXferSheet(
  sheetRows: readonly (readonly unknown[])[],
  map: BankXferImportMap,
  accountNo: string,
): BankXferConverted {
  const read = readDataRows(sheetRows, map.headerRow, map.headerSignature);
  if (!read.ok) return read;
  const c = map.columns;
  const data = dropFooter(read.data, c.seq);
  if (data.length === 0) return { ok: false, error: { code: 'no_rows', message: '올릴 줄이 없습니다' } };
  const mine = digitsOnly(accountNo);
  const excluded: BankXferExcluded = { badDate: 0, badAmount: 0, noAmount: 0, xferNotDone: 0, otherAccount: 0, noToAccount: 0 };
  const rows: BankXferStdRow[] = [];
  for (const row of data) {
    if (!c.done.values.includes(textOf(cell(row, c.done.col)))) { excluded.xferNotDone++; continue; }
    if (digitsOnly(textOf(cell(row, c.fromAccount))) !== mine) { excluded.otherAccount++; continue; }
    const xferAt = dateTimeOf(cell(row, c.xferAt));
    if (!xferAt) { excluded.badDate++; continue; }
    if (textOf(cell(row, c.amount)) === '') { excluded.noAmount++; continue; }
    const amount = amountOf(cell(row, c.amount));
    if (amount === null || amount <= 0) { excluded.badAmount++; continue; }
    const toBank = bankText(cell(row, c.toBank), XFER_BANK_MAX);
    const toDigits = digitsOnly(textOf(cell(row, c.toAccount)));
    const holder = bankText(cell(row, c.holder), XFER_TEXT_MAX);
    if (toBank === null || toDigits.length < 4 || holder === null) { excluded.noToAccount++; continue; }
    rows.push({
      xferAt,
      amount,
      toBank,
      toAccountLast4: toDigits.slice(-4),
      holder,
      toMemo: bankText(cell(row, c.toMemo), XFER_TEXT_MAX),
      fromMemo: bankText(cell(row, c.fromMemo), XFER_TEXT_MAX),
    });
  }
  return { ok: true, totalRows: data.length, rows, excluded, warnings: [] };
}

/* ── 짝 짓기 ─────────────────────────────────────────────────────────────── */

/** 짝 후보 — 고른 계좌의 출금 줄. `attachedFile` = 이미 덧붙은 이체 파일 이름(없으면 null). */
export interface BankOutCandidate {
  id: string;
  txnAt: string;
  outAmount: number;
  attachedFile: string | null;
}

export type XferMatchStatus = 'match' | 'none' | 'ambiguous' | 'already';

export interface XferMatchResult {
  /** 덧붙일 짝 — `index` = 이체 줄 순번(넘긴 순서). */
  pairs: { index: number; xfer: BankXferStdRow; txnId: string }[];
  /** 이체 줄마다 상태 — 넘긴 순서 그대로(미리보기 표). */
  statuses: XferMatchStatus[];
  unmatched: number;
  ambiguous: number;
  /** 가장 가까운 출금 줄에 이미 이체가 덧붙어 있어 건너뛴 이체 줄 — 그 이체 파일 이름. */
  alreadyAttached: { xfer: BankXferStdRow; fileName: string }[];
}

/**
 * 이체 줄 ↔ 출금 줄. 이체 시각 순으로, 이체금액 = 출금액이고 시각 차가 ±60초 안인 출금 줄 중 **가장 가까운 줄 하나**.
 * 가장 가까운 줄이 둘 이상이면 덧붙이지 않는다(ambiguous). 그 줄에 이미 이체가 덧붙어 있으면 건너뛴다(already).
 * 한 출금 줄은 한 이체 줄과만 짝이 된다.
 */
export function matchTransfers(xfers: readonly BankXferStdRow[], outs: readonly BankOutCandidate[]): XferMatchResult {
  const statuses: XferMatchStatus[] = xfers.map(() => 'none');
  const pairs: XferMatchResult['pairs'] = [];
  const alreadyAttached: XferMatchResult['alreadyAttached'] = [];
  const used = new Set<string>();
  const order = xfers.map((x, i) => ({ x, i, t: secondsOf(x.xferAt) })).sort((a, b) => a.t - b.t || a.i - b.i);
  for (const { x, i, t } of order) {
    const near = outs
      .filter((o) => o.outAmount === x.amount && !used.has(o.id))
      .map((o) => ({ o, d: Math.abs(secondsOf(o.txnAt) - t) }))
      .filter((c) => c.d <= XFER_MATCH_SECONDS);
    if (near.length === 0) continue;
    const min = Math.min(...near.map((c) => c.d));
    const best = near.filter((c) => c.d === min);
    if (best.length > 1) { statuses[i] = 'ambiguous'; continue; }
    const o = best[0]!.o;
    if (o.attachedFile !== null) {
      statuses[i] = 'already';
      alreadyAttached.push({ xfer: x, fileName: o.attachedFile });
      continue;
    }
    used.add(o.id);
    statuses[i] = 'match';
    pairs.push({ index: i, xfer: x, txnId: o.id });
  }
  pairs.sort((a, b) => a.index - b.index);
  return {
    pairs,
    statuses,
    unmatched: statuses.filter((s) => s === 'none').length,
    ambiguous: statuses.filter((s) => s === 'ambiguous').length,
    alreadyAttached,
  };
}

/** 이체 경고 — 짝 못 찾음 · 짝을 정할 수 없음(보관하지 않음, 결정 13). */
export function xferWarnings(m: Pick<XferMatchResult, 'unmatched' | 'ambiguous'>): TaxUploadWarning[] {
  const w: TaxUploadWarning[] = [];
  if (m.unmatched > 0) {
    w.push({ code: 'xfer_unmatched', message: `짝을 찾지 못한 이체 ${m.unmatched}줄 — 덧붙이지 않습니다(보관하지 않음)`, count: m.unmatched });
  }
  if (m.ambiguous > 0) {
    w.push({ code: 'xfer_ambiguous', message: `같은 금액 · 같은 시각 차의 출금 줄이 여럿이라 짝을 정할 수 없는 이체 ${m.ambiguous}줄 — 덧붙이지 않습니다`, count: m.ambiguous });
  }
  return w;
}

/* ── 주소 ────────────────────────────────────────────────────────────────── */

export type BankUploadQueryParsed =
  | { ok: true; value: { accountId: string; fileTp: TaxBankFileTp } }
  | { ok: false; errors: TaxFieldError[] };

/** 은행 올리기 주소 `?account=<세무 설정 계좌 id>&fileTp=TXN|XFER` — 계좌가 그 단체 것인지는 api 가 DB 로 본다. */
export function parseBankUploadQuery(raw: { account?: unknown; fileTp?: unknown }): BankUploadQueryParsed {
  const errors: TaxFieldError[] = [];
  const accountId = typeof raw.account === 'string' && raw.account.trim() !== '' ? raw.account.trim() : null;
  if (!accountId) errors.push({ field: 'account', message: '계좌를 고르세요' });
  const fileTp = TAX_BANK_FILE_TPS.find((t) => t === raw.fileTp) ?? null;
  if (!fileTp) errors.push({ field: 'fileTp', message: '파일 종류를 고르세요(거래내역 · 이체 내역)' });
  return accountId && fileTp ? { ok: true, value: { accountId, fileTp } } : { ok: false, errors };
}
