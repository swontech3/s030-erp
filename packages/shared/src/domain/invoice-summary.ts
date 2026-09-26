/**
 * 청구 합계 — 월별 청구의 요약 카드와 표 합계 줄이 **같은 함수**를 쓴다. 순수 함수.
 *
 * =============================================================================
 * ★★★ 과납은 미수금에 더하지도 빼지도 않는다 (2026-09-26 재현)
 * =============================================================================
 * 예전에는 미수금 = 청구 − 수납 이었다. 월납 첫 달을 받고 그 달 중간에 해지하면 해지 달이
 * 청구 183,333 · 수납 550,000 이 되어 −366,667 이 섞였고, **다른 입주사의 미납 550,000 이
 * 183,333 으로 깎여** 보였다. 돌려줄 돈이 받을 돈을 지운 것이다.
 *
 *   받을 돈   미수금 = Σ max(0, 청구 − 수납)
 *   돌려줄 돈 과납   = Σ max(0, 수납 − 청구)       ← 정산 대기. 따로 센다
 *   수납 완료        = Σ min(수납, 청구)            ← 청구에 들어간 몫만
 *   그래서           청구 = 수납 완료 + 미수금     ← 카드 세 숫자가 서로 맞는다
 *
 * ★ 취소된 장은 어디에도 넣지 않는다 — 받지 않기로 한 돈이다. 그 장에 선납이 남아 있으면
 *   그것은 정산이 돌려줄 돈이고, 정산 처리가 음수 수납으로 0 을 만든다.
 *
 * ★ 상태 판정은 `displayInvoiceStatus` 하나다. 미납 건수도 그 함수가 unpaid 라고 한 장만 센다.
 */
import { displayInvoiceStatus } from './invoice-status.ts';

export interface SummaryInvoice {
  /** 저장상태 `P` / `E` / `C`. */
  status: string;
  totalAmount: number;
  paidAmount: number;
  /** 납부일 `YYYY-MM-DD`. */
  dueDate: string;
}

export interface InvoiceSummary {
  /** 취소를 뺀 장 수. */
  count: number;
  total: number;
  /** 청구에 들어간 수납 — 과납분은 뺀다. */
  received: number;
  /** 받을 돈 — 양수만. */
  outstanding: number;
  /** 돌려줄 돈 — 정산 대기. */
  overpaid: number;
  overpaidCount: number;
  unpaidCount: number;
  unpaidAmount: number;
}

/**
 * `YYYY-MM-DD` → **로컬 자정** `Date`. `displayInvoiceStatus` 가 로컬 날짜로 비교한다
 * (`day.ts` 머리말). 읽을 수 없으면 `null` — 기한 없음으로 본다.
 */
export function localDayOf(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

export function summarizeInvoices(items: readonly SummaryInvoice[], asOf: Date): InvoiceSummary {
  const s: InvoiceSummary = {
    count: 0,
    total: 0,
    received: 0,
    outstanding: 0,
    overpaid: 0,
    overpaidCount: 0,
    unpaidCount: 0,
    unpaidAmount: 0,
  };
  for (const it of items) {
    const st = displayInvoiceStatus({
      status: it.status,
      paidAmount: it.paidAmount,
      totalAmount: it.totalAmount,
      dueDate: localDayOf(it.dueDate),
      asOf,
    });
    if (st === 'canceled') continue;

    s.count += 1;
    s.total += it.totalAmount;
    s.received += Math.min(it.paidAmount, it.totalAmount);
    const left = it.totalAmount - it.paidAmount;
    if (left > 0) s.outstanding += left;
    if (left < 0) {
      s.overpaid += -left;
      s.overpaidCount += 1;
    }
    if (st === 'unpaid') {
      s.unpaidCount += 1;
      s.unpaidAmount += left;
    }
  }
  return s;
}
