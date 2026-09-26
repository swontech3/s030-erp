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
import { discountLabel, withDiscountLine } from './contract-memo.ts';
import {
  PREVIOUS_TERMINATION_REASON,
  buildRenewalSeed,
  isPreviousLive,
  rejectRenewal,
  rejectRenewalStart,
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
    // ★ 이전 계약이 **아직 살아 있다**(계약중). 시작일 규칙이 여기서 갈린다.
    status: 'confirmed',
    // ★ 실제 12개월 계약의 모양이다 — 2026-01-02 + 12개월 = 2027-01-01.
    //   앞뒤가 안 맞는 픽스처로 시험하면 규칙이 아니라 픽스처를 고정하게 된다.
    startDate: '2026-01-02',
    endDate: '2027-01-01',
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

  it('★ 계약일자는 오늘이다 — 오늘 맺는 계약이다', () => {
    expect(buildRenewalSeed(prev, TODAY).contractDate).toBe(TODAY);
  });

  /**
   * ★★ 이전 계약이 **살아 있으면** 시작일은 그 종료일 다음 날이다. 이어지는 계약이라
   *    하루도 비지 않고 겹치지도 않는다 — 오늘로 두면 만기 전에 미리 재계약할 때
   *    **아직 살아 있는 계약의 기간 위에 새 계약이 겹쳐 시작한다.**
   *
   * ★ 기본값일 뿐이다 — 운영자가 화면에서 바꿀 수 있다.
   */
  it('★★ 계약중인 이전 계약 → 시작일은 그 종료일 다음 날이다', () => {
    expect(buildRenewalSeed(prev, TODAY).startDate).toBe('2027-01-02');
  });

  /**
   * ★★ **기간 만료도 계약중이다.** 종료일이 지나도 상태는 `confirmed` 그대로이고
   *    호실도 계속 잡고 있다(자동 종료 배치가 없다). 그래서 같은 규칙을 쓴다 —
   *    시작일이 **과거 날짜로 채워지지만** 두 계약 사이에 공백이 생기지 않는다.
   */
  it('★★ 종료일이 지난 계약중(기간 만료)도 같은 규칙 — 과거 날짜로 이어진다', () => {
    const expired = { ...prev, status: 'confirmed', endDate: '2026-08-31' };
    expect(buildRenewalSeed(expired, TODAY).startDate).toBe('2026-09-01');
  });

  /**
   * ★★ 이전 계약이 **이미 닫혔으면** 이어붙일 것이 없다. 종료·취소된 계약의 종료일은
   *    지나간 날짜라 거기에 맞추면 **새 계약이 과거에서 시작한다.** 다시 들어오는
   *    계약이므로 오늘부터다.
   */
  it('★★ 종료된 이전 계약 → 시작일은 오늘이다', () => {
    expect(buildRenewalSeed({ ...prev, status: 'terminated' }, TODAY).startDate).toBe(TODAY);
  });

  it('★ 취소된 이전 계약도 오늘이다', () => {
    expect(buildRenewalSeed({ ...prev, status: 'cancelled' }, TODAY).startDate).toBe(TODAY);
  });

  it('★ 달을 넘긴다 — 31일 다음은 다음 달 1일이다', () => {
    expect(buildRenewalSeed({ ...prev, endDate: '2026-01-31' }, TODAY).startDate).toBe('2026-02-01');
  });

  it('★ 윤년을 안다 — 2028-02-28 다음은 29일이다', () => {
    expect(buildRenewalSeed({ ...prev, endDate: '2028-02-28' }, TODAY).startDate).toBe('2028-02-29');
  });

  /**
   * ★ 종료일이 없거나 읽을 수 없으면 **오늘**로 떨어진다. 시작일은 필수값이라
   *   빈 칸으로 두면 운영자가 왜 비었는지 모른 채 저장이 막힌다.
   */
  it('종료일이 없으면 오늘로 떨어진다', () => {
    expect(buildRenewalSeed({ ...prev, endDate: null }, TODAY).startDate).toBe(TODAY);
    expect(buildRenewalSeed({ ...prev, endDate: '' }, TODAY).startDate).toBe(TODAY);
  });

  it('없는 날짜를 조용히 다음 달로 넘기지 않는다 — 오늘로 떨어진다', () => {
    expect(buildRenewalSeed({ ...prev, endDate: '2026-02-31' }, TODAY).startDate).toBe(TODAY);
    expect(buildRenewalSeed({ ...prev, endDate: '2026-12-31T15:00:00.000Z' }, TODAY).startDate).toBe(
      TODAY,
    );
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
    // 씨앗에 종료일 칸 자체가 없다 — 있으면 이전 계약의 종료일이 새 계약에 박힌다.
    expect(seed).not.toHaveProperty('endDate');

    // 2027-01-02 + 12개월 = 2028-01-01. **이전 종료일(2027-01-01)이 아니다.**
    const start = new Date(Date.UTC(2027, 0, 2));
    expect(seed.startDate).toBe('2027-01-02');
    expect(calcEndDate(start, Number(seed.months)).toISOString().slice(0, 10)).toBe('2028-01-01');
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

  /* ══════════════════════════════════════════════════════════════════════
     특기사항 — **어느 계약을 이어받았는지 계약서에 남긴다**
     ══════════════════════════════════════════════════════════════════════
     `renewed_from_contract_id` 는 DB 안에만 있다. 이용계약서를 받는 입주사는 그것을
     볼 수 없으므로, 특기사항에 사람이 읽을 문장으로 남긴다 — 그대로 인쇄된다. */
  it('★★ 특기사항에 재계약 문구가 들어간다 — 이전 계약 기간을 적는다', () => {
    expect(buildRenewalSeed(prev, TODAY).memo).toBe('재계약 (이전 계약 기간 2026.01.02 ~ 2027.01.01)');
  });

  it('★ 종료·취소된 계약을 이어받을 때도 같은 문구다', () => {
    expect(buildRenewalSeed({ ...prev, status: 'terminated' }, TODAY).memo).toBe(
      '재계약 (이전 계약 기간 2026.01.02 ~ 2027.01.01)',
    );
  });

  /** ★ 기간을 읽을 수 없으면 **지어내지 않는다.** 「재계약」만 남긴다. */
  it('★ 기간을 읽을 수 없으면 「재계약」만 적는다', () => {
    expect(buildRenewalSeed({ ...prev, startDate: null }, TODAY).memo).toBe('재계약');
    expect(buildRenewalSeed({ ...prev, endDate: '2026-02-31' }, TODAY).memo).toBe('재계약');
  });

  /**
   * ★★ 화면은 금액이 바뀔 때마다 **첫 줄에** 할인 문구를 얹는다(`withDiscountLine`).
   *    재계약 문구가 첫 줄에 있으니 덮이는지가 문제인데 — **덮이지 않는다.**
   *    `withDiscountLine` 은 「기준가 대비 」로 시작하는 줄만 갈아 끼우기 때문이다.
   *
   * ★ 그 규칙과 이 문구가 **같은 저장소**(shared)에 있어야 이 시험이 성립한다.
   *   예전에는 `withDiscountLine` 이 웹에만 있어서 둘을 함께 걸 수 없었다.
   */
  it('★★ 할인 문구가 얹혀도 재계약 문구가 살아남는다', () => {
    const memo = buildRenewalSeed(prev, TODAY).memo;
    const withDiscount = withDiscountLine(memo, discountLabel(100_000, 90_000));

    expect(withDiscount.split('\n')[0]).toBe('기준가 대비 -10,000원 (10.0% 할인)');
    expect(withDiscount.split('\n')[1]).toBe(memo);
  });

  it('★ 할인이 사라져도 재계약 문구는 남는다', () => {
    const memo = buildRenewalSeed(prev, TODAY).memo;
    const once = withDiscountLine(memo, discountLabel(100_000, 90_000));
    // 금액을 기준가로 되돌리면 할인 문구가 빠진다 — 그때 재계약 문구까지 지우면 안 된다.
    expect(withDiscountLine(once, discountLabel(100_000, 100_000))).toBe(memo);
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


/* ══════════════════════════════════════════════════════════════════════════
   시작일 검사 — **이전 계약이 살아 있을 때만** 본다
   ══════════════════════════════════════════════════════════════════════════
   씨앗이 기본값을 넣지만 운영자가 바꿀 수 있어 검사가 따로 있다. 화면과 서버가
   **같은 함수**를 보고, 서버도 이전 계약 상태를 보고 검사 여부를 정한다.

   ★ 살아 있으면 겹치면 안 된다 — 두 계약이 같은 날 같은 호실을 들고, 그 상태는
     재계약 예외(`selfContractIds`)가 일부러 허용하는 모양이라 **아무도 못 알아챈다.**
   ★ 이미 닫혔으면 겹칠 상대가 없다 — 검사할 근거 자체가 없다. */
describe('rejectRenewalStart', () => {
  const live = { status: 'confirmed', endDate: '2026-12-31' };

  it('★ 종료일 다음 날이면 통과한다', () => {
    expect(rejectRenewalStart({ startDate: '2027-01-01', previous: live })).toBeNull();
  });

  it('그 뒤 날짜도 통과한다 — 비는 기간은 막지 않는다', () => {
    expect(rejectRenewalStart({ startDate: '2027-03-01', previous: live })).toBeNull();
  });

  /** ★★ 하루 겹침. 종료일 당일까지는 이전 계약이 살아 있다. */
  it('★★ 종료일 당일은 막힌다', () => {
    const message = rejectRenewalStart({ startDate: '2026-12-31', previous: live });
    expect(message).toContain('2026-12-31');
    expect(message).toContain('다음 날');
  });

  it('★ 종료일보다 앞이면 막힌다', () => {
    expect(rejectRenewalStart({ startDate: '2026-06-01', previous: live })).not.toBeNull();
  });

  /**
   * ★★ **기간 만료도 살아 있는 계약이다.** 종료일이 지나도 상태는 `confirmed` 이고
   *    호실을 계속 잡고 있으니 겹치면 안 되는 것도 같다.
   */
  it('★★ 종료일이 지난 계약중(기간 만료)도 검사한다', () => {
    const expired = { status: 'confirmed', endDate: '2026-08-31' };
    expect(rejectRenewalStart({ startDate: '2026-08-31', previous: expired })).not.toBeNull();
    expect(rejectRenewalStart({ startDate: '2026-09-01', previous: expired })).toBeNull();
  });

  /**
   * ★★★ 이전 계약이 **닫혔으면 검사하지 않는다.** 종료·취소된 계약의 종료일은 지나간
   *     날짜이고, 거기에 맞추라고 하면 **다시 들어오는 입주사가 과거부터 계약해야 한다.**
   */
  it('★★★ 종료된 이전 계약이면 어떤 날짜든 통과한다', () => {
    const closed = { status: 'terminated', endDate: '2026-12-31' };
    expect(rejectRenewalStart({ startDate: '2026-12-31', previous: closed })).toBeNull();
    expect(rejectRenewalStart({ startDate: '2020-01-01', previous: closed })).toBeNull();
    expect(rejectRenewalStart({ startDate: '2030-01-01', previous: closed })).toBeNull();
  });

  it('★ 취소된 이전 계약도 검사하지 않는다', () => {
    expect(
      rejectRenewalStart({ startDate: '2026-01-01', previous: { status: 'cancelled', endDate: '2026-12-31' } }),
    ).toBeNull();
  });

  /** ★ 검사할 근거가 없으면 통과시킨다 — 여기서 지어내지 않는다. */
  it('이전 계약이 없거나 종료일을 모르면 검사하지 않는다', () => {
    expect(rejectRenewalStart({ startDate: '2027-01-01', previous: null })).toBeNull();
    expect(rejectRenewalStart({ startDate: '2027-01-01', previous: { status: 'confirmed', endDate: null } })).toBeNull();
    expect(
      rejectRenewalStart({ startDate: '2027-01-01', previous: { status: 'confirmed', endDate: '2026-02-31' } }),
    ).toBeNull();
  });

  it('시작일을 읽을 수 없으면 여기서 막지 않는다 — 형식 검사는 다른 자리다', () => {
    expect(rejectRenewalStart({ startDate: '', previous: live })).toBeNull();
    expect(rejectRenewalStart({ startDate: '2027-01-01T00:00:00.000Z', previous: live })).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   이전 계약이 살아 있는가 — **두 규칙이 같은 판정을 본다**
   ══════════════════════════════════════════════════════════════════════════
   ① 확정할 때 이전 계약을 닫을지    ② 시작일을 이전 종료일에 이어붙일지
   둘 다 「아직 살아 있는가」 하나로 갈린다. 두 벌로 두면 한쪽만 고쳐져 갈린다. */
describe('isPreviousLive', () => {
  it('★ 계약중·계약대기는 살아 있다', () => {
    expect(isPreviousLive('confirmed')).toBe(true);
    expect(isPreviousLive('draft')).toBe(true);
  });

  /** ★ 이미 끝난 계약을 다시 닫으면 종료일자와 사유가 덮인다 — 남은 기록을 지운다. */
  it('★ 종료·취소는 살아 있지 않다', () => {
    expect(isPreviousLive('terminated')).toBe(false);
    expect(isPreviousLive('cancelled')).toBe(false);
  });

  it('모르는 상태는 살아 있지 않은 것으로 본다 — 모르면 손대지 않는다', () => {
    expect(isPreviousLive('zzz')).toBe(false);
  });

  it('사유 문구가 「재계약으로 계약 종료」다', () => {
    expect(PREVIOUS_TERMINATION_REASON).toBe('재계약으로 계약 종료');
  });
});


/* ══════════════════════════════════════════════════════════════════════════
   ★ 무상 개월수는 이어받지 않는다
   ══════════════════════════════════════════════════════════════════════════
   무상은 **처음 들어올 때 주는 혜택**이다. 재계약 때 자동으로 또 주면 운영자가
   의도하지 않은 무상이 조용히 따라붙고, 그건 중도 해지 환수 금액까지 바꾼다.
   필요하면 운영자가 화면에서 다시 넣는다.

   ★ `RenewalSource` 에 무상 칸을 **두지 않는 것**이 그 규칙의 표현이다 — 이어받을
     값이 애초에 없으니 실수로 이어받을 수도 없다.
   ══════════════════════════════════════════════════════════════════════════ */
describe('buildRenewalSeed — 무상 개월수', () => {
  const prev = {
    contractId: 'k-0',
    companyId: 'c-1',
    buildId: 'b-1',
    contractRoom: '6-1',
    paymentMethod: 'M',
    accessRoute: 'E',
    periodMonths: 12,
    status: 'confirmed',
    startDate: '2026-01-02',
    endDate: '2027-01-01',
    spaces: [
      { roomType: 'VR', spaceId: 's-1', standardFee: 100000, deposit: 200000, monthlyFee: 90000, vatYn: true },
    ],
  };

  it('★ 언제나 0 으로 시작한다', () => {
    expect(buildRenewalSeed(prev, '2027-01-02').freeMonths).toBe('0');
  });

  it('★ 이전 계약이 닫혀 있어도 0 이다', () => {
    expect(buildRenewalSeed({ ...prev, status: 'terminated' }, '2027-01-02').freeMonths).toBe('0');
  });
});
