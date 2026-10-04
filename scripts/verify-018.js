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

const { itemCountGate } = require('./verify-count.js');

/**
 * 기대 항목 수 — 모자라면 **실패**다. 항목이 조용히 사라지는 것을 막는 유일한 장치이고,
 * 경위는 `verify-count.js` 머리말에 있다. 항목을 늘리면 끝에서 이 수를 고치라고 알려 준다.
 */
const EXPECTED_ITEMS = 4;
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

  /*
   * ══════════════════════════════════════════════════════════════════════
   * ★★ 대조군 — 위 둘이 **공짜로 통과하는 것**을 막는다
   * ══════════════════════════════════════════════════════════════════════
   * 위 두 검사는 「어긋난 행이 0건」이다. 회원구분이 든 회사가 **한 곳도 없으면
   * 둘 다 저절로 통과한다.** 그래서 「셀 것이 있었다」를 함께 말해야 한다.
   *
   * ★ 예전에는 여기서 `MOCK_TENANT_9001` 이 `'P'` 인지를 봤다. 018 이 그 회사의
   *   「개인사업자」를 `'P'` 로 바꿨으니 당시에는 맞는 말이었다. 그런데 그 값은
   *   **계약 폼에서 운영자가 고칠 수 있다.** 실제로 주식회사(R)로 바뀌었고, 그
   *   순간 이 항목은 018 과 아무 상관 없이 영원히 실패하기 시작했다
   *   (2026-10-04 · `verify-cont17.js` [7] 도 같은 병이었다).
   *
   *   **마이그레이션 검증은 특정 회사의 지금 값에 기대면 안 된다.** 018 이 보장한
   *   것은 「회원구분 칸에 표시명이 아니라 코드값이 들어간다」이지 「에스원3DP 가
   *   개인사업자다」가 아니다.
   */
  const filled = await one(`
    SELECT count(*)::int n FROM public.tb_s080_companies
     WHERE member_type IS NOT NULL AND btrim(member_type) <> ''`);
  check(
    '대조군 — 회원구분이 든 회사가 1곳 이상이다 (0곳이면 위 둘은 공짜로 통과한다)',
    filled.n >= 1,
    `${filled.n}곳`,
  );

  // 값이 의미를 유지했는지 — P 의 이름이 「개인사업자」여야 이 이관이 옳다(017).
  const pName = await one(`SELECT name FROM public.tb_s080_codes_line
                            WHERE category='MEMBER_TYPE' AND use_tp='000' AND code='P'`);
  check('P 의 이름이 여전히 개인사업자다', !!pName && pName.name === '개인사업자', pName ? pName.name : '행 없음');

  console.log(`\n통과 ${pass} · 실패 ${fail}`);
  // ★ 항목이 사라졌는지 본다 — 통과·실패만 세면 **덜 돈 것**을 알 수 없다.
  const short = itemCountGate({ expected: EXPECTED_ITEMS, actual: pass + fail, script: 'verify-018.js' });
  await c.end();
  process.exit(fail || short ? 1 : 0);
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
