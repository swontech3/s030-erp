/**
 * 청구 · 수납 목록(s030200070)의 거르기 · 이름 — 화면과 [엑셀 내려받기](API)가 **같은 함수**를 쓴다(2026-11-16).
 *
 * ★ 엑셀은 「지금 검색 결과 전체, 목록 칸 그대로」다. 화면이 거른 것과 API 가 거른 것이 다르면
 *   내려받은 파일이 화면과 다른 말을 한다 — 그래서 거르기 · 상태 이름 · 항목 글자를 여기 한 벌만 둔다.
 * ★ 상태 판정은 그대로 `displayInvoiceStatus` 하나다. 여기서는 그 결과를 묶고 이름을 붙일 뿐이다.
 */
import { displayInvoiceStatus, type DisplayStatus } from './invoice-status.ts';
import { localDayOf } from './invoice-summary.ts';

/** 화면 상태 이름 — 목록 뱃지 · 엑셀 「상태」 칸. */
export const DISPLAY_STATUS_LABEL: Record<DisplayStatus, string> = {
  pending: '납부대기',
  partial: '부분납부',
  unpaid: '미납',
  paid: '납부완료',
  canceled: '취소',
  // ★ 받은 것이 청구보다 많다 — 돌려줄 돈이 남았다. 「납부완료」로 보이면 끝난 장처럼 읽힌다.
  overpaid: '과납 · 정산 대기',
};

/**
 * 검색 상자 「상태」 — 공통 코드 `PAY_ST`(파티션 000)의 코드값으로 묶는다(2026-11-15).
 *   O 미납 = 미납 · P 납부대기 = 납부대기 + 부분납부(저장값 P) · E 납부완료 = 납부완료 + 과납(저장값 E) · C 취소 = 취소
 */
export function payStCodeOf(st: DisplayStatus): 'O' | 'P' | 'E' | 'C' {
  switch (st) {
    case 'unpaid':
      return 'O';
    case 'pending':
    case 'partial':
      return 'P';
    case 'paid':
    case 'overpaid':
      return 'E';
    case 'canceled':
      return 'C';
  }
}

/** 목록 「항목」 칸 — 「종류(호실)」 모양. 예: 이용료(FREE03). 호실이 없으면 종류만. */
export function invoiceItemLabel(roomNames: string): string {
  return roomNames ? `이용료(${roomNames})` : '이용료';
}

/** 거르기에 필요한 한 줄의 값. */
export interface BillingFilterRow {
  companyName: string;
  roomNames: string;
  dueDate: string;
  status: string;
  paidAmount: number;
  totalAmount: number;
}

/** 줄의 화면 상태 — `displayInvoiceStatus` 를 납부기한 로컬 자정으로 부른다. */
export function billingRowStatus(row: BillingFilterRow, asOf: Date): DisplayStatus {
  return displayInvoiceStatus({
    status: row.status,
    paidAmount: row.paidAmount,
    totalAmount: row.totalAmount,
    dueDate: localDayOf(row.dueDate),
    asOf,
  });
}

/**
 * 검색 조건에 맞는가 — 납부기한 From ~ To(빈 문자열 = 제한 없음) · 입주사/호실 글자 · 상태 코드(null = 전체).
 * ★ 글자는 대소문자를 가리지 않고 입주사 이름 · 호실 어느 쪽에 들어 있어도 맞다.
 */
export function matchesBillingFilter(
  row: BillingFilterRow,
  f: { from: string; to: string; q: string; st: string | null },
  asOf: Date,
): boolean {
  if (f.from && row.dueDate < f.from) return false;
  if (f.to && row.dueDate > f.to) return false;
  const q = f.q.trim().toLowerCase();
  if (q && !row.companyName.toLowerCase().includes(q) && !row.roomNames.toLowerCase().includes(q)) return false;
  if (f.st !== null && payStCodeOf(billingRowStatus(row, asOf)) !== f.st) return false;
  return true;
}
