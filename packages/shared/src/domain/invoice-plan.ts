/**
 * 청구서 계획 — 순수 함수.
 *
 * 정본은 이 파일과 `invoice-plan.test.ts` 다.
 *
 * 계약 한 건을 받아 **무엇을 몇 장 청구할지**를 계산한다. DB · 현재 시각 · 난수를
 * 모른다 — 식별자도 여기서 만들지 않는다. 쓰는 쪽은 `packages/api/src/db/invoices.ts` 다.
 *
 * =============================================================================
 * ★★★ 장수는 `period_months` 다 — 날짜에서 유도하지 않는다
 * =============================================================================
 * 레거시는 「시작월 포함, 종료월 미포함」으로 셌다(종료월 − 시작월).
 * 종료일이 `시작일 + 기간 − 1일` 이라 **1일에 시작하는 계약은 종료월이 한 달 앞**이다.
 * 10월 1일 시작 12개월의 종료일은 9월 30일 → 10월에서 9월까지를 세면 **11장**.
 * 1일 시작 계약이 늘 한 장 모자랐고, 그 한 장은 아무도 청구하지 않았다.
 *
 * 기간이 곧 장수다. 날짜는 **납부일**을 정할 때만 쓴다.
 *
 * =============================================================================
 * ★★ 첫 달은 만액이다
 * =============================================================================
 * 달 중간에 들어와도 첫 달을 일할하지 않는다. 일할은 **중도해지에만** 있다
 * (`contract-settlement.ts`). 계약이 「20일 입주 → 매달 20일 납부」라 첫 달도
 * 한 달 치가 맞다 — 일할하면 마지막 달이 비는 셈이 된다.
 */
import {
  PAYMENT_METHOD,
  calcTotals,
  requireFreeMonths,
  type ContractSpaceAmounts,
} from './contract-amounts.ts';
import { computeClawback, type ClawbackResult } from './contract-clawback.ts';
import {
  computeTerminationSettlement,
  type TerminationSettlementResult,
} from './contract-settlement.ts';
import { toDay } from './day.ts';

/**
 * 청구 줄이 **어디서 온 금액인가** — 코드 `PAY_ITEM`.
 *
 * ★ 지금은 하나뿐이다. 그래도 칸을 두는 이유는, 나중에 주차·사물함·외부 회의실이
 *   같은 청구서에 **줄로 얹히기** 때문이다. 시안이 이미 그렇게 그려져 있다 —
 *   `design/erp-tenants/ErpTenants.dc.html` 의 청구 이력 탭 항목이
 *   「이용료 + 회의실 초과 2시간」이다.
 *
 *   칸 없이 시작하면 그때 가서 「줄이 무엇으로 청구된 것인지」를 되짚을 수 없다.
 *   나중에 붙이는 것보다 지금 한 칸 두는 쪽이 훨씬 싸다.
 *
 * ★★ **새 어휘를 만들지 않았다.** 코드 `PAY_ITEM`(납부Item)이 이미 코드 테이블에
 *    있고 뜻이 정확히 이것이다. `BILL_SOURCE` 같은 것을 새로 만들면 같은 개념에
 *    이름이 둘이 되고, 코드관리 화면이 생길 때 어느 쪽이 정본인지 다투게 된다.
 */
export const PAY_ITEM = {
  /** 월 이용료 — 계약 항목(`tb_s080_contract_spaces`)에서 온다. */
  MONTHLY_FEE: 'M',
} as const;

/** 청구 줄의 원천이 되는 계약 항목 한 줄. 금액은 계약 저장 때 서버가 확정한 값이다. */
export type InvoiceSourceRow = {
  /** 계약 항목의 표시 순서. 청구 줄도 같은 순서를 쓴다. */
  seq: number;
  contractSpaceId: string;
  /** 월 이용료 — **부가세 제외**. */
  monthlyFee: number;
  /** 부가세액. `vat_yn` 이 false 면 0. */
  vatAmount: number;
  /** 납부액 = `monthlyFee + vatAmount`. 계약 저장 때 서버가 계산해 박아 둔 값이다. */
  paymentAmount: number;
};

export type InvoiceLinePlan = {
  seq: number;
  /** `PAY_ITEM` 코드. */
  payItem: string;
  contractSpaceId: string;
  /**
   * 무상 달의 줄인가.
   *
   * ★ 줄을 **지우지 않고 남기는** 이유 — 무상 달에도 어느 호실을 썼는지가 남아야 한다.
   *   금액만 0 이고 `unitPrice` 에는 **얼마짜리를 무상으로 줬는지**가 그대로 있다.
   *   중도 해지 무상 환수가 그 값을 되짚을 근거이기도 하다.
   */
  isFree: boolean;
  /** 월납이면 1, 일시불이면 **청구하는** 개월수(기간 − 무상). */
  quantity: number;
  /** 단가 = 월 이용료. 무상 줄에서도 **지우지 않는다**. */
  unitPrice: number;
  supplyAmount: number;
  vatAmount: number;
  totalAmount: number;
};

/** 확정과 동시에 만드는 첫 달 수납 1건. */
export type FirstPaymentPlan = {
  /** 입금일 `YYYY-MM-DD` — 계약일자다. */
  paidOn: string;
  amount: number;
};

export type InvoicePlan = {
  /** 청구 연월 `YYYY-MM`. */
  yearMonth: string;
  /** 납부일 `YYYY-MM-DD`. */
  dueDate: string;
  /** 저장 상태 — `E` 납부완료(첫 장) / `P` 납부대기. 미납은 저장하지 않는다. */
  status: 'P' | 'E';
  supplyAmount: number;
  vatAmount: number;
  totalAmount: number;
  lines: InvoiceLinePlan[];
  /** 첫 장에만 붙는다. 나머지는 `null`. */
  payment: FirstPaymentPlan | null;
};

/** 그 달의 말일. `Date.UTC` 는 day=0 을 「전 달의 마지막 날」로 읽는다. */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * 그 달의 납부일 `YYYY-MM-DD`.
 *
 * ★ **없는 날짜는 말일로 내린다.** 31일 입주의 2월은 28(윤년 29)일이다.
 *   `Date.UTC(2026, 1, 31)` 은 오류가 아니라 **3월 3일**을 준다 — 그대로 두면
 *   2월 청구서의 납부일이 3월로 넘어가 3월 청구서보다 늦어진다.
 *
 * @param month 1-based (1 = 1월)
 */
export function billingDueDate(args: { year: number; month: number; billingDay: number }): string {
  const { year, month, billingDay } = args;
  const day = Math.min(billingDay, lastDayOfMonth(year, month));
  return toDay(new Date(Date.UTC(year, month - 1, day)));
}

/**
 * 계약 확정 시 만들 청구서 전부.
 *
 * @param contractDate 계약일자 `YYYY-MM-DD`. 첫 달 수납의 입금일이다.
 *   ★ 없으면 **계약 시작일**을 쓴다 — 입금일은 NOT NULL 이고, 지어낼 다른 날이 없다.
 *
 * 던지는 경우: 모르는 납부방법 · 기간이 1 미만 · 계약 항목 0행.
 */
export function planInvoices(args: {
  startDate: Date;
  periodMonths: number;
  /** 코드 `PAYMENT_METHOD` — `M` 월납 / `C` 일시불. */
  paymentMethod: string;
  contractDate: string | null;
  /**
   * 무상 개월수 — 계약 시작월부터 이 달 수만큼은 0원 청구다. 안 넘기면 0.
   *
   * ★★ 월납이면 앞의 `freeMonths` 장이 0원이고, **첫 유료 달이 첫 청구**다.
   *    그래서 첫 달이 무상이면 확정 시 **수납을 하나도 만들지 않는다** —
   *    0원 수납은 기록이 아니고(DB 가 막는다), 첫 유료 달은 아직 안 받은 돈이다.
   *
   * ★★ 일시불이면 장이 하나뿐이라 **(기간 − 무상) × 월액**을 한 번에 받는다.
   *    그 장에는 무상 표시가 없다 — 무상분을 이미 빼고 청구한 장이기 때문이다.
   */
  freeMonths?: number;
  spaces: readonly InvoiceSourceRow[];
}): InvoicePlan[] {
  const { startDate, periodMonths, paymentMethod, contractDate, spaces } = args;
  const freeMonths = requireFreeMonths(args.freeMonths, periodMonths);

  const monthly = paymentMethod === PAYMENT_METHOD.MONTHLY;
  const lumpSum = paymentMethod === PAYMENT_METHOD.LUMP_SUM;
  if (!monthly && !lumpSum) {
    throw new RangeError(
      `모르는 납부방법이다: '${paymentMethod}'. 코드 PAYMENT_METHOD 는 ` +
        `'${PAYMENT_METHOD.MONTHLY}' 월납 / '${PAYMENT_METHOD.LUMP_SUM}' 일시불 둘뿐이다`,
    );
  }
  if (!Number.isInteger(periodMonths) || periodMonths < 1) {
    throw new RangeError(`periodMonths 는 1 이상의 정수여야 한다: ${periodMonths}`);
  }
  if (spaces.length === 0) {
    throw new RangeError('계약 항목이 없다 — 청구할 것이 없는 계약은 계약이 아니다');
  }

  // 납부일의 「날」은 계약 시작일의 날이다. 20일 입주면 매달 20일이다.
  const billingDay = startDate.getUTCDate();
  const firstMonthIndex = startDate.getUTCFullYear() * 12 + startDate.getUTCMonth();

  /** 일시불은 전 기간을 1장으로 묶는다 — 줄의 수량이 **청구하는** 개월수가 된다. */
  const quantity = lumpSum ? periodMonths - freeMonths : 1;
  const sheets = lumpSum ? 1 : periodMonths;

  const paidOn = contractDate ?? toDay(startDate);

  /*
   * ★★ 확정과 동시에 수납이 붙는 장은 **하나뿐이고, 무상이 있으면 아예 없다.**
   *    · 일시불 — 장이 하나뿐이고 확정 때 전액을 받는다
   *    · 월납 + 무상 0 — 첫 달을 확정 때 받는다
   *    · 월납 + 무상 있음 — **아무것도 안 받는다.** 첫 장은 0원이고, 첫 유료 달은
   *      아직 안 받은 돈이다
   */
  const prepaidOffset = lumpSum || freeMonths === 0 ? 0 : -1;

  const plans: InvoicePlan[] = [];
  for (let offset = 0; offset < sheets; offset += 1) {
    const monthIndex = firstMonthIndex + offset;
    const year = Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;

    // 월납의 앞 `freeMonths` 장이 무상이다. 일시불은 무상분을 이미 빼고 청구한다.
    const free = !lumpSum && offset < freeMonths;

    const lines: InvoiceLinePlan[] = spaces.map((row) => ({
      seq: row.seq,
      payItem: PAY_ITEM.MONTHLY_FEE,
      contractSpaceId: row.contractSpaceId,
      isFree: free,
      quantity,
      // ★ 무상 줄에서도 단가는 지우지 않는다 — 얼마짜리를 무상으로 줬는지가 남는다.
      unitPrice: row.monthlyFee,
      supplyAmount: free ? 0 : row.monthlyFee * quantity,
      vatAmount: free ? 0 : row.vatAmount * quantity,
      totalAmount: free ? 0 : row.paymentAmount * quantity,
    }));

    const supplyAmount = lines.reduce((sum, line) => sum + line.supplyAmount, 0);
    const vatAmount = lines.reduce((sum, line) => sum + line.vatAmount, 0);
    const totalAmount = lines.reduce((sum, line) => sum + line.totalAmount, 0);

    /*
     * ★ 무상 장은 **납부완료(E)** 다. 받을 것이 없으니 이미 끝난 장이고, 납부대기로
     *   두면 0원짜리가 영원히 미납 목록에 남는다.
     */
    plans.push({
      yearMonth: `${year}-${String(month).padStart(2, '0')}`,
      dueDate: billingDueDate({ year, month, billingDay }),
      status: free || offset === prepaidOffset ? 'E' : 'P',
      supplyAmount,
      vatAmount,
      totalAmount,
      lines,
      payment: offset === prepaidOffset ? { paidOn, amount: totalAmount } : null,
    });
  }

  return plans;
}

/* ══════════════════════════════════════════════════════════════════════════
   [계약종료] 를 누를 때 청구서에 무슨 일이 일어나는가
   ══════════════════════════════════════════════════════════════════════════ */

/** 이미 만들어진 청구서 한 장 — 종료 처리에 필요한 칸만. */
export type ExistingInvoice = {
  invoiceId: string;
  /** `YYYY-MM`. */
  yearMonth: string;
  /** 저장 상태 `P` / `E` / `C`. */
  status: string;
};

/** 한 장을 이 금액으로 낮춘다. */
export type ProratedInvoice = {
  invoiceId: string;
  supplyAmount: number;
  vatAmount: number;
  totalAmount: number;
};

export type TerminationChanges = {
  /** 손댈 것이 없다 — 종료일자가 원래 종료일과 같은 경우다. */
  untouched: boolean;
  /** 취소할 청구서. **삭제가 아니다.** */
  cancelInvoiceIds: string[];
  /** 일할로 낮출 청구서 한 장. 대상이 없으면 `null`. */
  prorate: ProratedInvoice | null;
  /**
   * 중도 해지 환수 — 할인 환수와 무상 환수. `untouched` 면 `null`(환수 없음).
   *
   * ★ **정산 원장에만 들어간다.** 청구서를 소급해 고치지 않는다.
   */
  clawback: ClawbackResult | null;
  /** 정산 원장에 남길 한 줄. `untouched` 면 `null`. */
  settlement: TerminationSettlementResult | null;
};

/** 일할 대상 청구서의 줄 — 원래 금액만 있으면 된다. */
export type ProratableLine = {
  invoiceLineId: string;
  supplyAmount: number;
  vatAmount: number;
};

export type ProratedLine = ProratableLine & { totalAmount: number };

/**
 * 청구서 머리를 일할로 낮출 때 **줄도 같은 비율로 낮춘다.**
 *
 * ★★ 레거시는 줄에 `updateMany` 로 같은 금액을 **전부** 박았다. 레거시는 계약 1건 =
 *    호실 1개라 줄이 언제나 하나였고 그래서 드러나지 않았다. 지금은 계약 하나에
 *    호실이 최대 10개다 — 그대로 옮기면 **줄 합계가 머리의 10배**가 된다.
 *
 * ★★ **나머지는 마지막 줄이 흡수한다.** 비율로 나누면 반올림이 남는데, 아무도
 *    가져가지 않으면 줄 합계와 머리가 어긋나고 그 1원이 영원히 미수금으로 남는다.
 *    합이 목표와 **정확히** 같은 것이 이 함수의 계약이다.
 */
export function prorateInvoiceLines(args: {
  lines: readonly ProratableLine[];
  /** 청구서 전체의 일할 공급가. */
  supplyAmount: number;
  /** 청구서 전체의 일할 부가세. */
  vatAmount: number;
}): ProratedLine[] {
  const { lines, supplyAmount, vatAmount } = args;
  if (lines.length === 0) return [];

  const supplyBase = lines.reduce((sum, line) => sum + line.supplyAmount, 0);
  const vatBase = lines.reduce((sum, line) => sum + line.vatAmount, 0);

  let supplyLeft = supplyAmount;
  let vatLeft = vatAmount;

  return lines.map((line, index) => {
    const isLast = index === lines.length - 1;

    // ★ 마지막 줄은 계산하지 않고 **남은 것을 전부** 가져간다. 그래서 합이 맞는다.
    //   원래 금액 합이 0 이면 나눌 수 없으므로 앞 줄은 0 이고 마지막이 전부 가져간다.
    const supply = isLast
      ? supplyLeft
      : supplyBase === 0
        ? 0
        : Math.round((line.supplyAmount / supplyBase) * supplyAmount);
    const vat = isLast
      ? vatLeft
      : vatBase === 0
        ? 0
        : Math.round((line.vatAmount / vatBase) * vatAmount);

    supplyLeft -= supply;
    vatLeft -= vat;

    return {
      invoiceLineId: line.invoiceLineId,
      supplyAmount: supply,
      vatAmount: vat,
      totalAmount: supply + vat,
    };
  });
}

/** `YYYY-MM` → 월 인덱스(`year × 12 + month0`). 비교용. */
function yearMonthIndex(yearMonth: string): number {
  const [year, month] = yearMonth.split('-').map(Number) as [number, number];
  return year * 12 + (month - 1);
}

/**
 * 합계를 공급가와 부가세로 가른다 — **월 금액의 비율 그대로**.
 *
 * ★ 부가세를 `floor(공급가 × 10%)` 로 다시 세지 않는다. 일할한 뒤 다시 세면
 *   `공급가 + 부가세` 가 합계와 어긋나고, 그 1원이 미수금으로 영원히 남는다.
 *   공급가를 비율로 구한 뒤 **부가세는 나머지**로 둔다 — 합이 반드시 맞는다.
 *
 * ★ `monthlyTotal` 이 0 이면 나눗셈이 `NaN` 을 만든다. 0원 계약(무상 입주)이
 *   실제로 있을 수 있어 여기서 막는다 — `NaN` 은 DB 까지 조용히 흘러간다.
 */
function splitSupplyVat(
  total: number,
  monthlyFee: number,
  monthlyTotal: number,
): { supplyAmount: number; vatAmount: number; totalAmount: number } {
  if (monthlyTotal === 0) return { supplyAmount: 0, vatAmount: 0, totalAmount: 0 };
  const supplyAmount = Math.round((total / monthlyTotal) * monthlyFee);
  return { supplyAmount, vatAmount: total - supplyAmount, totalAmount: total };
}

/**
 * 중도해지 시 청구서에 가할 변경.
 *
 * 금액 규칙은 `computeTerminationSettlement`(레거시 그대로)이 정하고, 여기서는
 * **어느 장을 어떻게 할지**만 정한다.
 *
 * ★ 날짜 셋은 전부 **UTC 자정의 `Date`** 여야 한다. pg 가 주는 값을 그대로 넘기지
 *   말고 `parseDay(to_char(...))` 로 만들어 넘긴다 — `date` 와 `timestamp` 가 서로
 *   다른 시각으로 돌아와서, 섞으면 하루가 어긋난다.
 *
 * ★ 할인(`discountAmount`)은 0 을 넘긴다 — 이 저장소에 할인 칸이 없다.
 *   `contract-settlement.ts` 머리말 참조.
 */
export function planTerminationChanges(args: {
  startDate: Date;
  /** 계약의 원래 종료일. */
  endDate: Date;
  /** 실제로 끝내는 날. */
  terminatedDate: Date;
  /** 코드 `PAYMENT_METHOD`. */
  paymentMethod: string;
  /** 무상 개월수. 실이용료에서 빠지고, 환수에서 따로 받는다. */
  freeMonths: number;
  /**
   * 계약 항목 전부 — 기준가·계약가·예치금·부가세 여부.
   *
   * ★ 합계를 미리 계산해 넘기지 않는다. **환수는 줄마다 계산해야** 하고(부가세가
   *   줄 단위로 버려진다), 합계도 같은 목록에서 `calcTotals` 로 낸다 — 한 곳에서 나온
   *   값이라야 실이용료와 환수가 같은 계약을 본다.
   */
  spaces: readonly ContractSpaceAmounts[];
  /** 이 계약에 지금까지 들어온 수납 합계. */
  totalPaid: number;
  invoices: readonly ExistingInvoice[];
}): TerminationChanges {
  const { startDate, endDate, terminatedDate, paymentMethod, freeMonths, spaces, totalPaid, invoices } =
    args;

  const totals = calcTotals(spaces);
  const monthlyFee = totals.monthlyFee;
  const vatAmount = totals.vatAmount;
  const deposit = totals.deposit;

  const endAt = endDate.getTime();
  const termAt = terminatedDate.getTime();

  /*
   * ★★ 원래 종료일보다 **뒤**로 끝내는 규칙이 없다. 청구서가 없는 달까지 쓴 셈인데
   *    그 달을 새로 청구할지, 연장으로 볼지, 아예 막을지가 정해진 바 없다.
   *    조용히 지나가면 **공짜로 쓴 달**이 남는다. 결정이 내려질 때까지 멈춘다.
   */
  if (termAt > endAt) {
    throw new RangeError(
      `종료일자(${toDay(terminatedDate)})가 계약 종료일(${toDay(endDate)})보다 뒤다. ` +
        '계약 기간을 넘겨 끝내는 규칙이 아직 없다 — 기간을 늘리려면 재계약이다',
    );
  }

  // ★ 원래 종료일 그대로 끝나는 길이다(기간 만료·재계약으로 인한 종료).
  //   청구서는 이미 마지막 달까지 맞게 만들어져 있다. 손대면 오히려 틀어진다.
  if (termAt === endAt) {
    return { untouched: true, cancelInvoiceIds: [], prorate: null, clawback: null, settlement: null };
  }

  /*
   * ★★★ 환수는 **중도 해지에서만** 생긴다. 위에서 이미 「원래 종료일과 같으면
   *    돌아간다」로 걸렀으므로, 여기 오면 계약을 다 못 채운 것이 확정이다.
   *    계약을 다 채웠는데 환수하면 할인해 준 적이 없는 셈이 된다.
   */
  const clawback = computeClawback({ startDate, terminateDate: terminatedDate, freeMonths, spaces });

  const settlement = computeTerminationSettlement({
    startDate,
    terminateDate: terminatedDate,
    monthlyRent: monthlyFee,
    taxFee: vatAmount,
    deposit,
    // ★ 환수 합계가 순정산금에서 빠진다. 나누어 보관하는 것은 정산 원장의 일이다.
    clawbackTotal: clawback.total,
    freeMonths,
    totalRentPaid: totalPaid,
  });

  const monthlyTotal = monthlyFee + vatAmount;
  const live = invoices.filter((row) => row.status !== 'C');

  // ── 일시불: 장이 하나뿐이다. 그 하나를 실이용료 전체로 낮춘다 ──────────────
  if (paymentMethod === PAYMENT_METHOD.LUMP_SUM) {
    const sheet = [...live].sort((a, b) => yearMonthIndex(a.yearMonth) - yearMonthIndex(b.yearMonth))[0];
    return {
      untouched: false,
      cancelInvoiceIds: [],
      prorate: sheet
        ? { invoiceId: sheet.invoiceId, ...splitSupplyVat(settlement.usageCharge, monthlyFee, monthlyTotal) }
        : null,
      clawback,
      settlement,
    };
  }

  // ── 월납: 뒤 달은 취소, 해지 달은 일할, 앞 달은 그대로 ────────────────────
  const termIndex = terminatedDate.getUTCFullYear() * 12 + terminatedDate.getUTCMonth();

  const cancelInvoiceIds = live
    .filter((row) => yearMonthIndex(row.yearMonth) > termIndex)
    .map((row) => row.invoiceId);

  const termSheet = live.find((row) => yearMonthIndex(row.yearMonth) === termIndex);

  return {
    untouched: false,
    cancelInvoiceIds,
    prorate: termSheet
      ? {
          invoiceId: termSheet.invoiceId,
          ...splitSupplyVat(settlement.terminationMonthCharge, monthlyFee, monthlyTotal),
        }
      : null,
    clawback,
    settlement,
  };
}
