/**
 * 회의실 예약 화면의 모델 — 타입과 날짜·시간 셈.
 *
 * ★★ **규칙은 여기 없다.** 30분 단위·운영시간·최소·최대·지난 시각·4주·하루 한도는
 *    `@swonbiz/shared/domain/reservation-rules` 하나가 정하고, 화면과 서버가 같이 부른다.
 *    이 파일은 그 함수에 넘길 값을 만들고, 주(週)·달(月)을 세는 일만 한다.
 *
 * ★ 화면 검사는 **친절**이다. 막는 것은 서버다(`routes/booking.ts` 머리말) — 여기서
 *   통과시켜도 서버가 거부하면 거부가 정답이다.
 *
 * 시안: design/handoff/room-booking/05-logic.md · 07-data-model.md
 */
import type { ReservationRoom } from '@swonbiz/shared/domain/reservation-rules';

/** 회의실 한 칸 — `GET /facilities`. 규칙이 데이터로 들어 있다. */
export interface Room {
  facilityId: string;
  name: string;
  floorNo: string | null;
  capacity: number | null;
  /** `HH:MM`. */
  openTime: string;
  closeTime: string;
  minDuration: number;
  /** 0 이면 제한 없음. */
  maxDuration: number;
  halfHourFee: number | null;
  isReservable: boolean;
}

/** 예약 한 건 — `GET /reservations`. */
export interface Reservation {
  reservationId: string;
  facilityId: string;
  roomName: string;
  /** 운영사가 잡은 건이면 `null`. */
  companyId: string | null;
  companyName: string | null;
  title: string;
  /** `YYYY-MM-DD`. */
  day: string;
  /** `HH:MM`. */
  startTime: string;
  endTime: string;
  attendees: number | null;
  /** 시안의 「메모」 — 표의 칸 이름은 `purpose` 다. */
  purpose: string | null;
  usageFee: number;
  /** `confirmed` | `cancelled` | `completed`. */
  status: string;
  cancelReason: string | null;
  /** 등록한 사람 이름(027). 옛 행은 `null`. */
  bookerName: string | null;
  /** `YYYY-MM-DD HH:MM`. */
  createdAt: string | null;
}

/**
 * 차 있는 자리 한 칸 — `GET /reservations` 의 `busy` (026).
 *
 * ★★★ 여기에 **이름이 없는 것이 규칙**이다. 입주사는 RLS 때문에 남의 예약을 상세로 볼
 *    수 없고, 서버는 시각만 따로 내려보낸다. 화면은 그 칸을 「예약됨」으로 잠그기만 한다.
 */
export interface Busy {
  facilityId: string;
  /** `YYYY-MM-DD`. */
  day: string;
  /** `HH:MM`. */
  startTime: string;
  endTime: string;
}

/**
 * 예약 조직 선택지 — `GET /facilities` 의 `companies`.
 * ★ **운영자에게만** 온다(입주사에게는 빈 배열 — 그 목록은 명부다).
 */
export interface CompanyOption {
  companyId: string;
  companyName: string;
}

export const STATUS_LABEL: Record<string, string> = {
  confirmed: '확정',
  cancelled: '취소',
  completed: '종료',
};

/**
 * 예약 조직 표시 이름.
 * ★ 입주사가 비어 있으면 **운영사가 잡은 건**이다(외부 손님 자리는 2차).
 */
export const orgLabel = (companyName: string | null): string => companyName ?? '운영사';

/**
 * 회의실 설정 → 규칙 함수가 보는 모양.
 *
 * ★ 최소·최대 **0 은 「제한 없음」**이다(`null`). API 가 최대 없음을 0 으로 내려보낸다.
 * ★ 이름이 다르다 — API 는 `minDuration`, 규칙은 `minMinutes` 다. 캐스팅으로 덮지 않는다.
 *   덮으면 규칙이 `undefined` 를 보고 **최소·최대 검사가 조용히 사라진다.**
 */
export function roomRules(room: Room): ReservationRoom {
  const [oh, om] = room.openTime.split(':').map(Number) as [number, number];
  const [ch, cm] = room.closeTime.split(':').map(Number) as [number, number];
  return {
    openMinutes: oh * 60 + om,
    closeMinutes: ch * 60 + cm,
    minMinutes: room.minDuration > 0 ? room.minDuration : null,
    maxMinutes: room.maxDuration > 0 ? room.maxDuration : null,
    halfHourFee: room.halfHourFee,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `Date` → 로컬 `YYYY-MM-DD`. ★ UTC 로 만들면 자정 앞뒤로 하루가 밀린다. */
export function toDayString(at: Date): string {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** 오늘 `YYYY-MM-DD`(로컬). */
export function today(now = new Date()): string {
  return toDayString(now);
}

/** `YYYY-MM-DD` → `Date`(로컬 자정). */
export function parseLocalDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

/** 월요일을 0 으로 세는 요일 번호. */
export function dowOf(day: string): number {
  return (parseLocalDay(day).getDay() + 6) % 7;
}

/** 그 날에서 `delta` 일 뒤. */
export function shiftDay(day: string, delta: number): string {
  const at = parseLocalDay(day);
  at.setDate(at.getDate() + delta);
  return toDayString(at);
}

/** 그 날이 든 주의 **월요일**. 시안의 주간 그리드가 월요일에 시작한다. */
export function weekStart(day: string): string {
  return shiftDay(day, -dowOf(day));
}

/** 그 날이 든 달에서 `delta` 달 뒤의 1일. */
export function shiftMonth(day: string, delta: number): string {
  const at = parseLocalDay(day);
  at.setDate(1);
  at.setMonth(at.getMonth() + delta);
  return toDayString(at);
}

/** 주의 7일. */
export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => shiftDay(start, i));
}

export const WEEKDAY = ['월', '화', '수', '목', '금', '토', '일'];

/** 「9월 30일」. */
export function md(day: string): string {
  const at = parseLocalDay(day);
  return `${at.getMonth() + 1}월 ${at.getDate()}일`;
}

/** 「9월 30일 (수)」 — 767 이하의 기간 라벨. */
export function mdDow(day: string): string {
  return `${md(day)} (${WEEKDAY[dowOf(day)]})`;
}

/** 그 날의 일(日) — 요일 머리의 큰 숫자. */
export const dayNum = (day: string): number => parseLocalDay(day).getDate();

/**
 * 주 기간 라벨.
 * ★ 같은 달이면 뒤쪽은 일(日)만 — 「10월 5일 – 11일」 / 달이 바뀌면 「9월 28일 – 10월 4일」.
 */
export function weekLabel(start: string): string {
  const end = shiftDay(start, 6);
  const sameMonth = parseLocalDay(end).getMonth() === parseLocalDay(start).getMonth();
  return `${md(start)} – ${sameMonth ? `${dayNum(end)}일` : md(end)}`;
}

/** 「2026년 9월」. */
export function monthLabel(day: string): string {
  const at = parseLocalDay(day);
  return `${at.getFullYear()}년 ${at.getMonth() + 1}월`;
}

/**
 * 달력 한 판 — 그 달 1일이 든 주의 월요일부터 7의 배수만큼.
 * 앞뒤 달 날짜도 들어 있다(화면이 흐리게 그리고 누르지 못하게 한다).
 */
export function monthGrid(day: string): { days: string[]; month: number } {
  const at = parseLocalDay(day);
  const first = toDayString(new Date(at.getFullYear(), at.getMonth(), 1));
  const lead = dowOf(first);
  const lastDate = new Date(at.getFullYear(), at.getMonth() + 1, 0).getDate();
  const total = Math.ceil((lead + lastDate) / 7) * 7;
  return {
    days: Array.from({ length: total }, (_, i) => shiftDay(first, i - lead)),
    month: at.getMonth(),
  };
}

/** 그 날이 그 달의 날인가 — 앞뒤 달 칸을 가린다. */
export const inMonth = (day: string, month: number): boolean => parseLocalDay(day).getMonth() === month;

/** 두 시각 사이의 분. */
export function minutesBetween(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(':').map(Number) as [number, number];
  const [eh, em] = endTime.split(':').map(Number) as [number, number];
  return eh * 60 + em - (sh * 60 + sm);
}

/** 90 → 「1시간 30분」 · 30 → 「30분」 · 120 → 「2시간」. */
export function dur(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h ? `${h}시간` : ''}${h && m ? ' ' : ''}${m ? `${m}분` : ''}` || '0분';
}

/**
 * 화면 폭 단계 — 시안과 같은 경계다(`08-responsive.md`).
 *   xl 1280 이상 · md 768~1279 · sm 767 이하
 */
export type WidthMode = 'xl' | 'md' | 'sm';

export function widthMode(width: number): WidthMode {
  return width >= 1280 ? 'xl' : width >= 768 ? 'md' : 'sm';
}
