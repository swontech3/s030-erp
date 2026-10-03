/**
 * 회의실 현황판 검증 — s030500060.
 *
 * =============================================================================
 * ★★★ 이 스크립트가 지키는 것은 **하나다 — 벽에 이름이 뜨지 않는다**
 * =============================================================================
 * 로그인 없이 열리는 화면이다. 그래서 「응답에 무엇이 오는가」가 곧 보안 경계다.
 * 여기서는 라우트를 **세션 없이** 불러 보고, 돌아온 JSON 본문 전체를 훑어
 * 회사명·제목·예약자·예약 ID 가 **한 글자도 없는지** 본다. 눈으로 화면을 보는 것으로는
 * 알 수 없다 — 화면이 안 그릴 뿐 응답에는 있을 수 있기 때문이다.
 *
 * ★ 같이 보는 것: 공개 설정이 옆 라우트로 새지 않았는가(인증 라우트는 여전히 401).
 * ★ 검증용 데이터는 새로 만들어 쓰고 지운다. 사용자가 띄운 서버는 건드리지 않는다 —
 *   `verify-booking.js` 와 같은 방식으로 세션 훅째 Fastify 를 따로 세운다.
 *
 * 사용: npx tsx scripts/verify-kiosk.js
 */
import fs from 'node:fs';
import Fastify from 'fastify';
import { Client } from 'pg';
import { itemCountGate } from './verify-count.js';
import { registerSessionHook } from '../packages/api/src/session/hook.ts';
import { registerKioskRoutes } from '../packages/api/src/routes/kiosk.ts';
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

/** 기대 항목 수 — 모자라면 **실패**다(`verify-count.js` 머리말). */
const EXPECTED_ITEMS = 23;

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

const TAG = `verify-kiosk-${Date.now()}`;
/** 응답에 새면 바로 눈에 띄는 값 — 제목·회사명 자리에 심는다. */
const SECRET_TITLE = `${TAG}-비밀회의-일급`;

/**
 * 진짜 세션 훅을 단 Fastify.
 * ★★ 훅을 바꿔 끼우지 않는다 — **`config.public` 이 실제로 동작하는지**가 시험 대상이다.
 */
function buildApp() {
  const app = Fastify({ logger: false });
  app.setErrorHandler((err, _req, reply) => {
    const status = err.statusCode ?? 500;
    return reply.code(status).send({ error: 'error', message: err.message });
  });
  registerSessionHook(app);
  registerKioskRoutes(app);
  // ★ 인증이 필요한 라우트도 같이 등록한다 — 공개 설정이 옆으로 새면 여기서 잡힌다.
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

const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

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
  const app = buildApp();

  try {
    const bldg = (await c.query('SELECT build_id FROM public.tb_s080_buildings LIMIT 1')).rows[0];
    const company = (await c.query(
      `SELECT company_id, company_name FROM public.tb_s080_companies ORDER BY company_id LIMIT 1`,
    )).rows[0];
    if (!bldg || !company) {
      console.error('✘ 준비 부족 — 건물·입주사가 없다');
      process.exit(1);
    }

    /* ── 검증용 회의실 둘 — 하나는 현황판이 볼 방, 하나는 「섞이지 않는가」용 ── */
    const ROOM = `${TAG}-room`;
    const OTHER = `${TAG}-other`;
    const makeRoom = (id, name, open, close, reservable = true) =>
      c.query(
        `INSERT INTO public.tb_s080_facilities
           (facility_id, building_id, name, facility_type, capacity, half_hour_fee,
            min_duration, max_duration, open_time, close_time, status, is_reservable, updated_at)
         VALUES ($1, $2, $3, 'MEETING', 8, 0, 30, 120, $4, $5, 'active', $6, now())`,
        [id, bldg.build_id, name, open, close, reservable],
      );
    await makeRoom(ROOM, `${TAG} 현황판실`, '09:00', '22:00');
    await makeRoom(OTHER, `${TAG} 옆방`, '09:00', '22:00');

    const today = ymd(new Date());
    const book = (id, facility, s, e, status = 'confirmed', title = SECRET_TITLE) =>
      c.query(
        `INSERT INTO public.tb_s080_reservations
           (reservation_id, build_id, facility_id, company_id, title, start_at, end_at,
            attendees, purpose, booker_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 7, $8, $9, $10, now(), now())`,
        [id, bldg.build_id, facility, company.company_id, title,
         `${today} ${s}`, `${today} ${e}`, `${TAG}-메모`, `${TAG}-예약자`, status],
      );
    await book(`${TAG}-1`, ROOM, '11:00', '13:00');
    await book(`${TAG}-2`, ROOM, '16:00', '17:00');
    await book(`${TAG}-3`, ROOM, '20:00', '21:00', 'cancelled');
    await book(`${TAG}-4`, OTHER, '14:00', '15:00');

    console.log(`준비 — 회의실 ${ROOM} (09:00–22:00) · 오늘 ${today} · 입주사 ${company.company_name}`);

    /* ═══ 1. 로그인 없이 열린다 ══════════════════════════════════════════ */
    console.log('\n1. 인증 — 세션 없이 열리고, 옆 라우트는 그대로 잠겨 있다');

    const board = await app.inject({ method: 'GET', url: `/kiosk/board?room=${ROOM}` });
    check('★★★ 세션 없이 200 (config.public)', board.statusCode === 200, `${board.statusCode} ${board.body.slice(0, 120)}`);

    const locked = await app.inject({ method: 'GET', url: '/facilities' });
    check(
      '★★★ 공개 설정이 옆 라우트로 새지 않았다 — /facilities 는 401',
      locked.statusCode === 401,
      `기대 401, 실제 ${locked.statusCode}`,
    );

    const lockedList = await app.inject({ method: 'GET', url: `/reservations?from=${today}&to=${today}` });
    check('예약 목록도 세션 없이는 401', lockedList.statusCode === 401, String(lockedList.statusCode));

    /* ═══ 2. 응답에 이름이 없다 ══════════════════════════════════════════ */
    console.log('\n2. ★ 벽에 걸리는 응답 — 시각 말고는 아무것도 없다');

    const body = json(board);
    const raw = board.body;
    check('★★★ 제목이 없다', !raw.includes(SECRET_TITLE) && !raw.includes('비밀회의'), raw.slice(0, 200));
    check('★★★ 회사명이 없다', !raw.includes(company.company_name), raw.slice(0, 200));
    check('★★★ 예약자·메모가 없다', !raw.includes('예약자') && !raw.includes('메모'), raw.slice(0, 200));
    check('★★★ 예약 ID 가 없다', !raw.includes(`${TAG}-1`), raw.slice(0, 200));
    check(
      '★★ 예약 한 건의 키는 **둘뿐**이다 — startTime · endTime',
      Array.isArray(body.busy) &&
        body.busy.length > 0 &&
        body.busy.every((b) => Object.keys(b).sort().join(',') === 'endTime,startTime'),
      JSON.stringify(body.busy),
    );
    check(
      '★ 최상위 키도 넷뿐이다 — room · day · serverTime · busy',
      Object.keys(body).sort().join(',') === 'busy,day,room,serverTime',
      Object.keys(body).join(','),
    );
    check(
      '★ 회의실 값은 넷뿐이다 — id · 이름 · 운영시간',
      Object.keys(body.room ?? {}).sort().join(',') === 'closeTime,facilityId,name,openTime',
      JSON.stringify(body.room),
    );

    /* ═══ 3. 무엇이 오는가 ══════════════════════════════════════════════ */
    console.log('\n3. 내용 — 오늘 · 이 회의실 · 취소 제외');

    check('회의실 이름과 운영시간이 온다', body.room?.name?.includes(TAG) && body.room.openTime === '09:00' && body.room.closeTime === '22:00', JSON.stringify(body.room));
    check('날짜 기본값은 **서버의 오늘**이다', body.day === today, `${body.day} vs ${today}`);
    check('서버 시각이 HH:MM 으로 온다 (화면이 시계를 보정한다)', /^([01]\d|2[0-3]):[0-5]\d$/.test(body.serverTime ?? ''), body.serverTime);
    check(
      '★★ 확정 예약 둘이 온다 — 11:00–13:00 · 16:00–17:00',
      body.busy.length === 2 &&
        body.busy[0].startTime === '11:00' && body.busy[0].endTime === '13:00' &&
        body.busy[1].startTime === '16:00' && body.busy[1].endTime === '17:00',
      JSON.stringify(body.busy),
    );
    check('★★ 취소된 예약은 자리를 잡지 않는다 (20:00 이 없다)', !raw.includes('20:00'), JSON.stringify(body.busy));
    check('★★ 옆 회의실 예약이 섞이지 않는다 (14:00 이 없다)', !raw.includes('14:00'), JSON.stringify(body.busy));

    const otherBoard = json(await app.inject({ method: 'GET', url: `/kiosk/board?room=${OTHER}` }));
    check('옆 회의실을 물으면 옆 회의실 것만 온다', otherBoard.busy?.length === 1 && otherBoard.busy[0].startTime === '14:00', JSON.stringify(otherBoard.busy));

    /* ═══ 4. 잘못된 주소 ════════════════════════════════════════════════ */
    console.log('\n4. 잘못된 주소 — 설치 실수를 구분해 준다');

    const noRoom = await app.inject({ method: 'GET', url: '/kiosk/board' });
    check('회의실이 없으면 400', noRoom.statusCode === 400, String(noRoom.statusCode));

    const ghost = await app.inject({ method: 'GET', url: '/kiosk/board?room=없는방' });
    check('없는 회의실은 404', ghost.statusCode === 404, String(ghost.statusCode));
    check('★ 404 가 식별자를 되뇌지 않는다', !ghost.body.includes('없는방'), ghost.body.slice(0, 120));

    /* ═══ 5. 예약 불가 방도 보인다 ══════════════════════════════════════ */
    console.log('\n5. 예약을 못 받는 방 — 그래도 오늘 일정은 보여 준다');

    await c.query(`UPDATE public.tb_s080_facilities SET is_reservable = false WHERE facility_id = $1`, [ROOM]);
    const off = await app.inject({ method: 'GET', url: `/kiosk/board?room=${ROOM}` });
    check(
      '★ `is_reservable=false` 여도 현황판은 열린다 — 벽에 걸린 화면은 일정을 보여 줘야 한다',
      off.statusCode === 200 && json(off).busy.length === 2,
      `${off.statusCode} ${off.body.slice(0, 120)}`,
    );

    await c.query(`UPDATE public.tb_s080_facilities SET status = 'inactive' WHERE facility_id = $1`, [ROOM]);
    const dead = await app.inject({ method: 'GET', url: `/kiosk/board?room=${ROOM}` });
    check('★ 내려둔 회의실(status≠active)은 404', dead.statusCode === 404, String(dead.statusCode));
  } finally {
    console.log('\n정리');
    const del = await c.query(`DELETE FROM public.tb_s080_reservations WHERE title LIKE $1`, [`${TAG}%`]);
    await c.query(`DELETE FROM public.tb_s080_facilities WHERE facility_id LIKE $1`, [`${TAG}%`]);
    const left = (await c.query(
      `SELECT count(*)::int n FROM public.tb_s080_facilities WHERE facility_id LIKE $1`, [`${TAG}%`],
    )).rows[0].n;
    check(`검증 데이터가 남지 않았다 (예약 ${del.rowCount}건 삭제)`, left === 0, `회의실 ${left}개 남음`);
    await c.end();
    await closePool();
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`검사 ${pass + fail}항목 — 통과 ${pass} · 실패 ${fail}`);
  const short = itemCountGate({ expected: EXPECTED_ITEMS, actual: pass + fail, script: 'verify-kiosk.js' });
  if (fail > 0) {
    console.log('실패 항목:');
    for (const f of failures) console.log(`  · ${f}`);
  }
  if (fail > 0 || short) process.exit(1);
  console.log('✔ 회의실 현황판 검증 전부 통과');
})().catch((e) => {
  console.error('✘ 검증 중 오류:', e.message);
  process.exit(1);
});
