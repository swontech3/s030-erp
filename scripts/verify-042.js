/**
 * 042 검증 — 설립 표를 삐용 단체 ID 로 가르기.
 *
 *   node scripts/verify-042.js .env packages/api/.env --dry-run   ← 적용 전. 롤백 안에서 042 를 돌려 본다
 *   node scripts/verify-042.js .env packages/api/.env             ← 적용 후. 구조 + RLS
 *
 * ★★ RLS 는 erp_app 으로 접속해서만 잰다(postgres 는 BYPASSRLS — verify-037 머리말).
 * ★ 시험 행은 트랜잭션 안에서 넣고 ROLLBACK 한다. 시험 단체 990001 · 990002(다른 검증과 같은 대역).
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
const INC = 'tb_s080_incorporations';
const PER = 'tb_s080_incorp_persons';
const ORG_A = 990001;
const ORG_B = 990002;

const results = [];
const check = (id, what, cond, note = '') => results.push({ 항목: id, 내용: what, 결과: cond ? '통과' : '실패', 비고: typeof note === 'string' ? note : JSON.stringify(note) });

function migrationBody() {
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/042_incorporation_org_scope.sql'), 'utf8');
  return sql.replace(/^BEGIN;\s*$/m, '').replace(/^COMMIT;\s*$/m, '');
}

async function structure(q, p) {
  const cols = async (t) => Object.fromEntries((await q(`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [t])).map((r) => [r.column_name, r]));
  const inc = await cols(INC);
  const per = await cols(PER);
  check(`${p}1`, 'company_id 없음 · submitted_at → written_at', !inc.company_id && !inc.submitted_at && !!inc.written_at, Object.keys(inc).filter((c) => /company_id|submitted|written/.test(c)));
  check(`${p}2`, 'org_id NOT NULL(두 표) · org_code · submit_snapshot',
    inc.org_id?.is_nullable === 'NO' && per.org_id?.is_nullable === 'NO' && !!inc.org_code && inc.submit_snapshot?.data_type === 'jsonb');
  const added = ['name_ko', 'name_en', 'head_zip_code', 'head_address', 'head_address_detail', 'purposes'];
  check(`${p}3`, '상호 · 본점 · 사업목적 칸', added.every((c) => inc[c]), added.filter((c) => !inc[c]));
  const big = ['capital_amount', 'par_value', 'units_authorized', 'units_issued'].map((c) => inc[c]?.data_type);
  check(`${p}4`, '★ 금액 · 주식 수 bigint(사람 인수수량 포함)', big.every((t) => t === 'bigint') && per.units_subscribed?.data_type === 'bigint', [...big, per.units_subscribed?.data_type]);

  const fks = (await q(`SELECT conname, pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid = ANY($1::regclass[]) AND contype IN ('f','u')`, [[`public.${INC}`, `public.${PER}`]])).map((r) => `${r.conname}:${r.d}`);
  check(`${p}5`, '회사표 FK 없음 · 사람→건 복합 FK(id, org_id)',
    !fks.some((f) => /tb_s080_companies/.test(f)) && fks.some((f) => /fk_s080_incorp_persons_inc_org:FOREIGN KEY \(incorporation_id, org_id\)/.test(f)), fks);

  const rls = await q(`SELECT c.relname, c.relrowsecurity r, c.relforcerowsecurity f,
      (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'erp_org_scope') n
    FROM pg_class c WHERE c.relname = ANY($1) ORDER BY 1`, [[INC, PER, 'tb_s080_incorp_purposes']]);
  const by = Object.fromEntries(rls.map((r) => [r.relname, r]));
  check(`${p}6`, 'RLS ENABLE + FORCE + erp_org_scope(건 · 사람)', [INC, PER].every((t) => by[t]?.r && by[t]?.f && by[t]?.n === 1), rls);
  check(`${p}7`, '사업목적 표(incorp_purposes)는 그대로 — RLS 꺼짐', by.tb_s080_incorp_purposes && !by.tb_s080_incorp_purposes.r);

  const g = (await q(`SELECT table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) p FROM information_schema.role_table_grants
      WHERE grantee='erp_app' AND table_name = ANY($1) GROUP BY 1 ORDER BY 1`, [[INC, PER, 'tb_s080_incorp_purposes']])).map((r) => `${r.table_name}=${r.p}`);
  check(`${p}8`, 'erp_app 권한 그대로(셋 다 4권한)', g.length === 3 && g.every((x) => x.endsWith('=DELETE,INSERT,SELECT,UPDATE')), g);
}

async function rlsChecks(ec) {
  const q = async (s, p) => (await ec.query(s, p)).rows;
  const scope = async (role, orgId) => {
    await ec.query(`SELECT set_config('app.current_role', $1, true)`, [role]);
    await ec.query(`SELECT set_config('app.current_company_id', '', true)`);
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
  const inc = (id, org) => tryRun(`INSERT INTO public.${INC} (id, org_id, entity_type, updated_at, operator_id, capital_amount) VALUES ($1, $2, 'R', now(), 1, 3000000000)`, [id, org]);
  const person = (id, incId, org) => tryRun(`INSERT INTO public.${PER} (id, incorporation_id, org_id, name, sort_order, updated_at, units_subscribed) VALUES ($1, $2, $3, '시험', 1, now(), 3000000000)`, [id, incId, org]);
  const ids = async (t) => (await q(`SELECT id FROM public.${t} WHERE id LIKE 'v042-%' ORDER BY 1`)).map((r) => r.id).join(',');

  await ec.query('BEGIN');
  try {
    await scope('operator', null);
    const a = await inc('v042-a', ORG_A);
    const b = await inc('v042-b', ORG_B);
    check('R1', '운영사 — 두 단체 건 넣기(자본금 30억 = bigint)', a.code === null && b.code === null, `${a.code} ${b.code}`);
    const pa = await person('v042-pa', 'v042-a', ORG_A);
    const px = await person('v042-px', 'v042-a', ORG_B);
    check('R2', '★ 사람은 부모 건과 같은 단체만 — 다른 단체면 FK 거절(23503)', pa.code === null && px.code === '23503', `${pa.code} ${px.code}`);

    await scope('tenant', ORG_A);
    check('R3', '회사 A — 자기 단체 건 · 사람만', (await ids(INC)) === 'v042-a' && (await ids(PER)) === 'v042-pa');
    const other = await inc('v042-x', ORG_B);
    check('R4', '회사 A — 남의 단체로 넣기는 막힌다(42501)', other.code === '42501', `code=${other.code}`);
    const upd = await tryRun(`UPDATE public.${INC} SET name_ko = '변조' WHERE id = 'v042-b'`);
    check('R5', '회사 A — 남의 건 고치기는 0줄', upd.code === null && upd.rowCount === 0, upd);

    await scope('tenant', null);
    check('R6', '단체 ID 없는 회사 세션 — 0건', (await ids(INC)) === '' && (await ids(PER)) === '');
    await scope('operator', null);
    const del = await tryRun(`DELETE FROM public.${INC} WHERE id = 'v042-a'`);
    check('R7', '운영사 — 건을 지우면 사람도 함께(CASCADE)', del.code === null && (await ids(PER)) === '', del);
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
      console.log('▶ --dry-run — 042 를 트랜잭션 안에서 돌리고 롤백한다(남는 것 없음)');
      await pc.query('BEGIN');
      try {
        await pc.query(migrationBody());
        await structure(pq, 'D');
      } finally {
        await pc.query('ROLLBACK');
      }
      const after = (await pq(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name=$1 AND column_name='company_id'`, [INC]))[0].n;
      check('D9', '롤백 후 — 그대로(company_id 있음)', after === 1);
    } else {
      await structure(pq, 'S');
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
