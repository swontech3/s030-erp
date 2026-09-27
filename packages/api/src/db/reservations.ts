/**
 * 회의실·예약 조회와 쓰기 — SQL 만 한다.
 *
 * 무엇을 받아도 되는지는 `@swonbiz/shared/domain/reservation-rules` 의 순수 함수가 정한다.
 * 이 파일은 그 함수가 볼 값을 모아 주고, 결과를 넣는다.
 *
 * =============================================================================
 * ★★★ 시각은 **벽시계 문자열**로 주고받는다 — `Date` 를 넘기지 않는다
 * =============================================================================
 * `start_at`·`end_at` 은 `timestamp without time zone` 이다. `Date` 를 그냥 넘기면
 * 드라이버가 시간대를 붙여 보내고, 그 값이 서버 시간대만큼 밀려 저장된다. 그러면
 * 「10:00 예약」이 DB 에 01:00 으로 앉는다. 그래서 `'2026-10-06 10:00'` 처럼
 * **문자열로 넣고 `to_char` 로 읽는다** — 청구 쪽이 같은 이유로 같은 규칙을 쓴다
 * (`db/invoices.ts` 머리말).
 *
 * ★ 겹침을 여기서 세지 않는다. 배타 제약이 판정하고, 라우트가 23P01 을 409 로 바꾼다.
 */
import type { ScopedClient } from './withCompanyScope.ts';

interface Rows<T> {
  rows: T[];
  rowCount: number | null;
}
const q = <T>(client: ScopedClient, sql: string, params?: unknown[]): Promise<Rows<T>> =>
  client.query(sql, params) as Promise<Rows<T>>;

/** 회의실 한 칸 — **규칙이 데이터로 들어 있는 자리**(운영시간·최소·최대·요금). */
export interface RoomRow {
  facility_id: string;
  build_id: string;
  name: string;
  floor_no: string | null;
  capacity: number | null;
  /** `HH:MM`. */
  open_time: string | null;
  close_time: string | null;
  min_duration: number | null;
  max_duration: number | null;
  half_hour_fee: number | null;
  is_reservable: boolean;
}

const ROOM_COLUMNS = `
  f.facility_id, f.building_id AS build_id, f.name, f.floor_no, f.capacity,
  f.open_time, f.close_time, f.min_duration, f.max_duration, f.half_hour_fee, f.is_reservable`;

/**
 * 예약할 수 있는 회의실 목록.
 *
 * ★ `status='active'` 인 `MEETING` 만이다. 예약 불가로 내려둔 방(`is_reservable=false`)도
 *   **목록에는 보인다** — 화면이 「예약 불가」로 보여 줘야 운영자가 왜 못 잡는지 안다.
 */
export async function listRooms(client: ScopedClient): Promise<RoomRow[]> {
  const { rows } = await q<RoomRow>(
    client,
    `SELECT ${ROOM_COLUMNS}
       FROM public.tb_s080_facilities f
      WHERE f.facility_type = 'MEETING' AND f.status = 'active'
      ORDER BY f.floor_no, f.name`,
  );
  return rows;
}

/**
 * 예약을 넣을 회의실 한 칸을 **잠근다**(`FOR UPDATE`).
 *
 * ★★★ 같은 회의실에 동시에 들어오는 요청을 이 행 하나로 **직렬화**한다. 잠그지 않으면
 *    둘이 같이 「빈 시간」을 읽고 둘 다 통과시키려 든다 — 그때 배타 제약이 한쪽을 막아
 *    주지만, 막힌 쪽은 하루 한도를 이미 계산해 버린 상태다. 레거시에서 가져온 규칙이다.
 * ★ 예약 불가 방은 여기서 `null` 이다 — 잡을 수 없는 방을 잠글 이유가 없다.
 */
export async function lockRoom(client: ScopedClient, facilityId: string): Promise<RoomRow | null> {
  const { rows } = await q<RoomRow>(
    client,
    `SELECT ${ROOM_COLUMNS}
       FROM public.tb_s080_facilities f
      WHERE f.facility_id = $1 AND f.facility_type = 'MEETING'
        AND f.status = 'active' AND f.is_reservable
      FOR UPDATE`,
    [facilityId],
  );
  return rows[0] ?? null;
}

/**
 * 회의실 한 칸 — 잠그지 않고 읽는다. 현황판(s0300500060)이 쓴다.
 *
 * ★ `is_reservable` 을 보지 않는다 — 지금 예약을 못 받는 방이어도 **벽에 걸린 화면은
 *   오늘 일정을 보여 줘야 한다**. 예약을 만드는 길은 이 화면에 없다.
 */
export async function findRoom(client: ScopedClient, facilityId: string): Promise<RoomRow | null> {
  const { rows } = await q<RoomRow>(
    client,
    `SELECT ${ROOM_COLUMNS}
       FROM public.tb_s080_facilities f
      WHERE f.facility_id = $1 AND f.facility_type = 'MEETING' AND f.status = 'active'`,
    [facilityId],
  );
  return rows[0] ?? null;
}

/** 예약 한 줄 — 화면이 보는 칸. 시각은 벽시계 문자열이다(머리말). */
export interface ReservationRow {
  reservation_id: string;
  facility_id: string;
  room_name: string | null;
  company_id: string | null;
  company_name: string | null;
  member_id: string | null;
  title: string;
  /** `YYYY-MM-DD`. */
  day: string;
  /** `HH:MM`. */
  start_time: string;
  end_time: string;
  attendees: number | null;
  purpose: string | null;
  usage_fee: number | null;
  status: string;
  cancel_reason: string | null;
  created_by: string | null;
  /** 등록한 사람 이름 — 등록 시점 스냅샷(027). 옛 행은 `null`. */
  booker_name: string | null;
  /** `YYYY-MM-DD HH:MM` — 모달 하단의 「등록 …」 줄. */
  created_at: string | null;
}

const RESERVATION_COLUMNS = `
  r.reservation_id, r.facility_id, f.name AS room_name,
  r.company_id, c.company_name, r.member_id, r.title,
  to_char(r.start_at, 'YYYY-MM-DD')      AS day,
  to_char(r.start_at, 'HH24:MI')         AS start_time,
  to_char(r.end_at,   'HH24:MI')         AS end_time,
  r.attendees, r.purpose, r.usage_fee, r.status, r.cancel_reason, r.created_by,
  r.booker_name,
  to_char(r.created_at, 'YYYY-MM-DD HH24:MI') AS created_at`;

/**
 * 한 회의실의 기간 안 예약.
 *
 * ★★ **입주사 스코프는 RLS 가 거른다**(003 의 `erp_company_scope`). 여기서 `company_id`
 *    조건을 또 붙이지 않는다 — 두 벌로 거르면 한쪽만 고쳐지는 날 남의 예약이 보인다.
 *    운영사 세션은 정책이 전부 통과시킨다.
 * ★ 취소된 예약도 내려보낸다. 화면이 「취소」로 흐리게 보여 줘야 「누가 취소했나」가 읽힌다.
 */
export async function listReservations(
  client: ScopedClient,
  args: { facilityId: string | null; from: string; to: string },
): Promise<ReservationRow[]> {
  const { rows } = await q<ReservationRow>(
    client,
    `SELECT ${RESERVATION_COLUMNS}
       FROM public.tb_s080_reservations r
       JOIN public.tb_s080_facilities f ON f.facility_id = r.facility_id
       LEFT JOIN public.tb_s080_companies c ON c.company_id = r.company_id
      WHERE ($1::text IS NULL OR r.facility_id = $1)
        AND r.start_at >= $2::date
        AND r.start_at <  ($3::date + interval '1 day')
      ORDER BY r.start_at, f.name`,
    [args.facilityId, args.from, args.to],
  );
  return rows;
}

/**
 * 그 기간에 **차 있는 시간**만 — 회의실·날짜·시작·종료 넷뿐이다.
 *
 * =============================================================================
 * ★★★ 이것은 **RLS 를 지나가는 조회**다 (026)
 * =============================================================================
 * 입주사 세션에는 RLS 가 남의 예약을 아예 안 보여 준다. 그래서 잡혀 있는 칸이 화면에서
 * 빈 칸으로 보였다 — 눌러야 409 가 왔다. 그 칸을 잠그려면 「차 있다」만 알면 되고,
 * **누가** 잡았는지는 알 필요가 없다.
 *
 * ★ 그 판단을 SQL 로 여기 적지 않는다. `public.erp_busy_slots` 함수가 시각 넷만
 *   돌려주고, 이 파일은 그것을 부를 뿐이다 — 함수의 반환형이 「무엇까지 새도 되는가」다.
 *   여기에 직접 SELECT 를 적으면 예약 표 전체가 열린 상태가 되고, 나중에 회사명 JOIN 이
 *   한 줄 붙는 날 이름이 샌다(026 머리말).
 * ★ 취소는 자리를 잡지 않는다 — 그 판정도 함수 안에 있다.
 */
export async function listBusySlots(
  client: ScopedClient,
  args: { facilityId: string | null; from: string; to: string },
): Promise<{ facility_id: string; day: string; start_time: string; end_time: string }[]> {
  const { rows } = await q<{ facility_id: string; day: string; start_time: string; end_time: string }>(
    client,
    `SELECT facility_id, day, start_time, end_time
       FROM public.erp_busy_slots($1::text, $2::date, $3::date)`,
    [args.facilityId, args.from, args.to],
  );
  return rows;
}

/** 예약 한 건. 취소·종료가 대상을 찾을 때 쓴다. ★ RLS 가 남의 회사 것을 안 보여 준다. */
export async function findReservation(
  client: ScopedClient,
  reservationId: string,
): Promise<ReservationRow | null> {
  const { rows } = await q<ReservationRow>(
    client,
    `SELECT ${RESERVATION_COLUMNS}
       FROM public.tb_s080_reservations r
       JOIN public.tb_s080_facilities f ON f.facility_id = r.facility_id
       LEFT JOIN public.tb_s080_companies c ON c.company_id = r.company_id
      WHERE r.reservation_id = $1`,
    [reservationId],
  );
  return rows[0] ?? null;
}

/**
 * 그 입주사가 그 날 잡아 둔 예약 — **하루 한도**를 재는 재료.
 *
 * ★★ 회의실을 가리지 않는다. 한도는 입주사의 것이지 회의실의 것이 아니다.
 * ★ 취소분을 여기서 빼지 않는다 — 무엇을 세는지는 shared 의 `usedMinutes` 가 정한다.
 *   SQL 에서 걸러 버리면 규칙이 두 곳(여기와 shared)에 생긴다.
 */
export async function listCompanyDayReservations(
  client: ScopedClient,
  args: { companyId: string; day: string; exceptId?: string | null },
): Promise<{ status: string; start_minutes: number; end_minutes: number }[]> {
  const { rows } = await q<{ status: string; start_minutes: number; end_minutes: number }>(
    client,
    `SELECT r.status,
            (extract(hour FROM r.start_at) * 60 + extract(minute FROM r.start_at))::int AS start_minutes,
            (extract(hour FROM r.end_at)   * 60 + extract(minute FROM r.end_at))::int   AS end_minutes
       FROM public.tb_s080_reservations r
      WHERE r.company_id = $1
        AND r.start_at >= $2::date
        AND r.start_at <  ($2::date + interval '1 day')
        -- ★★ 고치는 중인 예약은 **자기 자신을 세지 않는다.** 1시간을 1시간 30분으로
        --    늘릴 때 「이미 1시간 썼다」로 막히면 안 된다(시안 04-rules.md 「수정 시」).
        AND ($3::text IS NULL OR r.reservation_id <> $3)`,
    [args.companyId, args.day, args.exceptId ?? null],
  );
  return rows;
}

/**
 * 그 입주사가 그 **기간** 동안 잡아 둔 예약 — 날짜별 사용량의 재료.
 *
 * =============================================================================
 * ★★★ 회의실을 가리지 않는다 — 하루 한도는 **입주사**의 것이다
 * =============================================================================
 * 화면이 「지금 보고 있는 회의실」의 목록만 더하면 다른 방에서 쓴 시간이 빠진다. B 에서
 * 2시간 쓴 입주사가 A 화면에서 「예약 가능」으로 보이고, 눌러야 400 이 온다(2026-09-27
 * 발견). 서버가 전 회의실을 합산해 내려보내고 화면은 그것만 본다
 * (시안 `room-booking/07-data-model.md` 의 `usedMinutesByDate`).
 *
 * ★ 취소분을 여기서 빼지 않는다 — 무엇을 세는지는 shared 의 `usedMinutes` 가 정한다
 *   (`listCompanyDayReservations` 와 같은 이유).
 */
export async function listCompanyRangeReservations(
  client: ScopedClient,
  args: { companyId: string; from: string; to: string },
): Promise<{ day: string; status: string; start_minutes: number; end_minutes: number }[]> {
  const { rows } = await q<{ day: string; status: string; start_minutes: number; end_minutes: number }>(
    client,
    `SELECT to_char(r.start_at, 'YYYY-MM-DD') AS day,
            r.status,
            (extract(hour FROM r.start_at) * 60 + extract(minute FROM r.start_at))::int AS start_minutes,
            (extract(hour FROM r.end_at)   * 60 + extract(minute FROM r.end_at))::int   AS end_minutes
       FROM public.tb_s080_reservations r
      WHERE r.company_id = $1
        AND r.start_at >= $2::date
        AND r.start_at <  ($3::date + interval '1 day')`,
    [args.companyId, args.from, args.to],
  );
  return rows;
}

/**
 * 예약 조직 선택지 — **운영자가 대신 잡아 줄 입주사 목록**.
 *
 * ★★ 이것은 **명부다.** 입주사 세션에 주지 않는다 — 부르는 쪽(`routes/booking.ts`)이
 *    운영자일 때만 부른다. RLS 는 이 표를 가리지 않는다(입주사 표는 카탈로그가 아니지만
 *    003 의 격리 대상에 들어 있지 않다 — 그래서 **앱이 막아야 한다**).
 * ★ 이름과 식별자만 준다. 대표자·연락처·사업자번호는 예약 화면이 알 필요가 없다.
 */
export async function listBookingCompanies(
  client: ScopedClient,
): Promise<{ company_id: string; company_name: string }[]> {
  const { rows } = await q<{ company_id: string; company_name: string }>(
    client,
    `SELECT company_id, company_name
       FROM public.tb_s080_companies
      ORDER BY company_name, company_id`,
  );
  return rows;
}

/**
 * 예약을 넣는다. ★ 시각은 `'YYYY-MM-DD HH:MM'` **문자열**이다(머리말).
 *
 * ★ 겹치면 여기서 `23P01` 이 난다 — 부르는 쪽이 409 로 바꾼다. 미리 세지 않는다.
 */
export async function insertReservation(
  client: ScopedClient,
  args: {
    reservationId: string;
    buildId: string;
    facilityId: string;
    /** 입주사. 운영자 대행(외부 손님)이면 `null`. */
    companyId: string | null;
    memberId: string | null;
    title: string;
    /** `YYYY-MM-DD HH:MM`. */
    startAt: string;
    endAt: string;
    attendees: number | null;
    purpose: string | null;
    usageFee: number;
    /** 등록한 사람 이름 — 화면의 「예약자」 칸(027). */
    bookerName: string | null;
    actor: string;
  },
): Promise<void> {
  await q(
    client,
    `INSERT INTO public.tb_s080_reservations
       (reservation_id, build_id, facility_id, company_id, member_id, title,
        start_at, end_at, attendees, purpose, usage_fee, status, booker_name,
        created_at, updated_at, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6, $7::timestamp, $8::timestamp, $9,$10,$11,'confirmed',$13,
             now(), now(), $12, $12)`,
    [
      args.reservationId, args.buildId, args.facilityId, args.companyId, args.memberId,
      args.title, args.startAt, args.endAt, args.attendees, args.purpose, args.usageFee,
      args.actor, args.bookerName,
    ],
  );
}

/**
 * 예약을 고친다 — 회의실 · 시각 · 제목 · 인원 · 메모.
 *
 * ★★ **확정인 것만 고친다.** 취소·종료된 예약을 되살리는 길을 이 조건이 막는다.
 * ★★ 겹침은 여기서 세지 않는다 — 배타 제약이 판정하고(23P01), **자기 자신과는 다투지
 *    않는다**(같은 행을 고치는 것이라 옛 값은 비교 대상이 아니다).
 * ★ 예약 조직(`company_id`)은 **바꾸지 않는다.** 조직을 바꾸는 것은 사실상 다른 예약이라
 *   취소 후 새로 잡는다(시안 03-booking-form.md §4).
 */
export async function updateReservation(
  client: ScopedClient,
  args: {
    reservationId: string;
    buildId: string;
    facilityId: string;
    title: string;
    /** `YYYY-MM-DD HH:MM`. */
    startAt: string;
    endAt: string;
    attendees: number | null;
    purpose: string | null;
    usageFee: number;
    actor: string;
  },
): Promise<boolean> {
  const res = await q(
    client,
    `UPDATE public.tb_s080_reservations
        SET build_id = $2, facility_id = $3, title = $4,
            start_at = $5::timestamp, end_at = $6::timestamp,
            attendees = $7, purpose = $8, usage_fee = $9,
            updated_at = now(), updated_by = $10
      WHERE reservation_id = $1 AND status = 'confirmed'`,
    [
      args.reservationId, args.buildId, args.facilityId, args.title,
      args.startAt, args.endAt, args.attendees, args.purpose, args.usageFee, args.actor,
    ],
  );
  return (res.rowCount ?? 0) === 1;
}
/**
 * 상태를 바꾼다 — 취소 · 종료.
 *
 * ★★ **확정인 것만 바꾼다.** 두 사람이 동시에 취소를 눌러도 한 번만 바뀌고, 고친 행이
 *    0 이면 부르는 쪽이 「이미 처리됨」으로 읽는다. 취소된 예약을 종료로 덮어쓰는 길도
 *    이 조건이 막는다.
 * ★ 지우지 않는다(소프트 취소). 누가 언제 왜 취소했는지가 예약의 절반이다.
 */
export async function setReservationStatus(
  client: ScopedClient,
  args: {
    reservationId: string;
    /** `cancelled` | `completed`. */
    status: string;
    cancelReason: string | null;
    actor: string;
  },
): Promise<boolean> {
  const res = await q(
    client,
    `UPDATE public.tb_s080_reservations
        SET status = $2,
            cancelled_at  = CASE WHEN $2 = 'cancelled' THEN now() ELSE cancelled_at END,
            cancel_reason = CASE WHEN $2 = 'cancelled' THEN $3 ELSE cancel_reason END,
            updated_at = now(), updated_by = $4
      WHERE reservation_id = $1 AND status = 'confirmed'`,
    [args.reservationId, args.status, args.cancelReason, args.actor],
  );
  return (res.rowCount ?? 0) === 1;
}
