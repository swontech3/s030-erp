/**
 * 세무(S05) 자료 올리기 — 국세 · 지방세 납부 · 4대보험 고지 · 대출 거래 표준 양식 변환 (1-6, 2026-11-01).
 *
 * 표는 214 의 `tb_s050_tax_payments` · `tb_s050_social_ins` · `tb_s050_loan_txns`, 대응표는 215 의 여섯 줄이다.
 *
 * ★ 결정(2026-11-01 대표):
 *   - 국세 · 지방세: 세목은 파일 글자 그대로. 비용 여부는 저장하지 않고 코드 「비용이 아닌 세목」(TAX_TAX_NOEXP)의 **이름**과 견준다 —
 *     목록에 있으면 비용 아님, 없으면 비용. 목록에도 없고 그 단체에서 처음인 세목은 「처음 보는 세목」 경고(결정 19).
 *     국세는 납부세액과 가산금을 따로(15), 지방세는 납부방법을 저장(16). 같은 납부번호는 (단체, 종류)마다 하나(214 UNIQUE)
 *   - 4대보험: 파일 금액(고지 · 결정보험료) 그대로 — 직원 · 회사 나눔은 하지 않는다(7 · 8). 보수월액은 있는 보험만(9).
 *     고지 연월은 파일에 없어 올릴 때 고른다(10). 이름 저장 · 가입자 번호는 끝 4자리만(12).
 *     ★★ 3번째 칸(주민번호)은 읽지 않는다 — 대응표가 가리키는 칸만 읽는다. 건강 파일 한 줄에서 건강 · 장기요양 두 줄이 나온다
 *   - 대출: 이자 = 정상 + 연체 − 환출, 수수료 따로. 거래원금 > 0 이면 실행(D), 원금상환 · 이자가 있으면 상환(R) (13).
 *     대출번호는 파일 머리에서 읽어 끝 4자리만(14). 거래번호가 없어 중복은 「개수 맞추기」(tax-card-cash `pickNewByCount`)
 * ★ 날짜 · 금액이 틀린 줄은 205 · 209 의 badDate · badAmount · noAmount 로 센다. 새 뺀 줄 종류는 215 의 넷.
 */
import { digitsOnly } from './tax-number.ts';
import {
  amountOf,
  cell,
  dateOf,
  parseMonth,
  readDataRows,
  textOf,
  type TaxFieldError,
  type TaxUploadError,
  type TaxUploadWarning,
} from './tax-uploads.ts';

export const TAX_KIND_NTAX = 'NTAX';
export const TAX_KIND_LTAX = 'LTAX';
export const TAX_KIND_SOCIAL = 'SOCIAL';
export const TAX_KIND_LOAN = 'LOAN';
export type TaxPayKind = typeof TAX_KIND_NTAX | typeof TAX_KIND_LTAX;
export const TAX_PAY_KINDS: readonly TaxPayKind[] = [TAX_KIND_NTAX, TAX_KIND_LTAX];

/** 비용이 아닌 세목(215) — 코드 이름 = 파일의 세목 글자. 고정 코드가 아니다(이름으로 견준다). */
export const TAX_TAX_NOEXP_CATEGORY = 'TAX_TAX_NOEXP';
/** 4대보험 종류(215) — ★ 고정 코드. 214 CHECK 가 코드값에 기댄다. 순서 = 코드 표 순서. */
export const TAX_SOCIAL_INS_CATEGORY = 'TAX_SOCIAL_INS';
export const TAX_SOCIAL_INS_TPS = ['NP', 'HI', 'LTC', 'EI', 'IA'] as const;
/** 올릴 때 고르는 보험 종류 — 장기요양(LTC)은 건강(HI) 파일에서 나온다. */
export const TAX_SOCIAL_FILE_TPS: readonly string[] = ['NP', 'HI', 'EI', 'IA'];
/** 대출 거래 구분(215) — ★ 고정 코드. D 실행 · R 상환. */
export const TAX_LOAN_TP_CATEGORY = 'TAX_LOAN_TP';
export const TAX_LOAN_DRAW = 'D';
export const TAX_LOAN_REPAY = 'R';
export type TaxLoanTp = typeof TAX_LOAN_DRAW | typeof TAX_LOAN_REPAY;

const TAX_ITEM_MAX = 100;
const OFFICE_MAX = 100;
const PAY_NO_MAX = 40;
const PAY_METHOD_MAX = 50;
const NAME_MAX = 100;
const LOAN_TYPE_MAX = 50;

type Converted<R, E, X = object> =
  | ({ ok: true; totalRows: number; rows: R[]; excluded: E; warnings: TaxUploadWarning[] } & X)
  | { ok: false; error: TaxUploadError };

/** 글자 칸 — 빈 칸은 null, 길면 자른다. */
const textOrNull = (v: unknown, max: number): string | null => {
  const t = textOf(v);
  return t === '' ? null : t.slice(0, max);
};

/* ── 국세 · 지방세 ────────────────────────────────────────────────────────── */

export interface PayMapColumns {
  payDate: number;
  taxItem: number;
  amount: number;
  payNo: number;
  office: number;
  /** 가산금 — 국세만. 지방세는 null. */
  penalty: number | null;
  /** 귀속 연월 — 지방세 과세대상(「YYYY년 MM월 귀속분」). 국세는 null. */
  belongMonth: number | null;
  /** 납부방법 — 지방세만. */
  payMethod: number | null;
}

export interface PayImportMap {
  id: string;
  kind: string;
  headerRow: number;
  headerSignature: readonly string[];
  columns: PayMapColumns;
}

export interface PayStdRow {
  /** `YYYY-MM-DD`. */
  payDate: string;
  taxItem: string;
  payNo: string;
  amount: number;
  /** 국세 가산금(0 이상, 금액 이하) — 지방세는 null. */
  penalty: number | null;
  /** `YYYY-MM` — 못 읽으면 null. */
  belongMonth: string | null;
  office: string | null;
  payMethod: string | null;
}

/** 넣지 않은 납부 줄 — 키 = 코드 TAX_SKIP_REASON 코드값(205 · 209 · 215). */
export interface PayExcluded {
  badDate: number;
  badAmount: number;
  noAmount: number;
  noPayNo: number;
  dupPayNo: number;
}

export type PayConverted = Converted<PayStdRow, PayExcluded>;

/** 「2026년 09월 귀속분」 → `2026-09`. 못 읽으면 null. */
function belongMonthOf(v: unknown): string | null {
  const m = /^(\d{4})\s*년\s*(\d{1,2})\s*월/.exec(textOf(v));
  return m ? parseMonth(`${m[1]}-${m[2]!.padStart(2, '0')}`) : null;
}

/** 국세(홈택스) · 지방세(위택스) 납부내역 → 표준 양식. 파일 안에서 겹친 납부번호는 첫 줄만 넣는다. */
export function convertPaySheet(sheetRows: readonly (readonly unknown[])[], map: PayImportMap): PayConverted {
  const read = readDataRows(sheetRows, map.headerRow, map.headerSignature);
  if (!read.ok) return read;
  const c = map.columns;
  const excluded: PayExcluded = { badDate: 0, badAmount: 0, noAmount: 0, noPayNo: 0, dupPayNo: 0 };
  const rows: PayStdRow[] = [];
  const seen = new Set<string>();
  for (const row of read.data) {
    const payNo = textOrNull(cell(row, c.payNo), PAY_NO_MAX);
    if (payNo === null) { excluded.noPayNo++; continue; }
    const payDate = dateOf(cell(row, c.payDate));
    if (!payDate) { excluded.badDate++; continue; }
    if (textOf(cell(row, c.amount)) === '') { excluded.noAmount++; continue; }
    const amount = amountOf(cell(row, c.amount));
    if (amount === null || amount <= 0) { excluded.badAmount++; continue; }
    let penalty: number | null = null;
    if (c.penalty !== null) {
      penalty = textOf(cell(row, c.penalty)) === '' ? 0 : amountOf(cell(row, c.penalty));
      if (penalty === null || penalty < 0 || penalty > amount) { excluded.badAmount++; continue; }
    }
    if (seen.has(payNo)) { excluded.dupPayNo++; continue; }
    seen.add(payNo);
    rows.push({
      payDate,
      taxItem: textOf(cell(row, c.taxItem)).slice(0, TAX_ITEM_MAX),
      payNo,
      amount,
      penalty,
      belongMonth: c.belongMonth === null ? null : belongMonthOf(cell(row, c.belongMonth)),
      office: textOrNull(cell(row, c.office), OFFICE_MAX),
      payMethod: c.payMethod === null ? null : textOrNull(cell(row, c.payMethod), PAY_METHOD_MAX),
    });
  }
  return { ok: true, totalRows: read.data.length, rows, excluded, warnings: [] };
}

/** 비용인가 — 「비용이 아닌 세목」 이름 목록에 없으면 비용(명세 06). 앞뒤 공백은 걷는다. */
export function isExpenseTaxItem(taxItem: string, noExpNames: readonly string[]): boolean {
  const t = taxItem.trim();
  return !noExpNames.some((n) => n.trim() === t);
}

/** ★ 처음 보는 세목 — 목록에도 없고 이 단체 줄(`seen`)에도 없는 세목. 처음 나온 순서 · 한 번씩(결정 19). */
export function firstSeenTaxItems(taxItems: readonly string[], noExpNames: readonly string[], seen: readonly string[]): string[] {
  const known = new Set([...noExpNames, ...seen].map((n) => n.trim()));
  const out: string[] = [];
  for (const raw of taxItems) {
    const t = raw.trim();
    if (!known.has(t) && !out.includes(t)) out.push(t);
  }
  return out;
}

/** 처음 보는 세목 경고 — 비용으로 넣는다. */
export function taxItemWarnings(items: readonly string[]): TaxUploadWarning[] {
  if (items.length === 0) return [];
  return [{
    code: 'tax_item_new',
    message: `처음 보는 세목 ${items.length}가지(${items.join(' · ')}) — 비용으로 봅니다. 비용이 아니면 코드 관리 「비용이 아닌 세목」에 더하세요`,
    count: items.length,
  }];
}

/* ── 4대보험 ─────────────────────────────────────────────────────────────── */

export interface SocialMapColumns {
  seq: number;
  /** 그 보험의 가입자 번호 — 끝 4자리만 남긴다. */
  memberNo: number;
  name: number;
  /** 보수월액 — 국민연금 파일에는 없다(null). */
  payBase: number | null;
  /** { 고른 보험 종류: { 줄 보험 종류: 금액 칸 } } — 건강 HI 는 HI · LTC 두 줄. */
  lines: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

export interface SocialImportMap {
  id: string;
  kind: string;
  headerRow: number;
  headerSignature: readonly string[];
  /** 이 대응표가 받는 보험 종류(214 `social_ins_tps`). */
  socialInsTps: readonly string[];
  columns: SocialMapColumns;
}

export interface SocialStdRow {
  insTp: string;
  memberName: string;
  /** 가입자 번호 끝 4자리(숫자) — 4자리가 안 되면 null. ★ 전체 번호는 없다. */
  memberNoLast4: string | null;
  /** 파일 금액(원) — 정산 환급이면 0 아래일 수 있다. */
  noticeAmount: number;
  payBase: number | null;
}

/** 넣지 않은 4대보험 줄(사람 단위) — 키 = 코드 TAX_SKIP_REASON 코드값. */
export interface SocialExcluded {
  badAmount: number;
  noAmount: number;
  noMemberName: number;
}

/** `personCount` = 넣는 사람 수 — 올린 파일 기록의 「들어간 줄」(건강 파일은 한 사람이 두 줄이라 줄 수와 다르다). */
export type SocialConverted = Converted<SocialStdRow, SocialExcluded, { personCount: number }>;

/**
 * 통합징수포털 가입자별 고지 내역 → 4대보험 줄. `fileTp` = 올릴 때 고른 보험 종류(NP · HI · EI · IA).
 * ★ 대응표가 가리키는 칸만 읽는다 — 3번째 칸(주민번호)은 어디에도 적혀 있지 않아 손대지 않는다.
 * 한 사람의 금액 · 보수월액 중 하나라도 틀리면 그 사람의 줄을 모두 뺀다(totalRows = 파일의 사람 줄 수).
 */
export function convertSocialSheet(sheetRows: readonly (readonly unknown[])[], map: SocialImportMap, fileTp: string): SocialConverted {
  const read = readDataRows(sheetRows, map.headerRow, map.headerSignature);
  if (!read.ok) return read;
  const c = map.columns;
  const lines = map.socialInsTps.includes(fileTp) ? c.lines[fileTp] : undefined;
  if (!lines) return { ok: false, error: { code: 'format_mismatch', message: '고른 보험 종류의 파일이 아닙니다' } };
  const excluded: SocialExcluded = { badAmount: 0, noAmount: 0, noMemberName: 0 };
  const rows: SocialStdRow[] = [];
  let personCount = 0;
  person: for (const row of read.data) {
    const memberName = textOrNull(cell(row, c.name), NAME_MAX);
    if (memberName === null) { excluded.noMemberName++; continue; }
    let payBase: number | null = null;
    if (c.payBase !== null && textOf(cell(row, c.payBase)) !== '') {
      payBase = amountOf(cell(row, c.payBase));
      if (payBase === null || payBase < 0) { excluded.badAmount++; continue; }
    }
    const digits = digitsOnly(textOf(cell(row, c.memberNo)));
    const memberNoLast4 = digits.length >= 4 ? digits.slice(-4) : null;
    const mine: SocialStdRow[] = [];
    for (const [insTp, col] of Object.entries(lines)) {
      if (textOf(cell(row, col)) === '') { excluded.noAmount++; continue person; }
      const noticeAmount = amountOf(cell(row, col));
      if (noticeAmount === null) { excluded.badAmount++; continue person; }
      mine.push({ insTp, memberName, memberNoLast4, noticeAmount, payBase });
    }
    rows.push(...mine);
    personCount++;
  }
  return { ok: true, totalRows: read.data.length, rows, excluded, warnings: [], personCount };
}

/** 보험 종류별 줄 수 · 금액 — 코드 순서(NP · HI · LTC · EI · IA). 미리보기 · 은행 짝 맞추기의 합계(설계 5). */
export function socialTotals(rows: readonly Pick<SocialStdRow, 'insTp' | 'noticeAmount'>[]): { insTp: string; count: number; amount: number }[] {
  const order: readonly string[] = TAX_SOCIAL_INS_TPS;
  const by = new Map<string, { insTp: string; count: number; amount: number }>();
  for (const r of rows) {
    const got = by.get(r.insTp) ?? { insTp: r.insTp, count: 0, amount: 0 };
    got.count++;
    got.amount += r.noticeAmount;
    by.set(r.insTp, got);
  }
  return [...by.values()].sort((a, b) => order.indexOf(a.insTp) - order.indexOf(b.insTp));
}

export type SocialUploadQueryParsed =
  | { ok: true; value: { insTp: string; noticeMonth: string } }
  | { ok: false; errors: TaxFieldError[] };

/** 4대보험 올리기 주소 `?insTp=NP|HI|EI|IA&noticeMonth=YYYY-MM`. */
export function parseSocialUploadQuery(raw: { insTp?: unknown; noticeMonth?: unknown }): SocialUploadQueryParsed {
  const errors: TaxFieldError[] = [];
  const insTp = TAX_SOCIAL_FILE_TPS.find((t) => t === raw.insTp) ?? null;
  if (!insTp) errors.push({ field: 'insTp', message: '보험 종류를 고르세요(국민연금 · 건강보험 · 고용보험 · 산재보험)' });
  const noticeMonth = parseMonth(raw.noticeMonth);
  if (!noticeMonth) errors.push({ field: 'noticeMonth', message: '고지 연월을 고르세요' });
  return insTp && noticeMonth ? { ok: true, value: { insTp, noticeMonth } } : { ok: false, errors };
}

/* ── 대출 ────────────────────────────────────────────────────────────────── */

export interface LoanNoAt {
  row: number;
  label: string;
  stopAt: string | null;
}

export interface LoanMapColumns {
  seq: number;
  txnDate: number;
  /** 거래원금 — 0 보다 크면 실행. */
  drawAmount: number;
  balance: number;
  repayAmount: number;
  interest: number;
  lateInterest: number;
  refundInterest: number;
  fee: number;
  txnType: number;
  loanNo: LoanNoAt;
}

export interface LoanImportMap {
  id: string;
  kind: string;
  /** 대출 기관 — 코드 BANK. */
  bankCode: string;
  headerRow: number;
  headerSignature: readonly string[];
  columns: LoanMapColumns;
}

export interface LoanStdRow {
  /** `YYYY-MM-DD`. */
  txnDate: string;
  txnTp: TaxLoanTp;
  txnType: string | null;
  principal: number;
  interest: number;
  fee: number;
  balance: number;
}

/** 넣지 않은 대출 줄 — 키 = 코드 TAX_SKIP_REASON 코드값. */
export interface LoanExcluded {
  badDate: number;
  badAmount: number;
  noLoanAmount: number;
}

export type LoanConverted = Converted<LoanStdRow, LoanExcluded, { loanNoLast4: string }>;

/** 금액 — 빈 칸은 0, 글자 · 소수 · 음수는 null. */
function moneyOf(v: unknown): number | null {
  if (textOf(v) === '') return 0;
  const n = amountOf(v);
  return n === null || n < 0 ? null : n;
}

/** 파일 머리의 대출번호(숫자만) — 그 줄에서 이름표로 시작하는 칸의 뒤, stopAt 앞까지. 못 찾으면 null. */
function fileLoanNo(sheetRows: readonly (readonly unknown[])[], at: LoanNoAt): string | null {
  const t = (sheetRows[at.row - 1] ?? []).map(textOf).find((x) => x.startsWith(at.label));
  if (t === undefined) return null;
  let rest = t.slice(at.label.length);
  if (at.stopAt !== null && rest.includes(at.stopAt)) rest = rest.slice(0, rest.indexOf(at.stopAt));
  const d = digitsOnly(rest);
  return d.length >= 4 ? d : null;
}

/** 은행 대출거래내역 → 대출 줄. ★ 대출번호는 끝 4자리만 돌려준다. */
export function convertLoanSheet(sheetRows: readonly (readonly unknown[])[], map: LoanImportMap): LoanConverted {
  const read = readDataRows(sheetRows, map.headerRow, map.headerSignature);
  if (!read.ok) return read;
  const c = map.columns;
  const loanNo = fileLoanNo(sheetRows, c.loanNo);
  if (loanNo === null) return { ok: false, error: { code: 'no_loan_no', message: '파일에서 대출 계좌번호를 찾지 못했습니다' } };
  const excluded: LoanExcluded = { badDate: 0, badAmount: 0, noLoanAmount: 0 };
  const rows: LoanStdRow[] = [];
  for (const row of read.data) {
    const txnDate = dateOf(cell(row, c.txnDate));
    if (!txnDate) { excluded.badDate++; continue; }
    const [draw, repay, normal, late, refund, fee] =
      [c.drawAmount, c.repayAmount, c.interest, c.lateInterest, c.refundInterest, c.fee].map((col) => moneyOf(cell(row, col)));
    const balance = textOf(cell(row, c.balance)) === '' ? null : moneyOf(cell(row, c.balance));
    if ([draw, repay, normal, late, refund, fee, balance].some((n) => n === null)) { excluded.badAmount++; continue; }
    const interest = normal! + late! - refund!;
    const isDraw = draw! > 0;
    const principal = isDraw ? draw! : repay!;
    if (principal === 0 && interest === 0 && fee === 0) { excluded.noLoanAmount++; continue; }
    rows.push({
      txnDate,
      txnTp: isDraw ? TAX_LOAN_DRAW : TAX_LOAN_REPAY,
      txnType: textOrNull(cell(row, c.txnType), LOAN_TYPE_MAX),
      principal,
      interest,
      fee: fee!,
      balance: balance!,
    });
  }
  return { ok: true, totalRows: read.data.length, rows, excluded, warnings: [], loanNoLast4: loanNo.slice(-4) };
}

/** 대출 열쇠 — 거래일 · 구분 · 거래종류 · 원금 · 이자 · 수수료 · 잔액. 기관 · 대출번호 끝 4자리는 DB 쪽에서 거른다. */
export const loanDedupKey = (r: Pick<LoanStdRow, 'txnDate' | 'txnType' | 'principal' | 'interest' | 'fee' | 'balance'> & { txnTp: string }): string =>
  JSON.stringify([r.txnDate, r.txnTp, r.txnType, r.principal, r.interest, r.fee, r.balance]);
