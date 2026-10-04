/**
 * 회의실 예약 규칙 — 순수 함수. 화면과 서버가 **같은 함수**를 본다.
 *
 * =============================================================================
 * ★★★ 겹침은 여기 없다 — **DB 배타 제약이 정본이다**
 * =============================================================================
 * `tb_s080_reservations_no_overlap` 이 `(facility_id, tsrange(start_at, end_at))` 를
 * `status='confirmed'` 에서만 막는다(002). 앱에서 한 번 더 세면 두 벌이 되고, **동시에
 * 두 사람이 누르면 앱 쪽은 반드시 진다** — 둘 다 「빈 시간」을 보고 통과시킨다.
 * 그래서 서버는 회의실 행을 잠그고(직렬화) 넣어 본 뒤 `23P01` 을 409 로 바꾼다.
 * 레거시는 앱에서도 셌는데, 그것을 버린 것이 이번 변경의 요점 하나다.
 *
 * ★★ 붙는 예약(10~11 · 11~12)은 **겹치지 않는다.** `tsrange` 의 기본 경계가 `[)` 라서다.
 *    회의실을 연달아 빌리는 흔한 경우가 거기 달려 있어 `verify-001-003` V7b 가 지킨다.
 *
 * =============================================================================
 * ★★ 운영시간·최소·최대는 **회의실 설정값**이다 — 상수가 아니다
 * =============================================================================
 * 레거시는 `06:00~24:00` 을 상수로 박아 두고 시설 행에도 같은 값을 들고 있었다. 두 곳에서
 * 정해지면 한쪽만 고쳐지고, 그때 화면과 서버가 다른 시간을 믿는다. 이 파일은 상수를 두지
 * 않고 `ReservationRoom` 을 받는다.
 *
 * ★ 운영자 예외가 셋이다 — 지난 시각 · 4주 · 하루 한도. 전화로 받은 예약을 나중에 적고,
 *   장기 행사를 미리 잡고, 회사 행사로 하루를 다 쓰는 일이 실제로 있다.
 */
import { parseDay } from './day.ts';

/** 예약 칸 하나의 길이. 30분이 아닌 예약은 만들지 않는다. */
export const SLOT_MINUTES = 30;

/**
 * 입주사 하루 한도(분). **입주사 기준**이고 회의실이 여러 개면 합산한다.
 *
 * ★ 한도는 회의실의 것이 아니라 **입주사의 것**이다 — 회의실별로 재면 방 3개짜리 건물에서
 *   한 회사가 하루를 다 쓸 수 있다.
 */
export const DAILY_LIMIT_MINUTES = 120;

/**
 * 며칠까지 잡을 수 있는가 — 4주 = **오늘을 포함한 28일**. ★ 운영자는 제한이 없다.
 *
 * ★★ 마지막으로 잡을 수 있는 날은 **오늘+27** 이다. 「오늘+28 까지」로 읽으면 29일이
 *    열린다 — 실제로 하루가 더 열려 있었다(2026-09-27, 시안 `room-booking/04-rules.md`
 *    「date ≤ 오늘 + 27일 (오늘 포함 28일)」 과 대조해 찾았다).
 */
export const AHEAD_DAYS = 28;

/**
 * 예약 상태 어휘 — **DB CHECK 와 같은 목록이어야 한다**(025).
 *
 * ★★★ 어휘 밖의 값이 들어가면 **자리 판정이 어긋난다.** 그래서 DB 에 CHECK 를 박았다.
 *    배타 제약이 `status <> 'cancelled'` 에 걸리므로(034) 오타(`cancelld`)는 「취소가
 *    아닌 것」이 되어 **자리를 잡아 버린다.** 034 전에는 반대였다 — 제약이 확정에만
 *    걸려서 `confirmd` 는 아무와도 안 다투고 같은 시간에 몇 건이든 들어갔다.
 *
 * ★★ 배타 제약의 범위는 **취소가 아닌 전부**다(확정 + 종료). 026 의 `erp_busy_slots`
 *    가 「차 있음」을 칠하는 식과 **같은 글자**이고, 그게 034 의 요점이다 — 같은 질문에
 *    두 벌의 답을 두지 않는다. 한쪽만 고치면 그날 둘이 갈린다.
 *
 * ★ 「신청」(`requested`)을 나중에 넣을 자리가 있다 — 어휘를 여기서 한 줄 늘리고 025 의
 *   CHECK 를 같이 늘린다. ★ 034 뒤로는 **기본값이 「자리를 잡는다」**이다(취소가 아니므로).
 *   자리를 잡지 않게 하려면 034 의 WHERE 와 026 을 **함께** 고쳐야 한다.
 */
export const RESERVATION_STATUS = ['confirmed', 'cancelled', 'completed'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUS)[number];

/** 회의실 설정 — 규칙이 데이터로 들어 있는 자리(`tb_s080_facilities`). */
export interface ReservationRoom {
  /** 운영 시작(자정 기준 분). */
  openMinutes: number;
  /** 운영 종료(자정 기준 분). `24:00` 은 1440 이다. */
  closeMinutes: number;
  /** 최소 이용 분. `null` 이면 제한 없음. */
  minMinutes: number | null;
  /** 최대 이용 분. `null` 이면 제한 없음. */
  maxMinutes: number | null;
  /** 30분당 요금. `null` 이면 0 원. */
  halfHourFee: number | null;
}

export type ReservationReason =
  | 'INVALID_RANGE'
  | 'NOT_ALIGNED'
  | 'OUT_OF_HOURS'
  | 'TOO_SHORT'
  | 'TOO_LONG'
  | 'PAST'
  | 'TOO_FAR'
  | 'DAILY_LIMIT'
  /** ★ DB 배타 제약이 판정한다(23P01). 문구만 여기 둔다 — 말이 한 곳에 있어야 한다. */
  | 'OVERLAP';

/** 사람에게 보일 문구. 화면과 서버가 같은 말을 쓴다. */
export const REASON_TEXT: Record<ReservationReason, string> = {
  INVALID_RANGE: '끝나는 시각이 시작 시각보다 뒤여야 합니다',
  NOT_ALIGNED: '예약은 30분 단위로만 할 수 있습니다',
  OUT_OF_HOURS: '회의실 운영시간을 벗어났습니다',
  TOO_SHORT: '최소 이용 시간보다 짧습니다',
  TOO_LONG: '최대 이용 시간을 넘었습니다',
  PAST: '지난 시각은 예약할 수 없습니다',
  TOO_FAR: '4주 뒤까지만 예약할 수 있습니다',
  DAILY_LIMIT: '하루에 쓸 수 있는 시간(2시간)을 넘었습니다',
  OVERLAP: '이미 예약된 시간입니다',
};

export type ReservationCheck = { ok: true } | { ok: false; reason: ReservationReason };

/** `HH:MM` → 자정 기준 분. `24:00` → 1440. */
export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

/** 자정 기준 분 → `HH:MM`. 1440 → `24:00`. */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 그 회의실의 슬롯 시작 분 목록 — 화면의 칸이 이것이다. */
export function slotStarts(room: Pick<ReservationRoom, 'openMinutes' | 'closeMinutes'>): number[] {
  const out: number[] = [];
  for (let m = room.openMinutes; m < room.closeMinutes; m += SLOT_MINUTES) out.push(m);
  return out;
}

/**
 * 그 날 그 입주사가 **쓴 시간**(분).
 *
 * ★★★ **확정과 종료만 센다. 취소는 세지 않는다.** 취소한 예약이 한도를 먹으면 잘못 잡고
 *    바로 취소한 입주사가 그날 다시 잡을 수 없다 — 취소가 벌이 된다.
 * ★★ 회의실이 달라도 합산한다(머리말 — 한도는 입주사의 것이다).
 */
export function usedMinutes(
  rows: readonly { status: string; startMinutes: number; endMinutes: number }[],
): number {
  return rows
    .filter((r) => r.status !== 'cancelled')
    .reduce((sum, r) => sum + Math.max(0, r.endMinutes - r.startMinutes), 0);
}

/**
 * 이용 요금 = 30분 요금 × 이용 분 / 30, 원 단위 반올림.
 *
 * ★ **청구와 잇지 않았다.** 예약 행에 금액만 남긴다 — 021 이 계약 없는 청구서를 이미
 *   받으므로 나중에 그쪽으로 넘기면 된다. 자리만 만든 것이다.
 */
export function reservationFee(
  room: Pick<ReservationRoom, 'halfHourFee'>,
  startMinutes: number,
  endMinutes: number,
): number {
  if (room.halfHourFee == null) return 0;
  return Math.round((room.halfHourFee * (endMinutes - startMinutes)) / SLOT_MINUTES);
}

/**
 * 지금이 언제인가 — **로컬 벽시계**로 읽는다.
 *
 * ★ 예약 시각은 벽시계 값이다(`timestamp without time zone`). 「지난 시각인가」를 UTC 로
 *   재면 시간대만큼 밀려서, 자정 앞뒤로 하루가 틀린다(`day.ts` 머리말과 같은 함정).
 */
export function localDayMinutes(now: Date): { day: string; minutes: number } {
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    day: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    minutes: now.getHours() * 60 + now.getMinutes(),
  };
}

/** 두 `YYYY-MM-DD` 사이의 날 수. 읽을 수 없으면 `null`. ★ 문자열은 UTC 로 센다(`day.ts`). */
function daysBetweenDays(from: string, to: string): number | null {
  const a = parseDay(from);
  const b = parseDay(to);
  if (a === null || b === null) return null;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/**
 * 이 예약을 받아도 되는가.
 *
 * ★ 순서가 곧 사유의 우선순위다 — **모양(단위·운영시간·길이) → 기간(지난 시각·4주) →
 *   한도**. 30분 정렬이 아닌 지난 시각 예약은 `NOT_ALIGNED` 로 말해 주는 것이 낫다.
 * ★ 겹침은 여기 없다(머리말).
 */
export function validateReservation(args: {
  room: ReservationRoom;
  /** 예약 날짜 `YYYY-MM-DD`. */
  day: string;
  startMinutes: number;
  endMinutes: number;
  /** 지금 — `localDayMinutes(new Date())`. */
  asOf: { day: string; minutes: number };
  /** 운영자인가. ★ 지난 시각·4주·하루 한도를 넘긴다. */
  operator: boolean;
  /** 그 날 그 입주사가 이미 쓴 분(`usedMinutes`). 운영자 대행 건은 0 으로 본다. */
  companyUsedMinutes: number;
}): ReservationCheck {
  const { room, day, startMinutes, endMinutes, asOf, operator, companyUsedMinutes } = args;

  if (startMinutes >= endMinutes) return { ok: false, reason: 'INVALID_RANGE' };
  if (startMinutes % SLOT_MINUTES !== 0 || endMinutes % SLOT_MINUTES !== 0) {
    return { ok: false, reason: 'NOT_ALIGNED' };
  }
  if (startMinutes < room.openMinutes || endMinutes > room.closeMinutes) {
    return { ok: false, reason: 'OUT_OF_HOURS' };
  }

  const minutes = endMinutes - startMinutes;
  if (room.minMinutes != null && minutes < room.minMinutes) return { ok: false, reason: 'TOO_SHORT' };
  if (room.maxMinutes != null && minutes > room.maxMinutes) return { ok: false, reason: 'TOO_LONG' };

  if (operator) return { ok: true };

  const ahead = daysBetweenDays(asOf.day, day);
  if (ahead === null) return { ok: false, reason: 'INVALID_RANGE' };
  // ★ 오늘이면 **이미 시작한 시각**만 막는다 — 10:15 에 10:30 칸은 잡을 수 있어야 한다.
  if (ahead < 0 || (ahead === 0 && startMinutes < asOf.minutes)) return { ok: false, reason: 'PAST' };
  // ★ `>=` 다 — 오늘이 1일째이므로 마지막 날은 오늘+27 이다(상수 머리말).
  if (ahead >= AHEAD_DAYS) return { ok: false, reason: 'TOO_FAR' };

  if (companyUsedMinutes + minutes > DAILY_LIMIT_MINUTES) return { ok: false, reason: 'DAILY_LIMIT' };

  return { ok: true };
}
