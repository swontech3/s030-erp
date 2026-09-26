/**
 * 실제 이용 기간 — 시작일 ~ 종료일자(둘 다 포함)가 몇 개월 며칠인가. 순수 함수.
 *
 * 정산 카드와 정산서가 계약 기간 옆에 적는다 — 「2026.09.01 ~ 2026.11.15 (2개월 15일)」.
 *
 * ★★ 달을 세는 규칙은 계약 종료일(`calcEndDate`)과 **같다.** 시작일에 N개월을 더한 날
 *    (없는 날짜는 그 달 말일)의 **전날**까지가 N개월이다. 그래서 계약을 다 채우고 끝낸
 *    사람은 언제나 「계약 개월수」가 나온다 — 01.31 시작 1개월은 02.27 까지다.
 *    여기서 규칙을 따로 세우면 정산서의 이용 기간이 계약서의 기간과 다른 말을 한다.
 *
 * 날짜는 `YYYY-MM-DD` 문자열로 받고 UTC 로 센다 — 시간대가 끼어들 자리가 없다(`day.ts`).
 */
import { parseDay } from './day.ts';
import { usagePeriod as settlementUsagePeriod } from './contract-settlement.ts';

export interface UsedPeriod {
  months: number;
  days: number;
}

const DAY_MS = 86_400_000;

/** 시작일 + n개월. 없는 날짜는 그 달 말일(`calcEndDate` 와 같은 규칙). */
function addMonthsClamped(start: Date, n: number): Date {
  const y = start.getUTCFullYear();
  const m = start.getUTCMonth() + n;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(start.getUTCDate(), last)));
}

function requireDay(iso: string, label: string): Date {
  const at = parseDay(iso);
  if (at === null) throw new RangeError(`${label}를 읽을 수 없다: ${iso}`);
  return at;
}

export function usedPeriod(startIso: string, endIso: string): UsedPeriod {
  const start = requireDay(startIso, '시작일');
  const end = requireDay(endIso, '종료일자');
  if (end.getTime() < start.getTime()) {
    throw new RangeError(`종료일자(${endIso})가 시작일(${startIso})보다 앞이다`);
  }

  // 종료일자 **다음 날** — N개월째 날이 이 날 이하면 N개월을 다 쓴 것이다.
  const stop = end.getTime() + DAY_MS;
  let months = 0;
  while (addMonthsClamped(start, months + 1).getTime() <= stop) months += 1;

  const days = Math.round((stop - addMonthsClamped(start, months).getTime()) / DAY_MS);
  return { months, days };
}

/** 「2개월 15일」 · 「3개월」 · 「10일」. */
export function usedPeriodText(p: UsedPeriod): string {
  const parts: string[] = [];
  if (p.months > 0) parts.push(`${p.months}개월`);
  if (p.days > 0 || p.months === 0) parts.push(`${p.days}일`);
  return parts.join(' ');
}

/** 「2026.09.01 ~ 2026.11.15 (2개월 15일)」. */
export function usedPeriodLabel(startIso: string, endIso: string): string {
  const dot = (s: string) => s.replace(/-/g, '.');
  return `${dot(startIso)} ~ ${dot(endIso)} (${usedPeriodText(usedPeriod(startIso, endIso))})`;
}

/**
 * 실이용료를 「온전히 쓴 유료 달 + 해지 달 일할」로 **나누어 보여 준다.** 정산서가 쓴다.
 *
 * ★ 금액을 다시 계산하지 않는다 — 원장의 `usageCharge` 가 정본이고, 달 몫을 뺀 나머지를
 *   일할 몫으로 둔다. 그래서 두 금액의 합은 언제나 원장과 같다.
 * ★ 달·일수는 실이용료를 셌던 **그 함수**(`contract-settlement.ts` 의 `usagePeriod`)로 센다.
 *   무상 달은 유료 달에서 빠진다 — 실이용료가 그렇게 셌다.
 */
export function usageChargeBreakdown(args: {
  startDate: string;
  terminateDate: string;
  freeMonths: number;
  /** 부가세 포함 월액. */
  monthlyTotal: number;
  usageCharge: number;
}): { paidMonths: number; monthsAmount: number; usedDays: number; monthDays: number; daysAmount: number } {
  const start = requireDay(args.startDate, '시작일');
  const end = requireDay(args.terminateDate, '종료일자');
  const p = settlementUsagePeriod({ startDate: start, terminateDate: end });
  const paidMonths = Math.max(0, p.fullUsedMonths - args.freeMonths);
  const monthsAmount = paidMonths * args.monthlyTotal;
  return {
    paidMonths,
    monthsAmount,
    usedDays: p.usedDays,
    monthDays: p.monthDays,
    daysAmount: args.usageCharge - monthsAmount,
  };
}
