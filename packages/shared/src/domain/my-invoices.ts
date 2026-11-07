/**
 * 내 청구서(보기 전용 /billing/mine · s030200090) — 앱 1단계 7-나 (대표 지시 2026-11-08). 순수 함수.
 *
 * =============================================================================
 * ★★ 보기 전용이다 — 청구 · 수납 처리는 운영사 /billing 한 곳뿐 (CLAUDE.md 「한 업무는 한 화면에서」)
 * =============================================================================
 * 입주사가 자기 회사 청구를 본다 : 「XX월 납부 안내」 카드 · 지난 12개월 납부 내역 · 미납 안내 띠.
 * 카드 결제는 2단계다.
 *
 * ★ 상태 판정은 `displayInvoiceStatus` 하나, 합계는 `summarizeInvoices` 하나다 — 여기서 다시 만들지 않는다.
 * ★ 미납 띠 조건만 이 화면의 규칙이다(대표 결정 2026-11-08) :
 *     미납 장이 있거나, 기한이 지났는데 남은 금액이 있는 장(부분납부)이 있을 때.
 *   기존 상태 판정은 바꾸지 않는다 — 그 장은 여전히 「부분납부」로 보인다.
 * ★ 「이번 달」은 보는 사람의 로컬 날짜다(예약 화면과 같다). 미래 달 청구서는 계약 확정 때 미리 만들어져
 *   있지만 보이지 않는다 — 조회 기간이 이번 달에서 끝난다.
 */
import { displayInvoiceStatus, type DisplayStatus } from './invoice-status.ts';
import { localDayOf, summarizeInvoices } from './invoice-summary.ts';
import { daysBetweenLocal } from './day.ts';

/** `GET /my/invoices` 한 줄. */
export interface MyInvoice {
  invoiceId: string;
  /** `YYYY-MM`. */
  yearMonth: string;
  /** 납부일 `YYYY-MM-DD`. */
  dueDate: string;
  totalAmount: number;
  paidAmount: number;
  /** 저장상태 `P` / `E` / `C`. */
  status: string;
}

/** 납부 내역이 보는 지난 달 수 — 이번 달은 카드가 보여 주고, 내역은 그 앞 12개월이다. */
export const MY_INVOICES_HISTORY_MONTHS = 12;

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 보는 사람의 로컬 날짜로 `YYYY-MM`. */
export function yearMonthOf(asOf: Date): string {
  return `${asOf.getFullYear()}-${pad2(asOf.getMonth() + 1)}`;
}

function addMonths(yearMonth: string, delta: number): string {
  const [y, m] = yearMonth.split('-').map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${pad2((idx % 12) + 1)}`;
}

/** 조회 기간 — 12개월 전 ~ 이번 달. 미래 달은 받지 않는다. */
export function myInvoicesRange(thisMonth: string): { from: string; to: string } {
  return { from: addMonths(thisMonth, -MY_INVOICES_HISTORY_MONTHS), to: thisMonth };
}

function statusOf(it: MyInvoice, asOf: Date): DisplayStatus {
  return displayInvoiceStatus({
    status: it.status,
    paidAmount: it.paidAmount,
    totalAmount: it.totalAmount,
    dueDate: localDayOf(it.dueDate),
    asOf,
  });
}

/** 아직 낼 것이 남은 상태. 과납 · 납부완료 · 취소는 끝난 장이다. */
const OPEN: ReadonlySet<DisplayStatus> = new Set(['unpaid', 'partial', 'pending']);

export interface ThisMonthLine {
  invoiceId: string;
  dueDate: string;
  totalAmount: number;
  paidAmount: number;
  status: DisplayStatus;
}

export interface ThisMonthCard {
  yearMonth: string;
  /** 카드 제목에 쓰는 달 — `11월`. */
  monthLabel: string;
  total: number;
  /** 남은 금액 — `summarizeInvoices` 의 미수금(과납은 섞지 않는다). */
  outstanding: number;
  /** 남은 장 중 가장 이른 기한. 다 냈으면 `null`. */
  dueDate: string | null;
  /** 남은 장이 없다. */
  paidUp: boolean;
  /** 취소를 뺀 장들 — 기한 순. */
  lines: ThisMonthLine[];
}

/** 「XX월 납부 안내」 카드. 이번 달에 (취소 아닌) 청구가 없으면 `null`. */
export function thisMonthCard(items: readonly MyInvoice[], asOf: Date): ThisMonthCard | null {
  const yearMonth = yearMonthOf(asOf);
  const month = items.filter((it) => it.yearMonth === yearMonth);
  const lines: ThisMonthLine[] = month
    .map((it) => ({
      invoiceId: it.invoiceId,
      dueDate: it.dueDate,
      totalAmount: it.totalAmount,
      paidAmount: it.paidAmount,
      status: statusOf(it, asOf),
    }))
    .filter((l) => l.status !== 'canceled')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.invoiceId.localeCompare(b.invoiceId));
  if (lines.length === 0) return null;

  const s = summarizeInvoices(month, asOf);
  const open = lines.filter((l) => OPEN.has(l.status));
  return {
    yearMonth,
    monthLabel: `${Number(yearMonth.slice(5, 7))}월`,
    total: s.total,
    outstanding: s.outstanding,
    dueDate: open.length > 0 ? open[0]!.dueDate : null,
    paidUp: open.length === 0,
    lines,
  };
}

export interface HistoryRow {
  yearMonth: string;
  /** `2026년 10월`. */
  label: string;
  total: number;
  /** 실제로 받은 금액 — 과납분까지. */
  paid: number;
  /** 그 달 장들 중 `order` 에서 가장 앞선 상태. */
  status: DisplayStatus;
}

/**
 * 지난 12개월 납부 내역 — 이번 달 · 미래 달은 뺀다. 최근 달부터.
 *
 * @param order 달 상태를 고르는 순서 — 화면의 `STATUS_ORDER`(할 일이 있는 것부터)를 넘긴다
 */
export function paymentHistory(
  items: readonly MyInvoice[],
  asOf: Date,
  order: readonly DisplayStatus[],
): HistoryRow[] {
  const thisMonth = yearMonthOf(asOf);
  const { from } = myInvoicesRange(thisMonth);
  const byMonth = new Map<string, MyInvoice[]>();
  for (const it of items) {
    if (it.yearMonth < from || it.yearMonth >= thisMonth) continue;
    const list = byMonth.get(it.yearMonth) ?? [];
    list.push(it);
    byMonth.set(it.yearMonth, list);
  }

  const rank = (st: DisplayStatus) => {
    const i = order.indexOf(st);
    return i < 0 ? order.length : i;
  };
  const rows: HistoryRow[] = [];
  for (const [yearMonth, list] of byMonth) {
    const statuses = list.map((it) => statusOf(it, asOf)).filter((st) => st !== 'canceled');
    if (statuses.length === 0) continue;
    const s = summarizeInvoices(list, asOf);
    rows.push({
      yearMonth,
      label: `${yearMonth.slice(0, 4)}년 ${Number(yearMonth.slice(5, 7))}월`,
      total: s.total,
      paid: s.received + s.overpaid,
      status: statuses.reduce((a, b) => (rank(b) < rank(a) ? b : a)),
    });
  }
  return rows.sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));
}

/**
 * 미납 안내 띠 — 미납 장이 있거나, 기한이 지났는데 남은 금액이 있는 부분납부 장이 있을 때(대표 결정 2026-11-08).
 * ★ 기한 당일은 아직 지나지 않았다(`displayInvoiceStatus` 와 같은 기준). 미래 달 장은 보지 않는다.
 */
export function showUnpaidNotice(items: readonly MyInvoice[], asOf: Date): boolean {
  const thisMonth = yearMonthOf(asOf);
  return items.some((it) => {
    if (it.yearMonth > thisMonth) return false;
    const st = statusOf(it, asOf);
    if (st === 'unpaid') return true;
    if (st !== 'partial') return false;
    const due = localDayOf(it.dueDate);
    return due !== null && daysBetweenLocal(due, asOf) > 0 && it.totalAmount - it.paidAmount > 0;
  });
}

/** [계좌 복사]가 복사하는 것 — `우리은행 1005-002-433395` → `1005-002-433395`. 번호가 없으면 그대로. */
export function accountNumberOf(bank: string): string {
  const m = /\d[\d-]*\d/.exec(bank);
  return m ? m[0] : bank;
}
