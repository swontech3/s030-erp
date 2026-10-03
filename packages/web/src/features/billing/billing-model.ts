/**
 * 청구·납부 화면의 모델 — 월별 청구(s030200070) · 입주사 청구 탭 · 수납 창이 같이 쓴다.
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
import { localDayOf, summarizeInvoices, type InvoiceSummary } from '@swonbiz/shared/domain/invoice-summary';
import type { DepositEntryKind } from '@swonbiz/shared/domain/deposit-ledger';

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
  /* ── 아래 넷은 **그 계약의 값**이다 — 청구서의 값이 아니다 ──────────────────
     한 입주사가 계약을 여러 건 들고 있으면 줄마다 다르다. 계약 없는 청구서는 0·null. */
  /** 예치금 **장부 잔액** — 반환·차감하면 줄고, 반환 뒤에는 0 이다(사용자 결정). */
  deposit: number;
  /** 이용 시작일 `YYYY-MM-DD`. */
  usageStart: string | null;
  /** 이용 종료일 `YYYY-MM-DD` — 중도해지면 **종료일자**다. */
  usageEnd: string | null;
  /** 중도해지로 끝난 계약 — 종료일 뒤에 「해지」를 붙인다. */
  terminated: boolean;
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
  /**
   * 양수 = 환불 / 음수 = 추가청구. **10원 미만을 버린 값**이다.
   *
   * ★★ 원장에 저장된 값이고 화면은 그대로 보인다 — 정산서·정산 카드·정산 처리 기본값이
   *    다 이것이다. 화면이 따로 버리면 원장과 갈린다(`trimSettlementNet`, shared).
   */
  netAmount: number;
  /** 버린 금액(0 이상). 0 보다 크면 카드·정산서에 「절사」 줄을 보인다. */
  netTrim: number;
  settleType: string;
  /** 청구서에 들어가는 몫 = 총수납 − 실이용료. */
  rentNet: number;
  companyName: string;
  bizNumber: string;
  contractRoom: string;
  freeMonths: number;
  /** 부가세 포함 월액 — 실이용료를 「개월 + 일할」로 나누어 보여 줄 때 쓴다. */
  monthlyTotal: number;
  /** 환불 계좌 — **전체 번호**. 정산 카드와 정산서에서만 보인다. */
  refund: { bank: string; account: string; holder: string } | null;
  processed: {
    processedOn: string;
    amount: number;
    method: string;
    memo: string;
    paymentId: string | null;
  } | null;
}

/* ══════════════════════════════════════════════════════════════════════════
   상태 — 판정은 shared 의 `displayInvoiceStatus` 하나
   ══════════════════════════════════════════════════════════════════════════ */

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  pending: '납부대기',
  partial: '부분납부',
  unpaid: '미납',
  paid: '납부완료',
  canceled: '취소',
  // ★ 받은 것이 청구보다 많다 — 돌려줄 돈이 남았다. 「납부완료」로 보이면 끝난 장처럼 읽힌다.
  overpaid: '과납 · 정산 대기',
};

/** 필터 순서 — 할 일이 있는 것부터. */
export const STATUS_ORDER: readonly DisplayStatus[] = ['unpaid', 'overpaid', 'partial', 'pending', 'paid', 'canceled'];

/** 화면 상태 — 판정은 `displayInvoiceStatus` 한 곳이다. 납부일은 로컬 자정(`localDayOf`). */
export function statusOf(
  item: Pick<BillingItem, 'status' | 'paidAmount' | 'totalAmount' | 'dueDate'>,
  asOf: Date,
): DisplayStatus {
  return displayInvoiceStatus({
    status: item.status,
    paidAmount: item.paidAmount,
    totalAmount: item.totalAmount,
    dueDate: localDayOf(item.dueDate),
    asOf,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   합계 — 요약 카드와 표의 합계 줄이 **같은 함수**를 쓴다
   ══════════════════════════════════════════════════════════════════════════
   규칙과 시험은 shared 의 `invoice-summary.ts` 에 있다(웹에는 시험 러너가 없다).
   ★ 과납은 미수금에 더하지도 빼지도 않는다 — 다른 입주사의 미수금이 깎여 보였다(2026-09-26). */

export type BillingSummary = InvoiceSummary;

export function summarize(items: readonly BillingItem[], asOf: Date): BillingSummary {
  return summarizeInvoices(items, asOf);
}

/* ══════════════════════════════════════════════════════════════════════════
   청구 화면으로 가는 주소
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * 사이드바 「청구」(/billing) 주소 — 다른 화면이 처리를 **여기로 보낼 때** 쓴다.
 *
 *   company  그 입주사로 거른다(월을 넘기지 않고 전 기간)
 *   tab      'settle' 이면 정산 탭
 *   contract 정산 탭에서 그 계약의 정산 상세를 연다
 *
 * ★ 한 업무는 한 화면에서(CLAUDE.md) — 입주사 청구 탭·계약 폼은 버튼 대신 이 링크를 둔다.
 */
export function billingHref(p: { tab?: 'settle'; company?: string; contract?: string }): string {
  const sp = new URLSearchParams();
  if (p.tab) sp.set('tab', p.tab);
  if (p.company) sp.set('company', p.company);
  if (p.contract) sp.set('contract', p.contract);
  const q = sp.toString();
  return q ? `/billing?${q}` : '/billing';
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

/* ══════════════════════════════════════════════════════════════════════════
   예치금 · 정산 탭
   ══════════════════════════════════════════════════════════════════════════ */

/** 입주사의 예치금 — 계약마다. 보유액은 서버가 기록의 합으로 낸다(`depositBalance`). */
export interface ContractDeposit {
  contractId: string;
  balance: number;
  entries: { kind: DepositEntryKind; amount: number; entryOn: string; memo: string }[];
}

/** 정산 탭의 한 줄. `amount` 는 양수 = 돌려줄 돈 / 음수 = 받을 돈(순정산금과 같은 부호). */
export interface QueueItem {
  kind: 'settlement' | 'deposit';
  contractId: string;
  companyId: string;
  companyName: string;
  roomNames: string;
  /** 계약 시작일 `YYYY-MM-DD` — 목록의 「시작일」. */
  startDate: string;
  terminatedDate: string;
  amount: number;
  /** 처리 완료 줄에만. */
  processedOn?: string;
  /** 처리 완료 줄에만 — **가린** 계좌번호. */
  account?: string;
}
