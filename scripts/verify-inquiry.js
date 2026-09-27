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
 * ★ 검증용 데이터는 새로 만들어 쓰고 지운다(`name` 에 표식을 넣는다).
 * ★ 사용자가 띄운 서버는 건드리지 않는다 — 세션 훅째 Fastify 를 따로 세운다.
 *
 * 사용: npx tsx scripts/verify-inquiry.js
 */
import fs from 'node:fs';
import Fastify from 'fastify';
import { Client } from 'pg';
import { itemCountGate } from './verify-count.js';
import { registerSessionHook } from '../packages/api/src/session/hook.ts';
import { registerInquiryRoutes } from '../packages/api/src/routes/inquiry.ts';
import { registerBookingRoutes } from '../packages/api/src/routes/booking.ts';
import { closePool } from '../packages/api/src/db/pool.ts';

const readEnv = (p) =>
  Object.fromEntries(
    fs.readFileSync(p, 'utf8').split(/\r?\n/)
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
  );
const env = readEnv('.env');

/** 기대 항목 수 — 모자라면 **실패**다(`verify-count.js` 머리말). */
const EXPECTED_ITEMS = 53;

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
  return app;
}
const json = (res) => { try { return JSON.parse(res.body); } catch { return { __raw: res.body }; } };
const post = (app, url, payload, headers) =>
  app.inject({ method: 'POST', url, payload, headers: { 'content-type': 'application/json', ...headers } });

(async () => {
  const c = new Client({
    host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER,
    password: env.DB_PASSWORD, database: env.DB_NAME, connectionTimeoutMillis: 15000,
  });
  await c.connect();
  const app = buildApp();
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
    // 운영자 답변은 이번 범위 밖(s0300200080)이라 DB 에 직접 넣어 규칙만 본다.
    await c.query(
      `INSERT INTO public.tb_s080_inquiry_messages (message_id, inquiry_id, kind, body, operator_name)
       VALUES ($1, $2, 'text', $3, '이정희')`, [`${TAG}-m1`, createdId, `${TAG} 답변입니다`]);
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
  } finally {
    console.log('\n정리');
    const del = await c.query(`DELETE FROM public.tb_s080_inquiries WHERE name LIKE $1 OR body LIKE $1`, [`${TAG}%`]);
    const left = (await c.query(
      `SELECT count(*)::int n FROM public.tb_s080_inquiries WHERE name LIKE $1`, [`${TAG}%`])).rows[0].n;
    // 메시지·토큰·시도는 ON DELETE CASCADE 로 함께 사라진다 — 그것도 확인한다.
    const orphan = (await c.query(
      `SELECT count(*)::int n FROM public.tb_s080_inquiry_messages WHERE message_id LIKE $1`, [`${TAG}%`])).rows[0].n;
    check(`검증 데이터가 남지 않았다 (글 ${del.rowCount}건 삭제)`, left === 0 && orphan === 0, `글 ${left} · 메시지 ${orphan}`);
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
