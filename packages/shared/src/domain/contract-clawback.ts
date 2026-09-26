/**
 * 중도 해지 환수 — 순수 함수.
 *
 * 정본은 이 파일과 `contract-clawback.test.ts` 다.
 *
 * =============================================================================
 * ★★★ 왜 환수하는가 — 중도 해지하면 **깎아 준 것도 공짜로 준 것도 없던 일**이 된다
 * =============================================================================
 * 할인과 무상은 「계약 기간을 다 채운다」는 전제로 준 것이다. 중간에 끝내면 그 전제가
 * 깨지므로, 실제로 쓴 기간을 **기준가로 다시 계산**한 것이 총 받을 돈이다.
 *
 *     할인 환수 = (기준가 − 계약가) × 실제 사용 기간     ← 무상 달도 센다
 *     무상 환수 = 계약가 × (무상 기간 중 실제 사용한 부분)
 *
 * ★★ **둘을 합치면 무상 달이 정확히 기준가가 된다.**
 *     무상 달:  (기준가 − 계약가) + 계약가 = 기준가        ← 청구가 0 이었으니 전액
 *     유료 달:  (기준가 − 계약가)                          ← 계약가는 이미 청구·수납했다
 *     그 불변식을 시험이 고정한다. 한쪽만 틀리면 바로 깨진다.
 *
 * =============================================================================
 * ★★★ 실이용료와 **겹치지 않는다**
 * =============================================================================
 * 무상 달은 `computeTerminationSettlement` 의 실이용료에서 **빠져 있다**.
 * 그래야 무상 달을 여기서 한 번만 받는다. 둘 중 하나만 고치면 그 달을 두 번 받거나
 * 아예 못 받는다 — 이 두 모듈은 같이 읽어야 한다.
 *
 * =============================================================================
 * ★ 청구서를 건드리지 않는다
 * =============================================================================
 * 환수는 **정산 원장에만** 기록한다. 이미 나간 청구서를 소급해 고치면 「그때 얼마를
 * 청구했는지」가 사라지고, 수납과도 어긋난다. 실제로 받는 것은 운영자가 수납으로 넣는다.
 */
import { calcVat } from './contract-amounts.ts';
import { usagePeriod } from './contract-settlement.ts';

/** 환수 계산에 필요한 계약 항목 한 줄. */
export type ClawbackSpace = {
  /** 표시 순서. 계산에는 쓰지 않지만 어느 줄인지 가리킨다. */
  seq: number;
  /** 기준가 — 호실의 정가. 계약 저장 시점 값이 계약에 박혀 있다. */
  standardFee: number;
  /** 계약가(월 이용료) — 할인이 반영된 실제 금액. **부가세 제외**. */
  monthlyFee: number;
  /** 부가세 대상 여부. */
  vatYn: boolean;
};

export type ClawbackResult = {
  /** 할인 환수 — **부가세 포함**. */
  discountClawback: number;
  /** 무상 환수 — **부가세 포함**. */
  freeClawback: number;
  /** 둘의 합. 순정산금에서 빠지는 값이다. */
  total: number;
  /** 실제 사용 기간(개월, 소수). **무상 달도 포함**한다. */
  usedMonths: number;
};

/**
 * 중도 해지 환수액.
 *
 * ★ 날짜 둘은 **UTC 자정의 `Date`** 여야 한다. 기간 계산은 `usagePeriod` 하나가 하고,
 *   실이용료도 같은 함수를 쓴다 — 두 금액이 서로 다른 기간을 보면 안 된다.
 *
 * ★ **줄마다 계산해서 더한다.** 합계에 한 번 매기지 않는다 — 부가세가 줄 단위로
 *   버려지기 때문이다(`calcTotals` 와 같은 이유).
 *
 * ★ 기간 만료(종료일자 = 원래 종료일)에는 **부르지 않는다.** 그건 계약을 다 채운
 *   것이라 환수할 것이 없다. 판정은 `planTerminationChanges` 가 한다.
 */
export function computeClawback(args: {
  startDate: Date;
  terminateDate: Date;
  /** 무상 개월수. 0 이면 무상 환수가 0 이다. */
  freeMonths: number;
  spaces: readonly ClawbackSpace[];
}): ClawbackResult {
  const { startDate, terminateDate, freeMonths, spaces } = args;

  const { usedMonths } = usagePeriod({ startDate, terminateDate });

  /*
   * ★ 무상 기간 중 **실제로 쓴 부분**. 무상 2개월인데 보름 만에 나갔으면
   *   0.48개월치만 환수한다. 반대로 무상보다 오래 썼으면 무상 개월수까지다 —
   *   그 뒤는 정상 청구된 달이라 무상 환수와 무관하다.
   */
  const freeUsedMonths = Math.min(Math.max(freeMonths, 0), usedMonths);

  let discountClawback = 0;
  let freeClawback = 0;

  for (const row of spaces) {
    // ★ 계약가가 기준가 이상이면 깎아 준 것이 없다. 음수 환수(=깎아 주기)는 없다.
    const discountPerMonth = Math.max(0, row.standardFee - row.monthlyFee);

    const discountSupply = Math.round(discountPerMonth * usedMonths);
    const freeSupply = Math.round(row.monthlyFee * freeUsedMonths);

    discountClawback += discountSupply + calcVat(discountSupply, row.vatYn);
    freeClawback += freeSupply + calcVat(freeSupply, row.vatYn);
  }

  return {
    discountClawback,
    freeClawback,
    total: discountClawback + freeClawback,
    usedMonths,
  };
}
