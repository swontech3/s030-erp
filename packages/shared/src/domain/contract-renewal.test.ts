/**
 * 재계약 — 무엇을 이어받고 무엇을 새로 받는가, 그리고 **무엇을 «자기»로 보는가**.
 *
 * ★★ 이 파일의 절반은 `selfContractIds` 다. 재계약은 이전 계약이 **아직 살아 있는
 *    동안** 만들어진다(자동 종료가 없다). 그래서 이전 계약을 자기로 보지 않으면
 *    재계약이 **자기 이전 계약과 부딪혀 저장이 막힌다** — 계약호실 중복에서 한 번,
 *    호실 입주 계산에서 또 한 번.
 */
import { describe, it, expect } from 'vitest';
import { calcEndDate } from './contract-amounts.ts';
import {
  buildRenewalSeed,
  rejectRenewal,
  selfContractIds,
  type RenewalSource,
} from './contract-renewal.ts';

describe('selfContractIds', () => {
  it('신규 계약은 자기로 볼 계약이 없다', () => {
    expect(selfContractIds({ contractId: null, renewedFromContractId: null })).toEqual([]);
  });

  it('저장된 계약은 자기 자신을 자기로 본다', () => {
    expect(selfContractIds({ contractId: 'k-1', renewedFromContractId: null })).toEqual(['k-1']);
  });

  /** ★★ 재계약의 핵심. 아직 저장 전이라 자기 ID 는 없고, 이전 계약만 자기다. */
  it('★ 아직 저장 전인 재계약은 이전 계약을 자기로 본다', () => {
    expect(selfContractIds({ contractId: null, renewedFromContractId: 'k-0' })).toEqual(['k-0']);
  });

  /** 저장된 재계약을 다시 열어 고칠 때 — 둘 다 자기다. */
  it('★ 저장된 재계약은 자기와 이전 계약 둘 다 자기로 본다', () => {
    expect(selfContractIds({ contractId: 'k-1', renewedFromContractId: 'k-0' })).toEqual([
      'k-1',
      'k-0',
    ]);
  });

  it('빈 문자열과 중복은 떨어뜨린다 — 목록에 쓰레기를 넣지 않는다', () => {
    expect(selfContractIds({ contractId: '  ', renewedFromContractId: 'k-0' })).toEqual(['k-0']);
    expect(selfContractIds({ contractId: 'k-0', renewedFromContractId: 'k-0' })).toEqual(['k-0']);
  });
});

describe('buildRenewalSeed', () => {
  const prev: RenewalSource = {
    contractId: 'k-0',
    companyId: 'c-1',
    buildId: 'b-1',
    contractRoom: '6-1',
    paymentMethod: 'M',
    accessRoute: 'E',
    periodMonths: 12,
    spaces: [
      { roomType: 'VR', spaceId: 's-1', standardFee: 100000, deposit: 200000, monthlyFee: 90000, vatYn: true },
      { roomType: 'OF', spaceId: 's-2', standardFee: 500000, deposit: 1000000, monthlyFee: 500000, vatYn: false },
    ],
  };

  const TODAY = '2026-09-21';

  it('★ 이전 계약을 적어 둔다 — 어느 계약을 이어받았는지가 남는다', () => {
    expect(buildRenewalSeed(prev, TODAY).renewedFromContractId).toBe('k-0');
  });

  it('회사는 이전 계약과 같다 — 재계약은 같은 회사의 다음 계약이다', () => {
    expect(buildRenewalSeed(prev, TODAY).companyId).toBe('c-1');
  });

  it('★ 호실 줄을 금액째 그대로 이어받는다', () => {
    expect(buildRenewalSeed(prev, TODAY).spaces).toEqual(prev.spaces);
  });

  it('★ 납부방법·접근경로·계약호실·건물을 이어받는다', () => {
    const seed = buildRenewalSeed(prev, TODAY);
    expect(seed.paymentMethod).toBe('M');
    expect(seed.accessRoute).toBe('E');
    expect(seed.contractRoom).toBe('6-1');
    expect(seed.buildId).toBe('b-1');
  });

  it('★ 계약일자와 시작일은 오늘로 새로 받는다', () => {
    const seed = buildRenewalSeed(prev, TODAY);
    expect(seed.contractDate).toBe(TODAY);
    expect(seed.startDate).toBe(TODAY);
  });

  it('★ 기간은 이전과 같다', () => {
    expect(buildRenewalSeed(prev, TODAY).months).toBe('12');
  });

  /**
   * ★★ 종료일은 **씨앗에 없다.** 새 시작일과 기간으로 다시 계산되는 값이라
   *    이어받으면 그 순간 이전 계약의 종료일이 새 계약에 박힌다.
   */
  it('★ 종료일을 이어받지 않는다 — 새 시작일에서 다시 계산된다', () => {
    const seed = buildRenewalSeed(prev, TODAY);
    expect(seed).not.toHaveProperty('endDate');

    const start = new Date(Date.UTC(2026, 8, 21));
    expect(calcEndDate(start, Number(seed.months)).toISOString().slice(0, 10)).toBe('2027-09-20');
  });

  /** 상태·계약번호를 이어받을 자리가 없다 — 새 계약은 처음부터 시작한다. */
  it('상태를 이어받지 않는다', () => {
    expect(buildRenewalSeed(prev, TODAY)).not.toHaveProperty('status');
  });

  it('비어 있던 칸은 빈 문자열로 온다 — null 을 화면 입력값으로 흘리지 않는다', () => {
    const bare: RenewalSource = {
      ...prev,
      contractRoom: null,
      paymentMethod: null,
      accessRoute: null,
      periodMonths: null,
    };
    const seed = buildRenewalSeed(bare, TODAY);
    expect(seed.contractRoom).toBe('');
    expect(seed.paymentMethod).toBe('');
    expect(seed.accessRoute).toBe('');
    expect(seed.months).toBe('');
  });

  it('호실 줄이 없는 계약도 씨앗은 만들어진다 — 막는 것은 저장이다', () => {
    expect(buildRenewalSeed({ ...prev, spaces: [] }, TODAY).spaces).toEqual([]);
  });
});

describe('rejectRenewal', () => {
  const prev = { companyId: 'c-1', status: 'confirmed' };

  it('같은 회사의 계약이면 통과한다', () => {
    expect(rejectRenewal(prev, 'c-1')).toBeNull();
  });

  /** ★ 없는 계약을 가리키는 `?renewFrom=` 은 조용히 신규 계약이 되면 안 된다. */
  it('★ 이어받을 계약이 없으면 막는다', () => {
    expect(rejectRenewal(null, 'c-1')).toBe('이어받을 계약을 찾을 수 없습니다');
  });

  /**
   * ★★ 남의 계약을 이어받으면 **그 회사의 조건과 금액이 이 회사 계약에 복사된다.**
   *    URL 을 고치는 것만으로 되는 일이라 서버가 막는다.
   */
  it('★ 다른 입주사의 계약은 이어받을 수 없다', () => {
    expect(rejectRenewal(prev, 'c-2')).toBe('다른 입주사의 계약은 이어받을 수 없습니다');
  });

  /**
   * ★ 상태는 보지 않는다. 종료된 계약을 이어받는 것이 재계약의 원래 모습이고,
   *   계약중인 계약을 이어받는 것도 만기 전 갱신이라 정상이다.
   */
  it('종료·취소된 계약도 이어받을 수 있다', () => {
    expect(rejectRenewal({ companyId: 'c-1', status: 'terminated' }, 'c-1')).toBeNull();
    expect(rejectRenewal({ companyId: 'c-1', status: 'cancelled' }, 'c-1')).toBeNull();
  });
});
