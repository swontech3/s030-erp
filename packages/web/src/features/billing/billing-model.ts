/**
 * 청구·납부 화면의 모델 — 월별 청구(s0300200070) · 입주사 청구 탭 · 수납 창이 같이 쓴다.
 *
 * =============================================================================
 * ★★★ 화면 상태는 `displayInvoiceStatus` **하나**가 정한다
 * =============================================================================
 * 서버는 저장값(P/E/C)만 준다. 미납·부분납부는 「오늘」에 달린 사실이라 화면이 판정하고,
 * 그 판정은 shared 의 함수 하나다(시험이 붙어 있다). 이 파일은 그 결과에 **이름만** 붙인다.
 * 요약 카드의 「미납」도, 표의 뱃지도, 상태 필터도 전부 `statusOf` 를 거친다 — 한 군데라도
 * 따로 세면 카드와 표가 다른 숫자를 말한다.
 *
 * ★ 납부일은 **로컬 자정**으로 만든다. `daysBetweenLocal` 이 로컬 날짜를 보기 때문이다
 *   (`day.ts` 머리말). `parseDay` 는 UTC 자정이라 시간대가 음수인 곳에서는 하루 밀린다.
 */
import { displayInvoiceStatus, type DisplayStatus } from '@swonbiz/shared/domain/invoice-status';

/** 청구 목록 한 줄 — `GET /billing/invoices` · `GET /companies/:id/billing` 이 같은 모양이다. */
export interface BillingItem {
  invoiceId: string;
  companyId: string;
  companyName: string;
  contractId: string | null;
  /** `YYYY-MM`. */
  yearMonth: string;
  /** `YYYY-MM-DD`. */
  dueDate: string;
  totalAmount: number;
  paidAmount: number;
  outstanding: number;
  /** 저장값 `P` / `E` / `C`. 화면에 그대로 쓰지 않는다 — `statusOf` 를 거친다. */
  status: string;
  roomNames: string;
  /** 무상 달의 청구서인가. 금액이 0 이어도 「무상」으로 보여야 한다. */
  isFree: boolean;
  /** 무상으로 준 이용료(부가세 제외). */
  freeSupply: number;
}

export interface InvoiceLine {
  invoiceLineId: string;
  seq: number;
  roomName: string;
  isFree: boolean;
  quantity: number;
  unitPrice: number;
  supplyAmount: number;
  vatAmount: number;
  totalAmount: number;
}

export interface Payment {
  paymentId: string;
  /** `YYYY-MM-DD`. */
  paidOn: string;
  amount: number;
  /** 코드 `PAY_METHOD` — B 계좌이체 / C 카드. */
  payMethod: string;
  memo: string;
}

export interface InvoiceDetail {
  invoiceId: string;
  yearMonth: string;
  dueDate: string;
  supplyAmount: number;
  vatAmount: number;
  totalAmount: number;
  paidAmount: number;
  outstanding: number;
  status: string;
  lines: InvoiceLine[];
  payments: Payment[];
}

/** 정산 원장 한 줄 — 중도해지 계약마다 하나. */
export interface Settlement {
  settlementId: string;
  contractId: string;
  terminateDate: string;
  paymentMethod: string | null;
  startDate: string;
  endDate: string;
  roomNames: string;
  totalPaid: number;
  usageCharge: number;
  depositReturn: number;
  discountClawback: number;
  freeClawback: number;
  /** 양수 = 환불 / 음수 = 추가청구. */
  netAmount: number;
  settleType: string;
  /** 청구서에 들어가는 몫 = 총수납 − 실이용료. */
  rentNet: number;
  processed: {
    processedOn: string;
    amount: number;
    method: string;
    memo: string;
    paymentId: string | null;
  } | null;
}

/* ══════════════════════════════════════════════════════════════════════════
   상태
   ══════════════════════════════════════════════════════════════════════════ */

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  pending: '납부대기',
  partial: '부분납부',
  unpaid: '미납',
  paid: '납부완료',
  canceled: '취소',
};

/** 필터 순서 — 할 일이 있는 것부터. */
export const STATUS_ORDER: readonly DisplayStatus[] = ['unpaid', 'partial', 'pending', 'paid', 'canceled'];

/** `YYYY-MM-DD` → **로컬 자정** `Date`. 읽을 수 없으면 `null`. */
export function localDay(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** 화면 상태 — 판정은 `displayInvoiceStatus` 한 곳이다. */
export function statusOf(
  item: Pick<BillingItem, 'status' | 'paidAmount' | 'totalAmount' | 'dueDate'>,
  asOf: Date,
): DisplayStatus {
  return displayInvoiceStatus({
    status: item.status,
    paidAmount: item.paidAmount,
    totalAmount: item.totalAmount,
    dueDate: localDay(item.dueDate),
    asOf,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   합계 — 요약 카드와 표의 합계 줄이 **같은 함수**를 쓴다
   ══════════════════════════════════════════════════════════════════════════ */

export interface BillingSummary {
  /** 취소를 뺀 장 수. */
  count: number;
  total: number;
  paid: number;
  /** 미수금 = 청구 − 수납. */
  outstanding: number;
  unpaidCount: number;
  unpaidAmount: number;
}

/**
 * ★ **취소된 장은 합계에 넣지 않는다.** 받지 않기로 한 돈이다 — 넣으면 중도해지한
 *   계약의 남은 달이 전부 미수금으로 잡힌다.
 *
 * ★ 미수금은 `청구 − 수납` 이다. 줄마다 음수를 0 으로 자르지 않는다 — 자르면
 *   카드의 세 숫자(청구·수납·미수)가 서로 더해지지 않는다.
 *
 * ★ 예치금·환수는 여기에 **들어올 길이 없다.** 청구서에 있는 돈만 세고, 정산의 예치금
 *   반환과 환수는 정산 원장에만 있다(023). 정산 처리가 청구서에 넣는 것은 이용료 차액뿐이다.
 */
export function summarize(items: readonly BillingItem[], asOf: Date): BillingSummary {
  const sum: BillingSummary = { count: 0, total: 0, paid: 0, outstanding: 0, unpaidCount: 0, unpaidAmount: 0 };
  for (const item of items) {
    const st = statusOf(item, asOf);
    if (st === 'canceled') continue;
    sum.count += 1;
    sum.total += item.totalAmount;
    sum.paid += item.paidAmount;
    if (st === 'unpaid') {
      sum.unpaidCount += 1;
      sum.unpaidAmount += item.totalAmount - item.paidAmount;
    }
  }
  sum.outstanding = sum.total - sum.paid;
  return sum;
}

/* ══════════════════════════════════════════════════════════════════════════
   날짜·금액 표기
   ══════════════════════════════════════════════════════════════════════════ */

const pad = (n: number) => String(n).padStart(2, '0');

/** 이번 달 `YYYY-MM` — 로컬 기준. */
export function currentYearMonth(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

export function isYearMonth(s: string | null | undefined): s is string {
  return !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

export function shiftYearMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}

/** 「2026년 9월」. */
export function yearMonthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${y}년 ${m}월`;
}

/** 「2026.09」. */
export function yearMonthDot(ym: string): string {
  return ym.replace('-', '.');
}

/** 「09.25」 — 같은 해 안에서 읽는 납부일. */
export function monthDay(iso: string): string {
  return iso.length === 10 ? `${iso.slice(5, 7)}.${iso.slice(8, 10)}` : iso;
}

/** 「2026.09.25」. */
export function dotDate(iso: string): string {
  return iso.replace(/-/g, '.');
}

/** `₩1,234,000`. 음수면 `−₩1,234`. */
export function won(n: number): string {
  const abs = Math.abs(n).toLocaleString('ko-KR');
  return n < 0 ? `−₩${abs}` : `₩${abs}`;
}

/** 로컬 오늘 `YYYY-MM-DD`. */
export function localTodayIso(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export const PAY_METHOD_LABEL: Record<string, string> = { B: '계좌이체', C: '카드' };

/** 금액 입력 문자열 → 정수. 쉼표·공백을 지우고, 앞의 `-` 하나만 부호로 본다. */
export function parseMoneyInput(s: string): number | null {
  const cleaned = s.replace(/[,\s₩]/g, '');
  if (!/^-?\d+$/.test(cleaned)) return null;
  return Number(cleaned);
}

/** 입력 칸에 보일 모양 — `1,234,000` / `-1,234`. */
export function formatMoneyInput(s: string): string {
  const negative = s.trim().startsWith('-');
  const digits = s.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  if (digits === '') return negative ? '-' : '';
  return `${negative ? '-' : ''}${Number(digits).toLocaleString('ko-KR')}`;
}
