/**
 * 세무(S05) 세금 · 4대보험 · 대출(s050300040) — 1-7 (2026-11-02). 1-6 에서 올린 자료를 **보기만** 한다.
 *
 * 표는 214 의 `tb_s050_tax_payments` · `tb_s050_social_ins` · `tb_s050_loan_txns`. DB 변경 없음.
 *
 * ★ 결정(2026-11-02 대표, 설계 보고 7번 답):
 *   ① 탭 넷 — 국세 · 지방세 · 4대보험 · 대출(탭 값 = 자료 종류 코드값 NTAX · LTAX · SOCIAL · LOAN)
 *   ② 4대보험 회사 · 직원 부담은 나누지 않는다 — 화면에 안내 한 줄만(직원 급여 단계에서)
 *   ③ 「처음 보는 세목」은 이 화면에서 빼고 「비용 / 비용 아님」만(코드 TAX_TAX_NOEXP 이름과 견준다, `isExpenseTaxItem`)
 *   ④ 엑셀 이름 국세납부_ · 지방세납부_ · 4대보험_ · 대출_ + YYYY-MM(직접 지정이면 YYYY-MM~YYYY-MM). 4대보험은 보험 종류별 합계 시트를 더한다
 *   ⑤ 대출 요약은 대출(은행 · 끝 4자리)별 실행 원금 · 상환 원금 · 이자 · 수수료 합계만 — 잔액은 거래 목록에서
 *   ⑥ 4대보험은 고지 연월로 거른다
 * ★ 자료 올리기 [보기]는 `?month=&file=` 로 온다 — 탭은 서버가 파일의 자료 종류로 정한다(`tabOfFileKind`).
 * ★ 주소 검사 · 기간 · 파일 이름 · 합계는 여기 한 곳 — 화면 목록 · 엑셀 · 검증이 같은 것을 쓴다.
 * ★ 2026-11-08 대표 수정 ⑥: 탭을 없애고 메뉴 셋으로 나눴다 — 세금 납부(s050300040 · /tax/payments) · 4대보험(s050300050 · /tax/social) ·
 *   대출내역(s050300060 · /tax/loans). 서버 계산 · 엑셀 시트 함수는 그대로 — 주소 tab 에 「세금 전체」(PAY = 국세 + 지방세)를 더하고,
 *   4대보험에 보험 거르기(ins — 건강보험은 장기요양 포함)를 더했다. 기간 직접 지정은 화면에서 없앴다(from · to 는 세무사 전달 서류가 쓴다).
 *   결정 ② 의 안내 한 줄(회사 · 직원 부담)은 지웠다.
 */
import { TAX_KIND_LOAN, TAX_KIND_LTAX, TAX_KIND_NTAX, TAX_KIND_SOCIAL, TAX_SOCIAL_FILE_TPS } from './tax-pay-social-loan.ts';
import { parseMonth, type TaxCodeName, type TaxFieldError } from './tax-uploads.ts';

export const PAYMENT_TABS = [TAX_KIND_NTAX, TAX_KIND_LTAX, TAX_KIND_SOCIAL, TAX_KIND_LOAN] as const;
export type PaymentTab = (typeof PAYMENT_TABS)[number];

/** 탭 이름(결정 ①) — 엑셀 시트 이름도 이것. */
export const PAYMENT_TAB_LABELS: Readonly<Record<PaymentTab, string>> = {
  NTAX: '국세',
  LTAX: '지방세',
  SOCIAL: '4대보험',
  LOAN: '대출',
};

/** 엑셀 파일 이름 앞 글자(결정 ④). */
const FILE_PREFIX: Readonly<Record<PaymentView, string>> = {
  PAY: '세금납부',
  NTAX: '국세납부',
  LTAX: '지방세납부',
  SOCIAL: '4대보험',
  LOAN: '대출',
};

/** 세금 전체 — 국세 + 지방세 한 목록(세금 납부 화면, 2026-11-08). */
export const PAY_ALL = 'PAY';
/** 주소 tab — 자료 종류 넷(세무사 전달이 하나씩 부른다) + 세금 전체. */
export type PaymentView = PaymentTab | typeof PAY_ALL;

/**
 * 세금 납부 검색조건 「세금 전체 / 국세 / 지방세」 — 코드 TAX_PAY_SRC(223). ★ 고정 코드 — 코드값 = 자료 종류 코드값(주소 tab).
 * 「세금 전체」는 선택 상자 첫 줄이고 코드가 아니다(주소 tab=PAY).
 */
export const TAX_PAY_SRC_CATEGORY = 'TAX_PAY_SRC';
export const PAY_SRCS = [TAX_KIND_NTAX, TAX_KIND_LTAX] as const;

/** 메뉴 셋의 주소 — 자료 올리기 [보기]가 파일 종류에 맞는 메뉴로 간다. */
export const PAYMENT_ROUTES = { pay: '/tax/payments', social: '/tax/social', loan: '/tax/loans' } as const;

/** 올린 파일의 자료 종류 → 메뉴 주소. 이 세 메뉴의 자료가 아니면 null. */
export function paymentsRouteOfFileKind(kind: string): string | null {
  if (kind === TAX_KIND_NTAX || kind === TAX_KIND_LTAX) return PAYMENT_ROUTES.pay;
  if (kind === TAX_KIND_SOCIAL) return PAYMENT_ROUTES.social;
  if (kind === TAX_KIND_LOAN) return PAYMENT_ROUTES.loan;
  return null;
}

/** 4대보험 보험 거르기 선택지 — 국민연금 · 건강보험 · 고용보험 · 산재보험(장기요양은 건강보험에 들어간다). */
export const SOCIAL_INS_FILTERS: readonly string[] = TAX_SOCIAL_FILE_TPS;

/** 보험 거르기 — 건강보험(HI)을 고르면 장기요양(LTC)까지. null 이면 전부. */
export function filterSocialIns<T extends { insTp: string }>(rows: readonly T[], ins: string | null | undefined): T[] {
  if (!ins) return [...rows];
  return rows.filter((r) => r.insTp === ins || (ins === 'HI' && r.insTp === 'LTC'));
}

/** 올린 파일의 자료 종류 → 탭. 이 화면 자료가 아니면 null. */
export function tabOfFileKind(kind: string): PaymentTab | null {
  return (PAYMENT_TABS as readonly string[]).includes(kind) ? (kind as PaymentTab) : null;
}

/* ── 주소 ────────────────────────────────────────────────────────────────── */

export interface PaymentsQuery {
  month: string;
  /** 자료 종류 하나 또는 세금 전체(PAY). */
  tab: PaymentView;
  /** 4대보험 보험 거르기(2026-11-08) — 국민연금 NP · 건강보험 HI(장기요양 포함) · 고용보험 EI · 산재보험 IA. 없으면 전부. */
  ins?: string | null;
  /** 기간 직접 지정(`YYYY-MM-DD`) — 둘 다 있거나 둘 다 없다. 없으면 작업할 달. */
  from: string | null;
  to: string | null;
  /** 자료 올리기 [보기]로 들어온 파일 — 있으면 기간 없음 · 탭은 서버가 정한다. */
  fileId: string | null;
}

export type PaymentsQueryParsed = { ok: true; value: PaymentsQuery } | { ok: false; errors: TaxFieldError[] };

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** `YYYY-MM-DD` 이고 달력에 있는 날. */
function isDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function parsePaymentsQuery(raw: Record<string, unknown>): PaymentsQueryParsed {
  const errors: TaxFieldError[] = [];
  const month = parseMonth(raw.month);
  if (!month) errors.push({ field: 'month', message: '작업할 달은 YYYY-MM 입니다' });
  const tabRaw = text(raw.tab) ?? TAX_KIND_NTAX;
  const tab: PaymentView | null = tabRaw === PAY_ALL ? PAY_ALL : tabOfFileKind(tabRaw);
  if (!tab) errors.push({ field: 'tab', message: '탭이 올바르지 않습니다' });
  const ins = text(raw.ins);
  if (ins !== null && !SOCIAL_INS_FILTERS.includes(ins)) errors.push({ field: 'ins', message: '보험 종류가 올바르지 않습니다' });

  const fileId = text(raw.file);
  let from = text(raw.from);
  let to = text(raw.to);
  if (fileId) {
    from = null;
    to = null;
  } else if ((from === null) !== (to === null)) {
    errors.push({ field: 'period', message: '기간은 시작과 끝을 함께 고르세요' });
  } else if (from !== null && to !== null) {
    if (!isDate(from) || !isDate(to)) errors.push({ field: 'period', message: '기간 날짜가 올바르지 않습니다' });
    else if (from > to) errors.push({ field: 'period', message: '기간의 시작이 끝보다 늦습니다' });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { month: month!, tab: tab!, from, to, fileId, ...(ins ? { ins } : {}) } };
}

const nextDay = (date: string): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

const nextMonthFirst = (month: string): string => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
};

/**
 * 줄을 고르는 날짜 범위 [첫날, 끝 다음 날) — 파일로 들어왔으면 null(그 파일 줄 전부).
 * 국세 · 지방세 납부일 · 대출 거래일은 날짜 그대로, ★ 4대보험은 고지 연월(달 첫날)이라 달 단위로 넓힌다(결정 ⑥).
 */
export function paymentsRange(q: PaymentsQuery): [string, string] | null {
  if (q.fileId) return null;
  if (q.from && q.to) {
    if (q.tab === TAX_KIND_SOCIAL) return [`${q.from.slice(0, 7)}-01`, nextMonthFirst(q.to.slice(0, 7))];
    return [q.from, nextDay(q.to)];
  }
  return [`${q.month}-01`, nextMonthFirst(q.month)];
}

/** 엑셀 파일 이름(결정 ④) — 「국세납부_2026-09.xlsx」, 기간 직접 지정이면 「국세납부_2026-07~2026-09.xlsx」. */
export function paymentsExportFileName(q: PaymentsQuery): string {
  const prefix = FILE_PREFIX[q.tab];
  if (!q.fileId && q.from && q.to) return `${prefix}_${q.from.slice(0, 7)}~${q.to.slice(0, 7)}.xlsx`;
  return `${prefix}_${q.month}.xlsx`;
}

/** 주소 글자 — 화면 목록 · 엑셀이 같은 거르기를 쓴다. 파일이면 파일만(탭 · 기간은 싣지 않는다). */
export function paymentsSearch(q: PaymentsQuery): string {
  const p = new URLSearchParams({ month: q.month });
  if (q.fileId) p.set('file', q.fileId);
  else {
    p.set('tab', q.tab);
    if (q.ins) p.set('ins', q.ins);
    if (q.from && q.to) {
      p.set('from', q.from);
      p.set('to', q.to);
    }
  }
  return `?${p.toString()}`;
}

/* ── 줄 ──────────────────────────────────────────────────────────────────── */

/** 국세 · 지방세 납부 줄. 비용 여부는 읽을 때 정한다(저장하지 않음). */
export interface TaxPaymentRow {
  id: string;
  /** 국세 NTAX · 지방세 LTAX — 세금 전체 목록에서 「구분」 칸(2026-11-08). */
  kind: typeof TAX_KIND_NTAX | typeof TAX_KIND_LTAX;
  payDate: string;
  taxItem: string;
  expense: boolean;
  amount: number;
  /** 가산금 — 국세만, 지방세는 null. */
  penalty: number | null;
  /** 귀속 연월 `YYYY-MM` — 지방세만, 없으면 null. */
  belongMonth: string | null;
  office: string | null;
  /** 납부방법 — 지방세만. */
  payMethod: string | null;
  payNo: string;
}

/** 4대보험 고지 줄 — 한 사람 × 한 보험. ★ 가입자 번호는 끝 4자리만. */
export interface SocialInsRow {
  id: string;
  /** 고지 연월 `YYYY-MM`. */
  noticeMonth: string;
  insTp: string;
  name: string;
  memberLast4: string | null;
  payBase: number | null;
  noticeAmount: number;
}

/** 대출 거래 줄. ★ 대출번호는 끝 4자리만. */
export interface LoanTxnRow {
  id: string;
  bankCode: string;
  loanLast4: string;
  txnDate: string;
  txnTp: string;
  txnType: string | null;
  principal: number;
  interest: number;
  fee: number;
  balance: number;
}

export interface PayTotals {
  count: number;
  amount: number;
  expense: number;
  nonExpense: number;
  penalty: number;
}

/** 국세 · 지방세 합계 — 전체 · 비용 · 비용 아님 · 가산금(국세만 값이 있다). */
export function payTotals(rows: readonly Pick<TaxPaymentRow, 'amount' | 'expense' | 'penalty'>[]): PayTotals {
  const t: PayTotals = { count: 0, amount: 0, expense: 0, nonExpense: 0, penalty: 0 };
  for (const r of rows) {
    t.count++;
    t.amount += r.amount;
    if (r.expense) t.expense += r.amount;
    else t.nonExpense += r.amount;
    t.penalty += r.penalty ?? 0;
  }
  return t;
}

export interface LoanSummaryRow {
  bankCode: string;
  loanLast4: string;
  count: number;
  /** 실행 원금 합계(구분 D). */
  draw: number;
  /** 상환 원금 합계(구분 R). */
  repay: number;
  interest: number;
  fee: number;
}

/** 대출(은행 · 끝 4자리)별 요약 — 은행 코드 · 끝 4자리 순. 잔액은 싣지 않는다(결정 ⑤). */
export function loanSummary(
  rows: readonly Pick<LoanTxnRow, 'bankCode' | 'loanLast4' | 'txnTp' | 'principal' | 'interest' | 'fee'>[],
): LoanSummaryRow[] {
  const by = new Map<string, LoanSummaryRow>();
  for (const r of rows) {
    const key = `${r.bankCode}:${r.loanLast4}`;
    const s = by.get(key) ?? { bankCode: r.bankCode, loanLast4: r.loanLast4, count: 0, draw: 0, repay: 0, interest: 0, fee: 0 };
    s.count++;
    if (r.txnTp === 'D') s.draw += r.principal;
    else s.repay += r.principal;
    s.interest += r.interest;
    s.fee += r.fee;
    by.set(key, s);
  }
  return [...by.values()].sort((a, b) => a.bankCode.localeCompare(b.bankCode) || a.loanLast4.localeCompare(b.loanLast4));
}

/* ── 응답 ────────────────────────────────────────────────────────────────── */

export interface TaxPaymentsResponse {
  /** 파일로 들어왔으면 탭이 파일 종류로 바뀌어 있다. */
  query: PaymentsQuery;
  /** 탭마다 줄 수 — 같은 기간(파일이면 그 파일). */
  counts: Record<PaymentTab, number>;
  /** 지금 탭의 줄만 채운다 — 날짜 최신순. */
  pays: TaxPaymentRow[];
  social: SocialInsRow[];
  loans: LoanTxnRow[];
  file: { id: string; fileName: string } | null;
  codes: {
    /** 세금 납부 「세금 전체 / 국세 / 지방세」 선택지(TAX_PAY_SRC, 켜진 것 · 코드 순서). */
    paySrcs: TaxCodeName[];
    socialIns: TaxCodeName[];
    loanTps: TaxCodeName[];
    banks: TaxCodeName[];
  };
}
