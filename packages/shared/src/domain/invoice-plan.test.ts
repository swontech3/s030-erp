import { describe, it, expect } from 'vitest';
import { PAY_ITEM, billingDueDate, planInvoices } from './invoice-plan.ts';

/* ══════════════════════════════════════════════════════════════════════════
   납부일 — 「매달 계약 시작일과 같은 날」
   ══════════════════════════════════════════════════════════════════════════ */
describe('billingDueDate', () => {
  it('20일 입주면 그 달 20일이다', () => {
    expect(billingDueDate({ year: 2026, month: 10, billingDay: 20 })).toBe('2026-10-20');
  });

  it('31일 입주 — 31일이 있는 달은 31일이다', () => {
    expect(billingDueDate({ year: 2026, month: 1, billingDay: 31 })).toBe('2026-01-31');
  });

  it('★ 31일 입주 — 2월은 말일(28일)로 내린다', () => {
    expect(billingDueDate({ year: 2026, month: 2, billingDay: 31 })).toBe('2026-02-28');
  });

  it('★ 31일 입주 — 윤년 2월은 29일이다', () => {
    expect(billingDueDate({ year: 2028, month: 2, billingDay: 31 })).toBe('2028-02-29');
  });

  it('★ 31일 입주 — 30일까지인 달은 30일이다', () => {
    expect(billingDueDate({ year: 2026, month: 4, billingDay: 31 })).toBe('2026-04-30');
  });

  it('★ 29일 입주 — 평년 2월은 28일이다 (말일 처리는 31일만의 문제가 아니다)', () => {
    expect(billingDueDate({ year: 2026, month: 2, billingDay: 29 })).toBe('2026-02-28');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   청구서 계획
   ══════════════════════════════════════════════════════════════════════════ */

/** 월회비 500,000 · 부가세 50,000 · 납부액 550,000 짜리 호실 한 줄. */
const ROOM_A = {
  seq: 1,
  contractSpaceId: 'cs-a',
  monthlyFee: 500_000,
  vatAmount: 50_000,
  paymentAmount: 550_000,
};
/** 월회비 300,000 · 부가세 없음(`vat_yn` = false) 짜리 호실 한 줄. */
const ROOM_B = {
  seq: 2,
  contractSpaceId: 'cs-b',
  monthlyFee: 300_000,
  vatAmount: 0,
  paymentAmount: 300_000,
};

function utc(y: number, m1: number, d: number): Date {
  return new Date(Date.UTC(y, m1 - 1, d));
}

describe('planInvoices — 월납(M) 장수', () => {
  it('12개월이면 12장이다', () => {
    const plans = planInvoices({
      startDate: utc(2026, 3, 15),
      periodMonths: 12,
      paymentMethod: 'M',
      contractDate: '2026-03-10',
      spaces: [ROOM_A],
    });
    expect(plans).toHaveLength(12);
  });

  /*
   * ★★ 레거시가 여기서 한 장을 잃었다.
   *    레거시는 「시작월 포함, 종료월 미포함」으로 셌다(종료월 − 시작월).
   *    10월 1일 시작 12개월은 종료일이 **9월 30일**이라 종료월이 9월이고,
   *    10월→9월을 세면 **11장**이 나온다. 1일 시작 계약이 늘 한 장 모자랐다.
   *    장수는 날짜에서 유도하지 않는다 — `period_months` 가 곧 장수다.
   */
  it('★ 10월 1일 시작 12개월도 12장이다 (11장이 아니다)', () => {
    const plans = planInvoices({
      startDate: utc(2026, 10, 1),
      periodMonths: 12,
      paymentMethod: 'M',
      contractDate: '2026-09-25',
      spaces: [ROOM_A],
    });
    expect(plans).toHaveLength(12);
    expect(plans[0]?.yearMonth).toBe('2026-10');
    expect(plans[11]?.yearMonth).toBe('2027-09');
  });

  it('청구월은 시작월부터 한 달씩 이어진다 — 해를 넘어도 끊기지 않는다', () => {
    const plans = planInvoices({
      startDate: utc(2026, 11, 5),
      periodMonths: 4,
      paymentMethod: 'M',
      contractDate: null,
      spaces: [ROOM_A],
    });
    expect(plans.map((p) => p.yearMonth)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });
});

describe('planInvoices — 납부일', () => {
  it('매달 계약 시작일과 같은 날이다', () => {
    const plans = planInvoices({
      startDate: utc(2026, 3, 20),
      periodMonths: 3,
      paymentMethod: 'M',
      contractDate: null,
      spaces: [ROOM_A],
    });
    expect(plans.map((p) => p.dueDate)).toEqual(['2026-03-20', '2026-04-20', '2026-05-20']);
  });

  it('★ 31일 시작이면 그 날이 없는 달은 말일이다', () => {
    const plans = planInvoices({
      startDate: utc(2026, 1, 31),
      periodMonths: 4,
      paymentMethod: 'M',
      contractDate: null,
      spaces: [ROOM_A],
    });
    expect(plans.map((p) => p.dueDate)).toEqual([
      '2026-01-31',
      '2026-02-28', // 2월은 말일
      '2026-03-31',
      '2026-04-30', // 4월은 30일
    ]);
  });
});

describe('planInvoices — 첫 달', () => {
  it('첫 장만 납부완료(E)이고 나머지는 납부대기(P)다', () => {
    const plans = planInvoices({
      startDate: utc(2026, 3, 1),
      periodMonths: 3,
      paymentMethod: 'M',
      contractDate: '2026-02-25',
      spaces: [ROOM_A],
    });
    expect(plans.map((p) => p.status)).toEqual(['E', 'P', 'P']);
  });

  it('첫 장에만 수납 1건이 붙는다 — 입금일은 계약일자, 금액은 그 장의 합계', () => {
    const plans = planInvoices({
      startDate: utc(2026, 3, 1),
      periodMonths: 3,
      paymentMethod: 'M',
      contractDate: '2026-02-25',
      spaces: [ROOM_A],
    });
    expect(plans[0]?.payment).toEqual({ paidOn: '2026-02-25', amount: 550_000 });
    expect(plans[1]?.payment).toBeNull();
    expect(plans[2]?.payment).toBeNull();
  });

  it('계약일자가 없으면 입금일은 계약 시작일이다', () => {
    const plans = planInvoices({
      startDate: utc(2026, 3, 1),
      periodMonths: 2,
      paymentMethod: 'M',
      contractDate: null,
      spaces: [ROOM_A],
    });
    expect(plans[0]?.payment?.paidOn).toBe('2026-03-01');
  });

  it('★ 첫 달도 만액이다 — 달 중간에 시작해도 일할하지 않는다', () => {
    const plans = planInvoices({
      startDate: utc(2026, 3, 28),
      periodMonths: 2,
      paymentMethod: 'M',
      contractDate: null,
      spaces: [ROOM_A],
    });
    expect(plans[0]?.totalAmount).toBe(550_000);
  });
});

describe('planInvoices — 줄', () => {
  it('호실이 둘이면 한 장에 두 줄이고 합계는 두 줄의 합이다', () => {
    const plans = planInvoices({
      startDate: utc(2026, 3, 1),
      periodMonths: 1,
      paymentMethod: 'M',
      contractDate: null,
      spaces: [ROOM_A, ROOM_B],
    });
    expect(plans).toHaveLength(1);
    expect(plans[0]?.lines).toHaveLength(2);
    expect(plans[0]?.supplyAmount).toBe(800_000); // 500,000 + 300,000
    expect(plans[0]?.vatAmount).toBe(50_000); // 50,000 + 0
    expect(plans[0]?.totalAmount).toBe(850_000);
  });

  it('줄은 어느 계약 항목에서 왔는지와 무엇으로 왔는지를 달고 있다', () => {
    const plans = planInvoices({
      startDate: utc(2026, 3, 1),
      periodMonths: 1,
      paymentMethod: 'M',
      contractDate: null,
      spaces: [ROOM_A],
    });
    expect(plans[0]?.lines[0]).toEqual({
      seq: 1,
      payItem: PAY_ITEM.MONTHLY_FEE,
      contractSpaceId: 'cs-a',
      quantity: 1,
      unitPrice: 500_000,
      supplyAmount: 500_000,
      vatAmount: 50_000,
      totalAmount: 550_000,
    });
  });

  it('★ 예치금은 청구서에 들어가지 않는다 — 넣을 자리가 없다', () => {
    const plans = planInvoices({
      startDate: utc(2026, 3, 1),
      periodMonths: 1,
      paymentMethod: 'M',
      contractDate: null,
      spaces: [ROOM_A],
    });
    // 청구 합계는 월 납부액 그대로다. 예치금은 `contract_spaces.deposit` 에 남는다.
    expect(plans[0]?.totalAmount).toBe(ROOM_A.paymentAmount);
  });
});

describe('planInvoices — 일시불(C)', () => {
  it('전 기간을 1장으로 묶는다', () => {
    const plans = planInvoices({
      startDate: utc(2026, 3, 15),
      periodMonths: 12,
      paymentMethod: 'C',
      contractDate: '2026-03-10',
      spaces: [ROOM_A],
    });
    expect(plans).toHaveLength(1);
    expect(plans[0]?.yearMonth).toBe('2026-03');
    expect(plans[0]?.dueDate).toBe('2026-03-15');
  });

  /*
   * ★ 왜 월액 × 개월인가 — `floor(전 기간 공급가 × 10%)` 이 아니다.
   *   계약의 `vat_amount` 는 `floor(monthly_fee × 10%)` 로 이미 굳은 값이고,
   *   계약서와 첫달납부액(`calcFirstPayment`)이 그 값을 쓴다. 청구서만 다르게 세면
   *   같은 계약의 두 서류에 다른 부가세가 찍힌다.
   */
  it('금액은 월액 × 개월수이고 줄의 수량이 개월수다', () => {
    const plans = planInvoices({
      startDate: utc(2026, 3, 15),
      periodMonths: 12,
      paymentMethod: 'C',
      contractDate: null,
      spaces: [ROOM_A],
    });
    expect(plans[0]?.supplyAmount).toBe(500_000 * 12);
    expect(plans[0]?.vatAmount).toBe(50_000 * 12);
    expect(plans[0]?.totalAmount).toBe(550_000 * 12);
    expect(plans[0]?.lines[0]?.quantity).toBe(12);
    expect(plans[0]?.lines[0]?.unitPrice).toBe(500_000);
  });

  it('그 1장은 납부완료이고 수납 1건이 붙는다', () => {
    const plans = planInvoices({
      startDate: utc(2026, 3, 15),
      periodMonths: 12,
      paymentMethod: 'C',
      contractDate: '2026-03-10',
      spaces: [ROOM_A],
    });
    expect(plans[0]?.status).toBe('E');
    expect(plans[0]?.payment).toEqual({ paidOn: '2026-03-10', amount: 550_000 * 12 });
  });
});

describe('planInvoices — 막는 것', () => {
  it('★ 모르는 납부방법은 던진다 — 조용히 한 장도 안 만들지 않는다', () => {
    expect(() =>
      planInvoices({
        startDate: utc(2026, 3, 1),
        periodMonths: 12,
        paymentMethod: 'X',
        contractDate: null,
        spaces: [ROOM_A],
      }),
    ).toThrow(RangeError);
  });

  it('기간이 0 이하면 던진다', () => {
    expect(() =>
      planInvoices({
        startDate: utc(2026, 3, 1),
        periodMonths: 0,
        paymentMethod: 'M',
        contractDate: null,
        spaces: [ROOM_A],
      }),
    ).toThrow(RangeError);
  });

  it('계약 항목이 하나도 없으면 던진다 — 청구할 것이 없는 계약은 계약이 아니다', () => {
    expect(() =>
      planInvoices({
        startDate: utc(2026, 3, 1),
        periodMonths: 12,
        paymentMethod: 'M',
        contractDate: null,
        spaces: [],
      }),
    ).toThrow(RangeError);
  });
});
