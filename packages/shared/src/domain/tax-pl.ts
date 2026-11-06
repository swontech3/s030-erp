/**
 * 세무(S05) 월별 손익(s050400010) 계산 — 1-8 (2026-11-05). **보기만** 한다. 화면 · 검증 · 나중 세무사 전달이 이 함수를 쓴다.
 *
 * 자료와 규칙(명세 04 §2 · 06 §6 · 결과서 S05-08, 2026-11-05 대표 결정):
 *   매출  매출 계산서 공급가액(작성일) · 현금 매출 금액(사용일, 결정 7)
 *   비용  매입 계산서 공급가액 · 카드(사용일, `cardCost`) · 현금 매입 금액 — 항목(TAX_ITEM_OUT)별로 묶는다
 *          국세 · 지방세(납부일) — 「비용이 아닌 세목」(TAX_TAX_NOEXP 이름)은 빼고 한 줄
 *          대출(거래일) — 이자 · 수수료를 따로 두 줄, 원금은 넣지 않는다(결정 6)
 *   미지정   항목이 빈 매입 계산서 · 카드 · 현금 매입 — 비용에 「미지정」 한 줄로 넣고 줄 수 · 금액도 따로 센다(11-06 대표 수정)
 *   빼는 것  「사업과 무관」 두 항목(따로 합, 결정 5) · 4대보험(결정 1 — 직원 급여 단계에서)
 *   올해 누적  작업할 달 해의 1월 ~ 작업할 달 매출 · 비용 · 이익(11-06 대표 수정) — 막대 값을 더한다
 * ★ 4대보험 · 직원 급여 · 은행(계산서 없는 매출)은 아직 넣지 않는다 — 직원 급여 · 은행 짝 맞추기 단계에서.
 */
import { isExpenseTaxItem } from './tax-pay-social-loan.ts';
import type { TaxCodeName } from './tax-uploads.ts';

/** 「사업과 무관」 출금 항목 — 법인(001) · 개인(002). 비용에서 빼고 따로 보인다(결정 5). */
export const NONBIZ_ITEM_CODES: readonly string[] = ['NONBIZ_TAXPRO', 'NONBIZ_OWNER'];

/** 카드 한 줄의 비용 — 공제(Y)면 부가세를 뺀 금액, 불공제 · 빈 값이면 합계(명세 06 §6, 결정 3). */
export function cardCost(total: number, tax: number, vatDeduct: string | null): number {
  return vatDeduct === 'Y' ? total - tax : total;
}

/** 서버가 DB 에서 읽어 넘기는 한 해의 줄. 날짜는 `YYYY-MM-DD`. */
export interface PlSources {
  salesInvoices: { date: string; supply: number; partner: string }[];
  cashSales: { date: string; amount: number }[];
  /** 매입 계산서 · 카드 · 현금 매입 — `cost` 는 손익에 넣을 금액(계산서 공급가액 · `cardCost` · 현금 금액). */
  purchases: { date: string; itemCode: string | null; cost: number }[];
  taxPays: { date: string; taxItem: string; amount: number }[];
  loans: { date: string; interest: number; fee: number }[];
}

export interface PlLine {
  key: string;
  label: string;
  note: string | null;
  amount: number;
}

export interface PlMonth {
  month: string;
  income: number;
  expense: number;
  /** 그 달에 줄이 하나라도 있는가(미지정 건 · 비용 아닌 세목 포함) — 없으면 막대를 누를 수 없다. */
  hasData: boolean;
}

export interface PlDetail {
  income: PlLine[];
  expense: PlLine[];
  incomeTotal: number;
  expenseTotal: number;
  profit: number;
  /** 「사업과 무관」 두 항목의 합 — 비용에 넣지 않는다. */
  nonBiz: number;
  unassigned: { count: number; amount: number };
}

/** 올해 누적 — 작업할 달 해의 1월 ~ 작업할 달(11-06). */
export interface PlYtd {
  income: number;
  expense: number;
  profit: number;
}

export interface PlResult {
  year: string;
  months: PlMonth[];
  detail: PlDetail;
  ytd: PlYtd;
}

export interface PlOptions {
  /** 작업할 달 `YYYY-MM` — 막대는 그 해, 내역은 그 달. */
  month: string;
  /** 그 회사 출금 항목(코드 순서) — 줄 순서 · 이름. */
  items: readonly TaxCodeName[];
  /** 「비용이 아닌 세목」 이름. */
  noExpNames: readonly string[];
}

const monthOf = (date: string) => date.slice(0, 7);

/** 매출 줄 풀이 — 금액 큰 거래처 셋 + 「외」 + 「부가세 뺀 금액」(결과서 S05-08). */
function salesNote(rows: readonly { supply: number; partner: string }[]): string {
  const by = new Map<string, number>();
  for (const r of rows) by.set(r.partner, (by.get(r.partner) ?? 0) + r.supply);
  const names = [...by.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  return `${names.slice(0, 3).join(' · ')}${names.length > 3 ? ' 외' : ''} — 부가세 뺀 금액`;
}

/** 한 달의 내역. */
function detailOf(src: PlSources, month: string, o: PlOptions): PlDetail {
  const inMonth = <T extends { date: string }>(rows: readonly T[]) => rows.filter((r) => monthOf(r.date) === month);
  const sum = <T>(rows: readonly T[], f: (r: T) => number) => rows.reduce((n, r) => n + f(r), 0);

  const income: PlLine[] = [];
  const sales = inMonth(src.salesInvoices);
  if (sales.length) income.push({ key: 'SALES_INVOICE', label: '매출 (세금계산서)', note: salesNote(sales), amount: sum(sales, (r) => r.supply) });
  const cash = inMonth(src.cashSales);
  if (cash.length) income.push({ key: 'CASH_SALES', label: '현금 매출', note: null, amount: sum(cash, (r) => r.amount) });

  const expense: PlLine[] = [];
  const purchases = inMonth(src.purchases);
  const unassignedRows = purchases.filter((r) => r.itemCode === null);
  const nonBizRows = purchases.filter((r) => r.itemCode !== null && NONBIZ_ITEM_CODES.includes(r.itemCode));
  const byItem = new Map<string, number>();
  for (const r of purchases) {
    if (r.itemCode === null || NONBIZ_ITEM_CODES.includes(r.itemCode)) continue;
    byItem.set(r.itemCode, (byItem.get(r.itemCode) ?? 0) + r.cost);
  }
  const order = (code: string) => {
    const i = o.items.findIndex((it) => it.code === code);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  for (const code of [...byItem.keys()].sort((a, b) => order(a) - order(b) || a.localeCompare(b))) {
    expense.push({ key: `ITEM:${code}`, label: o.items.find((it) => it.code === code)?.name ?? code, note: null, amount: byItem.get(code)! });
  }

  const taxes = inMonth(src.taxPays).filter((r) => isExpenseTaxItem(r.taxItem, o.noExpNames));
  if (taxes.length) {
    const names = [...new Set(taxes.map((r) => r.taxItem.trim()))];
    expense.push({ key: 'TAX', label: '세금 (비용인 세목)', note: names.join(' · '), amount: sum(taxes, (r) => r.amount) });
  }
  const loans = inMonth(src.loans);
  const interest = loans.filter((r) => r.interest !== 0);
  if (interest.length) expense.push({ key: 'LOAN_INTEREST', label: '대출 이자', note: null, amount: sum(interest, (r) => r.interest) });
  const fees = loans.filter((r) => r.fee !== 0);
  if (fees.length) expense.push({ key: 'LOAN_FEE', label: '대출 수수료', note: null, amount: sum(fees, (r) => r.fee) });

  if (unassignedRows.length) expense.push({ key: 'UNASSIGNED', label: '미지정', note: null, amount: sum(unassignedRows, (r) => r.cost) });

  const incomeTotal = sum(income, (l) => l.amount);
  const expenseTotal = sum(expense, (l) => l.amount);
  return {
    income,
    expense,
    incomeTotal,
    expenseTotal,
    profit: incomeTotal - expenseTotal,
    nonBiz: sum(nonBizRows, (r) => r.cost),
    unassigned: { count: unassignedRows.length, amount: sum(unassignedRows, (r) => r.cost) },
  };
}

/** 한 해 막대(1~12월) + 작업할 달 내역 + 올해 누적. 막대 · 내역 · 누적은 같은 함수로 센다. */
export function buildPl(src: PlSources, o: PlOptions): PlResult {
  const year = o.month.slice(0, 4);
  const dates = [
    ...src.salesInvoices, ...src.cashSales, ...src.purchases, ...src.taxPays, ...src.loans,
  ].map((r) => monthOf(r.date));
  const months: PlMonth[] = Array.from({ length: 12 }, (_, i) => {
    const month = `${year}-${String(i + 1).padStart(2, '0')}`;
    const d = detailOf(src, month, o);
    return { month, income: d.incomeTotal, expense: d.expenseTotal, hasData: dates.includes(month) };
  });
  const upTo = months.filter((m) => m.month <= o.month);
  const income = upTo.reduce((n, m) => n + m.income, 0);
  const expense = upTo.reduce((n, m) => n + m.expense, 0);
  return { year, months, detail: detailOf(src, o.month, o), ytd: { income, expense, profit: income - expense } };
}

/* ── 응답 ────────────────────────────────────────────────────────────────── */

export interface TaxPlResponse {
  month: string;
  /** 사업자 유형 이름 — 작업할 달 줄 오른쪽 안내. 설정이 없으면 null. */
  bizTypeName: string | null;
  pl: PlResult;
}
