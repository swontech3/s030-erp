/**
 * 037 검증 — 법무 표를 삐용 단체 ID 로 가르는 RLS.
 *
 * 사용:
 *   node scripts/verify-037.js .env packages/api/.env --dry-run   ← 적용 전. 롤백 안에서 037 을 돌려 본다
 *   node scripts/verify-037.js .env packages/api/.env             ← 적용 후. 구조 + RLS
 *
 * ★★ RLS 는 **erp_app 으로 접속해서만** 잴 수 있다. postgres 는 rolbypassrls=true 라 정책을
 *    그냥 통과하고, 이 서버에서는 SET ROLE erp_app 도 못 쓴다(verify-001-003.js A2 주석).
 *    그래서 --dry-run 은 「037 이 오류 없이 돌고 칸·정책·함수가 생기는가」까지만 본다 —
 *    롤백 안의 DDL 은 다른 접속(erp_app)에서 보이지 않는다.
 *
 * ★ 시험 행은 **erp_app 트랜잭션 안에서 넣고 ROLLBACK 한다.** 남는 것이 없다.
 *   넣을 때는 운영사 스코프로 넣고, 같은 트랜잭션 안에서 스코프를 바꿔 가며 센다
 *   (set_config 세 번째 인자 true = 트랜잭션 범위 — 바꿀 때마다 덮어쓴다).
 *
 * 종료코드: 0 = 전부 통과 / 1 = 실패 있음 / 2 = 실행 실패
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

const TABLES = ['tb_s080_corp_changes', 'tb_s080_corp_change_officers', 'tb_s080_legal_orgs'];
/** 시험용 단체 ID — 실제 삐용 번호(수백 대)·mock(9001~9199)과 겹치지 않는 대역. */
const ORG_A = 990001;
const ORG_B = 990002;

const results = [];
const ok = (id, what, note = '') => results.push({ 항목: id, 내용: what, 결과: '통과', 비고: note });
const ng = (id, what, note = '') => results.push({ 항목: id, 내용: what, 결과: '실패', 비고: note });
const check = (id, what, cond, note = '') => (cond ? ok(id, what, note) : ng(id, what, note));

/** 037 본문에서 BEGIN/COMMIT 을 뺀다 — 바깥 트랜잭션이 대신 열고 롤백한다. */
function migrationBody() {
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/037_legal_org_scope.sql'), 'utf8');
  return sql.replace(/^BEGIN;\s*$/m, '').replace(/^COMMIT;\s*$/m, '');
}

async function structure(q, label) {
  const cols = (await q(`SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='tb_s080_corp_changes'`)).map((r) => r.column_name);
  const gone = ['company_name', 'corp_number', 'biz_number', 'ceo_name', 'phone',
    'hq_zip_code', 'hq_address', 'hq_address_detail', 'company_id', 'is_member'];
  check(`${label}1`, '변경건 — 회사 사본·company_id·is_member 가 없다',
    gone.every((c) => !cols.includes(c)), gone.filter((c) => cols.includes(c)).join(', ') || '10칸 없음');
  check(`${label}2`, '변경건 — org_id · org_code · submit_snapshot 이 있다',
    ['org_id', 'org_code', 'submit_snapshot'].every((c) => cols.includes(c)));

  const off = (await q(`SELECT is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name='tb_s080_corp_change_officers' AND column_name='org_id'`))[0];
  check(`${label}3`, '임원 — org_id NOT NULL', off && off.is_nullable === 'NO');

  const rls = await q(`SELECT relname, relrowsecurity r, relforcerowsecurity f,
      (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'erp_org_scope') n
    FROM pg_class c WHERE relname = ANY($1) AND relkind = 'r'`, [TABLES]);
  check(`${label}4`, 'RLS ENABLE + FORCE + 정책 — 세 표',
    rls.length === 3 && rls.every((r) => r.r && r.f && r.n === 1),
    rls.map((r) => `${r.relname}:${r.r ? 'E' : '-'}${r.f ? 'F' : '-'}${r.n}`).join(' '));

  const fn = (await q(`SELECT
      has_function_privilege('erp_app', 'public.erp_current_org_id()', 'EXECUTE') app,
      has_function_privilege('anon',    'public.erp_current_org_id()', 'EXECUTE') anon`))[0];
  check(`${label}5`, '함수 erp_current_org_id — erp_app 만 실행', fn.app && !fn.anon, JSON.stringify(fn));

  const fk = await q(`SELECT conname FROM pg_constraint WHERE conname = 'fk_s080_corp_change_officers_change_org'`);
  check(`${label}6`, '임원 ↔ 부모 건 같은 단체 복합 FK', fk.length === 1);
}

async function rlsChecks(ec) {
  const q = (s, p) => ec.query(s, p).then((r) => r.rows);
  const scope = async (role, orgId) => {
    await ec.query(`SELECT set_config('app.current_role', $1, true)`, [role]);
    await ec.query(`SELECT set_config('app.current_org_id', $1, true)`, [orgId === null ? '' : String(orgId)]);
  };
  /** 막혀야 하는 쓰기 — 저장점으로 감싸 트랜잭션을 살려 둔다. 오류 코드를 돌려준다. */
  const blocked = async (sql, params) => {
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

  await ec.query('BEGIN');
  try {
    // ── 시험 행 — 운영사 스코프로 넣는다 ─────────────────────────────────
    await scope('operator', null);
    const op = (await q(`SELECT operator_id FROM public.tb_s080_tenant010 ORDER BY 1 LIMIT 1`))[0].operator_id;
    for (const [id, org] of [['v037-a', ORG_A], ['v037-b', ORG_B]]) {
      await ec.query(`INSERT INTO public.tb_s080_corp_changes (id, change_type, status, updated_at, operator_id, org_id, org_code)
        VALUES ($1, 'NAME', 'P', now(), $2, $3, 'Z00')`, [id, op, org]);
      await ec.query(`INSERT INTO public.tb_s080_corp_change_officers (id, corp_change_id, name, change_kind, sort_order, updated_at, org_id)
        VALUES ($1, $2, '시험임원', 'APPOINT', 0, now(), $3)`, [`${id}-o`, id, org]);
      await ec.query(`INSERT INTO public.tb_s080_legal_orgs (org_id, ceo_name) VALUES ($1, '시험대표')`, [org]);
    }

    const seen = async () => ({
      changes: (await q(`SELECT id FROM public.tb_s080_corp_changes WHERE id LIKE 'v037-%' ORDER BY 1`)).map((r) => r.id),
      officers: (await q(`SELECT id FROM public.tb_s080_corp_change_officers WHERE id LIKE 'v037-%' ORDER BY 1`)).map((r) => r.id),
      orgs: (await q(`SELECT org_id FROM public.tb_s080_legal_orgs WHERE org_id = ANY($1) ORDER BY 1`, [[ORG_A, ORG_B]])).map((r) => r.org_id),
    });

    // R1 운영사 — 전부
    const all = await seen();
    check('R1', '운영사 — 두 회사 건·임원·정보 전부 본다',
      all.changes.length === 2 && all.officers.length === 2 && all.orgs.length === 2, JSON.stringify(all));

    // R2 회사 A — 자기 것만
    await scope('tenant', ORG_A);
    const a = await seen();
    check('R2', '회사 A — 자기 건·임원·정보만 본다',
      a.changes.join() === 'v037-a' && a.officers.join() === 'v037-a-o' && a.orgs.join() === String(ORG_A),
      JSON.stringify(a));

    // R3 회사 A 가 B 의 임원을 고치거나 지운다 — 0행 (레거시 임원 IDOR)
    const upd = await blocked(`UPDATE public.tb_s080_corp_change_officers SET name = '탈취' WHERE id = 'v037-b-o'`);
    const del = await blocked(`DELETE FROM public.tb_s080_corp_change_officers WHERE id = 'v037-b-o'`);
    check('R3', '회사 A — B 의 임원 수정·삭제가 0행', upd.rowCount === 0 && del.rowCount === 0,
      `update ${upd.code ?? upd.rowCount} · delete ${del.code ?? del.rowCount}`);

    // R4 회사 A 가 B 단체로 건을 만든다 — WITH CHECK 위반(42501)
    const ins = await blocked(`INSERT INTO public.tb_s080_corp_changes (id, change_type, status, updated_at, operator_id, org_id)
      VALUES ('v037-x', 'NAME', 'P', now(), $1, $2)`, [op, ORG_B]);
    check('R4', '회사 A — 남의 단체로 건을 만들 수 없다', ins.code === '42501', `code=${ins.code}`);

    // R5 회사 A 가 B 의 건 밑에 「A 단체」 임원을 단다 — 복합 FK 위반(23503)
    const cross = await blocked(`INSERT INTO public.tb_s080_corp_change_officers (id, corp_change_id, name, change_kind, sort_order, updated_at, org_id)
      VALUES ('v037-y', 'v037-b', '끼워넣기', 'APPOINT', 0, now(), $1)`, [ORG_A]);
    check('R5', '회사 A — 남의 건 밑에 임원을 끼워 넣을 수 없다', cross.code === '23503', `code=${cross.code}`);

    // R6 회사 A 가 자기 건을 B 단체로 옮긴다 — WITH CHECK 위반
    const move = await blocked(`UPDATE public.tb_s080_corp_changes SET org_id = $1 WHERE id = 'v037-a'`, [ORG_B]);
    check('R6', '회사 A — 자기 건을 남의 단체로 옮길 수 없다', move.code === '42501', `code=${move.code}`);

    // R7 단체 ID 없는 회사 세션 — 0건 (fail-closed)
    await scope('tenant', null);
    const none = await seen();
    check('R7', '단체 ID 없는 회사 세션 — 아무것도 안 보인다',
      none.changes.length === 0 && none.officers.length === 0 && none.orgs.length === 0, JSON.stringify(none));

    // R8 스코프를 전혀 넣지 않은 접속 — 0건
    await ec.query(`SELECT set_config('app.current_role', '', true)`);
    await ec.query(`SELECT set_config('app.current_org_id', '', true)`);
    const bare = await seen();
    check('R8', '스코프 없는 접속 — 아무것도 안 보인다',
      bare.changes.length === 0 && bare.officers.length === 0 && bare.orgs.length === 0);
  } finally {
    await ec.query('ROLLBACK');
  }
}

(async () => {
  const pc = new Client({
    host: rootEnv.DB_HOST, port: +rootEnv.DB_PORT, user: rootEnv.DB_USER,
    password: rootEnv.DB_PASSWORD, database: rootEnv.DB_NAME,
  });
  await pc.connect();
  const pq = (s, p) => pc.query(s, p).then((r) => r.rows);

  if (DRY) {
    console.log('▶ --dry-run — 037 을 트랜잭션 안에서 돌리고 롤백한다(남는 것 없음)');
    await pc.query('BEGIN');
    try {
      await pc.query(migrationBody());
      await structure(pq, 'D');
    } finally {
      await pc.query('ROLLBACK');
    }
    const after = (await pq(`SELECT to_regclass('public.tb_s080_legal_orgs') t`))[0].t;
    check('D7', '롤백 후 — 표가 남지 않았다', after === null);
  } else {
    await structure(pq, 'S');
    const erpUrl = apiEnv.ERP_DATABASE_URL || '';
    if (!erpUrl) {
      ng('R*', 'erp_app 접속 RLS 검사', 'packages/api/.env 에 ERP_DATABASE_URL 이 없다');
    } else {
      const ec = new Client({ connectionString: erpUrl });
      await ec.connect();
      try {
        await rlsChecks(ec);
      } finally {
        await ec.end();
      }
    }
  }
  await pc.end();

  console.table(results);
  const failed = results.filter((r) => r.결과 !== '통과').length;
  console.log(failed === 0 ? `✔ 전부 통과 (${results.length}건)` : `✘ 실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error('✘ 실행 실패:', e.message);
  process.exit(2);
});
