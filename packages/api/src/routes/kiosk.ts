/**
 * 회의실 현황판 라우트 — s030500060.
 *
 * 명세: design/handoff/room-booking/06-kiosk.md · 시안 prototypes/s0300500060.html
 *
 * =============================================================================
 * ★★★ 로그인이 없는 라우트다 — 그래서 **응답이 계약이다**
 * =============================================================================
 * 벽에 걸린 화면은 복도를 지나는 누구나 본다. 그래서 이 라우트는 회사명·제목·예약자를
 * **고를 수 있는 위치에 두지 않는다.** 예약은 `erp_busy_slots`(026)로만 읽는다 —
 * 그 함수의 **반환 타입 자체가 시각 넷**이라, 실수로 이름을 흘릴 컬럼이 아예 없다.
 * 라우트가 거르는 것이 아니라 **가져올 수 없는 구조**라는 점이 중요하다.
 *
 * =============================================================================
 * ★★ 스코프는 **빈 것**으로 연다
 * =============================================================================
 * 세션이 없으니 회사도 없다. `{ role: 'tenant', companyId: null }` 은 RLS 가 0건으로
 * 판정하는 스코프다(ORG_ARCHITECTURE §1-2). 운영자 스코프로 열면 이 라우트에서 실수로
 * 표를 직접 읽었을 때 전부 보인다 — 빈 스코프면 그 실수가 0건으로 끝난다(fail-closed).
 * `erp_busy_slots` 는 SECURITY DEFINER 라 스코프와 무관하게 시각만 돌려준다.
 *
 * =============================================================================
 * ★★ 기기 토큰이 지금 **없는** 이유
 * =============================================================================
 * 시안 §7 은 `/kiosk/{roomId}?token={deviceToken}` 을 제안하고, 토큰 발급·폐기 화면은
 * **회의실 설정(4차)** 항목이다. 발급 화면 없이 토큰만 먼저 넣으면 발급 수단이 SQL 뿐이고,
 * 그렇게 만든 토큰은 누구도 폐기하지 않는다 — 잠금 장치처럼 보이지만 잠그지 못한다.
 * 그래서 **토큰 자리를 미리 만들지 않았다.** 4차에 설정 화면과 함께 붙인다
 * (2026-09-27 결정). 그때까지 이 주소를 아는 사람은 이 회의실의 오늘 **시각표**를 본다 —
 * 이름도 제목도 없는, 문 앞에 서면 보이는 것과 같은 정보다.
 */
import type { FastifyInstance } from 'fastify';
import { parseDay } from '@swonbiz/shared/domain/day';
import { withCompanyScope } from '../db/withCompanyScope.ts';
import { findRoom, listBusySlots } from '../db/reservations.ts';

/** 세션이 없는 요청이 쓰는 스코프 — RLS 가 0건으로 보는 자리(머리말). */
const NO_SCOPE = { role: 'tenant' as const, companyId: null };

/** `YYYY-MM-DD` · `HH:MM` — 서버의 벽시계. 화면이 진입 시 이 값으로 시계를 맞춘다(§7). */
function wallClock(at: Date): { day: string; time: string } {
  const p = (n: number) => String(n).padStart(2, '0');
  return {
    day: `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}`,
    time: `${p(at.getHours())}:${p(at.getMinutes())}`,
  };
}

export function registerKioskRoutes(app: FastifyInstance): void {
  /* ── 현황판 한 판 ────────────────────────────────────────────────────────
     ★ 하루치다. 현황판은 오늘만 보여 준다 — 자정이 지나면 다음 폴링이 새 날짜를 받는다.
     ★ `day` 를 받긴 하지만 **기본은 서버의 오늘**이다. 태블릿 시계가 틀어져 있어도
       엉뚱한 날짜를 그리지 않게, 날짜의 정본은 서버다. */
  app.get<{ Querystring: { room?: string; day?: string } }>(
    '/kiosk/board',
    { config: { public: true } },
    async (req, reply) => {
      const facilityId = String(req.query.room ?? '').trim();
      if (!facilityId) {
        return reply.code(400).send({ error: 'invalid_request', message: '회의실이 지정되지 않았습니다' });
      }

      const server = wallClock(new Date());
      const day = req.query.day && parseDay(String(req.query.day)) ? String(req.query.day) : server.day;

      const seen = await withCompanyScope(NO_SCOPE, async (client) => {
        const room = await findRoom(client, facilityId);
        if (!room) return null;
        return { room, busy: await listBusySlots(client, { facilityId, from: day, to: day }) };
      });

      if (!seen) {
        // ★ 없는 회의실과 잘못된 주소를 구분하지 않는다 — 식별자를 훑어볼 단서가 된다.
        return reply.code(404).send({ error: 'not_found', message: '회의실을 찾을 수 없습니다' });
      }

      return reply.send({
        room: {
          facilityId: seen.room.facility_id,
          name: seen.room.name,
          /** ★ 운영시간이 타임라인의 행을 나눈다 — 상수가 아니라 회의실의 값이다. */
          openTime: seen.room.open_time ?? '00:00',
          closeTime: seen.room.close_time ?? '24:00',
        },
        day,
        /** 서버 벽시계 — 화면은 이 값으로 로컬 시계를 보정한다(06-kiosk §7). */
        serverTime: server.time,
        /**
         * ★★★ **시각 둘뿐이다.** `erp_busy_slots` 가 준 네 칸에서 회의실·날짜를 뺀 것 —
         *    한 회의실의 하루를 물었으니 그 둘은 이미 안다. 회사명·제목·예약자는
         *    애초에 오지 않는다(026).
         */
        busy: seen.busy.map((b) => ({ startTime: b.start_time, endTime: b.end_time })),
      });
    },
  );
}
