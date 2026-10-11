/**
 * 040 검증 — 법인변경 서류 출력 이력(tb_s080_corp_change_prints).
 *
 * 사용: node scripts/verify-040.js .env packages/api/.env
 *
 * ★★ RLS 는 erp_app 으로 접속해서만 잰다(verify-037 머리말과 같은 이유 — postgres 는 bypassrls).
 * ★ 시험 행은 erp_app 트랜잭션 안에서 넣고 ROLLBACK 한다. 남는 것이 없다.
 *
 * 종료코드: 0 = 전부 통과 / 1 = 실패 있음 / 2 = 실행 실패
 */
const fs = require('fs');
const { Client } = require('pg');

const readEnv = (file) =>
  Object.fromEntries(
    fs.readFileSync(file, 'utf8').split(/\r?\n/)
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }),
  );

const rootEnv = readEnv(process.argv[2] || '.env');
const apiEnv = readEnv(process.argv[3] || 'packages/api/.env');
const T = 'tb_s080_corp_change_prints';
/** 시험용 단체 ID — verify-037 과 같은 대역. */
const ORG_A = 990001;
const ORG_B = 990002;

const results = [];
const check = (id, what, cond, note = '') => results.push({ 항목: id, 내용: what, 결과: cond ? '통과' : '실패', 비고: note });

async function structure(q) {
  const cols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [T])).map((r) => r.column_name);
  const want = ['id', 'corp_change_id', 'org_id', 'form_id', 'form_name', 'officer_name', 'apply_date', 'write_date', 'printed_by', 'printed_role', 'printed_at'];
  check('S1', '칸 11개', want.every((c) => cols.includes(c)) && cols.length === want.length, cols.join(','));
  check('S2', '★ 주민번호 칸이 없다', !cols.some((c) => /rrn/i.test(c)));

  const fk = await q(`SELECT conname FROM pg_constraint WHERE conrelid = 'public.${T}'::regclass AND contype = 'f'`);
  check('S3', '★ FK 없음 — 건 · 양식을 지워도 이력이 남는다', fk.length === 0, fk.map((r) => r.conname).join(','));

  const rls = (await q(`SELECT relrowsecurity r, relforcerowsecurity f,
      (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'erp_org_scope') n
    FROM pg_class c WHERE relname = $1`, [T]))[0];
  check('S4', 'RLS ENABLE + FORCE + erp_org_scope', rls && rls.r && rls.f && rls.n === 1, JSON.stringify(rls));

  const g = (await q(`SELECT
      has_table_privilege('erp_app', 'public.${T}', 'SELECT') sel,
      has_table_privilege('erp_app', 'public.${T}', 'INSERT') ins,
      has_table_privilege('erp_app', 'public.${T}', 'UPDATE') upd,
      has_table_privilege('erp_app', 'public.${T}', 'DELETE') del,
      has_table_privilege('anon', 'public.${T}', 'SELECT') anon,
      has_table_privilege('authenticated', 'public.${T}', 'SELECT') auth`))[0];
  check('S5', 'erp_app = 읽기 · 넣기만 / anon · authenticated 없음',
    g.sel && g.ins && !g.upd && !g.del && !g.anon && !g.auth, JSON.stringify(g));
}

async function rlsChecks(ec) {
  const q = (s, p) => ec.query(s, p).then((r) => r.rows);
  const scope = async (role, orgId) => {
    await ec.query(`SELECT set_config('app.current_role', $1, true)`, [role]);
    await ec.query(`SELECT set_config('app.current_org_id', $1, true)`, [orgId === null ? '' : String(orgId)]);
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
  const insert = (id, org, role = 'operator') =>
    tryRun(`INSERT INTO public.${T} (id, corp_change_id, org_id, form_id, form_name, printed_by, printed_role)
      VALUES ($1, 'v040-gone', $2, 'f-x', '시험양식', '1', $3)`, [id, org, role]);
  const ids = async () => (await q(`SELECT id FROM public.${T} WHERE id LIKE 'v040-%' ORDER BY 1`)).map((r) => r.id);

  await ec.query('BEGIN');
  try {
    await scope('operator', null);
    const a = await insert('v040-a', ORG_A);
    const b = await insert('v040-b', ORG_B);
    check('R1', '★ 없는 건 id 로도 넣어진다(FK 없음)', a.code === null && b.code === null, `${a.code} ${b.code}`);
    check('R2', '운영사 — 전부 본다', (await ids()).join() === 'v040-a,v040-b');

    await scope('tenant', ORG_A);
    check('R3', '회사 A — 자기 단체 줄만', (await ids()).join() === 'v040-a');
    const mine = await insert('v040-a2', ORG_A, 'tenant');
    check('R4', '회사 A — 자기 단체로 넣기는 된다', mine.code === null, `code=${mine.code}`);
    const other = await insert('v040-x', ORG_B, 'tenant');
    check('R5', '회사 A — 남의 단체로 넣기는 막힌다(42501)', other.code === '42501', `code=${other.code}`);

    await scope('operator', null);
    const upd = await tryRun(`UPDATE public.${T} SET form_name = '변조' WHERE id = 'v040-a'`);
    const del = await tryRun(`DELETE FROM public.${T} WHERE id = 'v040-a'`);
    check('R6', '★ 운영사도 고치기 · 지우기 권한이 없다(42501)', upd.code === '42501' && del.code === '42501', `${upd.code} ${del.code}`);

    await scope('tenant', null);
    check('R7', '단체 ID 없는 회사 세션 — 0건', (await ids()).length === 0);
  } finally {
    await ec.query('ROLLBACK');
  }
}

(async () => {
  const pc = new Client({ host: rootEnv.DB_HOST, port: +rootEnv.DB_PORT, user: rootEnv.DB_USER, password: rootEnv.DB_PASSWORD, database: rootEnv.DB_NAME });
  await pc.connect();
  await structure((s, p) => pc.query(s, p).then((r) => r.rows));
  await pc.end();

  const erpUrl = apiEnv.ERP_DATABASE_URL || '';
  if (!erpUrl) check('R*', 'erp_app 접속 RLS 검사', false, 'packages/api/.env 에 ERP_DATABASE_URL 이 없다');
  else {
    const ec = new Client({ connectionString: erpUrl });
    await ec.connect();
    try { await rlsChecks(ec); } finally { await ec.end(); }
  }

  console.table(results);
  const failed = results.filter((r) => r.결과 !== '통과').length;
  console.log(failed === 0 ? `✔ 전부 통과 (${results.length}건)` : `✘ 실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error('✘ 실행 실패:', e.message);
  process.exit(2);
});
