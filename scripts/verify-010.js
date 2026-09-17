/**
 * 010_status_history.sql 검증.
 *
 * 마이그레이션 파일 하단의 「검증」 5항목을 실제로 돌린다.
 *
 * ★★ 두 역할로 붙는다. RLS 는 **postgres 를 막지 않는다**(superuser 는 정책을
 *    우회한다). 정책이 실제로 무엇을 막는지는 erp_app 으로 붙어야만 보인다.
 *    postgres 로만 확인하고 "통과"로 읽은 전례가 이 프로젝트에 있다.
 *
 * 사용: node scripts/verify-010.js .env packages/api/.env
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

const admin = readEnv(process.argv[2] || '.env');
const app = readEnv(process.argv[3] || 'packages/api/.env');

const TABLE = 'public.tb_s080_contract_status_history';
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
  const pg = new Client({
    host: admin.DB_HOST,
    port: +admin.DB_PORT,
    user: admin.DB_USER,
    password: admin.DB_PASSWORD,
    database: admin.DB_NAME,
  });
  await pg.connect();

  // 계약은 건물·회사에 FK 가 걸려 있다. 가짜 ID 로는 INSERT 가 안 되므로
  // 실제 값을 하나씩 빌려 쓴다(넣은 것은 전부 되돌리거나 지운다).
  const fk = await pg.query(
    `SELECT (SELECT build_id FROM public.tb_s080_buildings LIMIT 1)   AS build_id,
            (SELECT company_id FROM public.tb_s080_companies LIMIT 1) AS company_id`,
  );
  const BUILD_ID = fk.rows[0].build_id;
  const COMPANY_ID = fk.rows[0].company_id;
  if (!BUILD_ID || !COMPANY_ID) {
    console.error('✘ 건물 또는 회사가 0건이라 검증용 계약을 만들 수 없다');
    process.exit(1);
  }
  console.log(`검증용 FK — build_id=${BUILD_ID} · company_id=${COMPANY_ID}`);

  // ── 1. 폭이 넓어졌는지 ────────────────────────────────────────────────────
  console.log('\n1. 상태 컬럼 폭');
  const cols = await pg.query(
    `SELECT column_name, character_maximum_length len
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name='tb_s080_contract_status_history'
        AND column_name IN ('from_status','to_status')
      ORDER BY column_name`,
  );
  for (const r of cols.rows) {
    check(`${r.column_name} 이 varchar(20)`, r.len === 20, `지금 varchar(${r.len})`);
  }

  // ── 2. 'confirmed' 가 실제로 들어가는지 ───────────────────────────────────
  // 계약이 0건이라 FK 를 만족시킬 계약을 먼저 넣고, 전부 ROLLBACK 한다.
  console.log("\n2. 'confirmed' 저장 (넣고 되돌린다)");
  try {
    await pg.query('BEGIN');
    await pg.query(
      `INSERT INTO public.tb_s080_contracts
         (contract_id, build_id, company_id, status, start_date, end_date, updated_at)
       VALUES ('verify010', $1, $2, 'draft', now(), now(), now())`,
      [BUILD_ID, COMPANY_ID],
    );
    await pg.query(
      `INSERT INTO ${TABLE} (history_id, contract_id, from_status, to_status)
       VALUES ('verify010-h', 'verify010', 'draft', 'confirmed')`,
    );
    const { rows } = await pg.query(
      `SELECT to_status FROM ${TABLE} WHERE history_id='verify010-h'`,
    );
    check("from='draft' → to='confirmed' 가 들어간다", rows[0]?.to_status === 'confirmed');

    // ── 3. 어휘 밖의 값이 막히는지 ──────────────────────────────────────────
    console.log('\n3. 어휘 밖 값 차단');
    // ★ 실패를 기대하는 문장은 SAVEPOINT 로 감싼다. 제약 위반이 나면 트랜잭션 전체가
    //   aborted 가 되어 **뒤따르는 검사가 전부 못 돈다** — 실제로 한 번 그렇게 났다.
    await pg.query('SAVEPOINT expect_fail');
    try {
      await pg.query(
        `INSERT INTO ${TABLE} (history_id, contract_id, to_status)
         VALUES ('verify010-bad', 'verify010', 'A')`,
      );
      check("레거시 값 'A' 가 거부된다", false, '들어가 버렸다');
      await pg.query('RELEASE SAVEPOINT expect_fail');
    } catch (e) {
      check("레거시 값 'A' 가 거부된다", e.code === '23514', `code=${e.code}`);
      await pg.query('ROLLBACK TO SAVEPOINT expect_fail');
    }

    // 최초 생성(from_status NULL)은 허용돼야 한다.
    try {
      await pg.query(
        `INSERT INTO ${TABLE} (history_id, contract_id, from_status, to_status)
         VALUES ('verify010-new', 'verify010', NULL, 'draft')`,
      );
      check('최초 생성(from_status NULL)은 허용된다', true);
    } catch (e) {
      check('최초 생성(from_status NULL)은 허용된다', false, e.message);
    }
  } finally {
    await pg.query('ROLLBACK');
  }

  const left = await pg.query(`SELECT count(*)::int n FROM ${TABLE}`);
  check('검증 데이터가 남지 않았다', left.rows[0].n === 0, `${left.rows[0].n}행 남음`);
  await pg.end();

  // ── 4·5. erp_app 으로 붙어서 RLS·권한 확인 ────────────────────────────────
  console.log('\n4. RLS — 운영사 전용 (erp_app 으로 접속)');
  const erp = new Client({ connectionString: app.ERP_DATABASE_URL });
  await erp.connect();
  const who = await erp.query('SELECT current_user u');
  check(`erp_app 으로 붙었다`, who.rows[0].u === 'erp_app', `지금 ${who.rows[0].u}`);

  const rls = await erp.query(
    `SELECT relrowsecurity FROM pg_class WHERE oid = 'tb_s080_contract_status_history'::regclass`,
  );
  check('RLS 가 켜져 있다', rls.rows[0].relrowsecurity === true);

  // 정책이 실제로 무엇을 하는지는 행을 넣어 봐야 안다. postgres 로 1행 심고
  // erp_app 이 역할별로 어떻게 보는지 확인한 뒤 지운다.
  const seed = new Client({
    host: admin.DB_HOST, port: +admin.DB_PORT, user: admin.DB_USER,
    password: admin.DB_PASSWORD, database: admin.DB_NAME,
  });
  await seed.connect();
  await seed.query(
    `INSERT INTO public.tb_s080_contracts (contract_id, build_id, company_id, status, start_date, end_date, updated_at)
     VALUES ('verify010b', $1, $2, 'draft', now(), now(), now())`,
    [BUILD_ID, COMPANY_ID],
  );
  await seed.query(
    `INSERT INTO ${TABLE} (history_id, contract_id, to_status) VALUES ('verify010b-h', 'verify010b', 'draft')`,
  );

  try {
    await erp.query('BEGIN');
    await erp.query(`SELECT set_config('app.current_role', 'tenant', true)`);
    await erp.query(`SELECT set_config('app.current_company_id', $1, true)`, [COMPANY_ID]);
    const asTenant = await erp.query(`SELECT count(*)::int n FROM ${TABLE}`);
    // ★ 계약의 company_id 와 **같은 회사**를 스코프로 줬는데도 0행이어야 한다 —
    //   회사 스코프가 아니라 운영사 전용이기 때문이다. 여기가 이 검증의 핵심이다.
    check('입주사 세션은 0행을 본다 (자기 회사 계약이어도)', asTenant.rows[0].n === 0, `${asTenant.rows[0].n}행 보임`);
    await erp.query('ROLLBACK');

    await erp.query('BEGIN');
    await erp.query(`SELECT set_config('app.current_role', 'operator', true)`);
    const asOperator = await erp.query(`SELECT count(*)::int n FROM ${TABLE}`);
    check('운영사 세션은 보인다', asOperator.rows[0].n === 1, `${asOperator.rows[0].n}행 보임`);
    await erp.query('ROLLBACK');

    // ── 5. 감사 이력이라 지우지 못한다 ─────────────────────────────────────
    console.log('\n5. 권한 — 감사 이력은 지우지 못한다');
    await erp.query('BEGIN');
    await erp.query(`SELECT set_config('app.current_role', 'operator', true)`);
    try {
      await erp.query(`DELETE FROM ${TABLE}`);
      check('erp_app 이 DELETE 하지 못한다', false, '지워졌다');
    } catch (e) {
      check('erp_app 이 DELETE 하지 못한다', e.code === '42501', `code=${e.code}`);
    }
    await erp.query('ROLLBACK');

    await erp.query('BEGIN');
    await erp.query(`SELECT set_config('app.current_role', 'operator', true)`);
    try {
      await erp.query(`UPDATE ${TABLE} SET to_status='cancelled'`);
      check('erp_app 이 UPDATE 하지 못한다', false, '바뀌었다');
    } catch (e) {
      check('erp_app 이 UPDATE 하지 못한다', e.code === '42501', `code=${e.code}`);
    }
    await erp.query('ROLLBACK');

    await erp.query('BEGIN');
    await erp.query(`SELECT set_config('app.current_role', 'operator', true)`);
    try {
      await erp.query(
        `INSERT INTO ${TABLE} (history_id, contract_id, to_status) VALUES ('verify010b-i','verify010b','confirmed')`,
      );
      check('erp_app 이 INSERT 는 한다 — 이력을 쌓아야 하므로', true);
    } catch (e) {
      check('erp_app 이 INSERT 는 한다 — 이력을 쌓아야 하므로', false, `${e.code} ${e.message}`);
    }
    await erp.query('ROLLBACK');
  } finally {
    await erp.end();
    // 심어 둔 검증 데이터 제거 (history 는 계약 CASCADE 로 함께 지워진다)
    await seed.query(`DELETE FROM public.tb_s080_contracts WHERE contract_id='verify010b'`);
    const after = await seed.query(`SELECT count(*)::int n FROM ${TABLE}`);
    check('검증 데이터가 남지 않았다 (2)', after.rows[0].n === 0, `${after.rows[0].n}행 남음`);
    await seed.end();
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`검사 ${pass + fail}항목 — 통과 ${pass} · 실패 ${fail}`);
  if (fail > 0) process.exit(1);
  console.log('✔ 010 검증 전부 통과');
})().catch((e) => {
  console.error('✘ 검증 중 오류:', e.message);
  process.exit(1);
});
