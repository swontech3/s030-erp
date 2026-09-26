import { describe, it, expect } from 'vitest';
import {
  depositBalance,
  planDepositOnConfirm,
  splitDepositOnSettle,
  type DepositEntry,
} from './deposit-ledger.ts';

const e = (kind: DepositEntry['kind'], amount: number): DepositEntry => ({ kind, amount });

describe('depositBalance — 보유액', () => {
  it('받음·이월(받음)은 더하고 이월(넘김)·반환·차감은 뺀다', () => {
    expect(
      depositBalance([e('receive', 1_000_000), e('carry_in', 500_000), e('deduct', 200_000), e('return', 300_000)]),
    ).toBe(1_000_000);
    expect(depositBalance([e('receive', 1_000_000), e('carry_out', 1_000_000)])).toBe(0);
  });

  it('기록이 없으면 0', () => {
    expect(depositBalance([])).toBe(0);
  });
});

describe('planDepositOnConfirm — 신규 확정', () => {
  it('★ 받음 1건 — 금액은 호실 예치금 합', () => {
    expect(planDepositOnConfirm({ depositTotal: 1_000_000, previous: null })).toEqual({
      current: [e('receive', 1_000_000)],
      previous: [],
      previousUnrecorded: false,
    });
  });

  it('★ 예치금 0원이면 아무것도 남기지 않는다', () => {
    expect(planDepositOnConfirm({ depositTotal: 0, previous: null }).current).toEqual([]);
  });
});

describe('planDepositOnConfirm — 재계약 확정', () => {
  it('★ 같은 금액이면 이월만 — 받음 없음', () => {
    expect(
      planDepositOnConfirm({ depositTotal: 1_000_000, previous: { balance: 1_000_000, hasRecords: true } }),
    ).toEqual({
      current: [e('carry_in', 1_000_000)],
      previous: [e('carry_out', 1_000_000)],
      previousUnrecorded: false,
    });
  });

  it('★ 새 계약이 더 많으면 차액만 받음', () => {
    const p = planDepositOnConfirm({ depositTotal: 1_500_000, previous: { balance: 1_000_000, hasRecords: true } });
    expect(p.current).toEqual([e('carry_in', 1_000_000), e('receive', 500_000)]);
    expect(p.previous).toEqual([e('carry_out', 1_000_000)]);
  });

  it('★ 새 계약이 더 적으면 차액만 반환', () => {
    const p = planDepositOnConfirm({ depositTotal: 600_000, previous: { balance: 1_000_000, hasRecords: true } });
    expect(p.current).toEqual([e('carry_in', 1_000_000), e('return', 400_000)]);
  });

  it('새 계약 예치금이 0 이면 넘겨받은 것 전부 반환', () => {
    const p = planDepositOnConfirm({ depositTotal: 0, previous: { balance: 1_000_000, hasRecords: true } });
    expect(p.current).toEqual([e('carry_in', 1_000_000), e('return', 1_000_000)]);
    expect(depositBalance(p.current)).toBe(0);
  });

  it('★ 이전 계약의 보유액이 0 이면(이미 돌려줬다) 신규처럼 받음', () => {
    const p = planDepositOnConfirm({ depositTotal: 1_000_000, previous: { balance: 0, hasRecords: true } });
    expect(p.current).toEqual([e('receive', 1_000_000)]);
    expect(p.previous).toEqual([]);
  });

  it('★★ 이전 계약에 장부가 아예 없으면 아무것도 남기지 않고 알린다 — 멈춤', () => {
    /*
     * 장부가 생기기 전에 확정된 계약이다. 그 예치금이 실제로 아직 우리에게 있는지
     * 장부는 모른다 — 「이월」로 적으면 확인 안 한 돈을 보유했다고 쓰는 것이고,
     * 「받음」으로 적으면 안 받은 돈을 받았다고 쓰는 것이다. 둘 다 지어내는 것이다.
     */
    expect(
      planDepositOnConfirm({ depositTotal: 1_000_000, previous: { balance: 0, hasRecords: false } }),
    ).toEqual({ current: [], previous: [], previousUnrecorded: true });
  });

  it('보유액은 언제나 새 계약 예치금과 같아진다', () => {
    for (const [total, bal] of [[1_000_000, 1_000_000], [1_500_000, 1_000_000], [600_000, 1_000_000], [0, 300_000]]) {
      const p = planDepositOnConfirm({ depositTotal: total!, previous: { balance: bal!, hasRecords: true } });
      expect(depositBalance(p.current)).toBe(total);
      expect(depositBalance([e('receive', bal!), ...p.previous])).toBe(0);
    }
  });

  it('음수 예치금은 던진다', () => {
    expect(() => planDepositOnConfirm({ depositTotal: -1, previous: null })).toThrow(RangeError);
  });
});

describe('splitDepositOnSettle — 정산 처리 때 반환·차감', () => {
  /*
   * 순정산금 = 예치금 + 이용료 차액 − 환수. 예치금은 **받을 돈을 먼저 메우고** 남는 만큼
   * 돌려준다. 받을 돈 = 예치금 − 순정산금.
   */
  it('순정산금이 예치금 이상이면 전액 반환 · 차감 0', () => {
    expect(splitDepositOnSettle({ held: 1_000_000, netAmount: 1_200_000 })).toEqual({ returned: 1_000_000, deducted: 0 });
    expect(splitDepositOnSettle({ held: 1_000_000, netAmount: 1_000_000 })).toEqual({ returned: 1_000_000, deducted: 0 });
  });

  it('★ 순정산금이 예치금보다 적으면 모자란 만큼 차감 — 나머지 반환', () => {
    expect(splitDepositOnSettle({ held: 1_000_000, netAmount: 400_000 })).toEqual({ returned: 400_000, deducted: 600_000 });
  });

  it('★ 순정산금이 0 이하(추가청구)면 전액 차감 · 반환 0', () => {
    expect(splitDepositOnSettle({ held: 100_000, netAmount: -719_677 })).toEqual({ returned: 0, deducted: 100_000 });
    expect(splitDepositOnSettle({ held: 100_000, netAmount: 0 })).toEqual({ returned: 0, deducted: 100_000 });
  });

  it('보유액이 0 이면 둘 다 0', () => {
    expect(splitDepositOnSettle({ held: 0, netAmount: 500_000 })).toEqual({ returned: 0, deducted: 0 });
  });

  it('반환 + 차감 = 보유액', () => {
    for (const net of [-5, 0, 1, 99_999, 100_000, 100_001]) {
      const s = splitDepositOnSettle({ held: 100_000, netAmount: net });
      expect(s.returned + s.deducted).toBe(100_000);
    }
  });
});
