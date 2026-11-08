/**
 * 224 검증 — 세무(S05) 세무사 전달 서류 보낸 이력 → 최종 발송 한 줄(2026-11-08 대표 지시 ⑧).
 *
 *   ① 표 tb_s050_handoff_last — 단체 · 종류 · 신고 기간(period_id)마다 한 줄 · 보낸 때 · 받는 사람 · 참조 · 파일 이름 · 보낸 사람(번호 + 이름)
 *      RLS erp_org_scope ENABLE + FORCE · erp_app 읽기 · 넣기 + 덮어쓰는 칸만 UPDATE · 지우기 없음
 *   ② 옛 보낸 이력 표 tb_s050_handoff_logs 가 없다
 *   ③ (시험만) 옛 이력 → 마지막 성공 한 줄만 옮긴다 · 실패 줄은 옮기지 않는다 · 반기 · 분기 ID
 *
 * 사용: node scripts/verify-224.js .env packages/api/.env
 * 적용 전 시험: node scripts/verify-224.js .env packages/api/.env --dry-run supabase/migrations/224_tax_handoff_last.sql
 *   postgres 한 접속 · 한 트랜잭션 안에서 옛 이력 시험 줄을 넣고 파일을 돌린 뒤(파일의 BEGIN; · COMMIT; 줄은 걷음) 검증하고 **늘 ROLLBACK** 한다.
 *   ★ 시험은 표 주인(postgres)으로 잰다 — BYPASSRLS 라 RLS · 권한 없음은 「건너뜀」, 적용 뒤 보통 실행이 erp_app 으로 잰다.
 *
 * ★ 시험 행은 트랜잭션 안에서 넣고 ROLLBACK 한다. 남는 것이 없다. 시험 값은 모두 지어낸 값이다.
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
const dryAt = process.argv.indexOf('--dry-run');
const dryFiles = dryAt >= 0 ? process.argv.slice(dryAt + 1) : null;

const H = 'tb_s050_handoff_last';
const OLD = 'tb_s050_handoff_logs';
/** 시험용 단체 ID — verify-201 · 203 · 214 · 218 과 같은 대역. */
const ORG_A = 990001;
const ORG_B = 990002;

const results = [];
const check = (id, what, cond, note = '') => results.push({ 항목: id, 내용: what, 결과: cond ? '통과' : '실패', 비고: note });
const skip = (id, what, note) => results.push({ 항목: id, 내용: what, 결과: '건너뜀', 비고: note });

/** 칸 이름 → [자료형, NULL 허용] — 지시(11-08 ⑧ 2) 그대로. */
const COLS = {
  org_id: ['integer', 'NO'], handoff_tp: ['character varying', 'NO'], period_id: ['character varying', 'NO'],
  sent_at: ['timestamp without time zone', 'NO'], recipients: ['ARRAY', 'NO'], cc: ['character varying', 'YES'],
  file_name: ['character varying', 'NO'], sent_by: ['text', 'NO'], sent_by_name: ['character varying', 'YES'],
};
const CKS = ['ck_s050_handoff_last_tp', 'ck_s050_handoff_last_period', 'ck_s050_handoff_last_recipients',
  'ck_s050_handoff_last_file_name', 'ck_s050_handoff_last_cc'];
const UPD_COLS = ['cc', 'file_name', 'recipients', 'sent_at', 'sent_by', 'sent_by_name'];

async function structure(q) {
  const cols = await q(`SELECT column_name, data_type, is_nullable FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1`, [H]);
  const got = Object.fromEntries(cols.map((c) => [c.column_name, [c.data_type, c.is_nullable]]));
  const diff = [...new Set([...Object.keys(COLS), ...Object.keys(got)])].filter((k) => JSON.stringify(COLS[k]) !== JSON.stringify(got[k]));
  check('S1', `${H} — 칸 ${Object.keys(COLS).length}개 · 자료형 · NULL 허용이 설계 그대로(더하지도 빼지도 않음)`,
    cols.length > 0 && diff.length === 0, diff.map((k) => `${k}: 설계 ${COLS[k]} / DB ${got[k]}`).join(' · ') || `${cols.length}칸`);
  if (cols.length === 0) return false;

  const cm = await q(`SELECT obj_description('public.${H}'::regclass, 'pg_class') d`);
  check('S2', `${H} — 표 설명이 「세무(S05)」로 시작`, (cm[0]?.d || '').startsWith('세무(S05)'), (cm[0]?.d || '').slice(0, 24));

  const pk = await q(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE contype='p' AND conrelid = to_regclass('public.${H}')`);
  check('S3', `★ ${H} — 기본키(단체 · 종류 · 신고 기간) — 그 묶음마다 한 줄`,
    pk.length === 1 && pk[0].d === 'PRIMARY KEY (org_id, handoff_tp, period_id)', pk[0]?.d ?? '없음');

  const rls = await q(`SELECT relrowsecurity r, relforcerowsecurity f FROM pg_class WHERE relname = $1`, [H]);
  const pol = await q(`SELECT 1 FROM pg_policies WHERE schemaname='public' AND policyname='erp_org_scope' AND tablename = $1
    AND qual LIKE '%erp_is_operator()%' AND qual LIKE '%erp_current_org_id()%' AND with_check LIKE '%erp_current_org_id()%'`, [H]);
  check('S4', `★ ${H} — RLS ENABLE + FORCE + erp_org_scope(운영사 · 자기 단체) 정책`,
    rls.length === 1 && rls[0].r && rls[0].f && pol.length === 1, JSON.stringify({ rls, pol: pol.length }));

  const cks = (await q(`SELECT conname FROM pg_constraint WHERE contype='c' AND conrelid = to_regclass('public.${H}')`)).map((r) => r.conname);
  const fks = await q(`SELECT 1 FROM pg_constraint WHERE contype='f' AND conrelid = to_regclass('public.${H}')`);
  check('S5', `${H} — CHECK ${CKS.length}개 이름 그대로 · FK 없음`,
    CKS.every((c) => cks.includes(c)) && cks.length === CKS.length && fks.length === 0, cks.sort().join(','));

  const pr = (await q(`SELECT
      has_table_privilege('erp_app', 'public.${H}', 'SELECT') sel,
      has_table_privilege('erp_app', 'public.${H}', 'INSERT') ins,
      has_table_privilege('erp_app', 'public.${H}', 'UPDATE') upd,
      has_table_privilege('erp_app', 'public.${H}', 'DELETE') del`))[0];
  const colUpd = (await q(`SELECT column_name FROM information_schema.column_privileges
    WHERE table_schema='public' AND table_name=$1 AND grantee='erp_app' AND privilege_type='UPDATE' ORDER BY 1`, [H])).map((r) => r.column_name);
  check('S6', `★ ${H} — erp_app 읽기 · 넣기 + 덮어쓰는 칸만 UPDATE(${UPD_COLS.join(' · ')}) · 표 UPDATE · 지우기 없음`,
    pr.sel && pr.ins && !pr.upd && !pr.del && colUpd.join() === UPD_COLS.join(), `${JSON.stringify(pr)} 칸=${colUpd.join(',')}`);

  const left = await q(`SELECT grantee FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name = $1 AND grantee IN ('anon', 'authenticated', 'PUBLIC')`, [H]);
  check('S7', `${H} — check-grants 기준 anon · authenticated · PUBLIC 권한 0건`, left.length === 0, left.map((r) => r.grantee).join(','));

  const old = (await q(`SELECT to_regclass('public.${OLD}') t`))[0].t;
  check('S8', `★ 옛 보낸 이력 표 ${OLD} 가 없다`, old === null, String(old));
  return true;
}

/** (시험만) 옛 이력 시험 줄 — 파일을 돌리기 전에 넣는다. */
async function seedOld(pc) {
  const add = (id, org, from, to, ok, at, file) =>
    pc.query(`INSERT INTO public.${OLD} (id, org_id, handoff_tp, period_from, period_to, recipients, file_name, row_count, ok, fail_reason, sent_by, sent_by_name, sent_at)
      VALUES ($1, $2, 'T', $3, $4, ARRAY['tax@example.com'], $5, 1, $6, $7, '7', '시험 사용자', $8)`,
    [id, org, from, to, file, ok, ok ? null : '지어낸 오류', at]);
  await add('v224-a1', ORG_A, '2026-07-01', '2026-09-30', true, '2026-10-01 09:00', 'A첫성공.xlsx');
  await add('v224-a2', ORG_A, '2026-07-01', '2026-09-30', true, '2026-10-02 09:00', 'A마지막성공.xlsx');
  await add('v224-a3', ORG_A, '2026-07-01', '2026-09-30', false, '2026-10-03 09:00', 'A실패.xlsx');
  await add('v224-a4', ORG_A, '2026-01-01', '2026-06-30', true, '2026-07-01 09:00', 'A반기.xlsx');
  await add('v224-b1', ORG_B, '2026-10-01', '2026-10-31', true, '2026-11-01 09:00', 'B분기.xlsx');
  await add('v224-b2', ORG_B, '2026-04-01', '2026-06-30', false, '2026-07-01 09:00', 'B실패만.xlsx');
}

async function moved(q) {
  const rows = await q(`SELECT org_id, period_id, file_name, to_char(sent_at, 'YYYY-MM-DD HH24:MI') at FROM public.${H}
    WHERE org_id IN ($1, $2) ORDER BY org_id, period_id`, [ORG_A, ORG_B]);
  const got = rows.map((r) => `${r.org_id}/${r.period_id}/${r.file_name}`).join(' · ');
  const want = [`${ORG_A}/2026-H1/A반기.xlsx`, `${ORG_A}/2026-Q3/A마지막성공.xlsx`, `${ORG_B}/2026-Q4/B분기.xlsx`].join(' · ');
  check('M1', '★ (시험) 옛 이력 → 단체 · 종류 · 기간마다 마지막 성공 한 줄만(실패 · 앞 성공 빠짐) · 6개월 기간은 반기 ID', got === want, got);
}

/** erp_app 길. `tx.begin()` · `tx.end()` 로 감싼다 — 보통은 BEGIN/ROLLBACK, --dry-run 은 SAVEPOINT(표 주인, `tx.asOwner`). */
async function rowChecks(ec, tx) {
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
  /** 앱과 같은 덮어쓰기(INSERT … ON CONFLICT DO UPDATE). */
  const upsert = (org, period, x = {}) =>
    tryRun(`INSERT INTO public.${H} (org_id, handoff_tp, period_id, sent_at, recipients, cc, file_name, sent_by, sent_by_name)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4, $5, $6, '7', '시험 사용자')
      ON CONFLICT (org_id, handoff_tp, period_id) DO UPDATE SET sent_at = EXCLUDED.sent_at, recipients = EXCLUDED.recipients,
        cc = EXCLUDED.cc, file_name = EXCLUDED.file_name, sent_by = EXCLUDED.sent_by, sent_by_name = EXCLUDED.sent_by_name`,
    [org, x.tp ?? 'T', period, x.to_ === undefined ? ['tax@example.com'] : x.to_, x.cc === undefined ? null : x.cc,
      x.file === undefined ? 'v224.xlsx' : x.file]);
  const filesOf = async () =>
    (await q(`SELECT org_id || '/' || period_id || '/' || file_name f FROM public.${H} WHERE file_name LIKE 'v224%' ORDER BY 1`)).map((r) => r.f).join();

  await tx.begin();
  try {
    await scope('operator', null);
    const ok = [
      await upsert(ORG_A, '2099-Q3', { file: 'v224-첫.xlsx' }),
      await upsert(ORG_A, '2099-Q3', { file: 'v224-덮음.xlsx', cc: 'ceo@example.com', to_: ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com'] }),
      await upsert(ORG_A, '2099-H2', { tp: 'M', file: 'v224-반기.xlsx' }),
      await upsert(ORG_B, '2099-Q3', { file: 'v224-B.xlsx' }),
    ];
    const a = (await q(`SELECT file_name, cc, cardinality(recipients) n FROM public.${H} WHERE org_id = $1 AND period_id = '2099-Q3'`, [ORG_A]));
    check('H1', '★ 운영사 — 같은 단체 · 종류 · 기간은 한 줄로 덮어쓴다(파일 · 참조 · 받는 사람 넷) · 다른 종류 · 다른 단체는 따로',
      ok.every((r) => r.code === null) && a.length === 1 && a[0].file_name === 'v224-덮음.xlsx' && a[0].cc === 'ceo@example.com' && a[0].n === 4,
      `${ok.map((r) => r.code).join(' ')} ${JSON.stringify(a)}`);

    const bad = [
      await upsert(ORG_A, '2099-Q3', { tp: 'X' }),
      await upsert(ORG_A, '2099-Q5'),
      await upsert(ORG_A, '2099-03'),
      await upsert(ORG_A, '2099-Q2', { to_: [] }),
      await upsert(ORG_A, '2099-Q2', { to_: ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com'] }),
      await upsert(ORG_A, '2099-Q2', { file: '   ' }),
      await upsert(ORG_A, '2099-Q2', { cc: ' ' }),
    ];
    check('H2', '★ CHECK — 종류 T/M · 기간 ID 꼴(YYYY-Q1~4 · H1~2) · 받는 사람 1~4 · 파일 이름 · 참조 빈칸 없음(23514)',
      bad.every((r) => r.code === '23514'), bad.map((r) => r.code).join(' '));

    await scope('tenant', ORG_A);
    const RLS_NOTE = '시험(표 주인 postgres)은 BYPASSRLS — 적용 뒤 erp_app 으로';
    if (tx.asOwner) {
      skip('H3', '회사 A — 자기 단체 줄만 보인다', RLS_NOTE);
      skip('H4', '★ 회사 A — 남의 단체 줄 넣기 · 덮어쓰기는 막힌다(42501 · 0줄)', RLS_NOTE);
      skip('H5', '★ 키 칸 고치기 · 지우기 — 권한 없음(42501)', '시험(표 주인)은 권한이 다 있다 — 적용 뒤 erp_app 으로');
    } else {
      const seen = await filesOf();
      check('H3', '회사 A — 자기 단체 줄만 보인다', seen === `${ORG_A}/2099-H2/v224-반기.xlsx,${ORG_A}/2099-Q3/v224-덮음.xlsx`, seen);
      const other = await upsert(ORG_B, '2099-Q4', { file: 'v224-남.xlsx' });
      const over = await tryRun(`UPDATE public.${H} SET file_name = 'v224-남덮음.xlsx' WHERE org_id = $1`, [ORG_B]);
      check('H4', '★ 회사 A — 남의 단체 줄 넣기는 막히고(42501) · 덮어쓰기는 0줄', other.code === '42501' && over.code === null && over.rowCount === 0,
        `넣기=${other.code} 덮기=${over.code}/${over.rowCount}`);
      const deny = [
        await tryRun(`UPDATE public.${H} SET period_id = '2099-Q4' WHERE org_id = $1`, [ORG_A]),
        await tryRun(`UPDATE public.${H} SET org_id = $2 WHERE org_id = $1`, [ORG_A, ORG_B]),
        await tryRun(`DELETE FROM public.${H} WHERE org_id = $1`, [ORG_A]),
      ];
      check('H5', '★ 키 칸(기간 · 단체) 고치기 · 지우기 — 권한 없음(42501)', deny.every((r) => r.code === '42501'), deny.map((r) => r.code).join(' '));
    }
    await scope('tenant', null);
    if (tx.asOwner) skip('H6', '단체 ID 없는 회사 세션 — 0건', RLS_NOTE);
    else check('H6', '단체 ID 없는 회사 세션 — 0건', (await filesOf()) === '');
  } finally {
    await tx.end();
  }

  await tx.begin();
  try {
    await scope('operator', null);
    const left = (await q(`SELECT count(*)::int n FROM public.${H} WHERE file_name LIKE 'v224%'`))[0].n;
    check('Z1', '롤백 후 시험 줄 0 (운영사 스코프로 센다)', left === 0, String(left));
  } finally {
    await tx.end();
  }
}

/** 마이그레이션 파일을 트랜잭션 안에서 돌릴 수 있게 — 파일 자체의 BEGIN; · COMMIT; 줄만 걷는다. */
const bodyOf = (file) => fs.readFileSync(file, 'utf8').replace(/^BEGIN;[ \t]*$/m, '').replace(/^COMMIT;[ \t]*$/m, '');

(async () => {
  const pc = new Client({ host: rootEnv.DB_HOST, port: +rootEnv.DB_PORT, user: rootEnv.DB_USER, password: rootEnv.DB_PASSWORD, database: rootEnv.DB_NAME });
  await pc.connect();
  const pq = (s, p) => pc.query(s, p).then((r) => r.rows);
  if (dryFiles) {
    if (dryFiles.length === 0) throw new Error('--dry-run 뒤에 마이그레이션 파일을 적는다');
    await pc.query('BEGIN');
    try {
      await pc.query(`SELECT set_config('app.current_role', 'operator', true)`);
      if ((await pq(`SELECT to_regclass('public.${OLD}') t`))[0].t !== null) await seedOld(pc);
      for (const f of dryFiles) { await pc.query(bodyOf(f)); console.log(`(시험) 돌림: ${f}`); }
      if (await structure(pq)) {
        await moved(pq);
        await rowChecks(pc, { asOwner: true, begin: () => pc.query('SAVEPOINT vr'), end: () => pc.query('ROLLBACK TO SAVEPOINT vr') });
      }
    } finally {
      await pc.query('ROLLBACK');
    }
    const gone = (await pq(`SELECT to_regclass('public.${H}') t, to_regclass('public.${OLD}') o`))[0];
    check('Z2', '(시험) ROLLBACK 뒤 새 표가 없고 옛 이력 표는 그대로 — DB 는 그대로', gone.t === null && gone.o !== null, JSON.stringify(gone));
    await pc.end();
  } else {
    let hasTable = false;
    try {
      hasTable = await structure(pq);
    } finally {
      await pc.end();
    }
    const erpUrl = apiEnv.ERP_DATABASE_URL || '';
    if (!hasTable) { /* 표가 없으면 행 검사는 하지 않는다 — S1 실패로 이미 알렸다 */ }
    else if (!erpUrl) check('H*', 'erp_app 접속', false, 'packages/api/.env 에 ERP_DATABASE_URL 이 없다');
    else {
      const ec = new Client({ connectionString: erpUrl });
      await ec.connect();
      try { await rowChecks(ec, { begin: () => ec.query('BEGIN'), end: () => ec.query('ROLLBACK') }); } finally { await ec.end(); }
    }
  }

  console.table(results);
  const failed = results.filter((r) => r.결과 === '실패').length;
  const skipped = results.filter((r) => r.결과 === '건너뜀').length;
  console.log(failed === 0 ? `✔ 전부 통과 (${results.length - skipped}건${skipped ? ` · 건너뜀 ${skipped}` : ''})` : `✘ 실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error('✘ 실행 실패:', e.message);
  process.exit(2);
});
