/**
 * 020_contract_files.sql 검증.
 *
 * ★ 「적용됐다」가 아니라 **「어긋날 수 없게 됐다」**를 본다. 구조가 바뀐 것만 보면
 *   유일 인덱스가 실제로 두 번째 INSERT 를 막는지는 알 수 없다 — 실제로 넣어 본다
 *   (트랜잭션 안에서 하고 롤백한다).
 *
 * 사용: node scripts/verify-020.js .env
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

  console.log('\n020 — tb_cm_file 이 첨부 서류를 받을 수 있는 상태인가');

  // ① 실물 없는 레거시 기록이 사라졌는가
  const n = await one(`SELECT count(*)::int n FROM public.tb_cm_file`);
  check('실물 없는 레거시 48행이 없다', n.n === 0, `현재 ${n.n}행`);

  // ② 만료되는 값을 담는 칸이 없는가
  const url = await one(`
    SELECT count(*)::int n FROM information_schema.columns
     WHERE table_schema='public' AND table_name='tb_cm_file' AND column_name='storage_url'`);
  check('storage_url 컬럼이 없다 — 서명 URL 을 저장할 자리가 아예 없다', url.n === 0);

  const path = await one(`
    SELECT is_nullable FROM information_schema.columns
     WHERE table_schema='public' AND table_name='tb_cm_file' AND column_name='storage_path'`);
  check('storage_path 는 남아 있고 NOT NULL 이다', path && path.is_nullable === 'NO', JSON.stringify(path));

  // ③ 운영사 전용 — 정책이 걸렸는가
  const rls = await one(`
    SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid='public.tb_cm_file'::regclass`);
  check('RLS 가 켜져 있다', rls.relrowsecurity === true);
  check('FORCE RLS — 소유자(postgres)도 정책을 거친다', rls.relforcerowsecurity === true);

  const pol = await one(`
    SELECT count(*)::int n, string_agg(policyname || ':' || qual, ' | ') d
      FROM pg_policies WHERE schemaname='public' AND tablename='tb_cm_file'`);
  check('정책이 정확히 1개다', pol.n === 1, pol.d);
  check('정책이 erp_is_operator() 를 본다', (pol.d || '').includes('erp_is_operator'), pol.d);

  /*
   * ★★ 정책이 실제로 막는지는 **여기서 확인하지 않는다.**
   *
   * 이 스크립트는 `postgres` 로 붙는데 그 역할은 `rolbypassrls = true` 라
   * **RLS 정책이 아예 적용되지 않는다.** FORCE ROW LEVEL SECURITY 도 소유자에게만
   * 적용되는 것이지 BYPASSRLS 를 이기지 못한다. 그래서 여기서 「입주사 스코프로
   * 0건이 보인다」를 확인하면, 테이블이 비어 있어서 0건인 것을 정책 덕이라고
   * 착각하게 된다 — 처음에 실제로 그렇게 적었다(2026-09-20에 잡혔다).
   *
   * 정책이 실제로 거르는지는 **API 가 쓰는 역할(`erp_app`, BYPASSRLS 없음)로**
   * 행이 있는 상태에서 봐야 한다. `scripts/verify-cont17.js` 가 그것을 한다:
   *   운영사 스코프 → 본다 / 입주사 스코프 → 0건 · INSERT 42501 / 스코프 없음 → 0건
   */
  const bypass = await one(`SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user`);
  check(
    '이 스크립트의 역할은 BYPASSRLS 다 — 그래서 여기서 정책을 시험하지 않는다',
    bypass.rolbypassrls === true,
    `rolbypassrls=${bypass.rolbypassrls} (false 면 아래 결과가 달라진다)`,
  );

  const appRole = await one(`SELECT rolbypassrls FROM pg_roles WHERE rolname = 'erp_app'`);
  check(
    '★ API 역할 erp_app 에는 BYPASSRLS 가 없다 — 정책이 실제로 적용된다',
    appRole && appRole.rolbypassrls === false,
    JSON.stringify(appRole),
  );

  // ④ 한 회사 · 한 종류 · 한 장 — 실제로 두 번 넣어 본다
  await c.query('BEGIN');
  await c.query(`SELECT set_config('app.current_role', 'operator', true)`);
  const ins = (id) =>
    c.query(
      `INSERT INTO public.tb_cm_file
         (id, target_type, target_id, file_purpose, original_name, storage_path, mime_type, file_size, operator_id)
       VALUES ($1,'COMPANY','__verify020__','CEO_ID','a.jpg','1/x/'||$1||'.jpg','image/jpeg',10,1)`,
      [id],
    );
  let first = 'ok';
  let second = 'ok';
  try {
    await ins('__v020_a__');
  } catch (e) {
    first = e.code;
  }
  try {
    await ins('__v020_b__');
  } catch (e) {
    second = e.code;
  }
  await c.query('ROLLBACK');
  check('운영사 스코프로 1장은 들어간다', first === 'ok', `코드 ${first}`);
  check('같은 (회사, 종류) 두 번째는 23505 로 막힌다', second === '23505', `코드 ${second}`);

  // 롤백이 실제로 됐는지 — 검증이 데이터를 남기지 않았음을 보인다
  const after = await one(`SELECT count(*)::int n FROM public.tb_cm_file WHERE target_id='__verify020__'`);
  check('검증이 남긴 행이 없다', after.n === 0, `${after.n}행 남음`);

  // FK — 019 가 만든 것이 살아 있는가
  const fk = await one(`
    SELECT count(*)::int n FROM pg_constraint
     WHERE conrelid='public.tb_cm_file'::regclass AND contype='f'`);
  check('operator_id FK 가 살아 있다 (019)', fk.n === 1, `${fk.n}건`);

  await c.end();
  console.log(`\n  통과 ${pass} · 실패 ${fail}\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
