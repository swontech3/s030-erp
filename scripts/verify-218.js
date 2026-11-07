/**
 * 218 검증 — 세무(S05) 세무사 전달 서류(s050500010, 1-9 · 2026-11-07).
 *
 *   ① 코드 분류 TAX_HANDOFF_TP(전달 종류, 고정 코드) · 파티션 000 하나 · 코드 줄 둘 — T 부가세 납부 · M 원천세 납부
 *   ② 표 tb_s050_handoff_logs(보낸 이력) — 보낸 때 · 종류 · 기간 · 받는 사람 · 파일 이름 · 줄 수 · 결과(성공 / 실패 사유) · 보낸 사람(번호 + 이름)
 *      RLS erp_org_scope ENABLE + FORCE · erp_app 읽기 · 넣기만
 *
 * 사용: node scripts/verify-218.js .env packages/api/.env
 * 적용 전 시험: node scripts/verify-218.js .env packages/api/.env --dry-run supabase/migrations/218_tax_handoff.sql
 *   postgres 한 접속 · 한 트랜잭션 안에서 파일을 돌리고(파일의 BEGIN; · COMMIT; 줄은 걷음) 검증한 뒤 **늘 ROLLBACK** 한다.
 *   ★ 시험은 표 주인(postgres)으로 잰다 — BYPASSRLS 라 RLS(H6 · H7 · H9) · 권한 없음(H8)은 「건너뜀」,
 *     적용 뒤 보통 실행이 erp_app 으로 잰다(verify-214 와 같은 방식).
 *
 * ★ 시험 행은 트랜잭션 안에서 넣고 ROLLBACK 한다. 남는 것이 없다. 시험 값은 모두 지어낸 값이다.
 * ★ 코드값 · 이름 · 순서는 대표가 정한 것 그대로 여기 적어 둔다 — 코드 관리에서 고치면 실패로 나온다.
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

const CAT = 'TAX_HANDOFF_TP';
const CAT_NAME = '세무사 전달 종류';
/** [코드값, 이름] — 순서 = 코드 표 순서. */
const WANT = [['T', '부가세 납부'], ['M', '원천세 납부']];
const H = 'tb_s050_handoff_logs';
/** 시험용 단체 ID — verify-201 · 203 · 214 와 같은 대역. */
const ORG_A = 990001;
const ORG_B = 990002;

const results = [];
const check = (id, what, cond, note = '') => results.push({ 항목: id, 내용: what, 결과: cond ? '통과' : '실패', 비고: note });
const skip = (id, what, note) => results.push({ 항목: id, 내용: what, 결과: '건너뜀', 비고: note });

/** 칸 이름 → [자료형, NULL 허용] — 지시(2026-11-07 답변 · 변경 7) 그대로. */
const COLS = {
  id: ['text', 'NO'], org_id: ['integer', 'NO'], handoff_tp: ['character varying', 'NO'],
  period_from: ['date', 'NO'], period_to: ['date', 'NO'], recipients: ['ARRAY', 'NO'],
  file_name: ['character varying', 'NO'], row_count: ['integer', 'NO'], ok: ['boolean', 'NO'],
  fail_reason: ['character varying', 'YES'], sent_by: ['text', 'NO'], sent_by_name: ['character varying', 'YES'],
  sent_at: ['timestamp without time zone', 'NO'],
};
const CKS = ['ck_s050_handoff_logs_tp', 'ck_s050_handoff_logs_from', 'ck_s050_handoff_logs_period', 'ck_s050_handoff_logs_recipients',
  'ck_s050_handoff_logs_file_name', 'ck_s050_handoff_logs_rows', 'ck_s050_handoff_logs_result'];
const IXS = ['ix_s050_handoff_logs_org_sent'];

async function codes(q) {
  const master = await q(`SELECT name, description FROM public.tb_s080_code_masters WHERE build_id = '1' AND category = $1`, [CAT]);
  check('C1', `분류 ${CAT} — 이름 「${CAT_NAME}」 · 설명에 「고정 코드」`,
    master.length === 1 && master[0].name === CAT_NAME && /고정 코드/.test(master[0].description || ''), master.map((m) => m.name).join(','));
  const parts = await q(`SELECT use_tp FROM public.tb_s080_code_categories WHERE build_id = '1' AND category = $1`, [CAT]);
  const lines = await q(`SELECT code, name, use_tp, sort_order, is_active FROM public.tb_s080_codes_line
    WHERE build_id = '1' AND category = $1 ORDER BY sort_order, code`, [CAT]);
  const fmt = (rows) => rows.map(([c, nm], i) => `${i + 1}.${c}=${nm}`).join(' ');
  check('C2', `${CAT} — 파티션 000 하나 · 코드값 ${WANT.length}개 · 이름 · 순서 그대로 · 모두 켜짐`,
    parts.length === 1 && parts[0].use_tp === '000' && fmt(lines.map((l) => [l.code, l.name])) === fmt(WANT) &&
    lines.every((l, i) => l.use_tp === '000' && l.sort_order === i + 1 && l.is_active),
    fmt(lines.map((l) => [l.code, l.name])));
}

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

  const rls = await q(`SELECT relrowsecurity r, relforcerowsecurity f FROM pg_class WHERE relname = $1`, [H]);
  const pol = await q(`SELECT 1 FROM pg_policies WHERE schemaname='public' AND policyname='erp_org_scope' AND tablename = $1
    AND qual LIKE '%erp_is_operator()%' AND qual LIKE '%erp_current_org_id()%' AND with_check LIKE '%erp_current_org_id()%'`, [H]);
  check('S3', `★ ${H} — RLS ENABLE + FORCE + erp_org_scope(운영사 · 자기 단체) 정책`,
    rls.length === 1 && rls[0].r && rls[0].f && pol.length === 1, JSON.stringify({ rls, pol: pol.length }));

  const cks = (await q(`SELECT conname FROM pg_constraint WHERE contype='c' AND conrelid = to_regclass('public.${H}')`)).map((r) => r.conname);
  check('S4', `${H} — CHECK ${CKS.length}개 이름 그대로`, CKS.every((c) => cks.includes(c)) && cks.length === CKS.length, cks.sort().join(','));

  const idx = (await q(`SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename=$1`, [H])).map((r) => r.indexname);
  const fks = await q(`SELECT 1 FROM pg_constraint WHERE contype='f' AND conrelid = to_regclass('public.${H}')`);
  check('S5', `${H} — 색인 ${IXS.join(',')} · FK 없음(이력은 파일 · 설정이 지워져도 남는다)`,
    IXS.every((i) => idx.includes(i)) && fks.length === 0, idx.sort().join(','));

  const pr = (await q(`SELECT
      has_table_privilege('erp_app', 'public.${H}', 'SELECT') sel,
      has_table_privilege('erp_app', 'public.${H}', 'INSERT') ins,
      has_table_privilege('erp_app', 'public.${H}', 'UPDATE') upd,
      has_table_privilege('erp_app', 'public.${H}', 'DELETE') del,
      (SELECT count(*)::int FROM information_schema.column_privileges
        WHERE table_schema='public' AND table_name='${H}' AND grantee='erp_app' AND privilege_type='UPDATE') colupd`))[0];
  check('S6', `★ ${H} — erp_app 읽기 · 넣기만(고치기 · 지우기 없음, 칸 고치기도 없음)`,
    pr.sel && pr.ins && !pr.upd && !pr.del && pr.colupd === 0, JSON.stringify(pr));

  const left = await q(`SELECT grantee FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name = $1 AND grantee IN ('anon', 'authenticated', 'PUBLIC')`, [H]);
  check('S7', `${H} — check-grants 기준 anon · authenticated · PUBLIC 권한 0건`, left.length === 0, left.map((r) => r.grantee).join(','));
  return true;
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
  const log = (id, org, x = {}) =>
    tryRun(`INSERT INTO public.${H} (id, org_id, handoff_tp, period_from, period_to, recipients, file_name, row_count, ok, fail_reason,
        sent_by, sent_by_name)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, '7', $11)`,
    [id, org, x.tp ?? 'T', x.from ?? '2026-07-01', x.to ?? '2026-09-30',
      x.to_ === undefined ? ['tax@example.com'] : x.to_, x.file === undefined ? '세무자료_부가세_2026년3분기.xlsx' : x.file,
      x.rows ?? 12, x.ok ?? true, x.reason === undefined ? null : x.reason, x.name === undefined ? '시험 사용자' : x.name]);
  const idsOf = async () => (await q(`SELECT id FROM public.${H} WHERE id LIKE 'v218-%' ORDER BY 1`)).map((r) => r.id).join();

  await tx.begin();
  try {
    await scope('operator', null);
    const ok = [
      await log('v218-a1', ORG_A),
      await log('v218-a2', ORG_A, { ok: false, reason: '메일 서버에 연결하지 못했습니다', name: null }),
      await log('v218-a3', ORG_A, { tp: 'M', to_: ['a@example.com', 'b@example.com', 'c@example.com'], rows: 0 }),
      await log('v218-b1', ORG_B),
    ];
    check('H1', '운영사 — 성공 · 실패(사유 · 이름 없음) · 원천세 · 받는 사람 셋 · 다른 단체 줄을 넣는다',
      ok.every((r) => r.code === null), ok.map((r) => r.code).join(' '));

    const bad = [
      await log('v218-x1', ORG_A, { tp: 'X' }),
      await log('v218-x2', ORG_A, { from: '2026-07-02' }),
      await log('v218-x3', ORG_A, { from: '2026-09-01', to: '2026-07-31' }),
      await log('v218-x4', ORG_A, { to_: [] }),
      await log('v218-x5', ORG_A, { to_: ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com'] }),
      await log('v218-x6', ORG_A, { file: '   ' }),
      await log('v218-x7', ORG_A, { rows: -1 }),
      await log('v218-x8', ORG_A, { ok: false, reason: null }),
      await log('v218-x9', ORG_A, { ok: true, reason: '성공인데 사유' }),
    ];
    check('H2', '★ CHECK — 종류 T/M · 기간 첫날은 1일 · 끝 ≥ 시작 · 받는 사람 1~4(219) · 파일 이름 빈칸 없음 · 줄 수 0 이상 · 실패일 때만 사유(23514)',
      bad.every((r) => r.code === '23514'), bad.map((r) => r.code).join(' '));

    await scope('tenant', ORG_A);
    const RLS_NOTE = '시험(표 주인 postgres)은 BYPASSRLS — 적용 뒤 erp_app 으로';
    if (tx.asOwner) {
      skip('H6', '회사 A — 자기 단체 이력만 보인다', RLS_NOTE);
      skip('H7', '★ 회사 A — 남의 단체로 넣기는 막힌다(42501)', RLS_NOTE);
      skip('H8', '★ 이력 고치기 · 지우기 — 권한 없음(42501)', '시험(표 주인)은 권한이 다 있다 — 적용 뒤 erp_app 으로');
    } else {
      const seen = await idsOf();
      check('H6', '회사 A — 자기 단체 이력만 보인다', seen === 'v218-a1,v218-a2,v218-a3', seen);
      const other = await log('v218-o1', ORG_B);
      check('H7', '★ 회사 A — 남의 단체로 넣기는 막힌다(42501)', other.code === '42501', `code=${other.code}`);
      const deny = [
        await tryRun(`UPDATE public.${H} SET ok = false, fail_reason = '고침' WHERE id = 'v218-a1'`),
        await tryRun(`DELETE FROM public.${H} WHERE id = 'v218-a1'`),
      ];
      check('H8', '★ 이력 고치기 · 지우기 — 권한 없음(42501)', deny.every((r) => r.code === '42501'), deny.map((r) => r.code).join(' '));
    }
    await scope('tenant', null);
    if (tx.asOwner) skip('H9', '단체 ID 없는 회사 세션 — 0건', RLS_NOTE);
    else check('H9', '단체 ID 없는 회사 세션 — 0건', (await idsOf()) === '');
  } finally {
    await tx.end();
  }

  await tx.begin();
  try {
    await scope('operator', null);
    const left = (await q(`SELECT count(*)::int n FROM public.${H} WHERE id LIKE 'v218-%'`))[0].n;
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
      for (const f of dryFiles) { await pc.query(bodyOf(f)); console.log(`(시험) 돌림: ${f}`); }
      await codes(pq);
      if (await structure(pq)) await rowChecks(pc, {
        asOwner: true,
        begin: () => pc.query('SAVEPOINT vr'),
        end: () => pc.query('ROLLBACK TO SAVEPOINT vr'),
      });
    } finally {
      await pc.query('ROLLBACK');
    }
    const gone = (await pq(`SELECT to_regclass('public.${H}') t,
      (SELECT count(*)::int FROM public.tb_s080_code_masters WHERE category = $1) c`, [CAT]))[0];
    check('Z2', '(시험) ROLLBACK 뒤 새 표 · 새 분류가 없다 — DB 는 그대로', gone.t === null && gone.c === 0, JSON.stringify(gone));
    await pc.end();
  } else {
    let hasTable = false;
    try {
      await codes(pq);
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
