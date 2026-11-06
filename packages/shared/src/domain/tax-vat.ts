/**
 * 세무(S05) 부가세 조회(s050400020) 계산 — 1-8 (2026-11-05). **보기만** 한다. 화면 · 엑셀 · 나중 세무사 전달이 이 함수를 쓴다.
 *
 * 규칙(명세 04 §3 · 결과서 S05-09, 2026-11-05 대표 결정):
 *   신고 기간  계산으로 — 법인 분기(1 · 3분기 예정, 2 · 4분기 확정) · 개인 반기(1기 · 2기 확정). 마감은 다음 달 25일, 휴일 미루기 없음(결정 9)
 *   세는 범위  기간 첫날 ~ (기간 끝 · 작업할 달 중 이른 달)의 끝 — 시안 「7~9월까지 쌓인 값」
 *   매출세액   매출 계산서 세액 합(결정 10) · 매입세액 매입 계산서 세액 합(항목과 무관)
 *   카드       홈택스 공제(Y) 줄 세액 합(결정 3)
 *   현금 매출  세액을 세지 않고 금액만 — 화면은 「부가세 포함 여부 세무사 확인」 안내(결정 7)
 *   공제가 안 될 수 있는 매입  매입 계산서 · 공제(Y) 카드 중 항목이 코드 TAX_NODEDUCT_ITEM 이름(= 출금 항목 코드값)인 줄의 세액(결정 4)
 *   달마다 표  기간의 달마다 매출 · 매입(계산서) 공급가액 · 부가세, 카드 공제(Y) 줄 공급가액 · 부가세, 낼 부가세 + 합계(11-06 대표 수정)
 *   선택지     올해 포함 최근 3년(작업할 달이 더 앞이면 그 해부터)에서 이번 달까지 시작한 기간(11-06)
 * ★ 계산서 없는 매출은 입금 항목 · 은행 분류가 아직 없어 세지 않는다.
 */
import { parseMonth, taxYearOptions, type TaxCodeName, type TaxFieldError } from './tax-uploads.ts';

export const TAX_NODEDUCT_ITEM_CATEGORY = 'TAX_NODEDUCT_ITEM';

/* ── 신고 기간 ───────────────────────────────────────────────────────────── */

export interface VatPeriod {
  /** `2026-Q3` · `2026-H2`. */
  id: string;
  year: string;
  /** 첫 달 · 끝 달 `YYYY-MM`. */
  from: string;
  to: string;
  /** 신고 · 납부 마감 `YYYY-MM-DD`. */
  deadline: string;
  /** 개인 예정고지 마감 — 법인은 null. */
  prepayDeadline: string | null;
  /** 신고 기간 카드 「2026년 3분기 예정신고 · 7~9월」. */
  title: string;
  /** 선택 칸 「2026년 3분기 예정 (7~9월)」. */
  option: string;
  /** 카드 설명. */
  desc: string;
}

const CORP_DESC = '법인은 분기마다 신고합니다 (예정 · 확정)';
const INDIV_DESC = '개인 일반과세자는 반기마다 확정신고하고, 중간에는 세무서 고지서로 냅니다 (예정고지)';

const mm = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`;
/** 끝 달 다음 달의 25일. */
const due = (y: number, lastMonth: number) => (lastMonth === 12 ? `${y + 1}-01-25` : `${mm(y, lastMonth + 1)}-25`);

function corpPeriod(y: number, q: number): VatPeriod {
  const a = q * 3 - 2;
  const b = q * 3;
  const kind = q % 2 === 1 ? '예정' : '확정';
  return {
    id: `${y}-Q${q}`, year: String(y), from: mm(y, a), to: mm(y, b), deadline: due(y, b), prepayDeadline: null,
    title: `${y}년 ${q}분기 ${kind}신고 · ${a}~${b}월`, option: `${y}년 ${q}분기 ${kind} (${a}~${b}월)`, desc: CORP_DESC,
  };
}

function indivPeriod(y: number, h: number): VatPeriod {
  const a = h === 1 ? 1 : 7;
  const b = h === 1 ? 6 : 12;
  return {
    id: `${y}-H${h}`, year: String(y), from: mm(y, a), to: mm(y, b), deadline: due(y, b), prepayDeadline: due(y, a + 2),
    title: `${y}년 ${h}기 확정신고 · ${a}~${b}월`, option: `${y}년 ${h}기 확정 (${a}~${b}월)`, desc: INDIV_DESC,
  };
}

/** 그 해의 기간 — 앞에서부터. 사업자 유형(C 법인 · I 개인)이 아니면 빈 목록. */
function periodsOfYear(bizType: string | null, y: number): VatPeriod[] {
  if (bizType === 'C') return [1, 2, 3, 4].map((q) => corpPeriod(y, q));
  if (bizType === 'I') return [1, 2].map((h) => indivPeriod(y, h));
  return [];
}

/** 작업할 달이 든 신고 기간. */
export function vatPeriodOf(bizType: string | null, month: string): VatPeriod | null {
  return periodsOfYear(bizType, Number(month.slice(0, 4))).find((p) => p.from <= month && month <= p.to) ?? null;
}

/** 선택지 — 달 고르기와 같은 연도 범위(`taxYearOptions`)에서 이번 달까지 시작한 기간, 최신순(11-06). */
export function vatPeriodOptions(bizType: string | null, month: string, thisMonth: string): VatPeriod[] {
  return taxYearOptions(month, thisMonth)
    .flatMap((y) => periodsOfYear(bizType, Number(y)))
    .filter((p) => p.from <= thisMonth)
    .reverse();
}

/** 기간을 고르면 작업할 달 — 그 기간 끝 달, 이번 달보다 뒤면 이번 달(주소 `?month=`, 다른 화면도 따라간다). */
export function vatPeriodMonth(p: VatPeriod, thisMonth: string): string {
  return p.to <= thisMonth ? p.to : thisMonth;
}

/** 기간의 달 — 첫 달부터 끝 달까지. */
export function vatPeriodMonths(p: VatPeriod): string[] {
  const out: string[] = [];
  for (let m = p.from; m <= p.to; m = nextMonth(m)) out.push(m);
  return out;
}

function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : mm(y, m + 1);
}

export function vatPeriodById(bizType: string | null, id: string): VatPeriod | null {
  const y = Number(id.slice(0, 4));
  return Number.isNaN(y) ? null : (periodsOfYear(bizType, y).find((p) => p.id === id) ?? null);
}

/** 마감 글자 — 기간과 같은 해면 「10월 25일」, 아니면 「2027년 1월 25일」. */
export function deadlineLabel(date: string, periodYear: string): string {
  const [y, m, d] = date.split('-');
  const md = `${Number(m)}월 ${Number(d)}일`;
  return y === periodYear ? md : `${y}년 ${md}`;
}

const nextMonthFirst = (month: string): string => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${mm(y, m + 1)}-01`;
};

/** 세는 날짜 범위 [첫날, 끝 다음 날) — 기간 첫날 ~ (기간 끝 · 작업할 달 중 이른 달)의 끝. */
export function vatRange(p: VatPeriod, month: string): [string, string] {
  const last = month < p.to ? month : p.to;
  return [`${p.from}-01`, nextMonthFirst(last)];
}

/** 범위의 「a~b월」 — 범위 끝 달까지. */
export function vatRangeLabel(range: [string, string]): string {
  const a = Number(range[0].slice(5, 7));
  const end = new Date(`${range[1]}T00:00:00Z`);
  end.setUTCDate(0);
  const b = end.getUTCMonth() + 1;
  return a === b ? `${a}월` : `${a}~${b}월`;
}

/* ── 주소 ────────────────────────────────────────────────────────────────── */

export interface VatQuery {
  month: string;
  /** 고른 신고 기간 — 없으면 작업할 달이 든 기간. 사업자 유형과 맞는지는 서버가 설정을 읽고 본다. */
  periodId: string | null;
}

export type VatQueryParsed = { ok: true; value: VatQuery } | { ok: false; errors: TaxFieldError[] };

export function parseVatQuery(raw: Record<string, unknown>): VatQueryParsed {
  const errors: TaxFieldError[] = [];
  const month = parseMonth(raw.month);
  if (!month) errors.push({ field: 'month', message: '작업할 달은 YYYY-MM 입니다' });
  const p = typeof raw.period === 'string' && raw.period.trim() !== '' ? raw.period.trim() : null;
  if (p !== null && !/^\d{4}-(Q[1-4]|H[12])$/.test(p)) errors.push({ field: 'period', message: '신고 기간이 올바르지 않습니다' });
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { month: month!, periodId: p } };
}

export function vatSearch(q: VatQuery): string {
  const p = new URLSearchParams({ month: q.month });
  if (q.periodId) p.set('period', q.periodId);
  return `?${p.toString()}`;
}

/** 엑셀 파일 이름 — 「부가세_2026년3분기.xlsx」 · 「부가세_2026년2기.xlsx」. */
export function vatExportFileName(p: VatPeriod): string {
  const [y, part] = p.id.split('-') as [string, string];
  return `부가세_${y}년${part.slice(1)}${part.startsWith('Q') ? '분기' : '기'}.xlsx`;
}

/* ── 계산 ────────────────────────────────────────────────────────────────── */

/** 서버가 DB 에서 읽어 넘기는 줄(기간 밖 줄이 섞여도 된다 — 범위로 거른다). 날짜는 `YYYY-MM-DD`. */
export interface VatSources {
  invoices: { direction: string; date: string; partner: string; bizNo: string; supply: number; tax: number; itemCode: string | null }[];
  cards: { date: string; merchant: string; bizNo: string | null; supply: number; tax: number; vatDeduct: string | null; itemCode: string | null }[];
  cashSales: { date: string; amount: number }[];
  cashPurchases: { date: string; itemCode: string | null }[];
}

export interface VatOptions {
  range: [string, string];
  /** 표의 달 — 신고 기간의 달 전부(`vatPeriodMonths`). 센 범위 밖 달은 0. */
  months: readonly string[];
  /** 그 회사 출금 항목 — 이름. */
  items: readonly TaxCodeName[];
  /** 코드 TAX_NODEDUCT_ITEM 의 이름(= 출금 항목 코드값), 코드 표 순서. */
  nodeductItems: readonly string[];
}

/** 표 한 줄 — 금액은 원. 카드는 홈택스 공제(Y) 줄만. 낼 부가세 = 매출 부가세 − 매입 부가세 − 카드 부가세. */
export interface VatAmounts {
  salesSupply: number;
  salesTax: number;
  purchaseSupply: number;
  purchaseTax: number;
  cardSupply: number;
  cardTax: number;
  payable: number;
}

export interface VatMonthRow extends VatAmounts {
  month: string;
}

export interface VatResult {
  sales: { supply: number; tax: number };
  purchase: { supply: number; tax: number };
  card: { tax: number };
  cashSales: number;
  /** 낼 세금 예상 = 매출세액 − 매입세액 − 카드. */
  payable: number;
  nodeduct: { lines: { itemCode: string; label: string; tax: number }[]; total: number };
  unassignedCount: number;
  /** 달마다 표(11-06). */
  months: VatMonthRow[];
  /** 합계 줄 — 낼 부가세가 그 기간 예상액(= payable). */
  total: VatAmounts;
}

const inRange = (range: [string, string]) => (r: { date: string }) => r.date >= range[0] && r.date < range[1];

export function buildVat(src: VatSources, o: VatOptions): VatResult {
  const ok = inRange(o.range);
  const sum = <T>(rows: readonly T[], f: (r: T) => number) => rows.reduce((n, r) => n + f(r), 0);
  const invoices = src.invoices.filter(ok);
  const salesInv = invoices.filter((r) => r.direction === 'S');
  const purchaseInv = invoices.filter((r) => r.direction === 'P');
  const cards = src.cards.filter(ok);
  const deductCards = cards.filter((r) => r.vatDeduct === 'Y');

  const sales = { supply: sum(salesInv, (r) => r.supply), tax: sum(salesInv, (r) => r.tax) };
  const purchase = { supply: sum(purchaseInv, (r) => r.supply), tax: sum(purchaseInv, (r) => r.tax) };
  const card = { tax: sum(deductCards, (r) => r.tax) };

  const byItem = new Map<string, number>();
  for (const r of [...purchaseInv, ...deductCards]) {
    if (r.itemCode !== null && o.nodeductItems.includes(r.itemCode)) byItem.set(r.itemCode, (byItem.get(r.itemCode) ?? 0) + r.tax);
  }
  const lines = o.nodeductItems
    .filter((code) => byItem.has(code))
    .map((code) => ({ itemCode: code, label: o.items.find((i) => i.code === code)?.name ?? code, tax: byItem.get(code)! }));

  const cashPurchases = src.cashPurchases.filter(ok);
  const amountsOf = (inv: readonly VatSources['invoices'][number][], cds: readonly VatSources['cards'][number][]): VatAmounts => {
    const s = inv.filter((r) => r.direction === 'S');
    const p = inv.filter((r) => r.direction === 'P');
    const salesTax = sum(s, (r) => r.tax);
    const purchaseTax = sum(p, (r) => r.tax);
    const cardTax = sum(cds, (r) => r.tax);
    return {
      salesSupply: sum(s, (r) => r.supply), salesTax, purchaseSupply: sum(p, (r) => r.supply), purchaseTax,
      cardSupply: sum(cds, (r) => r.supply), cardTax, payable: salesTax - purchaseTax - cardTax,
    };
  };
  const ofMonth = (m: string) => (r: { date: string }) => r.date.slice(0, 7) === m;
  return {
    sales,
    purchase,
    card,
    cashSales: sum(src.cashSales.filter(ok), (r) => r.amount),
    payable: sales.tax - purchase.tax - card.tax,
    nodeduct: { lines, total: sum(lines, (l) => l.tax) },
    unassignedCount:
      purchaseInv.filter((r) => r.itemCode === null).length +
      cards.filter((r) => r.itemCode === null).length +
      cashPurchases.filter((r) => r.itemCode === null).length,
    months: o.months.map((m) => ({ month: m, ...amountsOf(invoices.filter(ofMonth(m)), deductCards.filter(ofMonth(m))) })),
    total: amountsOf(invoices.filter((r) => o.months.includes(r.date.slice(0, 7))), deductCards.filter((r) => o.months.includes(r.date.slice(0, 7)))),
  };
}

/** 엑셀 한 줄(결정 11) — 작성일 · 거래처 · 사업자번호 · 공급가액 · 세액 · 자료 · 공제 여부(카드만, 코드 TAX_CARD_DEDUCT 값). */
export interface VatLedgerRow {
  date: string;
  partner: string;
  bizNo: string | null;
  supply: number;
  tax: number;
  source: 'INVOICE' | 'CARD';
  vatDeduct: string | null;
}

/** 매출 · 매입 명세 — 매출 = 매출 계산서, 매입 = 매입 계산서 + 카드 전부. 날짜 순(같은 날은 카드 · 계산서 순서 그대로). */
export function vatLedger(src: VatSources, range: [string, string]): { sales: VatLedgerRow[]; purchases: VatLedgerRow[] } {
  const ok = inRange(range);
  const fromInv = (r: VatSources['invoices'][number]): VatLedgerRow => ({
    date: r.date, partner: r.partner, bizNo: r.bizNo, supply: r.supply, tax: r.tax, source: 'INVOICE', vatDeduct: null,
  });
  const fromCard = (r: VatSources['cards'][number]): VatLedgerRow => ({
    date: r.date, partner: r.merchant, bizNo: r.bizNo, supply: r.supply, tax: r.tax, source: 'CARD', vatDeduct: r.vatDeduct,
  });
  const byDate = (a: VatLedgerRow, b: VatLedgerRow) => a.date.localeCompare(b.date);
  const invoices = src.invoices.filter(ok);
  return {
    sales: invoices.filter((r) => r.direction === 'S').map(fromInv).sort(byDate),
    purchases: [...src.cards.filter(ok).map(fromCard), ...invoices.filter((r) => r.direction === 'P').map(fromInv)].sort(byDate),
  };
}

/* ── 응답 ────────────────────────────────────────────────────────────────── */

export interface TaxVatResponse {
  /** 기간을 고르지 않았으면 periodId 가 작업할 달이 든 기간으로 채워져 있다. 사업자 유형이 없으면 null. */
  query: VatQuery;
  bizType: string | null;
  bizTypeName: string | null;
  /** 사업자 유형이 없으면 null — 화면은 세무 설정 안내만 그린다. */
  period: VatPeriod | null;
  periods: VatPeriod[];
  /** 센 범위 「7~9월」. */
  rangeLabel: string | null;
  vat: VatResult | null;
}
