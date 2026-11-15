/**
 * 정산을 사람에게 보여 줄 때의 말 — 순수 함수. 정산 카드 · 정산 탭 · 정산서가 같이 쓴다.
 */

export type SettlementDirection =
  | { kind: 'refund'; label: '환불할 금액'; amount: number }
  | { kind: 'charge'; label: '추가로 받을 금액'; amount: number }
  | { kind: 'none'; label: '주고받을 금액 없음'; amount: 0 };

/**
 * 순정산금(양수 = 환불 / 음수 = 추가청구) → 방향이 드러나는 이름과 **양수** 금액.
 *
 * ★ 「순정산금 −719,677」은 누가 누구에게 주는 돈인지 읽는 사람이 부호를 해석해야 한다.
 *   종이에 찍히는 정산서에서는 그 해석이 틀리면 돈이 거꾸로 간다.
 */
export function settlementDirection(netAmount: number): SettlementDirection {
  if (netAmount > 0) return { kind: 'refund', label: '환불할 금액', amount: netAmount };
  if (netAmount < 0) return { kind: 'charge', label: '추가로 받을 금액', amount: -netAmount };
  return { kind: 'none', label: '주고받을 금액 없음', amount: 0 };
}

/**
 * 계좌번호 가리기 — 끝 4자리만 남긴다. 구분자(`-`)는 그대로 둔다.
 *
 * ★ 목록(정산 탭)에서 쓴다. 전체 번호는 정산 카드와 정산서에서만 보인다 — 거기가 실제로
 *   송금하는 사람이 보는 자리다.
 * ★ 4자리 이하는 전부 가린다. 짧은 번호가 통째로 드러나면 가린 뜻이 없다.
 */
export function maskAccount(account: string | null | undefined): string {
  const s = account ?? '';
  const digits = s.replace(/\D/g, '').length;
  let keep = digits > 4 ? 4 : 0;
  let out = '';
  for (let i = s.length - 1; i >= 0; i -= 1) {
    const ch = s[i]!;
    if (/\d/.test(ch)) {
      out = (keep > 0 ? ch : '*') + out;
      if (keep > 0) keep -= 1;
    } else {
      out = ch + out;
    }
  }
  return out;
}

export type PendingKind = 'settlement' | 'deposit';

/**
 * 정산 탭의 처리 대기 — 이 계약에 운영자가 할 일이 남았는가.
 *
 *   · 중도해지 정산이 있고 처리 전          → 'settlement' (정산 처리가 예치금까지 한 번에 한다)
 *   · 정산 없이 끝났는데 예치금이 남아 있다 → 'deposit'    (기간 만료 — 반환만 처리)
 *
 * ★ 계약중인 계약은 예치금이 있어도 대기가 아니다 — 들고 있는 것이 맞다.
 * ★ 재계약으로 끝난 계약은 예치금이 새 계약으로 이월되어 0 이다 — 대기가 아니다.
 */
export function pendingKind(args: {
  contractStatus: string;
  settlement: { processed: boolean } | null;
  depositBalance: number;
}): PendingKind | null {
  if (args.contractStatus !== 'terminated') return null;
  if (args.settlement && !args.settlement.processed) return 'settlement';
  if (args.depositBalance > 0) return 'deposit';
  return null;
}

/**
 * 정산 탭(s030200070 「정산」) 구분 · 상태 · 정산 기준일 — 대표 지시 2026-11-15.
 *
 * ★ 코드값은 공통 코드(일회용 37)의 것이다 — 이름(「중도해지」 · 「대기」 등)은 화면이 `GET /codes` 로 읽는다.
 *   여기는 코드값과 판정만 둔다. 「전체」는 화면에만 있다.
 *   · 구분 `SETTLE_TP`(000): EARLY 중도해지 · EXPIRE 기간만료
 *   · 상태 `SETTLE_ST`(000): WAIT 대기 · DONE 완료
 * ★ 중도해지 = 중도해지일이 **종료일보다 앞선다**. 같거나 뒤거나 없으면 기간만료다.
 * ★ 정산 기준일 = 중도해지면 중도해지일, 기간만료면 종료일 — 검색 기간이 이 날로 거른다.
 *   API 의 SQL(`listSettlementQueue`)도 같은 규칙으로 거른다 — 바꾸면 둘 다 바꾼다.
 */
export const SETTLE_TYPE_CATEGORY = 'SETTLE_TP';
export const SETTLE_STATUS_CATEGORY = 'SETTLE_ST';
export const SETTLE_CODE_USE_TP = '000';

export type SettleTypeCode = 'EARLY' | 'EXPIRE';
export type SettleStatusCode = 'WAIT' | 'DONE';

/** 앱이 박아 둔 코드값 — 코드 관리가 바꾸거나 지우지 못하게 `PINNED_CODES` 에도 적는다. */
export const SETTLE_TYPE_CODES: readonly SettleTypeCode[] = ['EARLY', 'EXPIRE'];
export const SETTLE_STATUS_CODES: readonly SettleStatusCode[] = ['WAIT', 'DONE'];

/** 구분 — `endDate` · `terminatedDate` 는 `YYYY-MM-DD`(중도해지일이 없으면 null). */
export function settleTypeOf(endDate: string, terminatedDate: string | null): SettleTypeCode {
  return terminatedDate !== null && terminatedDate < endDate ? 'EARLY' : 'EXPIRE';
}

/** 정산 기준일 — 중도해지면 중도해지일, 기간만료면 종료일. */
export function settleBasisDate(endDate: string, terminatedDate: string | null): string {
  return settleTypeOf(endDate, terminatedDate) === 'EARLY' ? (terminatedDate as string) : endDate;
}

/** 상태 — 운영자가 할 일이 남았으면(`pendingKind`) 대기, 아니면 완료. */
export function settleStatusOf(kind: PendingKind | null): SettleStatusCode {
  return kind === null ? 'DONE' : 'WAIT';
}
