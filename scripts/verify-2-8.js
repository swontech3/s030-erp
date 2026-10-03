/**
 * 페이즈 1 · 2-8 검증 — 지시서 3장 "인증 · 세션" 완료 기준.
 *
 * 두 서버가 떠 있어야 한다:
 *   api  →  node_modules/.bin/tsx packages/api/src/index.ts   (127.0.0.1:3001)
 *   web  →  packages/web 에서 next dev                        (localhost:3000)
 * web 이 없으면 쿠키 관련 항목만 건너뛰고 나머지를 검사한다.
 *
 * 쓰기는 세션 테이블과 shadow 로그에만 일어난다. 업무 데이터는 건드리지 않는다.
 * 사용: node scripts/verify-2-8.js .env
 */
const fs = require('fs');
const crypto = require('crypto');
const { Client } = require('pg');

const API = 'http://127.0.0.1:3001';
const WEB = 'http://localhost:3000';
const PASSWORD = 'erp1234!';

const env = Object.fromEntries(
  fs.readFileSync(process.argv[2] || '.env', 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

const c = new Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });

const { itemCountGate } = require('./verify-count.js');

/** 기대 항목 수 — 모자라면 **실패**다(`verify-count.js` 머리말). */
const EXPECTED_ITEMS = 21;

let failed = 0;
/** ★ 몇 항목이 **돌았는가** — 통과·실패를 같이 센다. 이것이 없으면 덜 돈 것을 알 수 없다. */
let ran = 0;
const ok = (id, name, detail) => { ran++; console.log(`OK  ${id} ${name}${detail ? ' — ' + detail : ''}`); };
const bad = (id, name, detail) => { ran++; failed++; console.error(`X   ${id} ${name}${detail ? ' — ' + detail : ''}`); };
const check = (cond, id, name, detail) => (cond ? ok : bad)(id, name, detail);

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

async function apiLogin(email) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  return { status: res.status, body: await res.json() };
}

(async () => {
  await c.connect();

  // --- A1 홈 분기 4종 ------------------------------------------------------
  const expected = {
    'admin@s-wontech.co.kr': '/dashboard',
    'operator@s-wontech.co.kr': '/dashboard',
    'tenant@test.com': '/booking',
    'noaccess@test.com': '/no-access',
  };
  const sessions = {};
  for (const [email, home] of Object.entries(expected)) {
    const r = await apiLogin(email);
    sessions[email] = r.body;
    check(r.status === 200 && r.body.home === home, 'A1', `홈 분기 ${email}`, `[${r.status}] ${r.body.home} (기대 ${home})`);
  }

  // --- A2 잘못된 비밀번호는 401 -------------------------------------------
  {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'tenant@test.com', password: 'wrong' }),
    });
    check(res.status === 401, 'A2', '잘못된 비밀번호 → 401', String(res.status));
  }

  // --- A3 세션 쿠키 없이 보호 라우트 → 401 (리다이렉트가 아니라) ----------
  {
    const res = await fetch(`${API}/auth/me`, { redirect: 'manual' });
    check(res.status === 401, 'A3', '쿠키 없이 /auth/me → 401', String(res.status));
  }

  // --- A4 companyId 역조회 ------------------------------------------------
  {
    const tenant = sessions['tenant@test.com'];
    const linked = await c.query('SELECT company_id FROM tb_s080_companies WHERE link_s020_org_id = 9001');
    check(
      !!tenant.companyId && !!linked.rows[0] && tenant.companyId === linked.rows[0].company_id,
      'A4', 'companyId = link_s020_org_id 역조회', String(tenant.companyId));
  }

  // --- A5 연결 없는 org → companyId null (예외 아님, 로그인은 성공) --------
  {
    const noaccess = sessions['noaccess@test.com'];
    check(noaccess.companyId === null && noaccess.screens.length === 0,
      'A5', '미연결 org → companyId null · 빈 스코프', `companyId=${noaccess.companyId}`);
  }

  // --- A6 DB 에는 해시만, 토큰은 암호화 -----------------------------------
  {
    const raw = sessions['tenant@test.com'].erpSid;
    const row = (await c.query(
      'SELECT erp_sid, bbiyong_access_encrypted FROM tb_s080_auth_session WHERE erp_sid = $1',
      [sha(raw)])).rows[0];
    check(!!row, 'A6a', 'erp_sid 는 해시로 저장', row ? `${row.erp_sid.slice(0, 12)}...` : '행 없음');
    const enc = row ? row.bbiyong_access_encrypted : '';
    check(enc.startsWith('v1.') && !enc.includes('mock-access'),
      'A6b', '삐용 토큰은 암호문으로 저장', enc.slice(0, 24) + '...');
    const rawStored = await c.query('SELECT count(*)::int n FROM tb_s080_auth_session WHERE erp_sid = $1', [raw]);
    check(rawStored.rows[0].n === 0, 'A6c', '원문 sid 는 DB 에 없음');
  }

  // --- A7 revoked_at 은 캐시를 우회한다 -----------------------------------
  {
    const raw = sessions['admin@s-wontech.co.kr'].erpSid;
    const cookie = `erp_sid=${raw}`;
    const before = await fetch(`${API}/auth/me`, { headers: { cookie } });   // 캐시 채우기
    await fetch(`${API}/auth/me`, { headers: { cookie } });
    await c.query('UPDATE tb_s080_auth_session SET revoked_at = now() WHERE erp_sid = $1', [sha(raw)]);
    const after = await fetch(`${API}/auth/me`, { headers: { cookie } });     // 30초 기다리지 않는다
    check(before.status === 200 && after.status === 401,
      'A7', 'DB 직접 revoke 직후 즉시 401 (30초 캐시 우회)', `${before.status} -> ${after.status}`);
  }

  // --- A8 shadow 로그 — 이 호출로 정확히 1건 늘어야 한다(전체 건수는 한 번 쌓이면 영원히 통과한다) ---
  {
    const raw = sessions['tenant@test.com'].erpSid;
    const countDeny = async () => (await c.query(
      `SELECT count(*)::int n FROM tb_s080_acl_shadow_log WHERE s020_member_id = 2001 AND screen_code = 's030000060' AND verdict = 'DENY' AND enforced = false`)).rows[0].n;
    const before = await countDeny();
    await fetch(`${API}/acl/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `erp_sid=${raw}` },
      body: JSON.stringify({ screenCode: 's030000060', action: 'VIEW', route: '/dashboard' }),
    });
    await new Promise((r) => setTimeout(r, 300)); // 기록은 fire-and-forget 이라 잠깐 기다린다
    const after = await countDeny();
    check(after === before + 1, 'A8', 'shadow 로그에 이 호출의 DENY 1건 기록', `${before} -> ${after}`);
    const canDelete = (await c.query("SELECT has_table_privilege('erp_app','public.tb_s080_acl_shadow_log','DELETE') AS d")).rows[0].d;
    check(canDelete === false, 'A8b', 'shadow 로그는 erp_app 에게 append-only (DELETE 권한 없음)', String(canDelete));
  }

  // --- A9·A10 web 경유 — 쿠키에 삐용 토큰이 없어야 한다 -------------------
  let webUp = true;
  try { await fetch(`${WEB}/login`, { redirect: 'manual' }); } catch { webUp = false; }
  if (!webUp) {
    console.log('--  A9·A10 건너뜀 — web(3000) 미기동');
  } else {
    // ★ 웹 라우트는 출처를 본다(CSRF). 브라우저처럼 Origin 을 실어 보낸다.
    const res = await fetch(`${WEB}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: WEB },
      body: JSON.stringify({ email: 'tenant@test.com', password: PASSWORD }),
    });
    const csrf = await fetch(`${WEB}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'text/plain', origin: 'https://evil.example' },
      body: JSON.stringify({ email: 'tenant@test.com', password: PASSWORD }),
    });
    check(csrf.status === 403 && !csrf.headers.getSetCookie().length, 'A11', '교차 출처 text/plain 로그인 → 403, 쿠키 없음', String(csrf.status));
    const setCookies = res.headers.getSetCookie();
    check(res.status === 200, 'A9', 'web 로그인 200', String(res.status));
    const body = await res.json();
    check(!('erpSid' in body), 'A9a', '응답 본문에 세션 원문 없음');
    check(setCookies.length === 1 && setCookies[0].startsWith('erp_sid='),
      'A9b', '쿠키는 erp_sid 하나뿐 (삐용 토큰 없음)', setCookies.map(s => s.split('=')[0]).join(', '));
    check(/HttpOnly/i.test(setCookies[0] || '') && /SameSite=Lax/i.test(setCookies[0] || ''),
      'A9c', '쿠키는 HttpOnly · SameSite=Lax');

    const sid = (setCookies[0] || '').split(';')[0].split('=')[1];
    const csrfLogout = await fetch(`${WEB}/api/auth/logout`, {
      method: 'POST', headers: { cookie: `erp_sid=${sid}`, origin: 'https://evil.example' }, redirect: 'manual',
    });
    check(csrfLogout.status === 403, 'A12', '교차 출처 로그아웃 → 403 (세션 유지)', String(csrfLogout.status));
    const logout = await fetch(`${WEB}/api/auth/logout`, {
      method: 'POST', headers: { cookie: `erp_sid=${sid}`, origin: WEB }, redirect: 'manual',
    });
    const gone = (await c.query(
      'SELECT revoked_at FROM tb_s080_auth_session WHERE erp_sid = $1', [sha(decodeURIComponent(sid))])).rows[0];
    check(logout.status === 303 && (logout.headers.get('location') || '').endsWith('/login') && !!gone && gone.revoked_at !== null,
      'A10', '로그아웃 → 303 /login + revoked_at 설정', `${logout.status} ${logout.headers.get('location')}`);
  }

  await c.end();
  console.log(failed === 0 ? `\n통과 ${ran}항목` : `\n실패 ${failed}건 / ${ran}항목`);
  // ★ 항목이 사라졌는지 본다 — 통과·실패만 세면 **덜 돈 것**을 알 수 없다.
  const short = itemCountGate({ expected: EXPECTED_ITEMS, actual: ran, script: 'verify-2-8.js' });
  process.exit(failed === 0 && !short ? 0 : 1);
})().catch(async e => {
  console.error('X 검증 중 오류:', e.message);
  try { await c.end(); } catch {}
  process.exit(1);
});
