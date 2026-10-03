/**
 * 회의실 예약 라우트 — s030600010.
 *
 * `routes/billing.ts` 와 같은 규칙이다. 판정은 `@swonbiz/shared/domain/reservation-rules`
 * 의 순수 함수가 하고 이 파일은 배선만 한다.
 *
 * =============================================================================
 * ★★★ 규칙이 **서버에** 있어야 한다
 * =============================================================================
 * 화면도 같은 함수를 부르지만, 화면 검사는 친절이고 **서버 검사가 규칙이다.** API 를
 * 직접 찌르면 화면을 지나가지 않는다 — 30분이 아닌 예약, 지난 시각, 하루 3시간이 그렇게
 * 들어온다. `scripts/verify-booking.js` 가 세션을 바꿔 끼우고 그것을 확인한다.
 *
 * =============================================================================
 * ★★ 겹침은 **DB 가 판정한다**
 * =============================================================================
 * 회의실 행을 `FOR UPDATE` 로 잠가 동시 요청을 직렬화하고, 넣어 본 뒤 `23P01` 을 409 로
 * 바꾼다. 앱에서 미리 세지 않는다 — 두 벌이 되고, 동시 예약에서는 앱 쪽이 반드시 진다
 * (`reservation-rules.ts` 머리말).
 *
 * =============================================================================
 * ★★ 운영자 예외 셋 — 지난 시각 · 4주 · 하루 한도
 * =============================================================================
 * 전화로 받은 예약을 나중에 적고, 장기 행사를 미리 잡고, 회사 행사로 하루를 다 쓰는 일이
 * 실제로 있다. 예외는 `validateReservation({ operator })` 한 곳에서만 갈린다.
 *
 * ★ **예약에 입주사를 기록한다.** 입주사 세션이 만들면 그 회사를, 운영자가 만들면
 *   `companyId` 를 받은 그대로(외부 손님 대행이면 `null`) 넣는다. 비워 두면 그 회사
 *   직원이 자기 회사 예약을 못 본다 — 화면이 입주사로 거르고 RLS 도 그것으로 거른다.
 *
 * ★ 상태 전이는 **확정 → 취소 / 확정 → 종료** 둘뿐이고, 종료는 운영자만 한다.
 *   자동 종료 배치는 없다(기간 만료 계약과 같은 규칙 — 시스템이 먼저 닫지 않는다).
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { parseDay } from '@swonbiz/shared/domain/day';
import {
  REASON_TEXT,
  localDayMinutes,
  reservationFee,
  timeToMinutes,
  usedMinutes,
  validateReservation,
  type ReservationReason,
} from '@swonbiz/shared/domain/reservation-rules';
import { requireSession } from '../session/hook.ts';
import { bbiyongAuth } from '../bbiyong/index.ts';
import { withCompanyScope, type CompanyScope } from '../db/withCompanyScope.ts';
import {
  findReservation,
  insertReservation,
  listBookingCompanies,
  listBusySlots,
  listCompanyDayReservations,
  listCompanyRangeReservations,
  listReservations,
  listRooms,
  lockRoom,
  setReservationStatus,
  updateReservation,
  type ReservationRow,
  type RoomRow,
} from '../db/reservations.ts';

/** 종료 처리는 운영 업무다 — 입주사는 자기 예약도 종료하지 못한다(취소는 한다). */
const OPERATOR = 'operator';

function scopeOf(session: { role: string; companyId: string | null }): CompanyScope {
  return { role: session.role as CompanyScope['role'], companyId: session.companyId };
}

/** 사유를 단 실패 — 라우트가 상태코드로 바꾼다. */
class BookingError extends Error {
  constructor(public reason: ReservationReason | 'NOT_FOUND' | 'ALREADY' | 'STARTED') {
    super(reason);
  }
}

/** `HH:MM` 인가. 30분 단위인지는 규칙이 본다 — 여기서는 **읽을 수 있는가**만 본다. */
const isTime = (s: unknown): s is string => typeof s === 'string' && /^([01]\d|2[0-4]):[0-5]\d$/.test(s);

/** 회의실 설정 → 규칙이 보는 모양. ★ 기본값은 **설정이 비어 있을 때만** 쓴다. */
function roomRules(room: RoomRow) {
  return {
    // ★ 06:00~24:00 을 상수로 두지 않는다 — 설정값이 정본이고, 비어 있을 때만 하루 전체다.
    openMinutes: timeToMinutes(room.open_time ?? '00:00'),
    closeMinutes: timeToMinutes(room.close_time ?? '24:00'),
    minMinutes: room.min_duration,
    maxMinutes: room.max_duration,
    halfHourFee: room.half_hour_fee,
  };
}

function toRoom(row: RoomRow) {
  return {
    facilityId: row.facility_id,
    name: row.name,
    floorNo: row.floor_no,
    capacity: row.capacity,
    /** ★ 규칙이 데이터로 내려간다 — 화면이 같은 값으로 슬롯을 그린다. */
    openTime: row.open_time ?? '00:00',
    closeTime: row.close_time ?? '24:00',
    minDuration: row.min_duration ?? 30,
    maxDuration: row.max_duration ?? 0,
    halfHourFee: row.half_hour_fee,
    isReservable: row.is_reservable,
  };
}

function toReservation(row: ReservationRow) {
  return {
    reservationId: row.reservation_id,
    facilityId: row.facility_id,
    roomName: row.room_name ?? '',
    companyId: row.company_id,
    /** ★ 입주사 없는 예약 = 운영자 대행(외부 손님). 화면이 「외부」로 보여 준다. */
    companyName: row.company_name,
    title: row.title,
    day: row.day,
    startTime: row.start_time,
    endTime: row.end_time,
    attendees: row.attendees,
    purpose: row.purpose,
    usageFee: row.usage_fee ?? 0,
    status: row.status,
    cancelReason: row.cancel_reason,
    /** 등록한 사람 이름(027). 옛 행은 `null` — 화면이 「—」로 그린다. */
    bookerName: row.booker_name,
    createdAt: row.created_at,
  };
}

/**
 * 차 있는 자리 한 칸 — **시각만**.
 *
 * ★★★ 칸을 늘리지 않는다. 이 조회는 RLS 를 지나가므로(026) 여기 붙는 칸은 그대로
 *    **남의 회사 정보**가 된다. 회사명·제목·예약자·식별자 전부 주지 않는다 —
 *    식별자를 주면 상세를 찔러 볼 수 있고, 예약 수만 세어도 누가 많이 쓰는지가 읽힌다.
 */
function toBusy(row: { facility_id: string; day: string; start_time: string; end_time: string }) {
  return {
    facilityId: row.facility_id,
    day: row.day,
    startTime: row.start_time,
    endTime: row.end_time,
  };
}
const badReason = (reply: FastifyReply, reason: ReservationReason) =>
  reply.code(400).send({ error: 'invalid_request', reason, message: REASON_TEXT[reason] });

export function registerBookingRoutes(app: FastifyInstance): void {
  /* ── 회의실 목록 — 규칙이 데이터로 내려간다 ───────────────────────────────
     ★★ 운영자에게는 **예약 조직 목록**을 같이 준다. 전화로 받은 예약을 입주사 이름으로
        대신 잡아 주려면 화면에 그 선택지가 있어야 한다(시안 `03-booking-form.md` 섹션 3).
     ★★★ 입주사에게는 **빈 배열**이다 — 그 목록은 다른 입주사의 이름, 곧 명부다.
        RLS 가 입주사 표를 가리지 않으므로 이 갈림은 **앱이 지켜야 한다.** */
  app.get('/facilities', async (req, reply) => {
    const session = requireSession(req);
    const operator = session.role === OPERATOR;
    const data = await withCompanyScope(scopeOf(session), async (client) => ({
      rooms: await listRooms(client),
      companies: operator ? await listBookingCompanies(client) : [],
    }));
    return reply.send({
      facilities: data.rooms.map(toRoom),
      companies: data.companies.map((c) => ({ companyId: c.company_id, companyName: c.company_name })),
    });
  });

  /* ── 예약 목록 ───────────────────────────────────────────────────────────
     ★ 입주사 스코프는 RLS 가 거른다(003). 여기서 또 거르지 않는다.

     ★★★ 입주사에게는 **차 있는 자리**를 같이 준다 — `busy` (026).
        RLS 만으로는 남이 잡아 둔 칸이 화면에서 빈 칸으로 보이고, 눌러야 409 가 온다.
        `busy` 는 회의실·날짜·시각 넷뿐이다 — 회사명·제목·예약자는 없다.
     ★ 한 번에 같이 내려보낸다. 따로 부르게 하면 화면이 한쪽만 부르는 날이 오고,
       그날 잠금이 조용히 사라진다.
     ★ 운영자에게는 빈 배열이다 — 전부 상세로 보므로 두 벌이 될 이유가 없다. */
  app.get<{ Querystring: { facilityId?: string; from?: string; to?: string } }>(
    '/reservations',
    async (req, reply) => {
      const session = requireSession(req);
      const from = String(req.query.from ?? '');
      const to = String(req.query.to ?? from);
      if (parseDay(from) === null || parseDay(to) === null) {
        return reply
          .code(400)
          .send({ error: 'invalid_request', message: '기간은 YYYY-MM-DD 이어야 합니다 (from · to)' });
      }
      const facilityId = req.query.facilityId ? String(req.query.facilityId) : null;
      const operator = session.role === OPERATOR;
      const seen = await withCompanyScope(scopeOf(session), async (client) => ({
        rows: await listReservations(client, { facilityId, from, to }),
        // ★ 자기 회사 예약도 이 안에 들어 있다 — 화면이 상세를 먼저 보고, 없을 때만 「예약됨」이다.
        busy: operator ? [] : await listBusySlots(client, { facilityId, from, to }),
        /*
         * ★★★ 하루 한도의 재료 — **회의실을 가리지 않는다.**
         *    화면이 보고 있는 회의실 목록만 더하면 다른 방에서 쓴 시간이 빠지고,
         *    「예약 가능」으로 보이다가 누르면 400 이 온다. 판정하는 쪽이 그 값을 준다.
         *    ★ 운영자는 한도가 없어 빈 객체다 — 없는 한도를 그리지 않게.
         */
        used:
          operator || session.companyId === null
            ? []
            : await listCompanyRangeReservations(client, { companyId: session.companyId, from, to }),
      }));

      // 날짜별로 모아 shared 의 규칙(취소 제외)으로 센다 — 세는 규칙은 한 곳이다.
      const byDay = new Map<string, { status: string; startMinutes: number; endMinutes: number }[]>();
      for (const r of seen.used) {
        const list = byDay.get(r.day) ?? [];
        list.push({ status: r.status, startMinutes: r.start_minutes, endMinutes: r.end_minutes });
        byDay.set(r.day, list);
      }
      const usedMinutesByDate: Record<string, number> = {};
      for (const [day, rows] of byDay) usedMinutesByDate[day] = usedMinutes(rows);

      return reply.send({
        reservations: seen.rows.map(toReservation),
        busy: seen.busy.map(toBusy),
        usedMinutesByDate,
      });
    },
  );

  /* ── 예약 만들기 ─────────────────────────────────────────────────────────
     ★★ 회의실 행을 잠그고 → 규칙을 보고 → 넣는다. 겹침은 DB 가 말한다(23P01 → 409). */
  app.post<{
    Body: {
      facilityId?: string;
      day?: string;
      startTime?: string;
      endTime?: string;
      title?: string;
      attendees?: number | null;
      purpose?: string | null;
      /** 운영자만 쓴다 — 대신 잡아 주는 입주사. 외부 손님이면 비운다. */
      companyId?: string | null;
    };
  }>('/reservations', async (req, reply) => {
    const session = requireSession(req);
    const body = req.body ?? {};
    const facilityId = String(body.facilityId ?? '');
    const day = String(body.day ?? '');
    const title = String(body.title ?? '').trim();

    if (!facilityId || parseDay(day) === null || !isTime(body.startTime) || !isTime(body.endTime) || !title) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: '회의실 · 날짜 · 시작 · 종료 · 제목은 필수입니다',
      });
    }

    const operator = session.role === OPERATOR;
    /*
     * ★★★ 입주사를 **세션에서** 정한다. 입주사 세션이 보낸 `companyId` 는 **무시한다** —
     *    받아 쓰면 남의 회사 이름으로 예약을 넣을 수 있고, RLS 의 WITH CHECK 에 걸려
     *    500 이 될 뿐 의도가 드러나지 않는다.
     */
    const companyId = operator ? (body.companyId ? String(body.companyId) : null) : session.companyId;
    const startMinutes = timeToMinutes(body.startTime);
    const endMinutes = timeToMinutes(body.endTime);
    const attendees = body.attendees == null ? null : Number(body.attendees);
    if (attendees !== null && !Number.isInteger(attendees)) {
      return reply.code(400).send({ error: 'invalid_request', message: '참석 인원이 올바르지 않습니다' });
    }

    /*
     * 예약자 이름 — **삐용 프로필에서 받아 그 자리에 적어 둔다**(027).
     * ★ 세션에는 이름이 없다(`ErpSession` 은 판정에 필요한 것만 담는다). 화면이 보낸 값을
     *   믿지 않는다 — 이름은 「누가 잡았는가」의 기록이라 요청 본문에서 받으면 안 된다.
     * ★ 조회가 실패해도 예약은 선다. 이름이 없는 것보다 예약이 안 되는 것이 나쁘다.
     */
    const bookerName = await bbiyongAuth
      .getProfile(session.s020MemberId)
      .then((profile) => profile?.memberName ?? null)
      .catch(() => null);

    const reservationId = randomUUID();
    try {
      await withCompanyScope(scopeOf(session), async (client) => {
        // ① 회의실 잠금 — 같은 방의 동시 요청이 여기서 한 줄로 선다
        const room = await lockRoom(client, facilityId);
        if (!room) throw new BookingError('NOT_FOUND');

        // ② 하루 한도 재료 — 그 입주사가 그 날 쓴 시간(회의실 합산 · 취소 제외는 shared 가 한다)
        const sameDay =
          companyId === null
            ? []
            : await listCompanyDayReservations(client, { companyId, day });
        const used = usedMinutes(
          sameDay.map((r) => ({
            status: r.status,
            startMinutes: r.start_minutes,
            endMinutes: r.end_minutes,
          })),
        );

        // ③ 규칙 — 화면과 같은 함수다
        const rules = roomRules(room);
        const verdict = validateReservation({
          room: rules,
          day,
          startMinutes,
          endMinutes,
          asOf: localDayMinutes(new Date()),
          operator,
          companyUsedMinutes: used,
        });
        if (!verdict.ok) throw new BookingError(verdict.reason);

        // ④ 넣는다 — 겹치면 여기서 23P01 이 난다
        try {
          await insertReservation(client, {
            reservationId,
            buildId: room.build_id,
            facilityId,
            companyId,
            memberId: null,
            title,
            startAt: `${day} ${body.startTime}`,
            endAt: `${day} ${body.endTime}`,
            attendees,
            purpose: body.purpose ? String(body.purpose) : null,
            usageFee: reservationFee(rules, startMinutes, endMinutes),
            // ★ 이름을 그 자리에서 적어 둔다 — 삐용 회원 표는 ERP 가 조회하지 못한다(027).
            bookerName,
            actor: String(session.s020MemberId),
          });
        } catch (e) {
          // ★ 23P01 = 배타 제약. 겹침의 판정은 여기 하나다.
          if ((e as { code?: string }).code === '23P01') throw new BookingError('OVERLAP');
          throw e;
        }
      });
    } catch (e) {
      if (e instanceof BookingError) {
        if (e.reason === 'NOT_FOUND') {
          return reply.code(404).send({ error: 'not_found', message: '예약할 수 있는 회의실이 아닙니다' });
        }
        if (e.reason === 'OVERLAP') {
          return reply.code(409).send({ error: 'conflict', reason: 'OVERLAP', message: REASON_TEXT.OVERLAP });
        }
        return badReason(reply, e.reason as ReservationReason);
      }
      throw e;
    }

    return reply.code(201).send({ reservationId });
  });

  /* ── 예약 수정 ───────────────────────────────────────────────────────────
     ★★★ **등록과 같은 검사를 다시 한다.** 화면이 보낸 것만 덮고 나머지는 저장값을 쓴 뒤,
        합쳐진 값을 `validateReservation` 에 다시 통과시킨다 — 「수정이라서」 느슨해지는
        자리는 없다.
     ★★ 충돌과 하루 한도에서 **자기 자신은 뺀다.** 1시간을 1시간 30분으로 늘릴 때
        「이미 1시간 썼다」로 막히면 안 된다(시안 `04-rules.md` 「수정 시」).
        겹침은 DB 가 보는데, 같은 행을 고치는 것이라 옛 값과는 다투지 않는다.
     ★ 입주사는 **시작 전**까지만 고친다. 운영자는 진행 중인 것도 고친다(연장·조기 종료).
     ★ 예약 조직은 바꾸지 못한다 — 조직을 바꾸는 것은 다른 예약이다(400). */
  app.patch<{
    Params: { id: string };
    Body: {
      facilityId?: string;
      day?: string;
      startTime?: string;
      endTime?: string;
      title?: string;
      attendees?: number | null;
      purpose?: string | null;
      companyId?: string | null;
    };
  }>('/reservations/:id', async (req, reply) => {
    const session = requireSession(req);
    const body = req.body ?? {};
    const operator = session.role === OPERATOR;

    if ('companyId' in body) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: '예약 조직은 바꿀 수 없습니다 — 취소한 뒤 다시 잡아 주세요',
      });
    }

    try {
      await withCompanyScope(scopeOf(session), async (client) => {
        // ① 무엇을 고치는가 — RLS 가 남의 회사 것을 아예 안 보여 준다(404)
        const found = await findReservation(client, req.params.id);
        if (!found) throw new BookingError('NOT_FOUND');
        if (found.status !== 'confirmed') throw new BookingError('ALREADY');

        // ② 입주사는 시작 전까지만
        const now = localDayMinutes(new Date());
        const startedAlready =
          found.day < now.day || (found.day === now.day && timeToMinutes(found.start_time) <= now.minutes);
        if (!operator && startedAlready) throw new BookingError('STARTED');

        // ③ 보낸 것만 덮고 나머지는 저장값
        const facilityId = body.facilityId ? String(body.facilityId) : found.facility_id;
        const day = body.day ? String(body.day) : found.day;
        const startTime = body.startTime ?? found.start_time;
        const endTime = body.endTime ?? found.end_time;
        const title = body.title === undefined ? found.title : String(body.title).trim();
        const attendees =
          body.attendees === undefined ? found.attendees : body.attendees == null ? null : Number(body.attendees);
        const purpose =
          body.purpose === undefined ? found.purpose : body.purpose ? String(body.purpose) : null;

        if (parseDay(day) === null || !isTime(startTime) || !isTime(endTime) || !title) {
          throw new BookingError('INVALID_RANGE');
        }
        if (attendees !== null && !Number.isInteger(attendees)) throw new BookingError('INVALID_RANGE');

        // ④ 회의실 잠금 — 방을 옮기면 **옮겨 갈 방**을 잠근다
        const room = await lockRoom(client, facilityId);
        if (!room) throw new BookingError('NOT_FOUND');

        // ⑤ 하루 한도 — 자기 자신을 뺀다
        const sameDay =
          found.company_id === null
            ? []
            : await listCompanyDayReservations(client, {
                companyId: found.company_id,
                day,
                exceptId: req.params.id,
              });
        const used = usedMinutes(
          sameDay.map((r) => ({ status: r.status, startMinutes: r.start_minutes, endMinutes: r.end_minutes })),
        );

        const rules = roomRules(room);
        const startMinutes = timeToMinutes(startTime);
        const endMinutes = timeToMinutes(endTime);
        const verdict = validateReservation({
          room: rules,
          day,
          startMinutes,
          endMinutes,
          asOf: now,
          operator,
          companyUsedMinutes: used,
        });
        if (!verdict.ok) throw new BookingError(verdict.reason);

        try {
          const ok = await updateReservation(client, {
            reservationId: req.params.id,
            buildId: room.build_id,
            facilityId,
            title,
            startAt: `${day} ${startTime}`,
            endAt: `${day} ${endTime}`,
            attendees,
            purpose,
            usageFee: reservationFee(rules, startMinutes, endMinutes),
            actor: String(session.s020MemberId),
          });
          if (!ok) throw new BookingError('ALREADY');
        } catch (e) {
          // ★ 23P01 = 배타 제약. 겹침의 판정은 등록과 같은 자리 하나다.
          if ((e as { code?: string }).code === '23P01') throw new BookingError('OVERLAP');
          throw e;
        }
      });
    } catch (e) {
      if (e instanceof BookingError) {
        if (e.reason === 'NOT_FOUND') {
          return reply.code(404).send({ error: 'not_found', message: '예약을 찾을 수 없습니다' });
        }
        if (e.reason === 'ALREADY') {
          return reply.code(409).send({ error: 'conflict', message: '이미 취소되었거나 종료된 예약입니다' });
        }
        if (e.reason === 'STARTED') {
          return reply.code(403).send({ error: 'forbidden', message: '이미 시작된 예약은 수정할 수 없습니다' });
        }
        if (e.reason === 'OVERLAP') {
          return reply.code(409).send({ error: 'conflict', reason: 'OVERLAP', message: REASON_TEXT.OVERLAP });
        }
        return badReason(reply, e.reason as ReservationReason);
      }
      throw e;
    }

    return reply.send({ reservationId: req.params.id });
  });

  /* ── 취소 — 소프트. 사유를 남긴다 ────────────────────────────────────────
     ★ 자기 회사 예약만이다 — RLS 가 남의 회사 것을 아예 안 보여 주므로 404 가 된다. */
  app.post<{ Params: { id: string }; Body: { cancelReason?: string | null } }>(
    '/reservations/:id/cancel',
    async (req, reply) => {
      const session = requireSession(req);
      const reason =
        typeof req.body?.cancelReason === 'string' && req.body.cancelReason.trim() !== ''
          ? req.body.cancelReason.trim()
          : null;

      const outcome = await withCompanyScope(scopeOf(session), async (client) => {
        const found = await findReservation(client, req.params.id);
        if (!found) return 'not_found' as const;
        const ok = await setReservationStatus(client, {
          reservationId: req.params.id,
          status: 'cancelled',
          cancelReason: reason,
          actor: String(session.s020MemberId),
        });
        return ok ? ('ok' as const) : ('already' as const);
      });

      if (outcome === 'not_found') {
        return reply.code(404).send({ error: 'not_found', message: '예약을 찾을 수 없습니다' });
      }
      if (outcome === 'already') {
        return reply.code(409).send({ error: 'conflict', message: '이미 취소되었거나 종료된 예약입니다' });
      }
      return reply.send({ reservationId: req.params.id, status: 'cancelled' });
    },
  );

  /* ── 종료 — 운영자만. ★ 자동 배치는 없다 ────────────────────────────────
     시간이 지난 예약을 시스템이 닫아 버리면, 아직 이야기 중인 건이 끝난 것으로 보인다
     (기간 만료 계약과 같은 규칙 — `doc/DESIGN_HANDOFF_DIFF.md` §L-4). */
  app.post<{ Params: { id: string } }>('/reservations/:id/complete', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== OPERATOR) {
      return reply.code(403).send({ error: 'forbidden', message: '종료 처리는 운영사만 할 수 있습니다' });
    }

    const outcome = await withCompanyScope(scopeOf(session), async (client) => {
      const found = await findReservation(client, req.params.id);
      if (!found) return 'not_found' as const;
      const ok = await setReservationStatus(client, {
        reservationId: req.params.id,
        status: 'completed',
        cancelReason: null,
        actor: String(session.s020MemberId),
      });
      return ok ? ('ok' as const) : ('already' as const);
    });

    if (outcome === 'not_found') {
      return reply.code(404).send({ error: 'not_found', message: '예약을 찾을 수 없습니다' });
    }
    if (outcome === 'already') {
      return reply.code(409).send({ error: 'conflict', message: '이미 취소되었거나 종료된 예약입니다' });
    }
    return reply.send({ reservationId: req.params.id, status: 'completed' });
  });
}
