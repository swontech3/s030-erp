/**
 * 청구 화면(s030200070) 납부기한 검색 기간 상한 — 대표 지시 2026-11-15.
 *
 * ★ 끝일이 **시작일 + 6개월**을 넘으면 막는다. 시작일 + 6개월 날 자체는 된다.
 *   6개월 뒤 달에 그날이 없으면 그 달 말일이다(8월 31일 → 2월 28 · 29일).
 * ★ 화면([조회])과 API(`GET /billing/invoices`, 400)가 **이 함수와 이 말**을 같이 쓴다 — 두 벌로 두면 갈린다.
 * ★ 입주사로 거르고 들어온 경우(?company=, 전 기간)는 이 검사를 하지 않는다(부르는 쪽).
 */
import { parseDay, toDay } from './day.ts';

export const DUE_RANGE_MAX_MONTHS = 6;

export const DUE_RANGE_TOO_LONG = '조회 기간은 6개월 안으로 넣어 주세요';

/** 시작일 + 6개월 `YYYY-MM-DD` — 끝일이 이 날까지면 된다. 읽을 수 없는 날이면 `null`. */
export function dueRangeLimit(from: string): string | null {
  const at = parseDay(from);
  if (at === null) return null;
  const y = at.getUTCFullYear();
  const m = at.getUTCMonth() + DUE_RANGE_MAX_MONTHS;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return toDay(new Date(Date.UTC(y, m, Math.min(at.getUTCDate(), lastDay))));
}

/** 끝일이 시작일 + 6개월을 넘는가. 시작일을 읽을 수 없으면 `false`(형식 검사는 부르는 쪽이 따로 한다). */
export function isDueRangeTooLong(from: string, to: string): boolean {
  const limit = dueRangeLimit(from);
  return limit !== null && to > limit;
}
