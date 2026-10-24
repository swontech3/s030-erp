/**
 * 041 검증 — 사업목적 카탈로그(tb_s080_biz_purpose_catalog) 읽기 · 쓰기 가르기.
 *
 *   node scripts/verify-041.js .env packages/api/.env --dry-run   ← 적용 전. 롤백 안에서 041 을 돌려 본다
 *   node scripts/verify-041.js .env packages/api/.env             ← 적용 후. 구조 + RLS
 *
 * ★★ RLS 는 **erp_app 으로 접속해서만** 잴 수 있다. postgres 는 rolbypassrls=true 라 정책을
 *    그냥 통과한다(verify-037 머리말). 그래서 --dry-run 은 「041 이 오류 없이 돌고 칸 · 정책 · 권한이
 *    바뀌는가 + NULL 업종코드가 여럿 들어가는가」까지만 본다.
 * ★ 시험 행은 **트랜잭션 안에서 넣고 ROLLBACK 한다.** 남는 것이 없다.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const readEnv = (file) =>
  Object.fromEntries(
    fs.readFileSync(file, 'utf8').split(/\r?\n/)
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }),
  );

const rootEnv = readEnv(process.argv[2] || '.env');
const apiEnv = readEnv(process.argv[3] || 'packages/api/.env');
const DRY = process.argv.includes('--dry-run');
const T = 'tb_s080_biz_purpose_catalog';
/** 레거시 샘플 4줄 — 041 은 자료를 바꾸지 않는다. */
const SAMPLE_CODES = ['525101', '701201', '722000', '940909'];

const results = [];
const check = (id, what, cond, note = '') => results.push({ 항목: id, 내용: what, 결과: cond ? '통과' : '실패', 비고: note });

function migrationBody() {
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/041_biz_purpose_catalog_scope.sql'), 'utf8');
  return sql.replace(/^BEGIN;\s*$/m, '').replace(/^COMMIT;\s*$/m, '');
}

async function structure(q, p) {
  const col = (await q(`SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name='biz_code'`, [T]))[0];
  check(`${p}1`, 'biz_code NOT NULL 해제', col && col.is_nullable === 'YES', col && col.is_nullable);

  const uq = (await q(`SELECT indexdef FROM pg_indexes WHERE tablename=$1 AND indexname='tb_s080_biz_purpose_catalog_biz_code_key'`, [T]))[0];
  check(`${p}2`, '★ biz_code UNIQUE 그대로 · NULLS NOT DISTINCT 아님', !!uq && /UNIQUE/.test(uq.indexdef) && !/NULLS NOT DISTINCT/i.test(uq.indexdef), uq && uq.indexdef);

  const rls = (await q(`SELECT relrowsecurity r, relforcerowsecurity f FROM pg_class WHERE oid = $1::regclass`, [`public.${T}`]))[0];
  check(`${p}3`, 'RLS ENABLE + FORCE', rls && rls.r && rls.f, JSON.stringify(rls));

  const pol = (await q(`SELECT polname, polcmd FROM pg_policy WHERE polrelid = $1::regclass ORDER BY polname`, [`public.${T}`]))
    .map((r) => `${r.polname}:${r.polcmd}`).join(',');
  check(`${p}4`, '정책 셋 — 읽기(r) · 넣기(a) · 고치기(w), 지우기 정책 없음',
    pol === 'erp_biz_purpose_insert:a,erp_biz_purpose_read:r,erp_biz_purpose_update:w', pol);

  const g = (await q(`SELECT privilege_type p FROM information_schema.role_table_grants WHERE grantee='erp_app' AND table_name=$1 ORDER BY 1`, [T]))
    .map((r) => r.p).join(',');
  check(`${p}5`, '★ erp_app = 읽기 · 넣기 · 고치기 (DELETE 회수)', g === 'INSERT,SELECT,UPDATE', g);

  // ★ 정확히 4줄을 기대하지 않는다 — 041 뒤에는 운영사가 화면에서 문구를 더한다(업종코드 NULL).
  //   041 이 자료를 바꾸지 않았는지는 「샘플 4줄이 그 이름 그대로 남아 있는가」로 본다.
  const rows = (await q(`SELECT biz_code FROM public.${T} WHERE biz_code = ANY($1) ORDER BY biz_code`, [SAMPLE_CODES])).map((r) => r.biz_code).join(',');
  check(`${p}6`, '자료 그대로 — 레거시 샘플 4줄이 남아 있다', rows === SAMPLE_CODES.join(','), rows);

  const inc = await q(`SELECT relname, relrowsecurity r FROM pg_class WHERE relname IN ('tb_s080_incorporations','tb_s080_incorp_purposes') ORDER BY 1`);
  const incG = (await q(`SELECT table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) p FROM information_schema.role_table_grants
      WHERE grantee='erp_app' AND table_name IN ('tb_s080_incorporations','tb_s080_incorp_purposes') GROUP BY 1 ORDER BY 1`)).map((r) => r.p);
  check(`${p}7`, '설립 표 둘은 그대로(RLS 꺼짐 · erp_app 4권한)',
    inc.length === 2 && inc.every((r) => !r.r) && incG.length === 2 && incG.every((x) => x === 'DELETE,INSERT,SELECT,UPDATE'), JSON.stringify(incG));
}

/** postgres 로 — 업종코드 NULL 은 여럿, '' 는 하나만(UNIQUE). 롤백한다. */
async function nullChecks(pc, p) {
  const ins = async (id, code) => {
    await pc.query('SAVEPOINT s');
    try {
      await pc.query(`INSERT INTO public.${T} (id, biz_code, biz_name, updated_at) VALUES ($1, $2, $3, now())`, [id, code, `시험 ${id}`]);
      await pc.query('RELEASE SAVEPOINT s');
      return null;
    } catch (e) {
      await pc.query('ROLLBACK TO SAVEPOINT s');
      return e.code;
    }
  };
  const n1 = await ins('v041-n1', null);
  const n2 = await ins('v041-n2', null);
  check(`${p}8`, '★ 업종코드 NULL 줄 둘 — UNIQUE 에 걸리지 않는다', n1 === null && n2 === null, `${n1} ${n2}`);
  const e1 = await ins('v041-e1', '');
  const e2 = await ins('v041-e2', '');
  check(`${p}9`, "빈 문자열('')은 두 번째가 걸린다(23505) — 앱은 NULL 을 넣는다", e1 === null && e2 === '23505', `${e1} ${e2}`);
}

async function rlsChecks(ec) {
  const q = async (s, p) => (await ec.query(s, p)).rows;
  const scope = async (role) => {
    await ec.query(`SELECT set_config('app.current_role', $1, true)`, [role]);
    await ec.query(`SELECT set_config('app.current_company_id', '', true)`);
    await ec.query(`SELECT set_config('app.current_org_id', '', true)`);
  };
  const tryRun = async (sql, params) => {
    await ec.query('SAVEPOINT s');
    try {
      const r = await ec.query(sql, params);
      await ec.query('RELEASE SAVEPOINT s');
      return { code: null, rowCount: r.rowCount };
    } catch (e) {
      await ec.query('ROLLBACK TO SAVEPOINT s');
      return { code: e.code, rowCount: 0 };
    }
  };
  const insert = (id, active) =>
    tryRun(`INSERT INTO public.${T} (id, biz_code, biz_name, active, updated_at) VALUES ($1, NULL, $2, $3, now())`, [id, `시험 ${id}`, active]);
  const ids = async () => (await q(`SELECT id FROM public.${T} WHERE id LIKE 'v041-%' ORDER BY 1`)).map((r) => r.id).join(',');
  const all = async () => (await q(`SELECT count(*)::int n FROM public.${T}`))[0].n;

  await ec.query('BEGIN');
  try {
    await scope('operator');
    const a = await insert('v041-a', true);
    const b = await insert('v041-b', false);
    check('R1', '운영사 — 넣기(업종코드 NULL 둘)', a.code === null && b.code === null, `${a.code} ${b.code}`);
    check('R2', '운영사 — 사용 끈 줄까지 전부 본다', (await ids()) === 'v041-a,v041-b');
    // 회사가 볼 줄 수 = 운영사가 보는 켜진 줄 수(화면에서 더한 줄이 있어도 맞는다)
    const activeAll = (await q(`SELECT count(*)::int n FROM public.${T} WHERE active`))[0].n;

    await scope('tenant');
    check('R3', '★ 회사 — 사용 중인 줄만(단체 ID 없어도 읽는다)', (await ids()) === 'v041-a' && (await all()) === activeAll, `켜진 줄 ${activeAll}`);
    const ti = await insert('v041-t', true);
    check('R4', '회사 — 넣기는 막힌다(42501)', ti.code === '42501', `code=${ti.code}`);
    const tu = await tryRun(`UPDATE public.${T} SET biz_name = '변조' WHERE id = 'v041-a'`);
    check('R5', '회사 — 고치기는 0줄(정책이 줄을 감춘다)', tu.code === null && tu.rowCount === 0, `code=${tu.code} rows=${tu.rowCount}`);

    await scope('operator');
    const ou = await tryRun(`UPDATE public.${T} SET active = false WHERE id = 'v041-a'`);
    check('R6', '운영사 — 사용 끄기(고치기)는 된다', ou.code === null && ou.rowCount === 1, `code=${ou.code} rows=${ou.rowCount}`);
    const od = await tryRun(`DELETE FROM public.${T} WHERE id = 'v041-b'`);
    check('R7', '★ 운영사도 지우기 권한이 없다(42501)', od.code === '42501', `code=${od.code}`);

    await scope('');
    check('R8', '역할 없는 접속 — 0줄', (await all()) === 0);
  } finally {
    await ec.query('ROLLBACK');
  }
}

(async () => {
  const pc = new Client({ host: rootEnv.DB_HOST, port: +rootEnv.DB_PORT, user: rootEnv.DB_USER, password: rootEnv.DB_PASSWORD, database: rootEnv.DB_NAME });
  await pc.connect();
  const pq = (s, p) => pc.query(s, p).then((r) => r.rows);
  try {
    if (DRY) {
      console.log('▶ --dry-run — 041 을 트랜잭션 안에서 돌리고 롤백한다(남는 것 없음)');
      await pc.query('BEGIN');
      try {
        await pc.query(migrationBody());
        await structure(pq, 'D');
        await nullChecks(pc, 'D');
      } finally {
        await pc.query('ROLLBACK');
      }
      const after = (await pq(`SELECT is_nullable FROM information_schema.columns WHERE table_name=$1 AND column_name='biz_code'`, [T]))[0];
      check('D10', '롤백 후 — 그대로(biz_code NOT NULL)', after.is_nullable === 'NO', after.is_nullable);
    } else {
      await structure(pq, 'S');
      await pc.query('BEGIN');
      try {
        await nullChecks(pc, 'S');
      } finally {
        await pc.query('ROLLBACK');
      }
      const erpUrl = apiEnv.ERP_DATABASE_URL || '';
      if (!erpUrl) check('R*', 'erp_app 접속 RLS 검사', false, 'packages/api/.env 에 ERP_DATABASE_URL 이 없다');
      else {
        const ec = new Client({ connectionString: erpUrl });
        await ec.connect();
        try { await rlsChecks(ec); } finally { await ec.end(); }
      }
    }
  } finally {
    await pc.end();
  }

  console.table(results);
  const failed = results.filter((r) => r.결과 !== '통과').length;
  console.log(failed === 0 ? `✔ 전부 통과 (${results.length}건)` : `✘ 실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error('✘ 실행 실패:', e.message);
  process.exit(2);
});
