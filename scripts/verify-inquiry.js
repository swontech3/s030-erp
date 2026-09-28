/**
 * 문의상담 게시판 검증 — s0300500070 · p1 · p2.
 *
 * =============================================================================
 * ★★★ 로그인이 없는 화면이다 — **응답에 무엇이 오는가**가 곧 보안 경계다
 * =============================================================================
 * 여기서 보는 것 셋:
 *   ① 목록 응답에 실명·연락처·이메일·본문이 **한 글자도 없는가** (본문 전체를 훑는다)
 *   ② 비밀번호를 맞히지 않으면 원글이 **오지 않는가**, 시도는 제한되는가
 *   ③ 추가 질문이 **토큰 없이** 붙지 않는가, 상태가 「접수」로 돌아오는가
 * 화면을 눌러 보는 것으로는 알 수 없다 — 화면이 안 그릴 뿐 응답에는 있을 수 있다.
 *
 * =============================================================================
 * ★★ 14번부터는 **운영자 문의 관리(s0300200080)** 다
 * =============================================================================
 * 여기서 보는 것은 셋이다.
 *   ① 세션 없이·입주사 세션으로 **열리지 않는가**(401 · 403). 개인정보가 모인 화면이다
 *   ② 운영자가 한 일이 **고객 화면에 그대로 보이는가** — 답변·수정됨·전화 답변.
 *      그래서 운영 라우트로 쓰고 **공개 라우트로 읽는다**(양쪽을 한 번에 본다)
 *   ③ 삭제가 **개인정보를 지우고**, 그러면서도 스팸 집계를 죽이지 않는가
 *
 * ★ 검증용 데이터는 새로 만들어 쓰고 지운다(`name` 에 표식을 넣는다).
 *   ★★ 지운 글은 이름이 `(삭제)` 로 바뀌어 표식이 사라진다 — 그래서 만든 글의 id 를
 *      `made` 에 모아 두고 **id 로도** 지운다. 안 그러면 검증이 쓰레기를 남긴다.
 * ★ 사용자가 띄운 서버는 건드리지 않는다 — 세션 훅째 Fastify 를 따로 세운다.
 *
 * 사용: npx tsx scripts/verify-inquiry.js
 */
import fs from 'node:fs';
import Fastify from 'fastify';
import { Client } from 'pg';
import { itemCountGate } from './verify-count.js';
import {
  MAX_OPERATOR_ANSWERS,
  OPERATOR_DISPLAY_NAME,
  REPLY_BLOCK_MESSAGE,
} from '../packages/shared/src/domain/inquiry.ts';
import { registerSessionHook } from '../packages/api/src/session/hook.ts';
import { registerInquiryRoutes } from '../packages/api/src/routes/inquiry.ts';
import { registerInquiryAdminRoutes } from '../packages/api/src/routes/inquiryAdmin.ts';
import { registerBookingRoutes } from '../packages/api/src/routes/booking.ts';
import { phoneDigitsToken } from '../packages/api/src/lib/crypto.ts';
import { closePool } from '../packages/api/src/db/pool.ts';

const readEnv = (p) =>
  Object.fromEntries(
    fs.readFileSync(p, 'utf8').split(/\r?\n/)
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
  );
const env = readEnv('.env');

/** 기대 항목 수 — 모자라면 **실패**다(`verify-count.js` 머리말). */
const EXPECTED_ITEMS = 167;

let pass = 0;
let fail = 0;
const failures = [];
function check(label, ok, detail) {
  if (ok) { pass++; console.log(`  ✔ ${label}`); }
  else { fail++; failures.push(label); console.log(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`); }
}

const TAG = `verify-inq-${Date.now()}`;
/** 새면 바로 눈에 띄는 값들 — 목록 응답을 이 문자열로 훑는다. */
const NAME = `${TAG}김도현`;
const PHONE = '010-9999-0001';
const EMAIL = `${TAG}@bridgelab.co.kr`;
const COMPANY = `${TAG}브릿지랩`;
const BODY = `${TAG} 비밀본문 — 3명이 쓸 사무실을 찾습니다`;
const PASSWORD = 'pw1234';

function buildApp() {
  const app = Fastify({ logger: false });
  app.setErrorHandler((err, _req, reply) =>
    reply.code(err.statusCode ?? 500).send({ error: 'error', message: err.message }));
  registerSessionHook(app);
  registerInquiryRoutes(app);
  // ★ 인증이 필요한 라우트도 함께 등록한다 — 공개 설정이 옆으로 새면 여기서 잡힌다.
  registerBookingRoutes(app);
  // ★★ 문의 관리(s0300200080)도 **같은 앱에** 올린다. 세션 훅이 살아 있는 앱이라
  //    「세션 없이 열리는가」를 여기서 볼 수 있다 — 라우트에 config.public 이 잘못
  //    붙으면 그 자리에서 200 이 나온다.
  registerInquiryAdminRoutes(app);
  return app;
}

/**
 * 세션을 바꿔 끼운 Fastify — 로그인 왕복 없이 운영자·입주사로 라우트를 부른다
 * (`verify-booking.js` 와 같은 방식).
 *
 * ★ 이 앱에는 공개 라우트를 올리지 않는다. 세션이 항상 들어 있는 앱에서 공개 라우트를
 *   부르면 「공개인가」를 확인할 수 없다 — 그건 위의 `buildApp()` 이 본다.
 */
function buildAs(session) {
  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (req) => {
    req.session = session;
  });
  app.setErrorHandler((err, _req, reply) =>
    reply.code(err.statusCode ?? 500).send({ error: 'error', message: err.message }));
  registerInquiryAdminRoutes(app);
  return app;
}

/** 운영사 세션 — mock 계정 1001(김대표). ★ 답변에 **이 이름이 보이지는 않는다** — 표시는 고정 문구다. */
const OPERATOR = { s020MemberId: 1001, s020OrgId: 1, companyId: null, role: 'operator' };
/** 입주사 세션 — mock 계정 2001(홍길동). **이 화면은 열려서는 안 된다.** */
const TENANT = { s020MemberId: 2001, s020OrgId: 9001, companyId: 'co_verify', role: 'tenant' };
const json = (res) => { try { return JSON.parse(res.body); } catch { return { __raw: res.body }; } };
const post = (app, url, payload, headers) =>
  app.inject({ method: 'POST', url, payload, headers: { 'content-type': 'application/json', ...headers } });
const patch = (app, url, payload) =>
  app.inject({ method: 'PATCH', url, payload, headers: { 'content-type': 'application/json' } });
const httpDel = (app, url) => app.inject({ method: 'DELETE', url });
const get = (app, url) => app.inject({ method: 'GET', url });

/** 만든 글의 id — 정리에서 **id 로도** 지운다(지운 글은 이름 표식이 사라진다). */
const made = [];

(async () => {
  const c = new Client({
    host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER,
    password: env.DB_PASSWORD, database: env.DB_NAME, connectionTimeoutMillis: 15000,
  });
  await c.connect();
  const app = buildApp();
  /** 운영자·입주사로 부르는 앱. 공개 라우트는 위 `app` 으로만 부른다. */
  const asOperator = buildAs(OPERATOR);
  const asTenant = buildAs(TENANT);
  let createdId = null;

  try {
    /* ═══ 1. 코드 마스터 ═══════════════════════════════════════════════════ */
    console.log('\n1. 코드 마스터 — 화면에 문자열을 박지 않는다');
    const codes = json(await app.inject({ method: 'GET', url: '/inquiries/codes' }));
    check('★ 유형 5종이 코드로 온다 (O·L·T·R·E)',
      codes.types?.map((t) => t.code).join(',') === 'O,L,T,R,E', JSON.stringify(codes.types));
    check('★ 상태 2종 (R 접수 · A 답변완료)',
      codes.statuses?.length === 2 && codes.statuses[0].name === '접수' && codes.statuses[1].name === '답변완료',
      JSON.stringify(codes.statuses));
    /* ★★ 이름이 바뀌었다(030) — 화면에 박힌 문자열이 없으므로 **이 응답이 곧 화면의 문구**다.
       고객 목록·검색·문의하기 버튼·운영자 목록·운영자 필터 다섯 자리가 이것을 읽는다. */
    const typeNames = Object.fromEntries((codes.types ?? []).map((t) => [t.code, t.name]));
    check('★★ 법무설립문의 → **법무서비스문의**', typeNames.L === '법무서비스문의', String(typeNames.L));
    check('★★ 세무문의 → **세무서비스문의**', typeNames.T === '세무서비스문의', String(typeNames.T));
    check('★★ 기타 → **기타문의**', typeNames.E === '기타문의', String(typeNames.E));
    check('★ 나머지 둘은 그대로다',
      typeNames.O === '입주문의' && typeNames.R === '연구소설립문의', `${typeNames.O} · ${typeNames.R}`);
    check('★ 옛 이름은 어디에도 없다',
      !JSON.stringify(codes).includes('법무설립문의') && !JSON.stringify(codes).includes('"세무문의"'),
      JSON.stringify(codes.types));

    /* ═══ 2. 인증 ═════════════════════════════════════════════════════════ */
    console.log('\n2. 인증 — 세션 없이 열리고, 옆 라우트는 그대로 잠겨 있다');
    const list0 = await app.inject({ method: 'GET', url: '/inquiries' });
    check('★★★ 목록이 세션 없이 200', list0.statusCode === 200, String(list0.statusCode));
    const locked = await app.inject({ method: 'GET', url: '/facilities' });
    check('★★★ 공개 설정이 옆 라우트로 새지 않았다 — /facilities 는 401', locked.statusCode === 401, String(locked.statusCode));

    /* ═══ 3. 등록 ═════════════════════════════════════════════════════════ */
    console.log('\n3. 등록 — 검증은 서버가 한다');
    const bad = await post(app, '/inquiries', { name: '', phone: '010', email: 'x', type: 'ZZ', body: '', password: '1', agreed: false });
    check('★ 빈 폼은 400 + 어느 칸이 비었는지 돌려준다', bad.statusCode === 400 && Array.isArray(json(bad).fields), bad.body.slice(0, 120));
    check('★ 코드 마스터에 없는 유형은 거절한다',
      json(bad).fields?.includes('type'), JSON.stringify(json(bad).fields));

    const created = await post(app, '/inquiries', {
      name: NAME, phone: PHONE, email: EMAIL, companyName: COMPANY,
      type: 'O', body: BODY, password: PASSWORD, agreed: true,
    });
    createdId = json(created).inquiryId;
    made.push(createdId);
    check('문의가 등록된다 (201)', created.statusCode === 201 && !!createdId, created.body.slice(0, 160));
    check('★ 완료 화면 미리보기는 **가린 이름**이다', json(created).maskedName === `${TAG[0]}**`,
      json(created).maskedName);

    const stored = (await c.query(
      `SELECT password_hash, name, phone_digits FROM public.tb_s080_inquiries WHERE inquiry_id = $1`, [createdId])).rows[0];
    check('★★★ 비밀번호가 평문으로 저장되지 않는다 (scrypt 해시)',
      stored.password_hash.startsWith('scrypt$') && !stored.password_hash.includes(PASSWORD),
      stored.password_hash.slice(0, 40));
    check('★ 연락처 숫자만 따로 남는다 — 스팸 판정이 표기에 속지 않게',
      stored.phone_digits === '01099990001', stored.phone_digits);

    /* ═══ 4. 목록 — 무엇이 나가는가 ═══════════════════════════════════════ */
    console.log('\n4. ★ 목록 응답 — 유형 · 가린 이름 · 날짜 · 상태뿐');
    const listRes = await app.inject({ method: 'GET', url: '/inquiries' });
    const raw = listRes.body;
    const mine = json(listRes).items.find((i) => i.inquiryId === createdId);
    check('★★★ 실명이 없다', !raw.includes(NAME), raw.slice(0, 200));
    check('★★★ 본문이 없다', !raw.includes('비밀본문'), raw.slice(0, 200));
    check('★★★ 연락처가 없다', !raw.includes('9999-0001') && !raw.includes('01099990001'));
    check('★★★ 이메일·회사명이 없다', !raw.includes(EMAIL) && !raw.includes(COMPANY));
    check('★★ 한 줄의 키는 다섯뿐 — id · type · maskedName · day · status',
      Object.keys(mine).sort().join(',') === 'day,inquiryId,maskedName,status,type', Object.keys(mine).join(','));
    check('★ 이름은 성 한 자 + ** (글자 수를 드러내지 않는다)', mine.maskedName === `${TAG[0]}**`, mine.maskedName);
    check('갓 올린 글은 「접수」다', mine.status === 'R', mine.status);

    /* ═══ 5. 글 머리 ══════════════════════════════════════════════════════ */
    console.log('\n5. 글 머리 — 비밀번호 화면이 쓰는 최소 정보');
    const head = json(await app.inject({ method: 'GET', url: `/inquiries/${createdId}` }));
    check('★ 목록 한 줄과 같은 넷뿐이다',
      Object.keys(head).sort().join(',') === 'day,inquiryId,maskedName,type', Object.keys(head).join(','));
    const ghostHead = await app.inject({ method: 'GET', url: '/inquiries/없는글' });
    check('없는 글은 404', ghostHead.statusCode === 404, String(ghostHead.statusCode));

    /* ═══ 6. 비밀번호 ═════════════════════════════════════════════════════ */
    console.log('\n6. ★ 글 보기 — 비밀번호를 맞힌 사람에게만');
    const wrong = await post(app, `/inquiries/${createdId}/unlock`, { password: '0000' });
    check('★★★ 틀린 비밀번호는 401', wrong.statusCode === 401, String(wrong.statusCode));
    check('★★★ 401 응답에 원글이 섞여 오지 않는다',
      !wrong.body.includes('비밀본문') && !wrong.body.includes(NAME), wrong.body.slice(0, 160));

    const ghost = await post(app, '/inquiries/없는글/unlock', { password: PASSWORD });
    check('★ 없는 글과 틀린 비밀번호를 구분해 주지 않는다 (둘 다 401)', ghost.statusCode === 401, String(ghost.statusCode));

    const opened = await post(app, `/inquiries/${createdId}/unlock`, { password: PASSWORD });
    const box = json(opened);
    check('★★ 맞히면 200 — 토큰 · 원글 · 스레드', opened.statusCode === 200 && !!box.token && !!box.inquiry,
      opened.body.slice(0, 160));
    check('★ 그제야 본문·연락처가 온다', box.inquiry.body.includes('비밀본문') && box.inquiry.phone === PHONE);
    check('★ 원글 응답에 비밀번호 해시는 없다', !opened.body.includes('scrypt$'), opened.body.slice(0, 120));

    /* ═══ 7. 시도 제한 ════════════════════════════════════════════════════ */
    console.log('\n7. ★ 시도 제한 — 4자 비밀번호의 전제');
    const other = await post(app, '/inquiries', {
      name: `${TAG}이영희`, phone: '010-9999-0002', email: `${TAG}b@x.co.kr`,
      type: 'T', body: `${TAG} 두 번째 글`, password: PASSWORD, agreed: true,
    });
    const otherId = json(other).inquiryId;
    made.push(otherId);
    let codesSeen = [];
    for (let i = 0; i < 6; i++) {
      const r = await post(app, `/inquiries/${otherId}/unlock`, { password: 'xxxx' });
      codesSeen.push(r.statusCode);
    }
    check('★★★ 10분 5회를 넘기면 429 로 잠근다', codesSeen.join(',') === '401,401,401,401,401,429', codesSeen.join(','));
    const lockedOut = await post(app, `/inquiries/${otherId}/unlock`, { password: PASSWORD });
    check('★★ 잠긴 동안에는 **맞는 비밀번호도** 열리지 않는다', lockedOut.statusCode === 429, String(lockedOut.statusCode));
    await c.query(`DELETE FROM public.tb_s080_inquiry_unlock_attempts WHERE inquiry_id = $1`, [otherId]);
    const afterClear = await post(app, `/inquiries/${otherId}/unlock`, { password: PASSWORD });
    check('시간이 지나면(기록이 빠지면) 다시 열린다', afterClear.statusCode === 200, String(afterClear.statusCode));
    const successCleared = (await c.query(
      `SELECT count(*)::int n FROM public.tb_s080_inquiry_unlock_attempts WHERE inquiry_id = $1`, [otherId])).rows[0].n;
    check('★ 맞히면 실패 기록을 지운다 — 다음 사람이 앞사람 실패를 물려받지 않는다', successCleared === 0, String(successCleared));

    /* ═══ 8. 추가 질문 ════════════════════════════════════════════════════ */
    console.log('\n8. ★★★ 추가 질문 — 토큰 없이는 남의 글에 못 쓴다');
    const noToken = await post(app, `/inquiries/${createdId}/messages`, { body: '토큰 없이' });
    check('★★★ 토큰이 없으면 401', noToken.statusCode === 401, String(noToken.statusCode));
    const badToken = await post(app, `/inquiries/${createdId}/messages`, { body: '가짜 토큰' }, { 'x-inquiry-token': 'made-up' });
    check('★★★ 아무 토큰이나 통하지 않는다 (401)', badToken.statusCode === 401, String(badToken.statusCode));
    const otherToken = json(afterClear).token;
    const crossed = await post(app, `/inquiries/${createdId}/messages`, { body: '남의 글 토큰' }, { 'x-inquiry-token': otherToken });
    check('★★★ **다른 글의 토큰**으로도 못 쓴다', crossed.statusCode === 401, String(crossed.statusCode));

    const empty = await post(app, `/inquiries/${createdId}/messages`, { body: '   ' }, { 'x-inquiry-token': box.token });
    check('공백만이면 400', empty.statusCode === 400, String(empty.statusCode));

    const added = await post(app, `/inquiries/${createdId}/messages`, { body: `${TAG} 추가 질문입니다` }, { 'x-inquiry-token': box.token });
    check('★★ 토큰이 맞으면 201', added.statusCode === 201, added.body.slice(0, 120));
    check('★★★ 추가 질문을 달면 상태가 「접수」로 돌아온다', json(added).status === 'R', JSON.stringify(json(added).status));

    const twice = await post(app, `/inquiries/${createdId}/messages`, { body: '두 번째' }, { 'x-inquiry-token': box.token });
    check('★★ 글 하나에 1회 — 두 번째는 409', twice.statusCode === 409, String(twice.statusCode));

    /* ═══ 9. 상태 판정 ════════════════════════════════════════════════════ */
    console.log('\n9. 상태 — 마지막 글로 정한다');
    /* ★ 운영자 답변은 **운영 라우트로** 넣는다(s0300200080). DB 에 직접 넣으면 「규칙이
       SQL 에서 맞는가」만 보게 되고, 라우트가 다른 kind 를 쓰는 사고를 못 잡는다. */
    const answer1 = await post(asOperator, `/admin/inquiries/${createdId}/messages`,
      { kind: 'text', body: `${TAG} 답변입니다` });
    check('★ 운영자 답변이 운영 라우트로 들어간다 (201)', answer1.statusCode === 201, answer1.body.slice(0, 140));
    const afterAnswer = json(await app.inject({ method: 'GET', url: '/inquiries' }))
      .items.find((i) => i.inquiryId === createdId);
    check('★★ 운영자가 답하면 「답변완료」', afterAnswer.status === 'A', afterAnswer.status);

    const byStatus = json(await app.inject({ method: 'GET', url: '/inquiries?status=A' }));
    check('★ 상태로 검색된다 (A)', byStatus.items.some((i) => i.inquiryId === createdId));
    const byReceived = json(await app.inject({ method: 'GET', url: '/inquiries?status=R' }));
    check('★ 「접수」 검색에는 안 나온다', !byReceived.items.some((i) => i.inquiryId === createdId));
    const byType = json(await app.inject({ method: 'GET', url: '/inquiries?type=O' }));
    check('유형으로 검색된다', byType.items.some((i) => i.inquiryId === createdId));
    const today = new Date().toISOString().slice(0, 10);
    const byDay = json(await app.inject({ method: 'GET', url: `/inquiries?from=${today}&to=${today}` }));
    check('★ 문의일자 from~to 는 **양 끝을 포함**한다', byDay.items.some((i) => i.inquiryId === createdId));

    /* ═══ 10. 전화 답변 ═══════════════════════════════════════════════════ */
    console.log('\n10. 전화 답변 기록 — 본문이 없다');
    const phoneOnly = await c.query(
      `INSERT INTO public.tb_s080_inquiry_messages (message_id, inquiry_id, kind, operator_name)
       VALUES ($1, $2, 'phone', '이정희') RETURNING message_id`, [`${TAG}-m2`, createdId]);
    check('본문 없는 phone 메시지가 들어간다', phoneOnly.rowCount === 1);
    let bodyOnPhone = null;
    try {
      await c.query(`INSERT INTO public.tb_s080_inquiry_messages (message_id, inquiry_id, kind, body)
                     VALUES ($1, $2, 'phone', '있으면 안 된다')`, [`${TAG}-m3`, createdId]);
      bodyOnPhone = 'OK';
    } catch (e) { bodyOnPhone = e.code; }
    check('★ 전화 기록에 본문이 붙으면 DB 가 막는다 (23514)', bodyOnPhone === '23514', String(bodyOnPhone));
    let textNoBody = null;
    try {
      await c.query(`INSERT INTO public.tb_s080_inquiry_messages (message_id, inquiry_id, kind)
                     VALUES ($1, $2, 'text')`, [`${TAG}-m4`, createdId]);
      textNoBody = 'OK';
    } catch (e) { textNoBody = e.code; }
    check('★ 본문 없는 글답변도 막는다 (23514)', textNoBody === '23514', String(textNoBody));

    /* ═══ 11. 스팸 ════════════════════════════════════════════════════════ */
    console.log('\n11. 등록 제한 — 하루 3건 · 1분 간격');
    const cool = await post(app, '/inquiries', {
      name: `${TAG}박서준`, phone: '010-9999-0003', email: `${TAG}c@x.co.kr`,
      type: 'E', body: `${TAG} 세 번째`, password: PASSWORD, agreed: true,
    });
    made.push(json(cool).inquiryId);
    check('첫 글은 들어간다', cool.statusCode === 201, String(cool.statusCode));
    const again = await post(app, '/inquiries', {
      name: `${TAG}박서준`, phone: '010 9999 0003', email: `${TAG}c@x.co.kr`,
      type: 'E', body: `${TAG} 1분 이내`, password: PASSWORD, agreed: true,
    });
    check('★★ 1분 이내 재작성은 429 cooldown — **표기가 달라도 같은 연락처다**',
      again.statusCode === 429 && json(again).reason === 'cooldown', `${again.statusCode} ${again.body.slice(0, 80)}`);

    // 하루 3건 — 같은 연락처로 오늘 3건을 심고 4번째를 시도한다(1분 규칙을 피해 2분 전으로).
    for (let i = 0; i < 3; i++) {
      await c.query(
        `INSERT INTO public.tb_s080_inquiries
           (inquiry_id, build_id, type, name, phone, phone_digits, email, body, password_hash, agreed_at, created_at, updated_at)
         VALUES ($1,'1','E',$2,'010-9999-0004','01099990004',$3,$4,'scrypt$x', CURRENT_TIMESTAMP,
                 CURRENT_TIMESTAMP - interval '2 minutes', CURRENT_TIMESTAMP)`,
        [`${TAG}-d${i}`, `${TAG}최다건`, `${TAG}d@x.co.kr`, `${TAG} 하루치 ${i}`]);
      made.push(`${TAG}-d${i}`);
    }
    const daily = await post(app, '/inquiries', {
      name: `${TAG}최다건`, phone: '010-9999-0004', email: `${TAG}d@x.co.kr`,
      type: 'E', body: `${TAG} 네 번째`, password: PASSWORD, agreed: true,
    });
    check('★★ 같은 연락처 하루 3건을 넘기면 429 daily',
      daily.statusCode === 429 && json(daily).reason === 'daily', `${daily.statusCode} ${daily.body.slice(0, 80)}`);

    /* ═══ 12. 삭제된 글 ═══════════════════════════════════════════════════ */
    console.log('\n12. 운영자가 지운 글');
    await c.query(`UPDATE public.tb_s080_inquiries SET deleted_at = CURRENT_TIMESTAMP WHERE inquiry_id = $1`, [otherId]);
    const afterDelete = json(await app.inject({ method: 'GET', url: '/inquiries' }));
    check('★ 지운 글은 목록에서 사라진다', !afterDelete.items.some((i) => i.inquiryId === otherId));
    const deletedOpen = await post(app, `/inquiries/${otherId}/unlock`, { password: PASSWORD });
    check('★★ 지운 글은 비밀번호로도 열리지 않는다', deletedOpen.statusCode === 401, String(deletedOpen.statusCode));
    const stillCounts = (await c.query(
      `SELECT count(*)::int n FROM public.tb_s080_inquiries WHERE phone_digits = '01099990002'`)).rows[0].n;
    check('★ 지워도 스팸 집계에는 남는다 — 지우고 다시 쓰는 길을 막는다', stillCounts === 1, String(stillCounts));

    /* ═══ 13. 페이지 ══════════════════════════════════════════════════════ */
    console.log('\n13. 페이지 — 20건씩');
    const paged = json(await app.inject({ method: 'GET', url: '/inquiries?page=1' }));
    check('한 쪽은 20건 이하다', paged.items.length <= 20 && paged.pageSize === 20, `${paged.items.length}건 · pageSize ${paged.pageSize}`);
    check('전체 건수를 함께 준다', typeof paged.total === 'number' && paged.total >= 1, String(paged.total));

    /* ═══ 14. 운영자 문의 관리 — 권한 ═════════════════════════════════════ */
    console.log('\n14. ★★★ 문의 관리(s0300200080) — 세션 없이·입주사로 열리지 않는다');
    const noSession = await get(app, '/admin/inquiries');
    check('★★★ 세션이 없으면 401 — 공개 설정이 옆으로 새지 않았다', noSession.statusCode === 401,
      `${noSession.statusCode} ${noSession.body.slice(0, 80)}`);
    check('★★★ 401 응답에 이름·연락처가 섞여 오지 않는다',
      !noSession.body.includes(NAME) && !noSession.body.includes(PHONE), noSession.body.slice(0, 120));

    const tenantList = await get(asTenant, '/admin/inquiries');
    check('★★★ 입주사 세션은 403 (목록)', tenantList.statusCode === 403, String(tenantList.statusCode));
    check('★★★ 403 응답에도 이름·연락처가 없다',
      !tenantList.body.includes(NAME) && !tenantList.body.includes(PHONE), tenantList.body.slice(0, 120));
    check('★★★ 입주사 세션은 403 (글 상세)',
      (await get(asTenant, `/admin/inquiries/${createdId}`)).statusCode === 403);
    check('★★★ 입주사 세션은 403 (답변 등록)',
      (await post(asTenant, `/admin/inquiries/${createdId}/messages`, { kind: 'text', body: '남의 글에 답변' }))
        .statusCode === 403);
    check('★★★ 입주사 세션은 403 (답변 수정)',
      (await patch(asTenant, `/admin/inquiries/${createdId}/messages/x`, { body: '고쳐 보기' })).statusCode === 403);
    check('★★★ 입주사 세션은 403 (글 삭제)',
      (await httpDel(asTenant, `/admin/inquiries/${createdId}`)).statusCode === 403);

    /* ═══ 15. 운영자 목록 — 실명은 오고 연락처는 담기지 않는다 ════════════ */
    console.log('\n15. 운영자 목록 — 필터 · 검색');
    const opened2 = await post(app, '/inquiries', {
      name: `${TAG}운영테스트`, phone: '010-9999-0007', email: `${TAG}g@x.co.kr`, companyName: `${TAG}회사`,
      type: 'O', body: `${TAG} 운영자 화면 검증용 본문`, password: PASSWORD, agreed: true,
    });
    const inqA = json(opened2).inquiryId;
    made.push(inqA);
    check('검증용 문의를 하나 더 만든다 (201)', opened2.statusCode === 201 && !!inqA, opened2.body.slice(0, 120));

    const adminR = json(await get(asOperator, '/admin/inquiries?status=R'));
    const mineA = adminR.items.find((i) => i.inquiryId === inqA);
    check('★ 갓 올린 글은 「접수」 목록에 있다', !!mineA, `총 ${adminR.total}건`);
    check('★★ 운영자 목록에는 **실명**이 온다 — 답할 사람을 알아야 한다',
      mineA?.name === `${TAG}운영테스트`, String(mineA?.name));
    check('★ 한 줄의 키는 여덟 — **연락처는 목록에 담지 않는다**(검색은 된다)',
      Object.keys(mineA ?? {}).sort().join(',') ===
        'day,inquiryId,lastAt,lastKind,name,retentionPassed,status,type',
      Object.keys(mineA ?? {}).join(','));
    check('★ 스레드가 비었으면 마지막 글이 null 이다 (원글만)',
      mineA?.lastKind === null && mineA?.lastAt === null, `${mineA?.lastKind} ${mineA?.lastAt}`);
    check('갓 올린 글은 보관 기간이 지나지 않았다', mineA?.retentionPassed === false, String(mineA?.retentionPassed));
    check('★ 보관 기간 개월 수를 서버가 준다 — 화면에 6을 박지 않는다',
      adminR.retentionMonths === 6, String(adminR.retentionMonths));

    const byName = json(await get(asOperator, `/admin/inquiries?q=${encodeURIComponent(`${TAG}운영`)}`));
    check('★ 이름으로 검색된다', byName.items.some((i) => i.inquiryId === inqA), `${byName.total}건`);
    const byPhone = json(await get(asOperator, '/admin/inquiries?q=9999-0007'));
    check('★★ **연락처로도** 검색된다 — 표기(하이픈)가 달라도 찾는다',
      byPhone.items.some((i) => i.inquiryId === inqA), `${byPhone.total}건`);
    const byNone = json(await get(asOperator, `/admin/inquiries?q=${encodeURIComponent(`${TAG}없는이름`)}`));
    check('없는 이름은 0건', byNone.total === 0, String(byNone.total));
    const byWild = json(await get(asOperator, '/admin/inquiries?q=%25'));
    check('★ 검색어의 `%` 는 글자다 — 「전부」가 되지 않는다', byWild.total === 0, String(byWild.total));
    const byTypeO = json(await get(asOperator, '/admin/inquiries?type=O'));
    check('유형으로 걸러진다 (O)', byTypeO.items.some((i) => i.inquiryId === inqA));
    const byTypeT = json(await get(asOperator, '/admin/inquiries?type=T'));
    check('다른 유형에는 안 나온다 (T)', !byTypeT.items.some((i) => i.inquiryId === inqA));

    /* ═══ 16. 글 상세 ═════════════════════════════════════════════════════ */
    console.log('\n16. 글 상세 — 원글 전체. 비밀번호는 묻지 않고, 해시는 주지 않는다');
    const detailRes = await get(asOperator, `/admin/inquiries/${inqA}`);
    const detail = json(detailRes);
    check('★ 비밀번호 없이 원글이 온다 (운영자다)',
      detailRes.statusCode === 200 && detail.inquiry?.body.includes('운영자 화면 검증용'), detailRes.body.slice(0, 140));
    check('연락처·이메일·회사명이 함께 온다',
      detail.inquiry.phone === '010-9999-0007' && detail.inquiry.email === `${TAG}g@x.co.kr` &&
      detail.inquiry.companyName === `${TAG}회사`, JSON.stringify(detail.inquiry).slice(0, 160));
    check('★★★ 비밀번호 해시는 오지 않는다', !detailRes.body.includes('scrypt$'), detailRes.body.slice(0, 120));
    check('스레드는 비어 있다', Array.isArray(detail.messages) && detail.messages.length === 0);
    check('없는 글은 404', (await get(asOperator, '/admin/inquiries/없는글')).statusCode === 404);

    /* ═══ 17. 답변 등록 → 고객 화면 ═══════════════════════════════════════ */
    console.log('\n17. ★★ 답변 등록 — 고객 화면에 보이고 상태가 「답변완료」가 된다');
    const reply = await post(asOperator, `/admin/inquiries/${inqA}/messages`,
      { kind: 'text', body: `${TAG} 10시에 방문 가능합니다` });
    const replyBody = json(reply);
    check('답변이 등록된다 (201)', reply.statusCode === 201, reply.body.slice(0, 140));
    check('★★ 상태가 「답변완료」(A)로 바뀐다', replyBody.status === 'A', String(replyBody.status));
    check('★★★ 답변자 이름은 **고정 문구**다 — 로그인한 사람 이름이 아니다',
      replyBody.messages?.[0]?.operatorName === OPERATOR_DISPLAY_NAME, String(replyBody.messages?.[0]?.operatorName));
    check('★★★ 응답에 직원 실명(김대표)이 없다', !reply.body.includes('김대표'), reply.body.slice(0, 160));

    const adminA = json(await get(asOperator, '/admin/inquiries?status=A'));
    check('★ 「답변완료」 목록에 있다', adminA.items.some((i) => i.inquiryId === inqA));
    const adminR2 = json(await get(asOperator, '/admin/inquiries?status=R'));
    check('★★ 「접수」 목록에서는 빠진다 — 답할 것이 아니다',
      !adminR2.items.some((i) => i.inquiryId === inqA));
    const rowA = adminA.items.find((i) => i.inquiryId === inqA);
    check('★ 마지막 글이 목록에 보인다 (text)', rowA?.lastKind === 'text' && !!rowA?.lastAt,
      `${rowA?.lastKind} ${rowA?.lastAt}`);

    // ★★★ 여기가 이 절의 핵심 — **고객 화면에서** 읽는다(공개 라우트).
    const seenByCustomer = await post(app, `/inquiries/${inqA}/unlock`, { password: PASSWORD });
    const boxA = json(seenByCustomer);
    check('★★★ 고객 화면에 답변이 보인다',
      boxA.messages?.[0]?.body?.includes('10시에 방문 가능합니다'), seenByCustomer.body.slice(0, 160));
    check('★★★ 고객 화면의 상태도 「답변완료」다', boxA.inquiry?.status === 'A', String(boxA.inquiry?.status));
    check('★★★ 고객 화면도 같은 고정 문구를 본다',
      boxA.messages?.[0]?.operatorName === OPERATOR_DISPLAY_NAME, String(boxA.messages?.[0]?.operatorName));
    check('★★★ 고객 응답에도 직원 실명이 없다', !seenByCustomer.body.includes('김대표'), seenByCustomer.body.slice(0, 160));
    check('아직 「수정됨」이 아니다', boxA.messages?.[0]?.editedAt === null, String(boxA.messages?.[0]?.editedAt));

    /* ═══ 18. 고객 추가 질문 → 다시 「접수」 ═══════════════════════════════ */
    console.log('\n18. ★★★ 고객이 추가 질문하면 **다시 「접수」** — 목록 기본 필터에 다시 잡힌다');
    const follow = await post(app, `/inquiries/${inqA}/messages`, { body: `${TAG} 주차는 되나요?` },
      { 'x-inquiry-token': boxA.token });
    check('추가 질문이 등록된다 (201)', follow.statusCode === 201, follow.body.slice(0, 120));
    check('★★ 상태가 「접수」로 돌아온다', json(follow).status === 'R', String(json(follow).status));
    const adminR3 = json(await get(asOperator, '/admin/inquiries?status=R'));
    const backIn = adminR3.items.find((i) => i.inquiryId === inqA);
    check('★★★ 운영자 「접수」 목록에 **다시** 잡힌다', !!backIn, `총 ${adminR3.total}건`);
    check('★ 마지막 글이 고객 글(customer)로 보인다', backIn?.lastKind === 'customer', String(backIn?.lastKind));

    /* ═══ 19. 답변 수정 — 「수정됨」 ═══════════════════════════════════════ */
    console.log('\n19. 답변 수정 — 「수정됨」 · 순서는 그대로');
    const beforeEdit = json(await get(asOperator, `/admin/inquiries/${inqA}`));
    const textMsg = beforeEdit.messages.find((m) => m.kind === 'text');
    const customerMsg = beforeEdit.messages.find((m) => m.kind === 'customer');
    const edited = await patch(asOperator, `/admin/inquiries/${inqA}/messages/${textMsg.messageId}`,
      { body: `${TAG} 11시로 바뀌었습니다` });
    check('답변이 수정된다 (200)', edited.statusCode === 200, edited.body.slice(0, 140));
    const editedMsg = json(edited).messages.find((m) => m.messageId === textMsg.messageId);
    check('★ 본문이 바뀐다', editedMsg?.body?.includes('11시로 바뀌었습니다'), String(editedMsg?.body));
    check('★★ 「수정됨」이 붙는다 (날짜만)',
      typeof editedMsg?.editedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(editedMsg.editedAt),
      String(editedMsg?.editedAt));
    check('★★ 등록 시각은 그대로다 — 맨 아래로 옮기지 않는다',
      editedMsg?.createdAt === textMsg.createdAt, `${textMsg.createdAt} → ${editedMsg?.createdAt}`);
    check('★★ 스레드 순서도 그대로다 (답변 → 추가 질문)',
      json(edited).messages.map((m) => m.kind).join(',') === 'text,customer',
      json(edited).messages.map((m) => m.kind).join(','));
    check('★ 수정해도 상태는 「접수」다 — 마지막 글이 여전히 고객 글이다',
      json(edited).status === 'R', String(json(edited).status));

    const afterEditCustomer = json(await post(app, `/inquiries/${inqA}/unlock`, { password: PASSWORD }));
    check('★★★ 고객 화면에 「수정됨」이 보인다',
      afterEditCustomer.messages.find((m) => m.kind === 'text')?.editedAt === editedMsg.editedAt,
      String(afterEditCustomer.messages.find((m) => m.kind === 'text')?.editedAt));

    check('★★ 고객의 추가 질문은 수정할 수 없다 (409)',
      (await patch(asOperator, `/admin/inquiries/${inqA}/messages/${customerMsg.messageId}`, { body: '남의 말 고치기' }))
        .statusCode === 409);
    check('빈 본문으로는 수정되지 않는다 (400)',
      (await patch(asOperator, `/admin/inquiries/${inqA}/messages/${textMsg.messageId}`, { body: '   ' }))
        .statusCode === 400);
    check('없는 메시지는 404',
      (await patch(asOperator, `/admin/inquiries/${inqA}/messages/없는글`, { body: '내용' })).statusCode === 404);

    /* ═══ 20. 전화 답변 · 못 들어오는 것들 ════════════════════════════════ */
    console.log('\n20. 전화 답변 기록 · 받지 않는 입력');
    const phoneReply = await post(asOperator, `/admin/inquiries/${inqA}/messages`,
      { kind: 'phone', body: '이 본문은 버려진다' });
    check('전화 답변이 기록된다 (201)', phoneReply.statusCode === 201, phoneReply.body.slice(0, 140));
    const phoneMsg = json(phoneReply).messages.at(-1);
    check('★★ 전화 기록에는 **본문이 없다** — 보내와도 버린다', phoneMsg?.body === null, String(phoneMsg?.body));
    check('★ 전화 기록의 이름도 고정 문구다', phoneMsg?.operatorName === OPERATOR_DISPLAY_NAME, String(phoneMsg?.operatorName));
    check('★ 전화 답변도 「답변완료」다', json(phoneReply).status === 'A', String(json(phoneReply).status));
    const phoneOnCustomer = json(await post(app, `/inquiries/${inqA}/unlock`, { password: PASSWORD }));
    check('★★★ 고객 화면에 전화 답변이 보인다 (kind phone · 본문 없음)',
      phoneOnCustomer.messages.at(-1)?.kind === 'phone' && phoneOnCustomer.messages.at(-1)?.body === null,
      JSON.stringify(phoneOnCustomer.messages.at(-1)));
    check('★ 전화 기록은 수정할 수 없다 (409)',
      (await patch(asOperator, `/admin/inquiries/${inqA}/messages/${phoneMsg.messageId}`, { body: '고쳐 보기' }))
        .statusCode === 409);
    check('★★★ 운영자가 고객 글(customer)을 붙일 수는 없다 (400)',
      (await post(asOperator, `/admin/inquiries/${inqA}/messages`, { kind: 'customer', body: '고객인 척' }))
        .statusCode === 400);
    check('공백만인 글답변은 400',
      (await post(asOperator, `/admin/inquiries/${inqA}/messages`, { kind: 'text', body: '   ' })).statusCode === 400);
    check('모르는 kind 는 400',
      (await post(asOperator, `/admin/inquiries/${inqA}/messages`, { kind: 'TEXT', body: '내용' })).statusCode === 400);

    /* ═══ 21. 「보관 기간 지남」 — 운영자 화면에만 ═════════════════════════ */
    console.log('\n21. ★ 「보관 기간 지남」(원글 6개월) — **운영자 화면에만** · 자동 삭제 없음');
    const oldId = `${TAG}-old`;
    await c.query(
      `INSERT INTO public.tb_s080_inquiries
         (inquiry_id, build_id, type, name, phone, phone_digits, email, body, password_hash, agreed_at, created_at, updated_at)
       VALUES ($1,'1','E',$2,'010-9999-0008','01099990008',$3,$4,'scrypt$x', CURRENT_TIMESTAMP,
               CURRENT_TIMESTAMP - interval '7 months', CURRENT_TIMESTAMP)`,
      [oldId, `${TAG}오래된글`, `${TAG}h@x.co.kr`, `${TAG} 7개월 전 글`]);
    made.push(oldId);
    const oldDetail = json(await get(asOperator, `/admin/inquiries/${oldId}`));
    check('★★ 7개월 전 글은 「보관 기간 지남」이다', oldDetail.inquiry?.retentionPassed === true,
      String(oldDetail.inquiry?.retentionPassed));
    const oldRow = json(await get(asOperator, `/admin/inquiries?q=${encodeURIComponent(`${TAG}오래된글`)}`))
      .items.find((i) => i.inquiryId === oldId);
    check('★ 목록에도 표시가 온다', oldRow?.retentionPassed === true, String(oldRow?.retentionPassed));
    check('★ 6개월이 안 된 글에는 붙지 않는다',
      json(await get(asOperator, `/admin/inquiries/${inqA}`)).inquiry.retentionPassed === false);
    // ★★★ 고객 화면에는 이 표시가 없다 — 응답 본문을 문자열째 훑는다.
    const custList = await app.inject({ method: 'GET', url: '/inquiries' });
    const custHead = await app.inject({ method: 'GET', url: `/inquiries/${oldId}` });
    check('★★★ 고객 목록에 보관 기간 값이 없다', !custList.body.includes('retention'), custList.body.slice(0, 120));
    check('★★★ 고객 글머리에도 없다', !custHead.body.includes('retention'), custHead.body.slice(0, 120));
    check('★★★ 고객 글 보기(unlock)에도 없다',
      !JSON.stringify(phoneOnCustomer).includes('retention'), JSON.stringify(phoneOnCustomer).slice(0, 120));
    check('★ 지나도 고객 목록에는 그대로 있다 — 자동 삭제가 없다',
      json(custList).items.some((i) => i.inquiryId === oldId));

    /* ═══ 22. 글 전체 삭제 — 개인정보 파기 ════════════════════════════════ */
    console.log('\n22. ★★★ 글 전체 삭제 — 개인정보를 지우고, 스팸 집계는 살린다');
    const gone = await httpDel(asOperator, `/admin/inquiries/${inqA}`);
    check('삭제는 204 (본문 없음)', gone.statusCode === 204 && gone.body === '', `${gone.statusCode} ${gone.body}`);
    check('★ 운영자 목록에서 사라진다',
      !json(await get(asOperator, '/admin/inquiries')).items.some((i) => i.inquiryId === inqA));
    check('★ 운영자 상세도 404', (await get(asOperator, `/admin/inquiries/${inqA}`)).statusCode === 404);
    check('★★ 고객 목록에서도 사라진다',
      !json(await app.inject({ method: 'GET', url: '/inquiries' })).items.some((i) => i.inquiryId === inqA));
    check('★★★ 비밀번호로도 열리지 않는다',
      (await post(app, `/inquiries/${inqA}/unlock`, { password: PASSWORD })).statusCode === 401);

    const wiped = (await c.query(
      `SELECT name, phone, email, company_name, body, password_hash, phone_digits, deleted_at
         FROM public.tb_s080_inquiries WHERE inquiry_id = $1`, [inqA])).rows[0];
    check('★★★ 이름·연락처·이메일·회사명·본문이 지워졌다',
      wiped.name === '(삭제)' && wiped.phone === '' && wiped.email === '' &&
      wiped.company_name === null && wiped.body === '(삭제됨)', JSON.stringify(wiped).slice(0, 200));
    check('★★★ 원래 이름·본문이 한 글자도 남지 않았다',
      !JSON.stringify(wiped).includes('운영테스트') && !JSON.stringify(wiped).includes('검증용 본문'),
      JSON.stringify(wiped).slice(0, 200));
    check('★★ 글 비밀번호 해시도 지웠다', wiped.password_hash === 'scrypt$deleted', wiped.password_hash);
    check('지운 시각이 남는다', !!wiped.deleted_at);
    check('★★★ 연락처 자리에는 **해시**만 남는다 — 번호는 남지 않는다',
      wiped.phone_digits === phoneDigitsToken('01099990007') && !wiped.phone_digits.includes('9999'),
      wiped.phone_digits.slice(0, 20));
    const threadGone = (await c.query(
      `SELECT count(*)::int n FROM public.tb_s080_inquiry_messages WHERE inquiry_id = $1`, [inqA])).rows[0].n;
    check('★★★ 스레드(답변·추가 질문)가 통째로 사라졌다', threadGone === 0, String(threadGone));
    const tokenGone = (await c.query(
      `SELECT count(*)::int n FROM public.tb_s080_inquiry_tokens WHERE inquiry_id = $1`, [inqA])).rows[0].n;
    check('★ 열람 토큰도 사라졌다 — 이미 열어 둔 사람도 못 쓴다', tokenGone === 0, String(tokenGone));
    check('두 번째 삭제는 404', (await httpDel(asOperator, `/admin/inquiries/${inqA}`)).statusCode === 404);
    check('★ 지운 글에는 답을 붙일 수 없다 (404)',
      (await post(asOperator, `/admin/inquiries/${inqA}/messages`, { kind: 'text', body: '뒤늦은 답변' }))
        .statusCode === 404);

    /* ═══ 23. 지워도 스팸 집계는 산다 ═════════════════════════════════════ */
    console.log('\n23. ★★★ 지우고 다시 쓰기 — 막혀 있는가');
    // 11번에서 같은 연락처(010-9999-0004)로 오늘 3건을 심었다. 그중 하나를 **운영자가
    // 지우고** 다시 등록해 본다 — 해시가 남지 않으면 2건이 되어 통과해 버린다.
    const purged = await httpDel(asOperator, `/admin/inquiries/${TAG}-d0`);
    check('하루치 글 하나를 지운다 (204)', purged.statusCode === 204, String(purged.statusCode));
    const retry = await post(app, '/inquiries', {
      name: `${TAG}최다건`, phone: '010-9999-0004', email: `${TAG}d@x.co.kr`,
      type: 'E', body: `${TAG} 지우고 다시`, password: PASSWORD, agreed: true,
    });
    check('★★★ 지우고 다시 써도 하루 3건에 막힌다 (429 daily)',
      retry.statusCode === 429 && json(retry).reason === 'daily', `${retry.statusCode} ${retry.body.slice(0, 80)}`);
    const countedAfterPurge = (await c.query(
      `SELECT count(*)::int n FROM public.tb_s080_inquiries WHERE phone_digits = $1`,
      [phoneDigitsToken('01099990004')])).rows[0].n;
    check('★ 지운 글은 해시로 세어진다', countedAfterPurge === 1, String(countedAfterPurge));

    /* ═══ 24. ★★★ 답변 횟수 — 질문 하나에 하나 · 최대 2회 ═════════════════ */
    console.log('\n24. ★★★ 답변 횟수 — 연달아 두 번 답하지 않는다 · 최대 2회 · 수정은 무제한');
    const limited = await post(app, '/inquiries', {
      name: `${TAG}답변제한`, phone: '010-9999-0031', email: `${TAG}k@x.co.kr`,
      type: 'L', body: `${TAG} 답변 횟수를 보는 글`, password: PASSWORD, agreed: true,
    });
    const inqB = json(limited).inquiryId;
    made.push(inqB);
    check('검증용 문의를 만든다 (201)', limited.statusCode === 201 && !!inqB, limited.body.slice(0, 120));

    // ── 답변1 — 원글이 답 안 한 질문이다
    const a1 = await post(asOperator, `/admin/inquiries/${inqB}/messages`, { kind: 'text', body: `${TAG} 답변1` });
    check('★ 답변1 은 들어간다 (201)', a1.statusCode === 201, a1.body.slice(0, 140));

    // ── 답변2 를 바로 — **막힌다**
    const a1again = await post(asOperator, `/admin/inquiries/${inqB}/messages`, { kind: 'text', body: `${TAG} 연달아 답변` });
    check('★★★ 답 안 한 질문이 없으면 답변을 쓸 수 없다 (409)', a1again.statusCode === 409, String(a1again.statusCode));
    check('★★ 이유를 기계용으로도 준다 (reason)', json(a1again).reason === 'nothing_to_answer', String(json(a1again).reason));
    check('★★ 문구가 화면의 잠금 안내와 **같은 문장**이다',
      json(a1again).message === REPLY_BLOCK_MESSAGE.nothing_to_answer, String(json(a1again).message));
    check('★ 막으면서 **수정하라고** 알려 준다', json(a1again).message.includes('수정'), String(json(a1again).message));
    const phoneBlocked = await post(asOperator, `/admin/inquiries/${inqB}/messages`, { kind: 'phone' });
    check('★★ 전화 답변도 같은 규칙으로 막힌다 (409)', phoneBlocked.statusCode === 409, String(phoneBlocked.statusCode));
    const stillOne = json(await get(asOperator, `/admin/inquiries/${inqB}`)).messages;
    check('★ 막혔으니 스레드는 한 줄뿐이다', stillOne.length === 1, `${stillOne.length}줄`);

    // ── 막힌 동안에도 **수정은 된다**
    const editWhileBlocked = await patch(asOperator,
      `/admin/inquiries/${inqB}/messages/${stillOne[0].messageId}`, { body: `${TAG} 답변1 을 고쳤다` });
    check('★★★ 막힌 동안에도 **기존 답변 수정은 된다** (200)', editWhileBlocked.statusCode === 200,
      editWhileBlocked.body.slice(0, 140));
    check('★ 고친 내용이 반영된다', json(editWhileBlocked).messages[0].body.includes('고쳤다'));

    // ── 고객이 추가 질문 → 답변2 가 열린다
    const openB = json(await post(app, `/inquiries/${inqB}/unlock`, { password: PASSWORD }));
    const askB = await post(app, `/inquiries/${inqB}/messages`, { body: `${TAG} 하나 더 묻습니다` },
      { 'x-inquiry-token': openB.token });
    check('고객이 추가 질문을 남긴다 (201)', askB.statusCode === 201, String(askB.statusCode));
    const a2 = await post(asOperator, `/admin/inquiries/${inqB}/messages`, { kind: 'text', body: `${TAG} 답변2` });
    check('★★★ 추가 질문이 오면 답변2 가 열린다 (201)', a2.statusCode === 201, a2.body.slice(0, 140));
    check('★ 답변2 뒤의 상태는 「답변완료」', json(a2).status === 'A', String(json(a2).status));

    // ── 2회를 다 썼다
    const a3 = await post(asOperator, `/admin/inquiries/${inqB}/messages`, { kind: 'text', body: `${TAG} 세 번째 답변` });
    check(`★★★ ${MAX_OPERATOR_ANSWERS}회를 다 쓰면 잠긴다 (409)`, a3.statusCode === 409, String(a3.statusCode));
    check('★★ 이유가 「다 썼다」다', json(a3).reason === 'used_up', String(json(a3).reason));
    check('★★ 문구도 화면과 같다', json(a3).message === REPLY_BLOCK_MESSAGE.used_up, String(json(a3).message));
    const phoneAfterUsed = await post(asOperator, `/admin/inquiries/${inqB}/messages`, { kind: 'phone' });
    check('★ 전화 답변도 잠긴다 (409)', phoneAfterUsed.statusCode === 409, String(phoneAfterUsed.statusCode));

    // ── 잠긴 뒤에도 수정은 계속 된다
    const threadB = json(await get(asOperator, `/admin/inquiries/${inqB}`)).messages;
    check('★ 스레드는 세 줄이다 — 답변1 · 추가 질문 · 답변2',
      threadB.map((m) => m.kind).join(',') === 'text,customer,text', threadB.map((m) => m.kind).join(','));
    const editAfterUsed = await patch(asOperator,
      `/admin/inquiries/${inqB}/messages/${threadB[2].messageId}`, { body: `${TAG} 답변2 를 고쳤다` });
    check('★★★ 2회를 다 쓴 뒤에도 **수정은 계속 된다** (200)', editAfterUsed.statusCode === 200,
      editAfterUsed.body.slice(0, 140));
    check('★ 「수정됨」이 붙는다',
      /^\d{4}-\d{2}-\d{2}$/.test(json(editAfterUsed).messages[2].editedAt ?? ''),
      String(json(editAfterUsed).messages[2].editedAt));

    // ── 고객 화면에서 본 결과
    const seenB = json(await post(app, `/inquiries/${inqB}/unlock`, { password: PASSWORD }));
    check('★★ 고객 화면에 답변이 둘 · 추가 질문이 하나 — 최대 세 줄이다',
      seenB.messages.map((m) => m.kind).join(',') === 'text,customer,text',
      seenB.messages.map((m) => m.kind).join(','));
    check('★★★ 고객 화면의 답변자 이름 둘 다 고정 문구다',
      seenB.messages.filter((m) => m.kind === 'text').every((m) => m.operatorName === OPERATOR_DISPLAY_NAME),
      JSON.stringify(seenB.messages.map((m) => m.operatorName)));

    // ── 기록은 남는다: 표시 이름과 **처리자**는 다른 값이다
    const keptName = (await c.query(
      `SELECT operator_name FROM public.tb_s080_inquiry_messages
        WHERE inquiry_id = $1 AND kind = 'text' ORDER BY created_at LIMIT 1`, [inqB])).rows[0];
    check('★★ DB 에는 **누가 처리했는지**가 남는다 (표시와 별개)', keptName.operator_name === '김대표',
      String(keptName.operator_name));
  } finally {
    console.log('\n정리');
    /* ★★ **id 로도 지운다.** 운영자가 지운 글은 이름이 `(삭제)` 로 바뀌어 `TAG` 표식이
       사라진다 — 이름으로만 지우면 그 껍데기가 표에 계속 남는다. */
    const removed = await c.query(
      `DELETE FROM public.tb_s080_inquiries
        WHERE inquiry_id = ANY($2::text[]) OR name LIKE $1 OR body LIKE $1`,
      [`${TAG}%`, made]);
    const left = (await c.query(
      `SELECT count(*)::int n FROM public.tb_s080_inquiries
        WHERE inquiry_id = ANY($2::text[]) OR name LIKE $1`, [`${TAG}%`, made])).rows[0].n;
    // 메시지·토큰·시도는 ON DELETE CASCADE 로 함께 사라진다 — 그것도 확인한다.
    const orphan = (await c.query(
      `SELECT count(*)::int n FROM public.tb_s080_inquiry_messages
        WHERE message_id LIKE $1 OR inquiry_id = ANY($2::text[])`, [`${TAG}%`, made])).rows[0].n;
    check(`검증 데이터가 남지 않았다 (글 ${removed.rowCount}건 삭제)`, left === 0 && orphan === 0,
      `글 ${left} · 메시지 ${orphan}`);
    await c.end();
    await closePool();
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`검사 ${pass + fail}항목 — 통과 ${pass} · 실패 ${fail}`);
  const short = itemCountGate({ expected: EXPECTED_ITEMS, actual: pass + fail, script: 'verify-inquiry.js' });
  if (fail > 0) {
    console.log('실패 항목:');
    for (const f of failures) console.log(`  · ${f}`);
  }
  if (fail > 0 || short) process.exit(1);
  console.log('✔ 문의상담 검증 전부 통과');
})().catch((e) => {
  console.error('✘ 검증 중 오류:', e.message);
  process.exit(1);
});
