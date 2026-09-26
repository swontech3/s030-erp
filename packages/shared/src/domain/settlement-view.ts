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
