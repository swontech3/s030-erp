import { describe, it, expect } from 'vitest';
import { planTerminationChanges } from './invoice-plan.ts';

/**
 * [계약종료] 를 누를 때 청구서에 무슨 일이 일어나는가.
 *
 * 일할 금액 자체는 `contract-settlement.ts` 의 `computeTerminationSettlement` 이
 * 정한다(레거시 규칙 그대로). 여기서 정하는 것은 **어느 청구서를 어떻게 하는가**다.
 */

const MONTHLY_FEE = 500_000;
const VAT = 50_000;
const MONTHLY_TOTAL = MONTHLY_FEE + VAT; // 550,000
const DEPOSIT = 500_000;

function utc(y: number, m1: number, d: number): Date {
  return new Date(Date.UTC(y, m1 - 1, d));
}

/** 2026-03 부터 12장. 월납 계약이 확정될 때 만들어지는 모양이다. */
function twelveMonthlyInvoices() {
  const rows: { invoiceId: string; yearMonth: string; status: string }[] = [];
  for (let i = 0; i < 12; i += 1) {
    const monthIndex = 2026 * 12 + 2 + i;
    const y = Math.floor(monthIndex / 12);
    const m = (monthIndex % 12) + 1;
    const yearMonth = `${y}-${String(m).padStart(2, '0')}`;
    rows.push({ invoiceId: `inv-${yearMonth}`, yearMonth, status: i === 0 ? 'E' : 'P' });
  }
  return rows;
}

/** 기준가 = 계약가 — 할인이 없는 호실이라 환수도 0 이다. */
const SPACE = {
  seq: 1,
  standardFee: MONTHLY_FEE,
  deposit: DEPOSIT,
  monthlyFee: MONTHLY_FEE,
  vatYn: true,
};

const 월납계약 = {
  startDate: utc(2026, 3, 1),
  endDate: utc(2027, 2, 28),
  paymentMethod: 'M',
  freeMonths: 0,
  spaces: [SPACE],
};

/* ══════════════════════════════════════════════════════════════════════════
   ★ 경계 셋 — 종료일자가 원래 종료일보다 앞인가 · 같은가 · 뒤인가
   ══════════════════════════════════════════════════════════════════════════ */
describe('planTerminationChanges — 종료일자와 원래 종료일', () => {
  it('★ 같으면 아무것도 건드리지 않는다 (기간 만료·재계약이 이 길이다)', () => {
    const r = planTerminationChanges({
      ...월납계약,
      terminatedDate: utc(2027, 2, 28),
      totalPaid: MONTHLY_TOTAL * 12,
      invoices: twelveMonthlyInvoices(),
    });
    expect(r.untouched).toBe(true);
    expect(r.cancelInvoiceIds).toEqual([]);
    expect(r.prorate).toBeNull();
    expect(r.settlement).toBeNull();
  });

  /*
   * ★★ 종료일자가 원래 종료일보다 **뒤**인 경우는 규칙이 없다.
   *    청구서가 없는 달까지 쓴 셈이라 그 달을 새로 청구할지, 연장으로 볼지,
   *    막을지가 정해진 바 없다. 조용히 아무것도 안 하면 **공짜로 쓴 달**이 남는다.
   *    그래서 던진다 — 결정이 내려질 때까지 여기서 멈추는 편이 낫다.
   */
  it('★ 뒤면 던진다 — 규칙이 없다', () => {
    expect(() =>
      planTerminationChanges({
        ...월납계약,
        terminatedDate: utc(2027, 3, 1),
        totalPaid: MONTHLY_TOTAL * 12,
        invoices: twelveMonthlyInvoices(),
      }),
    ).toThrow(RangeError);
  });

  it('앞이면 손댄다', () => {
    const r = planTerminationChanges({
      ...월납계약,
      terminatedDate: utc(2026, 6, 15),
      totalPaid: MONTHLY_TOTAL * 4,
      invoices: twelveMonthlyInvoices(),
    });
    expect(r.untouched).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   월납 — 뒤 달은 취소, 해지 달은 일할, 앞 달은 그대로
   ══════════════════════════════════════════════════════════════════════════ */
describe('planTerminationChanges — 월납(M)', () => {
  const 해지 = () =>
    planTerminationChanges({
      ...월납계약,
      terminatedDate: utc(2026, 6, 15),
      totalPaid: MONTHLY_TOTAL * 4,
      invoices: twelveMonthlyInvoices(),
    });

  /*
   * ★★ **취소이지 삭제가 아니다.** 레거시는 미래 달 청구서를 DELETE 했다.
   *    지우면 "얼마를 청구했다가 왜 안 받았는지"가 사라진다 — 해지 분쟁에서
   *    필요한 것이 바로 그 기록이다.
   */
  it('★ 해지 달 다음 달부터 끝까지 취소한다 — 삭제가 아니다', () => {
    expect(해지().cancelInvoiceIds).toEqual([
      'inv-2026-07',
      'inv-2026-08',
      'inv-2026-09',
      'inv-2026-10',
      'inv-2026-11',
      'inv-2026-12',
      'inv-2027-01',
      'inv-2027-02',
    ]);
  });

  it('해지 달 청구서를 일할로 낮춘다', () => {
    // 6월은 30일, 15일까지 사용 → 550,000 × 15/30 = 275,000
    expect(해지().prorate).toEqual({
      invoiceId: 'inv-2026-06',
      supplyAmount: 250_000, // 500,000 × 15/30
      vatAmount: 25_000, // 275,000 − 250,000
      totalAmount: 275_000,
    });
  });

  it('★ 해지 달보다 앞선 달은 취소 목록에도 일할 대상에도 없다 — 정상 채무다', () => {
    const r = 해지();
    for (const ym of ['2026-03', '2026-04', '2026-05']) {
      expect(r.cancelInvoiceIds).not.toContain(`inv-${ym}`);
      expect(r.prorate?.invoiceId).not.toBe(`inv-${ym}`);
    }
  });

  it('★ 이미 취소된 청구서는 다시 취소하지 않는다', () => {
    const invoices = twelveMonthlyInvoices().map((row) =>
      row.yearMonth === '2026-09' ? { ...row, status: 'C' } : row,
    );
    const r = planTerminationChanges({
      ...월납계약,
      terminatedDate: utc(2026, 6, 15),
      totalPaid: MONTHLY_TOTAL * 4,
      invoices,
    });
    expect(r.cancelInvoiceIds).not.toContain('inv-2026-09');
    expect(r.cancelInvoiceIds).toHaveLength(7);
  });

  it('정산 한 줄 — 예치금 반환과 순정산금', () => {
    const r = 해지();
    // 실이용료 = 3개월 만액(3·4·5월) + 6월 일할 = 1,650,000 + 275,000
    expect(r.settlement?.usageCharge).toBe(1_925_000);
    expect(r.settlement?.depositReturn).toBe(DEPOSIT);
    // 순정산금 = 예치금 + (총수납 2,200,000 − 실이용료 1,925,000)
    expect(r.settlement?.netAmount).toBe(775_000);
    expect(r.settlement?.settleType).toBe('refund');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   일시불 — 장이 하나뿐이라 그 하나를 실이용료로 낮춘다
   ══════════════════════════════════════════════════════════════════════════ */
describe('planTerminationChanges — 일시불(C)', () => {
  const 일시불계약 = {
    startDate: utc(2026, 3, 1),
    endDate: utc(2027, 2, 28),
    paymentMethod: 'C',
    freeMonths: 0,
    spaces: [SPACE],
  };
  const 해지 = () =>
    planTerminationChanges({
      ...일시불계약,
      terminatedDate: utc(2026, 6, 15),
      totalPaid: MONTHLY_TOTAL * 12,
      invoices: [{ invoiceId: 'inv-lump', yearMonth: '2026-03', status: 'E' }],
    });

  it('취소할 장이 없다 — 애초에 한 장뿐이다', () => {
    expect(해지().cancelInvoiceIds).toEqual([]);
  });

  it('그 한 장을 실이용료 전체로 낮춘다', () => {
    expect(해지().prorate).toEqual({
      invoiceId: 'inv-lump',
      supplyAmount: 1_750_000, // (1,925,000 / 550,000) × 500,000
      vatAmount: 175_000,
      totalAmount: 1_925_000,
    });
  });

  it('순정산금은 선납분에서 실이용료를 뺀 것에 예치금을 더한 값이다', () => {
    // 6,600,000 − 1,925,000 = 4,675,000, + 예치금 500,000
    expect(해지().settlement?.netAmount).toBe(5_175_000);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   ★ 0원 계약 — 나눗셈이 있는 자리다
   ══════════════════════════════════════════════════════════════════════════ */
describe('planTerminationChanges — 월액이 0원인 계약', () => {
  it('★ NaN 을 만들지 않는다 (일시불 일할에 나눗셈이 있다)', () => {
    const r = planTerminationChanges({
      startDate: utc(2026, 3, 1),
      endDate: utc(2027, 2, 28),
      paymentMethod: 'C',
      freeMonths: 0,
      spaces: [{ seq: 1, standardFee: 0, deposit: 0, monthlyFee: 0, vatYn: false }],
      terminatedDate: utc(2026, 6, 15),
      totalPaid: 0,
      invoices: [{ invoiceId: 'inv-free', yearMonth: '2026-03', status: 'E' }],
    });
    expect(r.prorate).toEqual({
      invoiceId: 'inv-free',
      supplyAmount: 0,
      vatAmount: 0,
      totalAmount: 0,
    });
    expect(r.settlement?.netAmount).toBe(0);
    expect(r.settlement?.settleType).toBe('none');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   ★★★ 중도 해지 환수 — 정산 원장에만 들어간다
   ══════════════════════════════════════════════════════════════════════════
   금액 자체는 `contract-clawback.ts` 가 정한다. 여기서 보는 것은
   **언제 부르고 · 순정산금에 어떻게 반영되고 · 청구서를 안 건드리는가**다.
   ══════════════════════════════════════════════════════════════════════════ */

/** 기준가 300,000 · 계약가 270,000 — 월 30,000 할인. 예치금 0. */
const 할인호실 = {
  seq: 1,
  standardFee: 300_000,
  deposit: 0,
  monthlyFee: 270_000,
  vatYn: true,
};

describe('planTerminationChanges — 환수', () => {
  /** 2026-03-01 시작 3개월(무상 1) → 2026-05-31 종료 예정. 2026-05-15 해지. */
  const 해지 = (freeMonths: number) =>
    planTerminationChanges({
      startDate: utc(2026, 3, 1),
      endDate: utc(2026, 5, 31),
      terminatedDate: utc(2026, 5, 15),
      paymentMethod: 'M',
      freeMonths,
      spaces: [할인호실],
      totalPaid: 0,
      invoices: [
        { invoiceId: 'inv-2026-03', yearMonth: '2026-03', status: 'E' },
        { invoiceId: 'inv-2026-04', yearMonth: '2026-04', status: 'P' },
        { invoiceId: 'inv-2026-05', yearMonth: '2026-05', status: 'P' },
      ],
    });

  it('★ 지시서 사례 — 할인 환수 81,967 · 무상 환수 297,000', () => {
    const c = 해지(1).clawback;
    expect(c?.discountClawback).toBe(74_516 + 7_451);
    expect(c?.freeClawback).toBe(270_000 + 27_000);
  });

  it('★ 환수 합계가 순정산금에서 빠진다', () => {
    const r = 해지(1);
    // 실이용료 = 유료 온전 1달(4월) 297,000 + 5월 일할 round(297,000 × 15/31) = 143,710
    //   → 440,710 · 총수납 0 → rentNet = −440,710
    // 예치금 0 − 실이용료 440,710 − 환수(81,967 + 297,000)
    expect(r.settlement?.usageCharge).toBe(297_000 + 143_710);
    expect(r.settlement?.netAmount).toBe(-440_710 - 81_967 - 297_000);
    expect(r.settlement?.settleType).toBe('charge');
  });

  it('무상이 0 이면 무상 환수도 0 이고 할인 환수만 남는다', () => {
    const c = 해지(0).clawback;
    expect(c?.freeClawback).toBe(0);
    expect(c?.discountClawback).toBe(74_516 + 7_451);
  });

  /*
   * ★★ 환수는 **청구서를 건드리지 않는다.** 이미 나간 청구서를 소급해 고치면
   *    「그때 얼마를 청구했는지」가 사라지고 수납과도 어긋난다. 정산 원장이 말하고,
   *    실제로 받는 것은 운영자가 수납으로 넣는다.
   */
  it('★ 환수가 있어도 취소 목록과 일할 금액은 달라지지 않는다', () => {
    const 무상있음 = 해지(1);
    const 무상없음 = 해지(0);
    expect(무상있음.cancelInvoiceIds).toEqual(무상없음.cancelInvoiceIds);
    // 해지 달(5월)은 유료 달이라 두 경우 모두 일할이 같다
    expect(무상있음.prorate).toEqual(무상없음.prorate);
  });

  it('★ 기간 만료(종료일자 = 원래 종료일)면 환수가 없다', () => {
    const r = planTerminationChanges({
      startDate: utc(2026, 3, 1),
      endDate: utc(2026, 5, 31),
      terminatedDate: utc(2026, 5, 31),
      paymentMethod: 'M',
      freeMonths: 1,
      spaces: [할인호실],
      totalPaid: 0,
      invoices: [{ invoiceId: 'inv-2026-03', yearMonth: '2026-03', status: 'E' }],
    });
    expect(r.untouched).toBe(true);
    expect(r.clawback).toBeNull();
    expect(r.settlement).toBeNull();
  });
});

describe('planTerminationChanges — 무상 달에 해지', () => {
  /** 무상 1개월인데 그 달(3월) 15일에 나간다. */
  const 해지 = () =>
    planTerminationChanges({
      startDate: utc(2026, 3, 1),
      endDate: utc(2026, 5, 31),
      terminatedDate: utc(2026, 3, 15),
      paymentMethod: 'M',
      freeMonths: 1,
      spaces: [할인호실],
      totalPaid: 0,
      invoices: [
        { invoiceId: 'inv-2026-03', yearMonth: '2026-03', status: 'E' },
        { invoiceId: 'inv-2026-04', yearMonth: '2026-04', status: 'P' },
        { invoiceId: 'inv-2026-05', yearMonth: '2026-05', status: 'P' },
      ],
    });

  it('★ 실이용료가 0 이다 — 무상 달이라 낼 것이 없다', () => {
    expect(해지().settlement?.usageCharge).toBe(0);
  });

  it('★ 해지 달 청구서 일할도 0 이다 (원래 0원 장이었다)', () => {
    expect(해지().prorate?.totalAmount).toBe(0);
  });

  it('뒤 두 달은 취소된다', () => {
    expect(해지().cancelInvoiceIds).toEqual(['inv-2026-04', 'inv-2026-05']);
  });

  it('★ 쓴 만큼은 환수로 받는다 — 무상 15/31 + 할인 15/31', () => {
    const c = 해지().clawback;
    // 할인 round(30,000 × 15/31) = 14,516 + vat 1,451
    expect(c?.discountClawback).toBe(14_516 + 1_451);
    // 무상 round(270,000 × 15/31) = 130,645 + vat 13,064
    expect(c?.freeClawback).toBe(130_645 + 13_064);
  });
});
