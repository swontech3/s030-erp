import { describe, it, expect } from 'vitest';
import { maskAccount, settlementDirection } from './settlement-view.ts';

describe('settlementDirection — 「순정산금」 대신 방향이 드러나는 이름', () => {
  it('양수 → 환불할 금액', () => {
    expect(settlementDirection(466_667)).toEqual({ kind: 'refund', label: '환불할 금액', amount: 466_667 });
  });

  it('★ 음수 → 추가로 받을 금액 · 금액은 양수로', () => {
    expect(settlementDirection(-719_677)).toEqual({ kind: 'charge', label: '추가로 받을 금액', amount: 719_677 });
  });

  it('0 → 주고받을 금액 없음', () => {
    expect(settlementDirection(0)).toEqual({ kind: 'none', label: '주고받을 금액 없음', amount: 0 });
  });
});

describe('maskAccount — 목록에서 계좌번호를 가린다', () => {
  it('★ 끝 4자리만 남긴다 — 구분자는 그대로', () => {
    expect(maskAccount('110-123-456789')).toBe('***-***-**6789');
  });

  it('구분자가 없어도 끝 4자리', () => {
    expect(maskAccount('1002433395')).toBe('******3395');
  });

  it('4자리 이하는 전부 가린다 — 짧은 번호가 통째로 드러나지 않게', () => {
    expect(maskAccount('1234')).toBe('****');
  });

  it('빈 값은 빈 값', () => {
    expect(maskAccount('')).toBe('');
    expect(maskAccount(null)).toBe('');
  });
});

import { pendingKind } from './settlement-view.ts';

describe('pendingKind — 정산 탭의 처리 대기', () => {
  const base = { contractStatus: 'terminated', settlement: null, depositBalance: 0 } as const;

  it('★ 정산이 있고 처리 전이면 「중도해지 정산 대기」', () => {
    expect(pendingKind({ ...base, settlement: { processed: false }, depositBalance: 100_000 })).toBe('settlement');
  });

  it('★ 정산 없이 끝났고(기간 만료) 예치금이 남아 있으면 「예치금 반환 대기」', () => {
    expect(pendingKind({ ...base, depositBalance: 1_000_000 })).toBe('deposit');
  });

  it('정산을 처리했고 예치금도 0 이면 대기 아님', () => {
    expect(pendingKind({ ...base, settlement: { processed: true }, depositBalance: 0 })).toBeNull();
  });

  it('기간 만료로 끝났는데 예치금이 0 이면(재계약으로 이월) 대기 아님', () => {
    expect(pendingKind(base)).toBeNull();
  });

  it('★ 계약중인 계약은 예치금이 있어도 대기 아님 — 들고 있는 게 맞다', () => {
    expect(pendingKind({ ...base, contractStatus: 'confirmed', depositBalance: 1_000_000 })).toBeNull();
  });
});
