/** 회의실 운영시간(고정): 매일 06:00~24:00, 30분 슬롯 */
export const OPEN_MINUTES = 6 * 60;    // 360
export const CLOSE_MINUTES = 24 * 60;  // 1440
export const SLOT_MINUTES = 30;

/** "HH:MM" → 자정 기준 분. "24:00" → 1440 */
export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export interface ExistingReservation {
  startMin: number;
  endMin: number;
}

export interface ValidateInput {
  openMin: number;
  closeMin: number;
  minDuration: number | null;
  maxDuration: number | null;
  startMin: number;
  endMin: number;
  existing: ExistingReservation[];
}

export type ValidationFailReason =
  | "INVALID_RANGE"
  | "NOT_ALIGNED"
  | "OUT_OF_HOURS"
  | "TOO_SHORT"
  | "TOO_LONG"
  | "OVERLAP";

export type ValidateResult =
  | { ok: true }
  | { ok: false; reason: ValidationFailReason };

export function validateReservation(input: ValidateInput): ValidateResult {
  const { openMin, closeMin, minDuration, maxDuration, startMin, endMin, existing } = input;

  if (startMin >= endMin) return { ok: false, reason: "INVALID_RANGE" };
  if (startMin % SLOT_MINUTES !== 0 || endMin % SLOT_MINUTES !== 0)
    return { ok: false, reason: "NOT_ALIGNED" };
  if (startMin < openMin || endMin > closeMin)
    return { ok: false, reason: "OUT_OF_HOURS" };

  const dur = endMin - startMin;
  if (minDuration != null && dur < minDuration) return { ok: false, reason: "TOO_SHORT" };
  if (maxDuration != null && dur > maxDuration) return { ok: false, reason: "TOO_LONG" };

  // 겹침: 기존시작 < 신규종료 AND 기존종료 > 신규시작
  for (const e of existing) {
    if (e.startMin < endMin && e.endMin > startMin) return { ok: false, reason: "OVERLAP" };
  }
  return { ok: true };
}

/** usageFee = 30분당요금 × (이용분/30), 원 단위 반올림 */
export function computeUsageFee(halfHourFee: number | null, startMin: number, endMin: number): number {
  if (halfHourFee == null) return 0;
  return Math.round((halfHourFee * (endMin - startMin)) / 30);
}

/** 운영시간(openMin~closeMin) 내 30분 슬롯 시작 분 목록 */
export function generateSlotStarts(openMin: number, closeMin: number): number[] {
  const slots: number[] = [];
  for (let m = openMin; m < closeMin; m += SLOT_MINUTES) slots.push(m);
  return slots;
}

/** 배열을 앞에서부터 2개씩 묶는다. 홀수면 마지막 그룹은 1개. (2열 그리드 행 생성용) */
export function chunkPairs<T>(items: T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += 2) {
    rows.push(items.slice(i, i + 2));
  }
  return rows;
}
