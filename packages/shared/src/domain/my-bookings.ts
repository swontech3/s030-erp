/**
 * 내 예약(보기 전용 /booking/mine) — 앱 1단계 6-나 (대표 지시 2026-11-07)
 *
 * =============================================================================
 * ★★ 보기 전용이다 — 예약 · 수정 · 취소는 /booking 한 곳뿐 (ERP CLAUDE.md 「한 업무는 한 화면에서」)
 * =============================================================================
 * 이 목록에는 처리 버튼이 없다. 한 건을 누르면 /booking 의 **그날 · 그 회의실**로 링크 이동하고,
 * 취소 · 수정은 거기서 한다. 「예약하기」도 /booking 으로 가는 링크다.
 *
 * ★ 회사 거르기는 서버가 한다 — 입주사 세션의 `GET /reservations` 는 RLS 로 자기 회사 예약만 온다.
 *   여기서는 상태 · 시각으로만 거른다.
 * ★ 「끝났는가」는 예약 화면의 `shownStatus`(web BookingForm)와 같은 규칙이다 —
 *   취소면 뺀다 · 종료 처리됐거나 끝 시각이 지금 이전(같음 포함)이면 끝난 것이다.
 */
import { parseDay, toDay } from './day';

/**
 * ★ 내 예약 목록이 보는 기간 — **오늘 포함 183일(6개월)**. 대표 답 2026-11-07.
 *   예약 목록 주소(`GET /reservations`)는 끝 날짜(to)를 빼면 시작한 그 하루만 돌려주므로 끝을 정해 보낸다.
 *   입주사는 4주 안만 예약하지만 운영사가 대신 잡은 먼 예약도 보이도록 넉넉히 둔다.
 */
export const MY_BOOKINGS_RANGE_DAYS = 183;

/** 「예약하기」가 가는 곳 — 예약 화면 */
export const BOOK_HREF = '/booking';

/** 목록이 쓰는 예약 칸 — `GET /reservations` 한 건(web `Reservation`)의 일부 */
export interface MyBooking {
  reservationId: string;
  facilityId: string;
  roomName: string;
  /** `YYYY-MM-DD` */
  day: string;
  /** `HH:MM` */
  startTime: string;
  endTime: string;
  /** `confirmed` | `cancelled` | `completed` */
  status: string;
  /** 등록한 사람 이름 — 옛 행은 `null` */
  bookerName: string | null;
}

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
const DAY_MS = 24 * 60 * 60 * 1000;

const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

/** 목록을 받을 기간 — 오늘부터 오늘 포함 183일(끝 = 오늘 + 182) */
export function myBookingsRange(today: string): { from: string; to: string } {
  const at = parseDay(today);
  if (!at) throw new Error(`날짜를 읽을 수 없습니다: ${today}`);
  return { from: today, to: toDay(new Date(at.getTime() + (MY_BOOKINGS_RANGE_DAYS - 1) * DAY_MS)) };
}

/** 아직 안 끝난 확정 예약인가 — 예약 화면 `shownStatus` 가 'confirmed' 인 것과 같다 */
function upcoming(r: MyBooking, asOf: { day: string; minutes: number }): boolean {
  if (r.status !== 'confirmed') return false;
  if (r.day < asOf.day) return false;
  return !(r.day === asOf.day && minutesOf(r.endTime) <= asOf.minutes);
}

/** 확정 · 아직 안 끝난 것만 · 가까운 순(날짜 → 시작 시각 → 회의실 이름). 받은 배열은 바꾸지 않는다 */
export function pickMyBookings<T extends MyBooking>(list: readonly T[], asOf: { day: string; minutes: number }): T[] {
  return list
    .filter((r) => upcoming(r, asOf))
    .sort(
      (a, b) =>
        a.day.localeCompare(b.day) ||
        minutesOf(a.startTime) - minutesOf(b.startTime) ||
        a.roomName.localeCompare(b.roomName, 'ko'),
    );
}

/** 한 건 세 줄 — 날짜 · 시간 / 회의실 / 예약한 사람(비면 「-」). 표기는 예약 화면과 같다(「11월 7일 (토)」 · 「14:00–15:00」) */
export function myBookingLine(r: MyBooking): { when: string; room: string; booker: string } {
  const at = parseDay(r.day);
  const date = at ? `${at.getUTCMonth() + 1}월 ${at.getUTCDate()}일 (${WEEKDAY[at.getUTCDay()]})` : r.day;
  const name = (r.bookerName ?? '').trim();
  return { when: `${date} ${r.startTime}–${r.endTime}`, room: r.roomName, booker: name || '-' };
}

/** 한 건을 누르면 가는 곳 — 예약 화면의 그날 · 그 회의실(`/booking?day=&room=`) */
export function myBookingHref(r: MyBooking): string {
  return `${BOOK_HREF}?day=${encodeURIComponent(r.day)}&room=${encodeURIComponent(r.facilityId)}`;
}
