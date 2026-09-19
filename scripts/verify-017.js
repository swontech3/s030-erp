/**
 * 017_member_type_individual.sql 검증.
 *
 * ★ 「Z 가 000 에만 있는지」를 따로 본다. 001·002 는 법인 서류를 만드는 파티션이라
 *   개인이 섞이면 법인설립 화면의 법인종류 셀렉트에 「개인」이 뜬다.
 *
 * 사용: node scripts/verify-017.js .env
 */
const fs = require('fs');
const { Client } = require('pg');

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

const env = readEnv(process.argv[2] || '.env');

let pass = 0;
let fail = 0;

function check(label, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  ✔ ${label}`);
  } else {
    fail++;
    console.log(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

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
  const one = async (sql, p) => (await c.query(sql, p)).rows[0];

  console.log('\n017 — 회원구분: 개인사업자(P) · 개인(Z)');

  const list = await one(`SELECT string_agg(code || '=' || name, ' · ' ORDER BY sort_order) s
                            FROM public.tb_s080_codes_line
                           WHERE category='MEMBER_TYPE' AND use_tp='000' AND is_active = true`);
  check(
    '공통 파티션이 6종이고 순서가 맞다',
    list.s ===
      'R=주식회사 · A=유한회사 · C=농/어업회사법인 · S=사회적 기업/협동조합 · P=개인사업자 · Z=개인',
    list.s,
  );

  const p = await one(`SELECT name FROM public.tb_s080_codes_line
                        WHERE category='MEMBER_TYPE' AND use_tp='000' AND code='P'`);
  check('P 가 개인사업자다', p && p.name === '개인사업자', p ? p.name : '행 없음');

  // ★ Z 는 공통에만 있어야 한다. 001·002 는 법인 서류용이다.
  const z = await one(`SELECT string_agg(use_tp, ',' ORDER BY use_tp) s, count(*)::int n
                         FROM public.tb_s080_codes_line WHERE category='MEMBER_TYPE' AND code='Z'`);
  check('Z 가 use_tp=000 에만 있다', z.n === 1 && z.s === '000', `${z.n}행 (${z.s})`);

  const sys = await one(`SELECT is_system FROM public.tb_s080_codes_line
                          WHERE category='MEMBER_TYPE' AND code='Z' AND use_tp='000'`);
  check('Z 는 시스템 코드다(화면 로직이 직접 본다)', !!sys && sys.is_system === true);

  // 법인 파티션에 개인 계열이 새어 들어가지 않았는지
  const leak = await one(`SELECT count(*)::int n FROM public.tb_s080_codes_line
                           WHERE category='MEMBER_TYPE' AND use_tp <> '000' AND code IN ('P','Z')`);
  check('001·002 에 개인 계열(P·Z)이 없다', leak.n === 0, `${leak.n}건`);

  // 013 의 FK 가 살아 있는지 — Z 를 넣을 때 파티션이 있어야만 통과한다
  const fk = await one(`SELECT count(*)::int n FROM public.tb_s080_code_categories
                         WHERE category='MEMBER_TYPE' AND use_tp='000'`);
  check('MEMBER_TYPE 공통 파티션이 카테고리에 있다', fk.n === 1);

  console.log(`\n통과 ${pass} · 실패 ${fail}`);
  await c.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
