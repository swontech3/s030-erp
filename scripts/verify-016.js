/**
 * 016_email_domain.sql 검증.
 *
 * ★ `code = name` 을 따로 본다. 도메인은 화면이 그대로 이메일에 붙이는 값이라
 *   둘이 어긋나면 **메일 주소가 틀리게 저장된다.** 행 수만 세면 못 잡는다.
 *
 * 사용: node scripts/verify-016.js .env
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

  console.log('\n016 — 이메일 도메인 코드');

  const master = await one(
    `SELECT count(*)::int n FROM public.tb_s080_code_masters WHERE category='EMAIL_DOMAIN'`,
  );
  check('EMAIL_DOMAIN 마스터가 있다', master.n === 1);

  const cat = await one(`SELECT count(*)::int n FROM public.tb_s080_code_categories
                          WHERE category='EMAIL_DOMAIN' AND use_tp='000'`);
  check('공통 파티션(000)이 있다', cat.n === 1);

  const list = await one(`SELECT string_agg(code, ',' ORDER BY sort_order) s
                            FROM public.tb_s080_codes_line
                           WHERE category='EMAIL_DOMAIN' AND is_active = true`);
  check(
    '도메인 5종이 시안 순서대로다',
    list.s === 'naver.com,gmail.com,daum.net,hanmail.net,nate.com',
    list.s,
  );

  // ★ 화면이 code 를 그대로 이메일에 붙인다. 둘이 어긋나면 주소가 틀리게 저장된다.
  const mismatch = await one(`SELECT count(*)::int n FROM public.tb_s080_codes_line
                               WHERE category='EMAIL_DOMAIN' AND code <> name`);
  check('code 와 name 이 같다', mismatch.n === 0, `${mismatch.n}건`);

  // 시안 1차에 있던 예시 입주사 도메인. 기본 선택으로 남으면 그대로 저장돼 오등록이 난다.
  const sample = await one(`SELECT count(*)::int n FROM public.tb_s080_codes_line
                             WHERE category='EMAIL_DOMAIN' AND code LIKE '%bridgelab%'`);
  check('예시 입주사 도메인이 들어가 있지 않다', sample.n === 0, `${sample.n}건`);

  // 「선택하세요」·「직접입력」은 코드가 아니라 Select 의 조작 장치다.
  const ui = await one(`SELECT count(*)::int n FROM public.tb_s080_codes_line
                         WHERE category='EMAIL_DOMAIN' AND (btrim(code)='' OR code='custom')`);
  check('placeholder·직접입력이 코드로 들어가 있지 않다', ui.n === 0, `${ui.n}건`);

  const editable = await one(`SELECT count(*)::int n FROM public.tb_s080_codes_line
                               WHERE category='EMAIL_DOMAIN' AND is_system = true`);
  check('운영자가 지울 수 있다(is_system=false)', editable.n === 0, `is_system 참 ${editable.n}건`);

  console.log(`\n통과 ${pass} · 실패 ${fail}`);
  await c.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
