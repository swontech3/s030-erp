/**
 * 018_company_member_type_code.sql 검증.
 *
 * ★ 「코드가 아닌 값이 남아 있지 않은가」를 본다. 특정 회사의 값이 'P' 인지만 보면
 *   행이 늘었을 때 못 잡는다 — 확인할 것은 **컬럼 전체가 코드 체계 안에 있는가**다.
 *
 * 사용: node scripts/verify-018.js .env
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

  console.log('\n018 — 회사의 회원구분이 코드값인가');

  const orphan = await one(`
    SELECT count(*)::int n,
           string_agg(DISTINCT c.member_type, ', ') vals
      FROM public.tb_s080_companies c
     WHERE c.member_type IS NOT NULL
       AND btrim(c.member_type) <> ''
       AND NOT EXISTS (SELECT 1 FROM public.tb_s080_codes_line l
                        WHERE l.category = 'MEMBER_TYPE' AND l.use_tp = '000'
                          AND l.code = c.member_type)`);
  check('코드 목록에 없는 회원구분이 0건이다', orphan.n === 0, `${orphan.n}건 (${orphan.vals})`);

  // ★ 표시명이 그대로 남아 있는 경우를 따로 본다. 위 검사로도 걸리지만, 실패했을 때
  //   "코드로 안 바뀐 것"인지 "엉뚱한 값"인지 구분되어야 고칠 방향이 보인다.
  const asName = await one(`
    SELECT count(*)::int n FROM public.tb_s080_companies c
     WHERE EXISTS (SELECT 1 FROM public.tb_s080_codes_line l
                    WHERE l.category = 'MEMBER_TYPE' AND l.use_tp = '000' AND l.name = c.member_type)`);
  check('표시명이 그대로 들어간 행이 0건이다', asName.n === 0, `${asName.n}건`);

  // 018 이 실제로 바꾼 행. 시드가 1행이라 지금은 여기서 확인된다.
  const seed = await one(`SELECT member_type FROM public.tb_s080_companies
                           WHERE company_id = 'MOCK_TENANT_9001'`);
  check(
    'MOCK_TENANT_9001 이 P(개인사업자)다',
    !!seed && seed.member_type === 'P',
    seed ? seed.member_type : '행 없음',
  );

  // 값이 의미를 유지했는지 — P 의 이름이 「개인사업자」여야 이 이관이 옳다(017).
  const pName = await one(`SELECT name FROM public.tb_s080_codes_line
                            WHERE category='MEMBER_TYPE' AND use_tp='000' AND code='P'`);
  check('P 의 이름이 여전히 개인사업자다', !!pName && pName.name === '개인사업자', pName ? pName.name : '행 없음');

  console.log(`\n통과 ${pass} · 실패 ${fail}`);
  await c.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
