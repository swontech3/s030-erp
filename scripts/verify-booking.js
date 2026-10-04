/**
 * 회의실 예약 검증 — 025 제약 + 예약 라우트.
 *
 * =============================================================================
 * ★★ 규칙이 **어디서** 막히는지를 본다
 * =============================================================================
 * 겹침은 DB 배타 제약, 상태 어휘는 DB CHECK, 나머지(30분 단위·운영시간·최소·최대·지난
 * 시각·4주·하루 한도)는 shared 의 순수 함수다. 순수 함수는 단위시험이 이미 지키고
 * (`reservation-rules.test.ts` 30항목), 이 스크립트는 **DB 와 라우트**를 본다 —
 * 규칙이 화면에만 있고 서버에 없으면 API 를 직접 찔러서 뚫린다.
 *
 * ★ 검증용 데이터는 새로 만들어 쓰고 지운다. 예약은 `TAG` 를 제목에 넣어 표시한다.
 * ★ `verify-001-003` 의 V6·V7·V7b 가 배타 제약을 이미 본다 — 거기와 겹치지 않게,
 *   여기서는 **라우트를 통과했을 때** 무엇이 되는지를 본다.
 *
 * 사용: npx tsx scripts/verify-booking.js
 */
import fs from 'node:fs';
import Fastify from 'fastify';
import { Client } from 'pg';
import { itemCountGate } from './verify-count.js';
import { registerBookingRoutes } from '../packages/api/src/routes/booking.ts';
import { closePool } from '../packages/api/src/db/pool.ts';

const readEnv = (p) =>
  Object.fromEntries(
    fs
      .readFileSync(p, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
  );

const env = readEnv('.env');

/**
 * 기대 항목 수 — 모자라면 **실패**다(`verify-count.js` 머리말).
 * 항목을 늘리면 끝에서 이 수를 고치라고 알려 준다.
 */
const EXPECTED_ITEMS = 77;

let pass = 0;
let fail = 0;
const failures = [];

function check(label, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  ✔ ${label}`);
  } else {
    fail++;
    failures.push(label);
    console.log(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const TAG = `verify-booking-${Date.now()}`;

/**
 * 세션을 바꿔 끼운 Fastify — 서버를 띄우지 않고 라우트를 직접 부른다.
 * ★ 사용자가 띄운 개발 서버를 건드리지 않기 위해서다(`verify-billing` 과 같은 방식).
 */
function buildApp(session) {
  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (req) => {
    req.session = session;
  });
  app.setErrorHandler((err, _req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) return reply.code(500).send({ error: 'internal_error', message: err.message });
    return reply.code(status).send({ error: 'bad_request', message: err.message });
  });
  registerBookingRoutes(app);
  return app;
}

const json = (res) => {
  try {
    return JSON.parse(res.body);
  } catch {
    return { __raw: res.body };
  }
};

(async () => {
  const c = new Client({
    host: env.DB_HOST,
    port: +env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    connectionTimeoutMillis: 15000,
  });
  await c.connect();

  /** 트랜잭션 안에서 넣어 보고 **무조건 롤백**한다. 에러코드를 돌려준다. */
  const tryInTx = async (sqls) => {
    await c.query('BEGIN');
    try {
      for (const s of sqls) await c.query(s);
      await c.query('ROLLBACK');
      return { code: null };
    } catch (e) {
      await c.query('ROLLBACK');
      return { code: e.code, message: (e.message || '').slice(0, 90) };
    }
  };

  try {
    /* ═══ 1. 025 — 상태 어휘와 시간 순서를 DB 가 막는다 ═══════════════════ */
    console.log('\n1. 025 제약 — 상태 어휘 · 시간 순서');

    const bldg = (await c.query('SELECT build_id FROM public.tb_s080_buildings LIMIT 1')).rows[0];
    if (!bldg) {
      console.error('✘ 준비 부족 — 건물이 없다');
      process.exit(1);
    }

    /*
     * ★★★ 검증은 **자기 회의실을 만들어 쓴다.**
     *
     * 처음에는 개발계의 「소회의실 A」를 빌려 썼는데, 사람이 화면에서 잡아 둔 예약
     * (2026-09-27: 내일 17:00~18:30)과 시간이 겹쳐 「운영자는 한도가 없다」가 409 로
     * 죽었다. 규칙은 멀쩡한데 **검증이 남의 데이터에 기대고 있었다** — 그 예약을 지우면
     * 남의 일을 지우는 것이고, 시간을 옮기면 다음에 또 겹친다.
     * 그래서 방을 직접 만들어 쓰고 끝나면 지운다(`verify-001-003` 의 A7d 와 같은 방식).
     * 설정은 개발계 회의실과 같게 둔다 — 06:00~24:00 · 최소 30분 · 최대 120분 · 30분 1만원.
     */
    const fac = { facility_id: `${TAG}-A` };
    const makeRoom = (id, name) =>
      c.query(
        `INSERT INTO public.tb_s080_facilities
           (facility_id, building_id, name, facility_type, capacity, half_hour_fee,
            min_duration, max_duration, open_time, close_time, status, is_reservable, updated_at)
         VALUES ($1, $2, $3, 'MEETING', 4, 10000, 30, 120, '06:00', '24:00', 'active', true, now())`,
        [id, bldg.build_id, name],
      );
    await makeRoom(fac.facility_id, `${TAG} 검증 회의실`);

    const ins = (over) => {
      const v = {
        id: `${TAG}-a`, status: 'confirmed',
        s: '2099-01-02 10:00', e: '2099-01-02 11:00', ...over,
      };
      return `INSERT INTO public.tb_s080_reservations
        (reservation_id, build_id, facility_id, title, start_at, end_at, status, created_at, updated_at)
        VALUES ('${v.id}', '${bldg.build_id}', '${fac.facility_id}', '${TAG}',
                '${v.s}', '${v.e}', '${v.status}', now(), now())`;
    };

    const vocab = await c.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid='public.tb_s080_reservations'::regclass AND contype='c'`,
    );
    const defs = vocab.rows.map((r) => r.def).join(' | ');
    check(
      '★ 상태 CHECK 가 있다 — confirmed · cancelled · completed',
      /confirmed/.test(defs) && /cancelled/.test(defs) && /completed/.test(defs),
      defs || '상태 CHECK 가 없다',
    );

    const bogus = await tryInTx([ins({ status: '헛소리' })]);
    check(
      '★★★ 어휘 밖의 상태는 DB 가 막는다 (23514)',
      bogus.code === '23514',
      `기대 23514, 실제 ${bogus.code || '성공(막히지 않음)'}`,
    );

    /* ★ 어휘 CHECK 이 왜 중요한가 — 배타 제약은 **취소가 아닌 전부**에 걸리므로
     *   (034) `cancelld` 처럼 잘못 적힌 상태는 「취소가 아니」라서 오히려 자리를
     *   잡는다. 반대로 034 전에는 `confirmd` 가 **아무와도 안 다퉈** 같은 시간에
     *   몇 건이든 들어갔다. 어느 쪽이든 어휘가 새면 자리 판정이 어긋난다. */
    const three = ['confirmed', 'cancelled', 'completed'];
    const okAll = [];
    for (const st of three) {
      const r = await tryInTx([ins({ status: st })]);
      okAll.push(`${st}=${r.code ?? 'OK'}`);
    }
    check('어휘 안의 상태 셋은 들어간다', okAll.every((s) => s.endsWith('OK')), okAll.join(' '));

    const flipped = await tryInTx([ins({ status: 'cancelled', s: '2099-01-02 12:00', e: '2099-01-02 10:00' })]);
    check(
      '★★ 시작이 종료보다 뒤면 막는다 — 취소 상태여도',
      flipped.code === '23514',
      `기대 23514, 실제 ${flipped.code || '성공(막히지 않음)'}`,
    );

    /* ═══ 2. 겹침은 DB 가 정본 — **취소가 아닌 전부** ═════════════════════
     *
     * ★★ 범위가 034 에서 넓어졌다. 예전에는 확정끼리만 다퉜고, 그래서 **종료된
     *    예약 위에 겹쳐 넣을 수 있었다** — 화면(`erp_busy_slots`)은 그 자리를
     *    「차 있음」으로 보여 주는데 DB 가 안 막던 상태다(2026-10-04 실측).
     *    아래 넷은 그 선이 다시 좁아지지 않게 지킨다. **취소만 자리를 비운다.**
     */
    console.log('\n2. 겹침 — DB 배타 제약 (취소가 아닌 전부)');

    const scope = await c.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname = 'tb_s080_reservations_no_overlap'`,
    );
    check(
      "★★ 제약 범위가 status <> 'cancelled' 다 — 026 erp_busy_slots 와 같은 선",
      /status <> 'cancelled'/.test(scope.rows[0]?.def ?? ''),
      scope.rows[0]?.def,
    );

    const overlap = await tryInTx([
      ins({ id: `${TAG}-x`, s: '2099-01-03 10:00', e: '2099-01-03 11:00' }),
      ins({ id: `${TAG}-y`, s: '2099-01-03 10:30', e: '2099-01-03 11:30' }),
    ]);
    check('★ 겹치는 확정 예약은 막힌다 (23P01)', overlap.code === '23P01', `실제 ${overlap.code ?? '성공'}`);

    // ★ 종료도 자리를 잡는다 — 034 가 고친 바로 그 구멍이다.
    const overCompleted = await tryInTx([
      ins({ id: `${TAG}-c1`, status: 'completed', s: '2099-01-06 10:00', e: '2099-01-06 11:00' }),
      ins({ id: `${TAG}-c2`, s: '2099-01-06 10:30', e: '2099-01-06 11:30' }),
    ]);
    check(
      '★★ 종료된 예약 위에 확정을 못 넣는다 (23P01)',
      overCompleted.code === '23P01',
      `실제 ${overCompleted.code ?? '성공(막히지 않음)'}`,
    );

    const completedPair = await tryInTx([
      ins({ id: `${TAG}-c3`, status: 'completed', s: '2099-01-07 10:00', e: '2099-01-07 11:00' }),
      ins({ id: `${TAG}-c4`, status: 'completed', s: '2099-01-07 10:15', e: '2099-01-07 10:45' }),
    ]);
    check(
      '★ 종료끼리도 겹치지 못한다 (23P01) — 같은 방 같은 시간은 기록으로도 틀렸다',
      completedPair.code === '23P01',
      `실제 ${completedPair.code ?? '성공(막히지 않음)'}`,
    );

    /* ★★ 대조군 — **취소는 자리를 비운다.** 이것이 없으면 위 셋이 「다 막는다」로
     *    읽히고, 범위를 `true` 로 넓혀 취소된 자리까지 막아도 통과한다. */
    const overCancelled = await tryInTx([
      ins({ id: `${TAG}-c5`, status: 'cancelled', s: '2099-01-08 10:00', e: '2099-01-08 11:00' }),
      ins({ id: `${TAG}-c6`, s: '2099-01-08 10:30', e: '2099-01-08 11:30' }),
    ]);
    check(
      '★★ 대조군 — 취소된 자리에는 들어간다 (취소만 자리를 비운다)',
      overCancelled.code === null,
      `실제 ${overCancelled.code ?? '성공'} ${overCancelled.message ?? ''}`,
    );

    const adjacent = await tryInTx([
      ins({ id: `${TAG}-p`, s: '2099-01-04 10:00', e: '2099-01-04 11:00' }),
      ins({ id: `${TAG}-q`, s: '2099-01-04 11:00', e: '2099-01-04 12:00' }),
    ]);
    check('★ 붙는 예약은 통과한다 (10~11 · 11~12)', adjacent.code === null, `실제 ${adjacent.code}`);

    const cancelledOverlap = await tryInTx([
      ins({ id: `${TAG}-m`, s: '2099-01-05 10:00', e: '2099-01-05 11:00' }),
      ins({ id: `${TAG}-n`, status: 'cancelled', s: '2099-01-05 10:30', e: '2099-01-05 11:30' }),
    ]);
    check('취소된 예약은 자리를 잡지 않는다', cancelledOverlap.code === null, `실제 ${cancelledOverlap.code}`);

    /* ═══ 3. 계약 없이도 선다 — 자리만 남긴 것 ════════════════════════════ */
    console.log('\n3. 자리 — 계약 없는 예약');
    const noCompany = await tryInTx([ins({ id: `${TAG}-solo`, s: '2099-01-06 10:00', e: '2099-01-06 11:00' })]);
    check(
      '★ 입주사 없이도 예약이 선다 — 운영자가 외부 건을 대신 잡는 자리',
      noCompany.code === null,
      `실제 ${noCompany.code}`,
    );

    /* ═══════════════════════════════════════════════════════════════════════
       4. 라우트 — 규칙이 **서버에** 있는가
       ═══════════════════════════════════════════════════════════════════════
       화면에만 있는 규칙은 API 를 직접 찔러서 뚫린다. 여기서는 세션을 바꿔 끼우고
       라우트를 직접 부른다(`fastify.inject`) — 서버를 띄우지 않는다. */
    console.log('\n4. 라우트 — 입주사 예약');

    const company = (await c.query(
      `SELECT company_id, company_name FROM public.tb_s080_companies ORDER BY company_id LIMIT 2`,
    )).rows;
    if (company.length < 2) {
      console.error('✘ 준비 부족 — 입주사 2곳이 필요하다');
      process.exit(1);
    }
    const [COMPANY_A, COMPANY_B] = company;

    /** 그 날 자정 기준 로컬 날짜 — 규칙이 「오늘」을 보므로 실제 오늘에서 만든다. */
    const dayAfter = (n) => {
      const d = new Date();
      d.setDate(d.getDate() + n);
      const pad = (x) => String(x).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };
    const TOMORROW = dayAfter(1);

    const tenantApp = buildApp({
      s020MemberId: 2001, s020OrgId: 9001, memberName: '검증 입주사',
      companyId: COMPANY_A.company_id, role: 'tenant', screens: [],
    });
    const otherApp = buildApp({
      s020MemberId: 2002, s020OrgId: 9002, memberName: '검증 남의회사',
      companyId: COMPANY_B.company_id, role: 'tenant', screens: [],
    });
    const opApp = buildApp({
      s020MemberId: 1002, s020OrgId: 1, memberName: '검증 운영자',
      companyId: null, role: 'operator', screens: [],
    });

    const book = (app, over = {}) =>
      app.inject({
        method: 'POST',
        url: '/reservations',
        payload: {
          facilityId: fac.facility_id,
          day: TOMORROW,
          startTime: '14:00',
          endTime: '15:00',
          title: TAG,
          ...over,
        },
      });
    const reasonOf = (res) => json(res).reason;
    const made = [];
    const keep = (res) => {
      const id = json(res).reservationId;
      if (id) made.push(id);
      return id;
    };

    /* ── 회의실 설정을 화면이 받는가 ─────────────────────────────────────── */
    const rooms = json(await opApp.inject({ method: 'GET', url: '/facilities' }));
    const room = (rooms.facilities ?? []).find((r) => r.facilityId === fac.facility_id);
    check(
      '★ 회의실 설정을 받는다 — 운영시간·최소·최대·30분 요금이 **데이터**다',
      !!room && typeof room.openTime === 'string' && typeof room.minDuration === 'number' &&
        typeof room.maxDuration === 'number' && 'halfHourFee' in room,
      JSON.stringify(room),
    );

    /* ── 모양 규칙 ───────────────────────────────────────────────────────── */
    const notAligned = await book(tenantApp, { startTime: '14:05' });
    check('★ 30분 정렬이 아니면 400 NOT_ALIGNED', notAligned.statusCode === 400 && reasonOf(notAligned) === 'NOT_ALIGNED',
      `${notAligned.statusCode} ${notAligned.body}`);

    const tooLong = await book(tenantApp, { endTime: '17:00' });
    check('★ 최대 이용 시간을 넘으면 400 TOO_LONG', tooLong.statusCode === 400 && reasonOf(tooLong) === 'TOO_LONG',
      `${tooLong.statusCode} ${tooLong.body}`);

    const outOfHours = await book(tenantApp, { startTime: '05:00', endTime: '05:30' });
    check('★ 운영시간 밖이면 400 OUT_OF_HOURS',
      outOfHours.statusCode === 400 && reasonOf(outOfHours) === 'OUT_OF_HOURS',
      `${outOfHours.statusCode} ${outOfHours.body}`);

    /* ── 기간 규칙 — 운영자는 예외 ───────────────────────────────────────── */
    const past = await book(tenantApp, { day: dayAfter(-1) });
    check('★ 지난 시각은 400 PAST', past.statusCode === 400 && reasonOf(past) === 'PAST',
      `${past.statusCode} ${past.body}`);

    const pastByOp = await book(opApp, { day: dayAfter(-1), startTime: '09:00', endTime: '09:30' });
    check('★★ 운영자는 지난 시각도 넣는다 (201)', pastByOp.statusCode === 201, `${pastByOp.statusCode} ${pastByOp.body}`);
    keep(pastByOp);

    const tooFar = await book(tenantApp, { day: dayAfter(29) });
    check('★ 4주를 넘기면 400 TOO_FAR', tooFar.statusCode === 400 && reasonOf(tooFar) === 'TOO_FAR',
      `${tooFar.statusCode} ${tooFar.body}`);

    const farByOp = await book(opApp, { day: dayAfter(60), startTime: '09:00', endTime: '09:30' });
    check('★★ 운영자는 기간 제한이 없다 (201)', farByOp.statusCode === 201, `${farByOp.statusCode} ${farByOp.body}`);
    keep(farByOp);

    /* ── 만들기 · 입주사 기록 · 겹침 ─────────────────────────────────────── */
    const first = await book(tenantApp);
    check('입주사 예약이 만들어진다 (201)', first.statusCode === 201, `${first.statusCode} ${first.body}`);
    const firstId = keep(first);

    const stored = (await c.query(
      `SELECT company_id, status, usage_fee, to_char(start_at,'YYYY-MM-DD HH24:MI') s
         FROM public.tb_s080_reservations WHERE reservation_id = $1`, [firstId],
    )).rows[0];
    check(
      '★★★ 예약에 입주사가 기록된다 — 안 채우면 그 회사 직원이 자기 예약을 못 본다',
      stored?.company_id === COMPANY_A.company_id,
      JSON.stringify(stored),
    );
    check('상태는 확정이고 요금이 남는다 — 청구와는 잇지 않았다',
      stored?.status === 'confirmed' && stored?.usage_fee === (room?.halfHourFee ?? 0) * 2,
      JSON.stringify(stored));

    const overlapRoute = await book(otherApp, { startTime: '14:30', endTime: '15:30' });
    check('★★ 겹치면 409 OVERLAP — DB 배타 제약이 판정한다',
      overlapRoute.statusCode === 409 && reasonOf(overlapRoute) === 'OVERLAP',
      `${overlapRoute.statusCode} ${overlapRoute.body}`);

    const adj = await book(otherApp, { startTime: '15:00', endTime: '15:30' });
    check('★ 붙는 예약은 통과한다 (201)', adj.statusCode === 201, `${adj.statusCode} ${adj.body}`);
    keep(adj);

    /* ── 하루 한도 — 입주사 기준 2시간 ───────────────────────────────────── */
    console.log('\n5. 하루 한도 — 입주사 기준 2시간');
    const second = await book(tenantApp, { startTime: '16:00', endTime: '17:00' });
    check('같은 입주사가 2시간까지는 잡는다 (201)', second.statusCode === 201, `${second.statusCode} ${second.body}`);
    const secondId = keep(second);

    const third = await book(tenantApp, { startTime: '18:00', endTime: '18:30' });
    check('★★ 2시간을 넘기면 400 DAILY_LIMIT', third.statusCode === 400 && reasonOf(third) === 'DAILY_LIMIT',
      `${third.statusCode} ${third.body}`);

    const thirdByOp = await book(opApp, { startTime: '18:00', endTime: '18:30' });
    check('★★ 운영자는 한도가 없다 (201)', thirdByOp.statusCode === 201, `${thirdByOp.statusCode} ${thirdByOp.body}`);
    keep(thirdByOp);

    /* ── 취소 — 소프트 · 사유 · 한도에서 빠진다 ──────────────────────────── */
    console.log('\n6. 취소 · 종료');
    const cancel = await tenantApp.inject({
      method: 'POST', url: `/reservations/${secondId}/cancel`, payload: { cancelReason: '검증 취소' },
    });
    check('예약을 취소한다 (200)', cancel.statusCode === 200, `${cancel.statusCode} ${cancel.body}`);

    const afterCancel = (await c.query(
      `SELECT status, cancel_reason, cancelled_at FROM public.tb_s080_reservations WHERE reservation_id = $1`,
      [secondId],
    )).rows[0];
    check('★ 소프트 취소다 — 행은 남고 사유·취소일시가 붙는다',
      afterCancel?.status === 'cancelled' && afterCancel?.cancel_reason === '검증 취소' &&
        afterCancel?.cancelled_at !== null,
      JSON.stringify(afterCancel));

    /*
     * ★ **빈 칸으로 잡는다.** 18:00 은 위의 「운영자는 한도가 없다」가 이미 썼다 — 거기로
     *   잡으면 겹침(409)이 먼저 걸려서 한도 얘기를 못 한다. 시험이 재려는 것만 재게 둔다.
     * ★ 이 입주사의 그 날: 14~15 확정(60분) + 16~17 **취소**(세지 않는다) → 60분.
     *   취소분을 세면 120분이 되어 +30 이 한도를 넘고 400 이 된다 — 그래서 이 시험이 갈린다.
     */
    const afterCancelBook = await book(tenantApp, { startTime: '20:00', endTime: '20:30' });
    check('★★★ 취소분은 한도에서 빠진다 — 취소가 벌이 되면 안 된다',
      afterCancelBook.statusCode === 201, `${afterCancelBook.statusCode} ${afterCancelBook.body}`);
    keep(afterCancelBook);

    const otherCancel = await otherApp.inject({
      method: 'POST', url: `/reservations/${firstId}/cancel`, payload: {},
    });
    check('★ 남의 회사 예약은 취소하지 못한다 (404)', otherCancel.statusCode === 404,
      `${otherCancel.statusCode} ${otherCancel.body}`);

    /* ── 종료 — 자동 없음 · 운영자가 닫는다 ──────────────────────────────── */
    const tenantComplete = await tenantApp.inject({ method: 'POST', url: `/reservations/${firstId}/complete`, payload: {} });
    check('★ 종료 처리는 입주사가 못 한다 (403)', tenantComplete.statusCode === 403,
      `${tenantComplete.statusCode} ${tenantComplete.body}`);

    const complete = await opApp.inject({ method: 'POST', url: `/reservations/${firstId}/complete`, payload: {} });
    check('★ 운영자가 종료 처리한다 (200) — 자동 배치는 없다', complete.statusCode === 200,
      `${complete.statusCode} ${complete.body}`);
    const done = (await c.query(
      `SELECT status FROM public.tb_s080_reservations WHERE reservation_id = $1`, [firstId],
    )).rows[0];
    check('종료 상태가 저장된다', done?.status === 'completed', JSON.stringify(done));

    /* ── 보이는 범위 — RLS ───────────────────────────────────────────────── */
    console.log('\n7. 보이는 범위');
    const mine = json(await tenantApp.inject({
      method: 'GET', url: `/reservations?facilityId=${fac.facility_id}&from=${TOMORROW}&to=${TOMORROW}`,
    }));
    const mineIds = (mine.reservations ?? []).map((r) => r.reservationId);
    check('★ 입주사는 자기 회사 예약을 본다', mineIds.includes(firstId), JSON.stringify(mineIds));

    const theirs = json(await otherApp.inject({
      method: 'GET', url: `/reservations?facilityId=${fac.facility_id}&from=${TOMORROW}&to=${TOMORROW}`,
    }));
    const theirIds = (theirs.reservations ?? []).map((r) => r.reservationId);
    check('★★ 남의 회사 예약은 보이지 않는다', !theirIds.includes(firstId), JSON.stringify(theirIds));

    const opSees = json(await opApp.inject({
      method: 'GET', url: `/reservations?facilityId=${fac.facility_id}&from=${TOMORROW}&to=${TOMORROW}`,
    }));
    const opIds = (opSees.reservations ?? []).map((r) => r.reservationId);
    check('★ 운영자는 전부 본다', opIds.includes(firstId) && opIds.length >= mineIds.length,
      `${opIds.length}건`);

    const outsider = await book(opApp, { startTime: '19:00', endTime: '19:30', companyId: null });
    check('운영자 대행 건이 만들어진다 (201)', outsider.statusCode === 201, `${outsider.statusCode} ${outsider.body}`);
    const outsiderId = keep(outsider);
    const outsiderRow = (await c.query(
      `SELECT company_id FROM public.tb_s080_reservations WHERE reservation_id = $1`, [outsiderId],
    )).rows[0];
    check('★★ 운영자 대행 건은 입주사가 비어 있다 — 운영사에게만 보인다',
      outsiderRow?.company_id === null, JSON.stringify(outsiderRow));


    /* ═══════════════════════════════════════════════════════════════════════
       8. 남의 예약은 **시간만** — 026 의 busy 조회
       ═══════════════════════════════════════════════════════════════════════
       RLS 는 입주사에게 남의 예약을 **아예** 안 보여 준다. 그러면 잡혀 있는 칸이 화면에
       빈 칸으로 보이고, 눌러야 409 가 온다. 그래서 026 이 **시각만 돌려주는** 조회를
       따로 둔다(SECURITY DEFINER — RLS 를 지나간다).

       ★★★ 그 조회가 무엇을 돌려주는지가 이 절의 핵심이다. 회사명·제목·예약자가
          한 조각이라도 섞이면 RLS 를 열어 준 것과 같다 — **응답 본문을 문자열로
          훑어서** 확인한다(칼럼 이름만 보면 JOIN 이 붙는 날 놓친다). */
    console.log('\n8. 남의 예약은 시간만 — busy');

    const SECRET = `${TAG}-비밀`;
    /** ★ 운영자가 A 회사 몫으로 잡아 준다 — A 의 하루 한도를 건드리지 않으려고(운영자는 예외). */
    const secret = await book(opApp, {
      startTime: '21:00', endTime: '21:30', companyId: COMPANY_A.company_id, title: SECRET,
    });
    check('남의 회사 예약을 하나 만든다 (201)', secret.statusCode === 201, `${secret.statusCode} ${secret.body}`);
    const secretId = keep(secret);

    const fn = (await c.query(
      `SELECT pg_get_function_result(oid) AS result, prosecdef FROM pg_proc WHERE proname = 'erp_busy_slots'`,
    )).rows[0];
    check(
      '★★★ DB 함수가 **시각만** 돌려준다 — 회사·제목·예약자 칼럼이 아예 없다',
      !!fn && fn.prosecdef === true &&
        /facility_id/.test(fn.result) && /start_time/.test(fn.result) && /end_time/.test(fn.result) &&
        !/company|title|member|purpose|attendee|reservation_id/i.test(fn.result),
      JSON.stringify(fn) || '함수가 없다',
    );

    const grant = (await c.query(
      `SELECT has_function_privilege('erp_app', p.oid, 'EXECUTE') AS ok
         FROM pg_proc p WHERE p.proname = 'erp_busy_slots'`,
    )).rows[0];
    check('erp_app 이 그 함수를 부를 수 있다', grant?.ok === true, JSON.stringify(grant) || '함수가 없다');

    const bView = json(await otherApp.inject({
      method: 'GET', url: `/reservations?facilityId=${fac.facility_id}&from=${TOMORROW}&to=${TOMORROW}`,
    }));
    const bBusy = bView.busy ?? [];
    const at21 = bBusy.find((s) => s.day === TOMORROW && s.startTime === '21:00');
    check(
      '★★ 남의 예약 자리가 busy 로 온다 — 화면이 「예약됨」으로 잠근다',
      !!at21 && at21.endTime === '21:30' && at21.facilityId === fac.facility_id,
      JSON.stringify(bBusy),
    );
    check(
      '★ busy 한 칸에는 시각 말고 아무 칸도 없다 (facilityId · day · startTime · endTime)',
      bBusy.length > 0 &&
        bBusy.every((s) => Object.keys(s).sort().join(',') === 'day,endTime,facilityId,startTime'),
      JSON.stringify(bBusy[0]),
    );

    /* ★★★ 응답 본문 전체를 훑는다 — 이름이 어디로든 새면 여기서 걸린다. */
    const rawBody = JSON.stringify(bView);
    const leaks = [SECRET, COMPANY_A.company_name, COMPANY_A.company_id, secretId].filter(
      (needle) => needle && rawBody.includes(String(needle)),
    );
    check('★★★ 응답에 남의 회사명·제목·식별자가 하나도 없다', leaks.length === 0, `샌 값 — ${leaks.join(' · ')}`);

    const at16 = bBusy.find((s) => s.startTime === '16:00');
    check('★ 취소된 예약은 busy 에 없다 — 빈 칸이어야 한다', !at16, JSON.stringify(at16));

    const ownRow = (bView.reservations ?? []).find((r) => r.companyId === COMPANY_B.company_id);
    check(
      '★ 자기 회사 예약은 이름이 보인다 — 제목·입주사명이 그대로 온다',
      !!ownRow && ownRow.title === TAG && ownRow.companyName === COMPANY_B.company_name,
      JSON.stringify(ownRow),
    );

    const opView = json(await opApp.inject({
      method: 'GET', url: `/reservations?facilityId=${fac.facility_id}&from=${TOMORROW}&to=${TOMORROW}`,
    }));
    check(
      '★ 운영자에게는 busy 를 주지 않는다 — 전부 상세로 본다',
      Array.isArray(opView.busy) && opView.busy.length === 0 &&
        (opView.reservations ?? []).some((r) => r.reservationId === secretId),
      `busy ${JSON.stringify(opView.busy)}`,
    );

    /* ═══════════════════════════════════════════════════════════════════════
       9. 하루 사용량은 **전 회의실 합산** — 서버가 내려준다
       ═══════════════════════════════════════════════════════════════════════
       ★★★ 화면이 보고 있는 회의실의 목록만 더하면 **다른 회의실에서 쓴 시간이 빠진다.**
          B 에서 2시간 쓴 입주사가 A 화면에서 「예약 가능」으로 보이고, 눌러야 400 이 온다.
          서버 판정(전 회의실 합산)이 정본이므로, 서버가 그 값을 같이 내려보내고 화면은
          그것만 본다(시안 `room-booking/07-data-model.md` 의 `usedMinutesByDate`).
       ★ 여기서는 **회의실 두 개**를 쓴다 — 두 번째 방을 만들어 쓰고 끝나면 지운다. */
    console.log('\n9. 하루 사용량 · 예약 조직 · 4주 경계');

    const ROOM2 = `${TAG}-room`;
    await makeRoom(ROOM2, `${TAG} 두번째 회의실`);

    const DAY3 = dayAfter(3);
    const bookOn = (app, over = {}) =>
      app.inject({
        method: 'POST',
        url: '/reservations',
        payload: {
          facilityId: fac.facility_id, day: DAY3, startTime: '10:00', endTime: '11:00', title: TAG, ...over,
        },
      });

    const inA = await bookOn(otherApp);
    check('회의실 A 에 1시간 (201)', inA.statusCode === 201, `${inA.statusCode} ${inA.body}`);
    keep(inA);

    const inB = await bookOn(otherApp, { facilityId: ROOM2 });
    check('★ 다른 회의실에 1시간 — 겹치지 않는다 (201)', inB.statusCode === 201, `${inB.statusCode} ${inB.body}`);
    const inBId = keep(inB);

    const seen = json(await otherApp.inject({
      method: 'GET', url: `/reservations?facilityId=${fac.facility_id}&from=${DAY3}&to=${DAY3}`,
    }));
    check(
      '★★★ A 회의실 응답인데 사용량은 **두 방 합산** 120분이다',
      seen.usedMinutesByDate?.[DAY3] === 120,
      JSON.stringify(seen.usedMinutesByDate),
    );

    const over = await bookOn(otherApp, { startTime: '12:00', endTime: '12:30' });
    check(
      '★ 그 값이 곧 서버 판정이다 — 30분 더 잡으면 400 DAILY_LIMIT',
      over.statusCode === 400 && reasonOf(over) === 'DAILY_LIMIT',
      `${over.statusCode} ${over.body}`,
    );

    await otherApp.inject({ method: 'POST', url: `/reservations/${inBId}/cancel`, payload: {} });
    const afterCancelSeen = json(await otherApp.inject({
      method: 'GET', url: `/reservations?facilityId=${fac.facility_id}&from=${DAY3}&to=${DAY3}`,
    }));
    check(
      '★ 취소하면 사용량에서 빠진다 — 60분',
      afterCancelSeen.usedMinutesByDate?.[DAY3] === 60,
      JSON.stringify(afterCancelSeen.usedMinutesByDate),
    );

    const opSeen = json(await opApp.inject({
      method: 'GET', url: `/reservations?facilityId=${fac.facility_id}&from=${DAY3}&to=${DAY3}`,
    }));
    check(
      '운영자에게는 사용량이 비어 있다 — 한도가 없다',
      opSeen.usedMinutesByDate && Object.keys(opSeen.usedMinutesByDate).length === 0,
      JSON.stringify(opSeen.usedMinutesByDate),
    );

    /* ── 예약 조직 선택지 — 대행 예약을 화면에서 하려면 목록이 필요하다 ──── */
    const opFacilities = json(await opApp.inject({ method: 'GET', url: '/facilities' }));
    const opCompanies = opFacilities.companies ?? [];
    check(
      '★ 운영자는 예약 조직 목록을 받는다 (companyId · companyName)',
      opCompanies.length >= 2 && opCompanies.every((x) => typeof x.companyId === 'string' && typeof x.companyName === 'string'),
      JSON.stringify(opCompanies.slice(0, 2)),
    );

    const tnFacilities = json(await tenantApp.inject({ method: 'GET', url: '/facilities' }));
    check(
      '★★★ 입주사에게는 조직 목록을 주지 않는다 — 명부다',
      Array.isArray(tnFacilities.companies) && tnFacilities.companies.length === 0,
      JSON.stringify(tnFacilities.companies),
    );

    /* ── 대행 예약 — 고른 입주사로 기록된다 ─────────────────────────────── */
    const proxy = await bookOn(opApp, { startTime: '14:00', endTime: '14:30', companyId: COMPANY_A.company_id });
    check('운영자 대행 예약이 만들어진다 (201)', proxy.statusCode === 201, `${proxy.statusCode} ${proxy.body}`);
    const proxyId = keep(proxy);
    const proxyRow = (await c.query(
      `SELECT company_id FROM public.tb_s080_reservations WHERE reservation_id = $1`, [proxyId],
    )).rows[0];
    check(
      '★★ 대행 예약은 **고른 입주사**로 기록된다 — 외부가 아니다',
      proxyRow?.company_id === COMPANY_A.company_id,
      JSON.stringify(proxyRow),
    );

    /* ── 4주 경계 — 오늘 포함 28일 (마지막 날 = 오늘+27) ─────────────────── */
    const last = await book(tenantApp, { day: dayAfter(27), startTime: '09:00', endTime: '09:30' });
    check('★ 오늘+27 (마지막 날)은 통과한다 (201)', last.statusCode === 201, `${last.statusCode} ${last.body}`);
    keep(last);

    const past28 = await book(tenantApp, { day: dayAfter(28), startTime: '09:00', endTime: '09:30' });
    check(
      '★★ 오늘+28 은 400 TOO_FAR — 4주는 오늘 포함 28일이다',
      past28.statusCode === 400 && reasonOf(past28) === 'TOO_FAR',
      `${past28.statusCode} ${past28.body}`,
    );

    /* ═══════════════════════════════════════════════════════════════════════
       10. 예약 수정 — PATCH (시안 `03-booking-form.md` §4 · `04-rules.md` §4)
       ═══════════════════════════════════════════════════════════════════════
       ★★ 수정은 **등록과 같은 검사**를 다시 한다. 단 충돌과 하루 한도 계산에서
          **수정 중인 예약 자신은 뺀다** — 1시간을 1시간 30분으로 늘릴 때 「이미 1시간
          썼다」로 막히면 안 된다.
       ★ 입주사는 **시작 전**까지만, 운영자는 진행 중인 것도 고친다.
       ★ 예약 조직은 바꾸지 못한다(조직을 바꾸는 건 사실상 다른 예약이다). */
    console.log('\n10. 예약 수정 — PATCH');

    const DAY4 = dayAfter(4);
    const editBase = await tenantApp.inject({
      method: 'POST',
      url: '/reservations',
      payload: {
        facilityId: fac.facility_id, day: DAY4, startTime: '10:00', endTime: '11:00', title: `${TAG} 고칠 예약`,
      },
    });
    check('수정할 예약을 만든다 (201)', editBase.statusCode === 201, `${editBase.statusCode} ${editBase.body}`);
    const editId = keep(editBase);

    const patch = (app, body, id = editId) =>
      app.inject({ method: 'PATCH', url: `/reservations/${id}`, payload: body });

    const grow = await patch(tenantApp, { endTime: '11:30' });
    check(
      '★★★ 1시간을 1시간 30분으로 늘린다 — 자기 자신은 한도에서 뺀다 (200)',
      grow.statusCode === 200,
      `${grow.statusCode} ${grow.body}`,
    );
    const grown = (await c.query(
      `SELECT to_char(start_at,'HH24:MI') s, to_char(end_at,'HH24:MI') e, title, usage_fee
         FROM public.tb_s080_reservations WHERE reservation_id = $1`, [editId],
    )).rows[0];
    check('시간이 저장되고 요금이 다시 계산된다', grown?.e === '11:30' && grown?.usage_fee === 30000,
      JSON.stringify(grown));

    const move = await patch(tenantApp, { startTime: '14:00', endTime: '15:00', title: `${TAG} 고친 제목` });
    check('시각과 제목을 바꾼다 (200)', move.statusCode === 200, `${move.statusCode} ${move.body}`);
    const moved = (await c.query(
      `SELECT to_char(start_at,'HH24:MI') s, title FROM public.tb_s080_reservations WHERE reservation_id = $1`,
      [editId],
    )).rows[0];
    check('★ 바꾼 값이 저장된다', moved?.s === '14:00' && moved?.title === `${TAG} 고친 제목`, JSON.stringify(moved));

    /* ── 규칙은 등록과 같다 ─────────────────────────────────────────────── */
    const badAlign = await patch(tenantApp, { startTime: '14:10', endTime: '15:00' });
    check('★ 30분 정렬이 아니면 400 NOT_ALIGNED', badAlign.statusCode === 400 && reasonOf(badAlign) === 'NOT_ALIGNED',
      `${badAlign.statusCode} ${badAlign.body}`);

    const tooFarEdit = await patch(tenantApp, { day: dayAfter(28) });
    check('★ 4주를 넘겨 옮기면 400 TOO_FAR', tooFarEdit.statusCode === 400 && reasonOf(tooFarEdit) === 'TOO_FAR',
      `${tooFarEdit.statusCode} ${tooFarEdit.body}`);

    /* ── 겹침은 DB 가 판정한다 ──────────────────────────────────────────── */
    const neighbour = await tenantApp.inject({
      method: 'POST',
      url: '/reservations',
      payload: { facilityId: fac.facility_id, day: DAY4, startTime: '16:00', endTime: '16:30', title: TAG },
    });
    keep(neighbour);
    const clash = await patch(tenantApp, { startTime: '16:00', endTime: '16:30' });
    check('★★ 남의 자리로 옮기면 409 OVERLAP — DB 배타 제약이 판정한다',
      clash.statusCode === 409 && reasonOf(clash) === 'OVERLAP', `${clash.statusCode} ${clash.body}`);

    /* ── 권한 ───────────────────────────────────────────────────────────── */
    const otherEdit = await patch(otherApp, { title: '남의 것' });
    check('★ 남의 회사 예약은 고치지 못한다 (404)', otherEdit.statusCode === 404,
      `${otherEdit.statusCode} ${otherEdit.body}`);

    const orgChange = await patch(opApp, { companyId: COMPANY_B.company_id });
    check('★ 예약 조직은 바꾸지 못한다 (400)', orgChange.statusCode === 400, `${orgChange.statusCode} ${orgChange.body}`);

    /* ★ 입주사는 시작 전까지만 — 지난 예약은 운영자만 고친다 */
    const pastOne = await opApp.inject({
      method: 'POST',
      url: '/reservations',
      payload: {
        facilityId: fac.facility_id, day: dayAfter(-2), startTime: '10:00', endTime: '10:30',
        title: `${TAG} 지난 예약`, companyId: COMPANY_A.company_id,
      },
    });
    const pastId = keep(pastOne);
    const tenantPast = await patch(tenantApp, { title: `${TAG} 지난 예약 수정` }, pastId);
    check('★★ 입주사는 이미 시작된 예약을 고치지 못한다 (403)', tenantPast.statusCode === 403,
      `${tenantPast.statusCode} ${tenantPast.body}`);

    const opPast = await patch(opApp, { title: `${TAG} 운영자가 고침` }, pastId);
    check('★★ 운영자는 지난 예약도 고친다 (200)', opPast.statusCode === 200, `${opPast.statusCode} ${opPast.body}`);

    /* ★ 취소된 예약은 아무도 못 고친다 */
    await opApp.inject({ method: 'POST', url: `/reservations/${pastId}/cancel`, payload: {} });
    const editCancelled = await patch(opApp, { title: '되살리기' }, pastId);
    check('★ 취소된 예약은 고치지 못한다 (409)', editCancelled.statusCode === 409,
      `${editCancelled.statusCode} ${editCancelled.body}`);

    /* ── 예약자 이름 — 027 ──────────────────────────────────────────────── */
    const bookerRow = (await c.query(
      `SELECT booker_name FROM public.tb_s080_reservations WHERE reservation_id = $1`, [editId],
    )).rows[0];
    check('★ 예약에 등록한 사람 이름이 남는다 (027) — 삐용 프로필에서 받는다', bookerRow?.booker_name === '홍길동',
      JSON.stringify(bookerRow));

    const detail = json(await tenantApp.inject({
      method: 'GET', url: `/reservations?facilityId=${fac.facility_id}&from=${DAY4}&to=${DAY4}`,
    }));
    const mineRow = (detail.reservations ?? []).find((r) => r.reservationId === editId);
    check(
      '★ 화면이 받는 값에 예약자·등록일시·인원·메모 자리가 있다',
      !!mineRow && mineRow.bookerName === '홍길동' && typeof mineRow.createdAt === 'string' &&
        'attendees' in mineRow && 'purpose' in mineRow,
      JSON.stringify(mineRow),
    );
    await tenantApp.close();
    await otherApp.close();
    await opApp.close();
  } finally {
    /* ── 정리 — 트랜잭션 롤백이라 남을 것이 없지만 확인한다 ──────────────── */
    console.log('\n정리');
    // ★ 라우트가 만든 예약은 실제로 저장된다(롤백이 아니다) — 제목 표식으로 골라 지운다.
    //   ★ 표식으로 **시작하는** 것까지 지운다 — 8절이 「TAG-비밀」 제목을 쓴다.
    const del = await c.query(`DELETE FROM public.tb_s080_reservations WHERE title LIKE $1`, [TAG + '%']);
    // ★ 9절이 만든 두 번째 회의실도 지운다 — 예약을 먼저 지워야 FK 가 풀린다.
    await c.query(`DELETE FROM public.tb_s080_facilities WHERE facility_id LIKE $1`, [TAG + '%']);
    const left = (await c.query(
      `SELECT count(*)::int n FROM public.tb_s080_reservations WHERE title LIKE $1`, [TAG + '%'],
    )).rows[0].n;
    check(`검증 데이터가 남지 않았다 (${del.rowCount}건 삭제)`, left === 0, `${left}행 남음`);
    await c.end();
    await closePool();
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`검사 ${pass + fail}항목 — 통과 ${pass} · 실패 ${fail}`);
  // ★ 항목이 사라졌는지 본다 — 통과·실패만 세면 **덜 돈 것**을 알 수 없다.
  const short = itemCountGate({ expected: EXPECTED_ITEMS, actual: pass + fail, script: 'verify-booking.js' });
  if (fail > 0) {
    console.log('실패 항목:');
    for (const f of failures) console.log(`  · ${f}`);
  }
  if (fail > 0 || short) process.exit(1);
  console.log('✔ 회의실 예약 검증 전부 통과');
})().catch((e) => {
  console.error('✘ 검증 중 오류:', e.message);
  process.exit(1);
});
