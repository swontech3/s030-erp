/**
 * 예치금 장부 — 청구서와 **별도**다. 순수 함수. 정본은 이 파일과 `deposit-ledger.test.ts`.
 *
 * =============================================================================
 * ★★ 예치금은 청구서에 없는 돈이다
 * =============================================================================
 * 계약 확정 때 받고, 기간이 끝나거나 중도해지하면 돌려주거나(반환) 받을 돈을 메운다(차감).
 * 이 돈이 청구서에 섞이면 청구서 상태와 월별 미수금이 틀어진다(023 머리말). 그래서
 * 계약마다 장부를 따로 두고, 보유액은 **기록의 합**이다 — 칸에 적어 두지 않는다.
 *
 *   받음      receive    +   계약 확정 때 자동(호실 예치금 합 · 날짜는 계약일자)
 *   이월      carry_in   +   재계약 확정 — 이전 계약에서 넘겨받음
 *             carry_out  −   재계약 확정 — 이전 계약에서 넘겨줌
 *   반환      return     −   돌려줌 (정산 처리 · 기간 만료 반환 · 재계약 차액)
 *   차감      deduct     −   받을 돈을 예치금으로 메움 (정산 처리)
 *
 * ★ 금액은 언제나 **양수**로 적는다. 방향은 종류가 정한다 — 부호와 종류가 둘 다 방향을
 *   말하면 언젠가 둘이 어긋난다.
 */

export type DepositEntryKind = 'receive' | 'carry_in' | 'carry_out' | 'return' | 'deduct';

export interface DepositEntry {
  kind: DepositEntryKind;
  /** 언제나 양수. */
  amount: number;
}

export const DEPOSIT_ENTRY_LABEL: Record<DepositEntryKind, string> = {
  receive: '받음',
  carry_in: '이월',
  carry_out: '이월',
  return: '반환',
  deduct: '차감',
};

const INFLOW: ReadonlySet<DepositEntryKind> = new Set(['receive', 'carry_in']);

/** 보유액 = 들어온 것 − 나간 것. */
export function depositBalance(entries: readonly DepositEntry[]): number {
  return entries.reduce((sum, e) => sum + (INFLOW.has(e.kind) ? e.amount : -e.amount), 0);
}

export interface DepositConfirmPlan {
  /** 확정하는 계약에 남길 기록. */
  current: DepositEntry[];
  /** 이전 계약(재계약의 원래 계약)에 남길 기록. */
  previous: DepositEntry[];
  /**
   * 이전 계약에 장부가 아예 없다 — 장부가 생기기 전에 확정된 계약이다.
   * 아무것도 남기지 않았으니 **부르는 쪽이 알린다.**
   */
  previousUnrecorded: boolean;
}

/**
 * 계약 확정 때 남길 예치금 기록.
 *
 * @param depositTotal 확정하는 계약의 호실 예치금 합
 * @param previous     재계약이면 이전 계약의 보유액과 장부 유무. 신규면 `null`
 *
 * ★★ 재계약은 「받음」이 아니라 **「이월」**이다. 입주사는 예치금을 다시 내지 않았다 —
 *    우리가 들고 있던 것이 새 계약으로 옮겨 갈 뿐이다. 금액이 다르면 **차액만** 받거나
 *    돌려준다. 그래서 새 계약의 보유액은 언제나 새 계약의 예치금과 같아진다.
 *
 * ★★ 이전 계약에 장부가 **아예 없으면 아무것도 남기지 않는다.** 그 예치금이 아직 우리에게
 *    있는지 장부는 모른다. 「이월」로 적으면 확인 안 한 돈을 보유했다고 쓰는 것이고,
 *    「받음」으로 적으면 안 받은 돈을 받았다고 쓰는 것이다. 사람이 확인할 일이다.
 */
export function planDepositOnConfirm(args: {
  depositTotal: number;
  previous: { balance: number; hasRecords: boolean } | null;
}): DepositConfirmPlan {
  const { depositTotal, previous } = args;
  if (!Number.isInteger(depositTotal) || depositTotal < 0) {
    throw new RangeError(`예치금은 0 이상의 정수여야 한다: ${depositTotal}`);
  }

  if (previous !== null && !previous.hasRecords) {
    return { current: [], previous: [], previousUnrecorded: true };
  }

  const carried = previous !== null && previous.balance > 0 ? previous.balance : 0;
  if (carried === 0) {
    return {
      current: depositTotal > 0 ? [{ kind: 'receive', amount: depositTotal }] : [],
      previous: [],
      previousUnrecorded: false,
    };
  }

  const current: DepositEntry[] = [{ kind: 'carry_in', amount: carried }];
  const diff = depositTotal - carried;
  if (diff > 0) current.push({ kind: 'receive', amount: diff });
  if (diff < 0) current.push({ kind: 'return', amount: -diff });
  return { current, previous: [{ kind: 'carry_out', amount: carried }], previousUnrecorded: false };
}

/**
 * 중도해지 정산 처리 때 예치금을 반환·차감으로 나눈다.
 *
 * 순정산금 = 예치금 + 이용료 차액 − 환수 이므로, **받을 돈 = 예치금 − 순정산금** 이다.
 * 예치금은 받을 돈을 먼저 메우고(차감) 남는 만큼 돌려준다(반환).
 *   · 순정산금 ≥ 예치금  → 전액 반환 (넘는 부분은 이용료 과납이라 청구서 쪽 환불이다)
 *   · 0 < 순정산금 < 예치금 → 모자란 만큼 차감, 나머지 반환
 *   · 순정산금 ≤ 0       → 전액 차감 (그래도 모자라면 입주사가 더 낸다)
 */
export function splitDepositOnSettle(args: { held: number; netAmount: number }): {
  returned: number;
  deducted: number;
} {
  const { held, netAmount } = args;
  if (held <= 0) return { returned: 0, deducted: 0 };
  const deducted = Math.min(held, Math.max(0, held - netAmount));
  return { returned: held - deducted, deducted };
}
