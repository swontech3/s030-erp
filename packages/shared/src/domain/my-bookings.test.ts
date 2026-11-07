/**
 * 내 예약(보기 전용 /booking/mine) — 앱 1단계 6-나 (대표 지시 2026-11-07)
 *
 * ★ 보기 전용이다. 예약 · 수정 · 취소는 /booking 한 곳뿐이고(ERP CLAUDE.md 「한 업무는 한 화면에서」),
 *   이 목록은 한 건을 누르면 /booking 의 그날 · 그 회의실로 **링크 이동**한다.
 * ★ 목록 : 우리 회사 예약(서버 RLS 가 거른다) · 오늘부터 6개월(183일 — 대표 답) · 확정만(끝난 것 · 취소 뺌) ·
 *   가까운 날짜 순. 한 건 = 날짜 · 시간 / 회의실 / 예약한 사람(비면 「-」)
 */
import { describe, expect, it } from 'vitest';
import {
  BOOK_HREF,
  MY_BOOKINGS_RANGE_DAYS,
  myBookingHref,
  myBookingLine,
  myBookingsRange,
  pickMyBookings,
  type MyBooking,
} from './my-bookings';

const r = (over: Partial<MyBooking>): MyBooking => ({
  reservationId: 'r1',
  facilityId: 'f1',
  roomName: '회의실 A',
  day: '2026-11-07',
  startTime: '14:00',
  endTime: '15:00',
  status: 'confirmed',
  bookerName: '김예약',
  ...over,
});

/** 지금 = 2026-11-07 14:30 */
const NOW = { day: '2026-11-07', minutes: 14 * 60 + 30 };

describe('MY_BOOKINGS_RANGE_DAYS · myBookingsRange — 내 예약 목록이 보는 기간', () => {
  it('기간은 183일(6개월)', () => {
    expect(MY_BOOKINGS_RANGE_DAYS).toBe(183);
  });
  it('오늘 포함 183일 — 끝 = 오늘 + 182', () => {
    expect(myBookingsRange('2026-11-07')).toEqual({ from: '2026-11-07', to: '2027-05-08' });
  });
  it('달 · 해가 넘어가도 날짜로 센다(윤년 2028-02-29 포함)', () => {
    expect(myBookingsRange('2027-12-31')).toEqual({ from: '2027-12-31', to: '2028-06-30' });
  });
});

describe('pickMyBookings — 확정 · 아직 안 끝난 것만 · 가까운 순', () => {
  it('취소된 것 · 종료 처리된 것은 뺀다', () => {
    const got = pickMyBookings(
      [r({ reservationId: 'a', day: '2026-11-08' }), r({ reservationId: 'c', day: '2026-11-08', status: 'cancelled' }),
        r({ reservationId: 'd', day: '2026-11-08', status: 'completed' })],
      NOW,
    );
    expect(got.map((x) => x.reservationId)).toEqual(['a']);
  });

  it('이미 끝난 것은 뺀다 — 어제 · 오늘 끝 시각이 지금 이전이거나 같음', () => {
    const got = pickMyBookings(
      [r({ reservationId: 'yesterday', day: '2026-11-06', startTime: '20:00', endTime: '21:00' }),
        r({ reservationId: 'endedToday', startTime: '13:00', endTime: '14:00' }),
        r({ reservationId: 'endsNow', startTime: '14:00', endTime: '14:30' })],
      NOW,
    );
    expect(got).toEqual([]);
  });

  it('진행 중(시작했고 아직 안 끝남) · 오늘 뒤 · 내일은 남긴다', () => {
    const got = pickMyBookings(
      [r({ reservationId: 'later', startTime: '16:00', endTime: '17:00' }),
        r({ reservationId: 'ongoing', startTime: '14:00', endTime: '15:00' }),
        r({ reservationId: 'tomorrow', day: '2026-11-08', startTime: '09:00', endTime: '10:00' })],
      NOW,
    );
    expect(got.map((x) => x.reservationId)).toEqual(['ongoing', 'later', 'tomorrow']);
  });

  it('가까운 날짜 순 — 날짜 → 시작 시각 → 회의실 이름', () => {
    const got = pickMyBookings(
      [r({ reservationId: '3', day: '2026-11-10', startTime: '09:00', endTime: '10:00' }),
        r({ reservationId: '2b', day: '2026-11-09', startTime: '10:00', endTime: '11:00', roomName: '회의실 B' }),
        r({ reservationId: '2a', day: '2026-11-09', startTime: '10:00', endTime: '11:00', roomName: '회의실 A' }),
        r({ reservationId: '1', day: '2026-11-09', startTime: '09:00', endTime: '10:00' })],
      NOW,
    );
    expect(got.map((x) => x.reservationId)).toEqual(['1', '2a', '2b', '3']);
  });

  it('받은 배열을 바꾸지 않는다', () => {
    const list = [r({ reservationId: 'b', day: '2026-11-09' }), r({ reservationId: 'a', day: '2026-11-08' })];
    pickMyBookings(list, NOW);
    expect(list.map((x) => x.reservationId)).toEqual(['b', 'a']);
  });
});

describe('myBookingLine — 한 건 세 줄', () => {
  it('날짜 · 시간 / 회의실 / 예약한 사람', () => {
    expect(myBookingLine(r({ day: '2026-11-07', startTime: '14:00', endTime: '15:30' }))).toEqual({
      when: '11월 7일 (토) 14:00–15:30',
      room: '회의실 A',
      booker: '김예약',
    });
  });
  it.each([[null], [''], ['   ']])('예약한 사람 이름이 비면(%p) 「-」', (name) => {
    expect(myBookingLine(r({ bookerName: name })).booker).toBe('-');
  });
  it('요일 — 월요일', () => {
    expect(myBookingLine(r({ day: '2026-11-09' })).when.startsWith('11월 9일 (월)')).toBe(true);
  });
});

describe('누를 때 가는 주소 — 링크 이동', () => {
  it('한 건 → /booking 의 그날 · 그 회의실', () => {
    expect(myBookingHref(r({ day: '2026-11-09', facilityId: 'f-2' }))).toBe('/booking?day=2026-11-09&room=f-2');
  });
  it('회의실 식별자는 주소에 맞게 감싼다', () => {
    expect(myBookingHref(r({ facilityId: 'a b&c' }))).toBe('/booking?day=2026-11-07&room=a%20b%26c');
  });
  it('「예약하기」 → /booking', () => {
    expect(BOOK_HREF).toBe('/booking');
  });
});
