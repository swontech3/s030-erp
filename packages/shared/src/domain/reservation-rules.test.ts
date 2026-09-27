/**
 * 회의실 예약 규칙 — 시험이 규칙의 기록이다.
 *
 * ★ 레거시 `S-WonERP/src/lib/reservation-validation.test.ts` 의 경계 시험을 가져오고,
 *   이번에 새로 정한 것(지난 시각 · 4주 · 하루 한도 · 운영자 예외)을 더했다.
 * ★ **겹침은 여기서 시험하지 않는다** — DB 배타 제약이 정본이다(`verify-001-003` V6·V7).
 *   앱에서 겹침을 다시 세면 두 벌이 되고, 동시 예약에서는 앱 쪽이 반드시 진다.
 */
import { describe, it, expect } from 'vitest';
import {
  AHEAD_DAYS,
  DAILY_LIMIT_MINUTES,
  REASON_TEXT,
  RESERVATION_STATUS,
  SLOT_MINUTES,
  localDayMinutes,
  minutesToTime,
  reservationFee,
  slotStarts,
  timeToMinutes,
  usedMinutes,
  validateReservation,
} from './reservation-rules.ts';

/** 시안의 회의실 A — 06:00~24:00 · 최소 30분 · 최대 120분 · 30분 10,000원. */
const ROOM = {
  openMinutes: 6 * 60,
  closeMinutes: 24 * 60,
  minMinutes: 30,
  maxMinutes: 120,
  halfHourFee: 10_000,
};

/** 오늘은 2026-10-05 10:15 이라고 본다. */
const ASOF = { day: '2026-10-05', minutes: 10 * 60 + 15 };

const ask = (over = {}) =>
  validateReservation({
    room: ROOM,
    day: '2026-10-06',
    startMinutes: 14 * 60,
    endMinutes: 15 * 60,
    asOf: ASOF,
    operator: false,
    companyUsedMinutes: 0,
    ...over,
  });

describe('시간 읽고 쓰기', () => {
  it('HH:MM ↔ 분', () => {
    expect(timeToMinutes('06:00')).toBe(360);
    expect(timeToMinutes('09:30')).toBe(570);
    expect(timeToMinutes('24:00')).toBe(1440);
    expect(minutesToTime(570)).toBe('09:30');
    expect(minutesToTime(1440)).toBe('24:00');
  });

  it('★ 슬롯은 회의실 설정의 운영시간에서 나온다 — 상수가 아니다', () => {
    const short = slotStarts({ ...ROOM, openMinutes: 9 * 60, closeMinutes: 11 * 60 });
    expect(short.map(minutesToTime)).toEqual(['09:00', '09:30', '10:00', '10:30']);
    expect(slotStarts(ROOM).length).toBe((24 * 60 - 6 * 60) / SLOT_MINUTES);
  });
});

describe('모양 — 30분 단위와 운영시간', () => {
  it('정상 예약은 통과한다', () => {
    expect(ask()).toEqual({ ok: true });
  });

  it('★ 30분 정렬이 아니면 거부한다', () => {
    expect(ask({ startMinutes: 14 * 60 + 5 })).toEqual({ ok: false, reason: 'NOT_ALIGNED' });
    expect(ask({ endMinutes: 15 * 60 + 20 })).toEqual({ ok: false, reason: 'NOT_ALIGNED' });
  });

  it('시작이 종료와 같거나 뒤면 거부한다', () => {
    expect(ask({ endMinutes: 14 * 60 })).toEqual({ ok: false, reason: 'INVALID_RANGE' });
    expect(ask({ startMinutes: 15 * 60, endMinutes: 14 * 60 })).toEqual({ ok: false, reason: 'INVALID_RANGE' });
  });

  it('운영시간 경계는 통과한다 — 06:00 시작 · 24:00 종료', () => {
    expect(ask({ startMinutes: 360, endMinutes: 390 })).toEqual({ ok: true });
    expect(ask({ startMinutes: 1410, endMinutes: 1440 })).toEqual({ ok: true });
  });

  it('운영시간 밖은 거부한다', () => {
    expect(ask({ startMinutes: 330, endMinutes: 390 })).toEqual({ ok: false, reason: 'OUT_OF_HOURS' });
    expect(ask({ startMinutes: 1410, endMinutes: 1470 })).toEqual({ ok: false, reason: 'OUT_OF_HOURS' });
  });

  it('★ 운영시간은 회의실마다 다르다 — 09~18 회의실에 08:30 은 거부', () => {
    const nine = { ...ROOM, openMinutes: 9 * 60, closeMinutes: 18 * 60 };
    expect(ask({ room: nine, startMinutes: 8 * 60 + 30, endMinutes: 9 * 60 + 30 }))
      .toEqual({ ok: false, reason: 'OUT_OF_HOURS' });
    expect(ask({ room: nine, startMinutes: 9 * 60, endMinutes: 10 * 60 })).toEqual({ ok: true });
  });

  it('최소·최대는 회의실 설정값이다', () => {
    expect(ask({ room: { ...ROOM, minMinutes: 60 }, endMinutes: 14 * 60 + 30 }))
      .toEqual({ ok: false, reason: 'TOO_SHORT' });
    expect(ask({ endMinutes: 17 * 60 })).toEqual({ ok: false, reason: 'TOO_LONG' }); // 3시간 > 최대 120분
    /*
     * ★ 최대치를 풀면 `TOO_LONG` 은 사라진다. 그래도 입주사에게는 **하루 한도**가 남아
     *   3시간은 못 잡는다 — 두 규칙이 따로 산다는 뜻이고, 그래서 사유가 바뀐다.
     */
    expect(ask({ room: { ...ROOM, maxMinutes: null }, endMinutes: 17 * 60 }))
      .toEqual({ ok: false, reason: 'DAILY_LIMIT' });
    expect(ask({ room: { ...ROOM, maxMinutes: null }, endMinutes: 17 * 60, operator: true }))
      .toEqual({ ok: true });
  });
});

describe('지난 시각 — 운영자는 예외', () => {
  it('★ 지난 날은 거부한다', () => {
    expect(ask({ day: '2026-10-04' })).toEqual({ ok: false, reason: 'PAST' });
  });

  it('★ 오늘이라도 이미 시작한 시각은 거부한다', () => {
    expect(ask({ day: '2026-10-05', startMinutes: 10 * 60, endMinutes: 11 * 60 }))
      .toEqual({ ok: false, reason: 'PAST' });
  });

  it('오늘 아직 오지 않은 시각은 통과한다', () => {
    expect(ask({ day: '2026-10-05', startMinutes: 10 * 60 + 30, endMinutes: 11 * 60 })).toEqual({ ok: true });
  });

  it('★★ 운영자는 지난 시각도 넣는다 — 전화로 받은 예약을 나중에 적는 자리다', () => {
    expect(ask({ day: '2026-10-04', operator: true })).toEqual({ ok: true });
    expect(ask({ day: '2026-10-05', startMinutes: 8 * 60, endMinutes: 9 * 60, operator: true }))
      .toEqual({ ok: true });
  });
});

describe('예약 가능 기간 — 4주 · 운영자는 제한 없음', () => {
  /*
   * ★★ 「4주」는 **오늘을 포함해 28일**이다 — 마지막 날은 오늘+27 이다(시안
   *    `room-booking/04-rules.md` · `05-logic.md`: date ≤ 오늘+27, TENANT_ADVANCE_DAYS = 28).
   *    오늘+28 을 허용하면 29일이 열린다 — 하루가 조용히 더 열려 있었다(2026-09-27).
   */
  it('4주 뒤 마지막 날(오늘+27)은 통과한다', () => {
    expect(ask({ day: '2026-11-01' })).toEqual({ ok: true }); // 10-05 + 27일
  });

  it('★ 오늘+28 은 거부한다 — 오늘 포함 28일이 끝이다', () => {
    expect(ask({ day: '2026-11-02' })).toEqual({ ok: false, reason: 'TOO_FAR' });
  });

  it('★ 4주를 넘기면 거부한다', () => {
    expect(ask({ day: '2026-11-03' })).toEqual({ ok: false, reason: 'TOO_FAR' });
  });

  it('★★ 운영자는 제한이 없다', () => {
    expect(ask({ day: '2027-03-01', operator: true })).toEqual({ ok: true });
  });

  it('기간은 4주 — 오늘 포함 28일이다', () => {
    expect(AHEAD_DAYS).toBe(28);
  });
});

describe('하루 한도 — 입주사 기준 2시간', () => {
  it('한도는 2시간이다', () => {
    expect(DAILY_LIMIT_MINUTES).toBe(120);
  });

  it('이미 90분 쓴 입주사는 30분을 더 넣는다', () => {
    expect(ask({ companyUsedMinutes: 90, endMinutes: 14 * 60 + 30 })).toEqual({ ok: true });
  });

  it('★ 합이 2시간을 넘으면 거부한다', () => {
    expect(ask({ companyUsedMinutes: 90 })).toEqual({ ok: false, reason: 'DAILY_LIMIT' });
  });

  it('★ 정확히 2시간까지는 통과한다', () => {
    expect(ask({ companyUsedMinutes: 60 })).toEqual({ ok: true });
  });

  it('★★ 운영자는 한도가 없다', () => {
    expect(ask({ companyUsedMinutes: 300, operator: true })).toEqual({ ok: true });
  });

  /**
   * ★★★ 쓴 시간은 **확정된 예약만** 센다. 취소한 예약이 한도를 먹으면, 잘못 잡고 취소한
   *    입주사가 그날 다시 잡을 수 없다 — 취소가 벌이 된다.
   * ★★ 회의실이 여러 개면 **합산**한다. 한도는 입주사의 것이지 회의실의 것이 아니다.
   */
  it('★★★ 취소분은 세지 않는다', () => {
    const rows = [
      { status: 'confirmed', startMinutes: 540, endMinutes: 600 },  // 60분
      { status: 'cancelled', startMinutes: 600, endMinutes: 720 },  // 안 센다
      { status: 'completed', startMinutes: 780, endMinutes: 810 },  // 30분 — 쓴 것이다
    ] as const;
    expect(usedMinutes(rows)).toBe(90);
  });

  it('★★ 회의실이 달라도 합산한다', () => {
    expect(usedMinutes([
      { status: 'confirmed', startMinutes: 540, endMinutes: 600 },
      { status: 'confirmed', startMinutes: 540, endMinutes: 600 },
    ])).toBe(120);
  });
});

describe('상태 어휘', () => {
  /** ★ 셋뿐이다. DB CHECK 와 같은 목록이어야 한다 — 어긋나면 화면이 넣는 값이 막힌다. */
  it('★ 확정 · 취소 · 종료 셋이다', () => {
    expect([...RESERVATION_STATUS]).toEqual(['confirmed', 'cancelled', 'completed']);
  });

  it('사유마다 사람이 읽을 문구가 있다', () => {
    for (const reason of ['INVALID_RANGE', 'NOT_ALIGNED', 'OUT_OF_HOURS', 'TOO_SHORT', 'TOO_LONG',
      'PAST', 'TOO_FAR', 'DAILY_LIMIT', 'OVERLAP'] as const) {
      expect(REASON_TEXT[reason].length).toBeGreaterThan(0);
    }
  });
});

describe('요금 — 자리만 만든다(청구와 잇지 않는다)', () => {
  it('30분 요금 × 이용 분 / 30, 원 단위 반올림', () => {
    expect(reservationFee(ROOM, 14 * 60, 15 * 60)).toBe(20_000);
    expect(reservationFee(ROOM, 14 * 60, 14 * 60 + 30)).toBe(10_000);
  });

  it('요금이 없는 회의실은 0 이다', () => {
    expect(reservationFee({ ...ROOM, halfHourFee: null }, 14 * 60, 15 * 60)).toBe(0);
  });
});

describe('localDayMinutes', () => {
  it('로컬 벽시계로 날짜와 분을 읽는다', () => {
    expect(localDayMinutes(new Date(2026, 9, 5, 10, 15))).toEqual({ day: '2026-10-05', minutes: 615 });
  });

  /** ★ 자정 직후가 전날로 읽히면 「지난 시각」 판정이 하루 틀린다. */
  it('★ 자정 직후는 그날 0분이다', () => {
    expect(localDayMinutes(new Date(2026, 9, 5, 0, 0))).toEqual({ day: '2026-10-05', minutes: 0 });
  });
});
