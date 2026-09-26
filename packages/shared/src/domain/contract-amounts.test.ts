/**
 * 계약 금액 계산 규칙 — 테스트가 규칙의 기록이다.
 *
 * 정본은 `doc/CONTRACT_DATA_MODEL.md`. 시안(`s0300200040.html`)은 모양의 정본이지
 * 계산의 정본이 아니다 — 시안은 `Math.round`, 확정 규칙은 **버림**이다.
 */
import { describe, it, expect } from 'vitest';
import {
  VAT_RATE,
  PAYMENT_METHOD,
  calcRowAmounts,
  calcTotals,
  calcFirstPayment,
  calcEndDate,
  reconcileRowAmounts,
  ROOM_TYPE,
  calcSubleaseMonthlyPayment,
} from './contract-amounts';

/** 테스트용 줄 만들기 — 안 쓰는 칸은 0으로 채운다. */
const row = (monthlyFee: number, opts: { vatYn?: boolean; deposit?: number; standardFee?: number; seq?: number } = {}) => ({
  seq: opts.seq ?? 1,
  monthlyFee,
  deposit: opts.deposit ?? 0,
  standardFee: opts.standardFee ?? 0,
  vatYn: opts.vatYn ?? true,
});

/** UTC 고정 — 계산이 실행 머신의 표준시대에 흔들리면 안 된다. */
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const iso = (d: Date) => d.toISOString().slice(0, 10);

// ═══════════════════════════════════════════════════════════════════════════
// 부가세율
// ═══════════════════════════════════════════════════════════════════════════
describe('VAT_RATE', () => {
  it('세율이 상수 하나로 있고 10% 다', () => {
    expect(VAT_RATE.numerator / VAT_RATE.denominator).toBe(0.1);
  });

  it('정수 두 개로 되어 있다 — 부동소수점 상수가 아니다', () => {
    expect(Number.isInteger(VAT_RATE.numerator)).toBe(true);
    expect(Number.isInteger(VAT_RATE.denominator)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 호실 줄 하나 — 끝수 처리
// ═══════════════════════════════════════════════════════════════════════════
describe('calcRowAmounts — 끝수는 버림', () => {
  it('떨어지는 값: 400,000 → 부가세 40,000', () => {
    expect(calcRowAmounts(row(400_000)).vatAmount).toBe(40_000);
  });

  // ★ 이 테스트가 핵심이다. Math.round 면 10,000 이 나온다.
  it('안 떨어지는 값: 99,999 → 부가세 9,999 (round 면 10,000)', () => {
    expect(calcRowAmounts(row(99_999)).vatAmount).toBe(9_999);
  });

  it('1원 → 0', () => {
    expect(calcRowAmounts(row(1)).vatAmount).toBe(0);
  });

  it('9원 → 0', () => {
    expect(calcRowAmounts(row(9)).vatAmount).toBe(0);
  });

  it('10원 → 1', () => {
    expect(calcRowAmounts(row(10)).vatAmount).toBe(1);
  });

  it('0원 → 0', () => {
    expect(calcRowAmounts(row(0)).vatAmount).toBe(0);
  });

  it('납부액 = 월이용료 + 부가세액', () => {
    expect(calcRowAmounts(row(99_999))).toEqual({ vatAmount: 9_999, paymentAmount: 109_998 });
  });

  it('월이용료 0이면 계산은 되고 결과가 0이다 — 오류가 아니다', () => {
    expect(calcRowAmounts(row(0))).toEqual({ vatAmount: 0, paymentAmount: 0 });
  });
});

describe('calcRowAmounts — 부가세 대상 여부', () => {
  it('vat_yn=false 면 부가세 0, 납부액 = 월이용료', () => {
    expect(calcRowAmounts(row(500_000, { vatYn: false }))).toEqual({
      vatAmount: 0,
      paymentAmount: 500_000,
    });
  });

  it('vat_yn=false 는 끝수가 있어도 0이다', () => {
    expect(calcRowAmounts(row(99_999, { vatYn: false })).vatAmount).toBe(0);
  });
});

describe('calcRowAmounts — 부동소수점 오차가 없다', () => {
  // 99999 * 0.1 === 9999.900000000001 이다. 이 전제가 깨지면 테스트 의도가 바뀐다.
  it('곱셈 그대로면 오차가 실제로 난다는 전제 확인', () => {
    expect(99_999 * 0.1).not.toBe(9_999.9);
  });

  it('0원부터 20만원까지 1원 단위 전부, 정수 연산 기준값과 같다', () => {
    const mismatches: number[] = [];
    for (let fee = 0; fee <= 200_000; fee++) {
      const expected = (fee - (fee % 10)) / 10; // 정수만으로 구한 floor(fee/10)
      if (calcRowAmounts(row(fee)).vatAmount !== expected) mismatches.push(fee);
    }
    expect(mismatches).toEqual([]);
  });

  it('억 단위에서도 어긋나지 않는다', () => {
    expect(calcRowAmounts(row(123_456_789)).vatAmount).toBe(12_345_678);
    expect(calcRowAmounts(row(999_999_999)).vatAmount).toBe(99_999_999);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 합계 — 줄마다 계산해서 더한다
// ═══════════════════════════════════════════════════════════════════════════
describe('calcTotals', () => {
  it('호실 줄 0개면 합계가 전부 0이다 — 오류가 아니다', () => {
    expect(calcTotals([])).toEqual({
      deposit: 0,
      standardFee: 0,
      monthlyFee: 0,
      vatAmount: 0,
      monthlyPayment: 0,
    });
  });

  it('★ 월납부액 합계는 부가세를 포함한다', () => {
    const t = calcTotals([row(500_000, { seq: 1 })]);
    expect(t.monthlyFee).toBe(500_000); // 부가세 제외
    expect(t.vatAmount).toBe(50_000);
    expect(t.monthlyPayment).toBe(550_000); // ★ 포함
  });

  it('예치금·기준가도 줄별로 더한다', () => {
    const t = calcTotals([
      row(300_000, { seq: 1, deposit: 300_000, standardFee: 350_000 }),
      row(200_000, { seq: 2, deposit: 0, standardFee: 200_000 }),
    ]);
    expect(t.deposit).toBe(300_000);
    expect(t.standardFee).toBe(550_000);
    expect(t.monthlyFee).toBe(500_000);
  });

  it('한 계약에 vat_yn true 와 false 가 섞여도 합계가 맞는다', () => {
    const t = calcTotals([
      row(100_000, { seq: 1, vatYn: true }), // 부가세 10,000 · 납부 110,000
      row(100_000, { seq: 2, vatYn: false }), // 부가세      0 · 납부 100,000
    ]);
    expect(t.vatAmount).toBe(10_000);
    expect(t.monthlyPayment).toBe(210_000);
  });

  // ★ 이 테스트가 "합계에 한 번 매기면 되지"로 바꾸는 것을 막는다.
  it('★ 줄별 계산과 합계 계산이 1원 다르다 — 줄별이 맞다', () => {
    const t = calcTotals([row(99_999, { seq: 1 }), row(99_999, { seq: 2 })]);

    expect(t.vatAmount).toBe(19_998); // 9,999 + 9,999
    expect(Math.floor((99_999 + 99_999) * 0.1)).toBe(19_999); // 합계에 한 번 매기면 이 값
    expect(t.vatAmount).not.toBe(19_999);
    expect(t.monthlyPayment).toBe(219_996);
  });

  it('줄이 10개여도 줄별 합이다', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(99_999, { seq: i + 1 }));
    expect(calcTotals(rows).vatAmount).toBe(99_990); // 9,999 × 10
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 첫달납부액
// ═══════════════════════════════════════════════════════════════════════════
describe('calcFirstPayment', () => {
  const totals = calcTotals([row(500_000, { seq: 1, deposit: 1_000_000 })]);
  // monthlyPayment 550,000 · deposit 1,000,000

  it('월납 = 월납부액 합계 + 예치금 합계', () => {
    expect(calcFirstPayment({ totals, paymentMethod: PAYMENT_METHOD.MONTHLY, periodMonths: 12 }))
      .toBe(1_550_000);
  });

  it('일시불 = (월납부액 합계 × 기간) + 예치금 합계', () => {
    expect(calcFirstPayment({ totals, paymentMethod: PAYMENT_METHOD.LUMP_SUM, periodMonths: 12 }))
      .toBe(550_000 * 12 + 1_000_000);
  });

  it('기간 1개월이면 일시불과 월납이 같아진다', () => {
    const m = calcFirstPayment({ totals, paymentMethod: PAYMENT_METHOD.MONTHLY, periodMonths: 1 });
    const c = calcFirstPayment({ totals, paymentMethod: PAYMENT_METHOD.LUMP_SUM, periodMonths: 1 });
    expect(c).toBe(m);
  });

  it('★ 월납부액이 부가세 포함이라 첫달납부액도 부가세를 포함한다', () => {
    // 부가세를 빼고 계산하면 1,500,000 이 나온다. 10% 차이다.
    expect(calcFirstPayment({ totals, paymentMethod: PAYMENT_METHOD.MONTHLY, periodMonths: 12 }))
      .not.toBe(1_500_000);
  });

  it('예치금 0인 줄이 섞여 있어도 맞는다', () => {
    const t = calcTotals([
      row(300_000, { seq: 1, deposit: 500_000 }),
      row(200_000, { seq: 2, deposit: 0 }),
    ]);
    // 납부액 330,000 + 220,000 = 550,000 / 예치금 500,000
    expect(calcFirstPayment({ totals: t, paymentMethod: PAYMENT_METHOD.MONTHLY, periodMonths: 6 }))
      .toBe(1_050_000);
  });

  it('호실이 여러 개여도 줄별 합 위에서 계산한다', () => {
    const t = calcTotals([
      row(99_999, { seq: 1, deposit: 100 }),
      row(99_999, { seq: 2, deposit: 200 }),
      row(99_999, { seq: 3, deposit: 300 }),
    ]);
    // 납부액 109,998 × 3 = 329,994 / 예치금 600
    expect(calcFirstPayment({ totals: t, paymentMethod: PAYMENT_METHOD.LUMP_SUM, periodMonths: 3 }))
      .toBe(329_994 * 3 + 600);
  });

  it('호실 0개면 0이다', () => {
    const t = calcTotals([]);
    expect(calcFirstPayment({ totals: t, paymentMethod: PAYMENT_METHOD.LUMP_SUM, periodMonths: 12 }))
      .toBe(0);
  });

  it('납부방법이 코드값(M·C)이 아니면 던진다 — 화면 문자열("월납")을 받지 않는다', () => {
    expect(() => calcFirstPayment({ totals, paymentMethod: '월납', periodMonths: 12 })).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 무상 개월수 — 첫달납부액이 갈린다
// ═══════════════════════════════════════════════════════════════════════════
describe('calcFirstPayment — 무상 개월수', () => {
  const totals = calcTotals([row(500_000, { seq: 1, deposit: 1_000_000 })]);
  // monthlyPayment 550,000 · deposit 1,000,000

  /*
   * ★★ 무상 달에는 받을 돈이 없다. 월납에서 첫 달이 무상이면 첫달납부액은
   *    **예치금뿐**이다. 여기에 월납부액을 더하면 무상인데 돈을 받는 계약서가 된다.
   */
  it('★ 월납 + 무상이 있으면 예치금뿐이다', () => {
    expect(
      calcFirstPayment({
        totals,
        paymentMethod: PAYMENT_METHOD.MONTHLY,
        periodMonths: 12,
        freeMonths: 1,
      }),
    ).toBe(1_000_000);
  });

  it('월납 + 무상이 여러 달이어도 예치금뿐이다 (첫 달이 무상인 것은 같다)', () => {
    expect(
      calcFirstPayment({
        totals,
        paymentMethod: PAYMENT_METHOD.MONTHLY,
        periodMonths: 12,
        freeMonths: 3,
      }),
    ).toBe(1_000_000);
  });

  it('월납 + 무상 0 이면 지금 그대로다', () => {
    expect(
      calcFirstPayment({
        totals,
        paymentMethod: PAYMENT_METHOD.MONTHLY,
        periodMonths: 12,
        freeMonths: 0,
      }),
    ).toBe(1_550_000);
  });

  it('★ 일시불은 (기간 − 무상) × 월납부액 + 예치금이다', () => {
    expect(
      calcFirstPayment({
        totals,
        paymentMethod: PAYMENT_METHOD.LUMP_SUM,
        periodMonths: 12,
        freeMonths: 1,
      }),
    ).toBe(550_000 * 11 + 1_000_000);
  });

  it('무상을 안 넘기면 0 으로 본다 — 기존 호출이 그대로 돈다', () => {
    expect(calcFirstPayment({ totals, paymentMethod: PAYMENT_METHOD.MONTHLY, periodMonths: 12 })).toBe(
      1_550_000,
    );
  });

  /*
   * ★ 무상이 기간 이상이면 계약 전체가 무상이다. 그건 이용계약이 아니라 다른 것이고,
   *   일시불에서는 청구액이 0 이나 음수가 된다. 화면도 같은 검사를 한다.
   */
  it('★ 무상이 기간과 같으면 던진다', () => {
    expect(() =>
      calcFirstPayment({
        totals,
        paymentMethod: PAYMENT_METHOD.MONTHLY,
        periodMonths: 12,
        freeMonths: 12,
      }),
    ).toThrow(RangeError);
  });

  it('★ 무상이 기간보다 크면 던진다', () => {
    expect(() =>
      calcFirstPayment({
        totals,
        paymentMethod: PAYMENT_METHOD.LUMP_SUM,
        periodMonths: 6,
        freeMonths: 7,
      }),
    ).toThrow(RangeError);
  });

  it('무상이 음수면 던진다', () => {
    expect(() =>
      calcFirstPayment({
        totals,
        paymentMethod: PAYMENT_METHOD.MONTHLY,
        periodMonths: 12,
        freeMonths: -1,
      }),
    ).toThrow(RangeError);
  });

  it('무상이 정수가 아니면 던진다', () => {
    expect(() =>
      calcFirstPayment({
        totals,
        paymentMethod: PAYMENT_METHOD.MONTHLY,
        periodMonths: 12,
        freeMonths: 1.5,
      }),
    ).toThrow(RangeError);
  });

  /*
   * ★ 기간을 아직 안 적은 상태(0)로도 월납 첫달납부액이 나와야 한다 — 화면이
   *   입력 도중에 계속 부른다. 무상이 0 이면 비교할 것이 없으므로 통과시킨다.
   */
  it('무상 0 이면 기간이 아직 0 이어도 월납은 던지지 않는다', () => {
    expect(
      calcFirstPayment({
        totals,
        paymentMethod: PAYMENT_METHOD.MONTHLY,
        periodMonths: 0,
        freeMonths: 0,
      }),
    ).toBe(1_550_000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 종료일 = 시작일 + 기간(월) − 1일
// ═══════════════════════════════════════════════════════════════════════════
describe('calcEndDate', () => {
  it('1월 1일 + 12개월 = 12월 31일', () => {
    expect(iso(calcEndDate(utc(2026, 1, 1), 12))).toBe('2026-12-31');
  });

  it('12월 1일 + 1개월 = 12월 31일', () => {
    expect(iso(calcEndDate(utc(2026, 12, 1), 1))).toBe('2026-12-31');
  });

  it('12월 15일 + 1개월 = 이듬해 1월 14일 — 해를 넘긴다', () => {
    expect(iso(calcEndDate(utc(2026, 12, 15), 1))).toBe('2027-01-14');
  });

  // ★ 말일 처리. 시안은 JS Date 오버플로로 2026.03.02 를 낸다(2월 31일 → 3월 3일 → −1일).
  //   확정 규칙은 그 달의 말일로 맞춤이다.
  it('★ 1월 31일 + 1개월 = 2월 28일에 맞춘 뒤 −1일 = 2월 27일', () => {
    expect(iso(calcEndDate(utc(2026, 1, 31), 1))).toBe('2026-02-27');
  });

  it('★ 시안처럼 달을 넘기지 않는다 — 3월로 새지 않는다', () => {
    expect(iso(calcEndDate(utc(2026, 1, 31), 1))).not.toBe('2026-03-02');
    expect(calcEndDate(utc(2026, 1, 31), 1).getUTCMonth()).toBe(1); // 2월
  });

  it('1월 30일 + 1개월도 2월 말일로 맞춘다', () => {
    expect(iso(calcEndDate(utc(2026, 1, 30), 1))).toBe('2026-02-27');
  });

  it('윤년: 2028년 1월 31일 + 1개월 = 2월 29일 맞춤 → 2월 28일', () => {
    expect(iso(calcEndDate(utc(2028, 1, 31), 1))).toBe('2028-02-28');
  });

  it('8월 31일 + 6개월 = 2월 말일 맞춤 → 2월 27일', () => {
    expect(iso(calcEndDate(utc(2026, 8, 31), 6))).toBe('2027-02-27');
  });

  it('3월 31일 + 1개월 = 4월 30일 맞춤 → 4월 29일', () => {
    expect(iso(calcEndDate(utc(2026, 3, 31), 1))).toBe('2026-04-29');
  });

  // ★ 기간 0. 시안은 `if (!months) return ""` 로 아무 값도 내지 않는다.
  //   end_date 는 NOT NULL 이라 서버가 낼 값이 없다 → 오류로 정했다.
  it('★ 기간 0이면 던진다 — 계약 기간이 없는 계약은 없다', () => {
    expect(() => calcEndDate(utc(2026, 1, 1), 0)).toThrow();
  });

  it('기간이 음수여도 던진다', () => {
    expect(() => calcEndDate(utc(2026, 1, 1), -1)).toThrow();
  });

  it('기간이 정수가 아니면 던진다', () => {
    expect(() => calcEndDate(utc(2026, 1, 1), 1.5)).toThrow();
  });

  it('시작일을 변형하지 않는다 — 순수 함수다', () => {
    const start = utc(2026, 1, 31);
    calcEndDate(start, 1);
    expect(iso(start)).toBe('2026-01-31');
  });

  it('시작일의 시:분:초를 그대로 두지 않고 날짜만 다룬다', () => {
    const end = calcEndDate(new Date(Date.UTC(2026, 0, 1, 13, 45, 30)), 12);
    expect(iso(end)).toBe('2026-12-31');
    expect(end.getUTCHours()).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 화면 값 대조 — 서버 값이 정본이다
// ═══════════════════════════════════════════════════════════════════════════
describe('reconcileRowAmounts', () => {
  it('화면 값이 맞으면 어긋남이 없다', () => {
    const r = reconcileRowAmounts([
      { ...row(500_000, { seq: 1 }), vatAmount: 50_000, paymentAmount: 550_000 },
    ]);
    expect(r.mismatches).toEqual([]);
    expect(r.rows[0].vatAmount).toBe(50_000);
  });

  it('★ 화면이 반올림해서 올려도 서버 값(버림)을 쓴다', () => {
    const r = reconcileRowAmounts([
      // 시안의 Math.round 결과
      { ...row(99_999, { seq: 1 }), vatAmount: 10_000, paymentAmount: 109_999 },
    ]);
    expect(r.rows[0].vatAmount).toBe(9_999);
    expect(r.rows[0].paymentAmount).toBe(109_998);
  });

  it('어긋난 칸마다 경고를 남긴다 — 어느 줄 무엇이 얼마였는지', () => {
    const r = reconcileRowAmounts([
      { ...row(99_999, { seq: 3 }), vatAmount: 10_000, paymentAmount: 109_999 },
    ]);
    expect(r.mismatches).toEqual([
      { seq: 3, field: 'vatAmount', submitted: 10_000, server: 9_999 },
      { seq: 3, field: 'paymentAmount', submitted: 109_999, server: 109_998 },
    ]);
  });

  it('화면이 값을 안 보냈으면 어긋남이 아니다 — 서버가 채운다', () => {
    const r = reconcileRowAmounts([row(500_000, { seq: 1 })]);
    expect(r.mismatches).toEqual([]);
    expect(r.rows[0]).toMatchObject({ vatAmount: 50_000, paymentAmount: 550_000 });
  });

  it('vat_yn=false 인데 화면이 부가세를 보내면 어긋남이다', () => {
    const r = reconcileRowAmounts([
      { ...row(500_000, { seq: 2, vatYn: false }), vatAmount: 50_000 },
    ]);
    expect(r.rows[0].vatAmount).toBe(0);
    expect(r.mismatches).toEqual([
      { seq: 2, field: 'vatAmount', submitted: 50_000, server: 0 },
    ]);
  });

  it('줄이 여러 개면 어긋난 줄만 잡는다', () => {
    const r = reconcileRowAmounts([
      { ...row(500_000, { seq: 1 }), vatAmount: 50_000, paymentAmount: 550_000 },
      { ...row(99_999, { seq: 2 }), vatAmount: 10_000, paymentAmount: 109_998 },
    ]);
    expect(r.mismatches).toEqual([
      { seq: 2, field: 'vatAmount', submitted: 10_000, server: 9_999 },
    ]);
  });

  it('입력 배열을 변형하지 않는다 — 순수 함수다', () => {
    const input = [{ ...row(99_999, { seq: 1 }), vatAmount: 10_000 }];
    reconcileRowAmounts(input);
    expect(input[0].vatAmount).toBe(10_000);
  });

  it('줄이 없으면 빈 결과다', () => {
    expect(reconcileRowAmounts([])).toEqual({ rows: [], mismatches: [] });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 전대차계약서 월회비 — 비상주 특례
//
// 전대차계약서는 세무서 제출용이다. 비상주는 할인폭이 커서 실제 계약금액으로
// 내면 세무서가 인정하지 않는 경우가 많다 — 그래서 호실 지정금액(standard_fee)
// 으로 찍는다. 이용계약서는 지금 설계 그대로 실제 계약금액이다.
//
// ★ 계약 단위 판정이다. 줄마다 나누지 않는다.
// ═══════════════════════════════════════════════════════════════════════════

/** 계약구분이 붙은 줄. 전대차 판정에 계약구분이 필요하다. */
const docRow = (
  roomType: string,
  monthlyFee: number,
  standardFee: number,
  opts: { vatYn?: boolean; seq?: number } = {},
) => ({
  seq: opts.seq ?? 1,
  roomType,
  monthlyFee,
  standardFee,
  deposit: 0,
  vatYn: opts.vatYn ?? true,
});

describe('ROOM_TYPE — 계약구분 코드값', () => {
  it('비상주는 코드값 VR 이다 — 표시명이 아니다', () => {
    expect(ROOM_TYPE.VIRTUAL_OFFICE).toBe('VR');
  });
});

describe('calcSubleaseMonthlyPayment — 비상주 특례가 걸리는 경우', () => {
  it('비상주 1건이면 기준가로 찍는다', () => {
    // 기준가 300,000 + 부가세 30,000 = 330,000. 실계약가(100,000)를 쓰지 않는다.
    expect(calcSubleaseMonthlyPayment([docRow('VR', 100_000, 300_000)])).toBe(330_000);
  });

  it('비상주 2건이어도 기준가로 찍는다', () => {
    expect(
      calcSubleaseMonthlyPayment([
        docRow('VR', 100_000, 300_000, { seq: 1 }),
        docRow('VR', 90_000, 200_000, { seq: 2 }),
      ]),
    ).toBe(330_000 + 220_000);
  });

  it('★ 부가세는 기준가에서 다시 계산한다 — 실계약가 기준 부가세가 아니다', () => {
    // 기준가 99,999 → 버림 9,999. 실계약가(50,000) 기준이면 5,000 이 나온다.
    expect(calcSubleaseMonthlyPayment([docRow('VR', 50_000, 99_999)])).toBe(99_999 + 9_999);
  });

  it('vat_yn=false 인 줄은 기준가만 찍는다', () => {
    expect(calcSubleaseMonthlyPayment([docRow('VR', 100_000, 300_000, { vatYn: false })])).toBe(300_000);
  });
});

describe('calcSubleaseMonthlyPayment — 특례가 걸리지 않는 경우', () => {
  it('★ 비상주 3건이면 특례가 아니다 — 1~2건까지다', () => {
    const rows = [
      docRow('VR', 100_000, 300_000, { seq: 1 }),
      docRow('VR', 100_000, 300_000, { seq: 2 }),
      docRow('VR', 100_000, 300_000, { seq: 3 }),
    ];
    expect(calcSubleaseMonthlyPayment(rows)).toBe(330_000);
  });

  it('★ 2건 중 하나가 비상주가 아니면 계약 전체가 특례에서 빠진다', () => {
    const rows = [
      docRow('VR', 100_000, 300_000, { seq: 1 }),
      docRow('R1', 400_000, 450_000, { seq: 2 }),
    ];
    // 특례였다면 300,000+450,000 기준이 됐을 것이다. 실계약가 기준으로 간다.
    expect(calcSubleaseMonthlyPayment(rows)).toBe(110_000 + 440_000);
  });

  it('비상주가 하나도 없으면 실계약가 기준이다', () => {
    expect(calcSubleaseMonthlyPayment([docRow('R1', 400_000, 450_000)])).toBe(440_000);
  });

  it('특례가 아닐 때는 월납부액 합계와 같다', () => {
    const rows = [
      docRow('R1', 400_000, 450_000, { seq: 1 }),
      docRow('R2', 880_000, 880_000, { seq: 2 }),
    ];
    expect(calcSubleaseMonthlyPayment(rows)).toBe(calcTotals(rows).monthlyPayment);
  });

  it('★ 표시명 "비상주" 문자열은 비상주가 아니다 — 코드값으로만 판정한다', () => {
    expect(calcSubleaseMonthlyPayment([docRow('비상주', 100_000, 300_000)])).toBe(110_000);
  });

  it('호실이 0건이면 0이다', () => {
    expect(calcSubleaseMonthlyPayment([])).toBe(0);
  });
});

describe('calcSubleaseMonthlyPayment — 순수 함수', () => {
  it('입력 배열을 변형하지 않는다', () => {
    const rows = [docRow('VR', 100_000, 300_000)];
    const before = JSON.stringify(rows);
    calcSubleaseMonthlyPayment(rows);
    expect(JSON.stringify(rows)).toBe(before);
  });
});
