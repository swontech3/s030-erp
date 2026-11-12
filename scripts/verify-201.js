/**
 * 201 검증 — 세무(S05) 세무 설정 표 둘(tb_s050_settings · tb_s050_fin_accounts).
 *
 * 사용: node scripts/verify-201.js .env packages/api/.env
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
const S = 'tb_s050_settings';
const F = 'tb_s050_fin_accounts';
/** 시험용 단체 ID — verify-037 · 040 과 같은 대역. */
const ORG_A = 990001;
const ORG_B = 990002;

const results = [];
const check = (id, what, cond, note = '') => results.push({ 항목: id, 내용: what, 결과: cond ? '통과' : '실패', 비고: note });

async function structure(q) {
  const colsOf = async (t) =>
    (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [t])).map((r) => r.column_name);
  const audit = ['created_at', 'updated_at', 'created_by', 'updated_by'];

  const sc = await colsOf(S);
  const sWant = ['org_id', 'biz_type', 'withholding_cycle', 'tax_emails', 'unused_kinds', ...audit];
  check('S1', `${S} 칸 9개`, sWant.every((c) => sc.includes(c)) && sc.length === sWant.length, sc.join(','));

  const fc = await colsOf(F);
  const fWant = ['id', 'org_id', 'kind', 'bank_code', 'card_co_code', 'number', 'alias', 'is_active', 'sort_order', ...audit];
  check('S2', `${F} 칸 13개`, fWant.every((c) => fc.includes(c)) && fc.length === fWant.length, fc.join(','));
  check('S3', '★ 카드 전체 번호 · 유효기간 칸이 없다', !fc.some((c) => /card_no|expir|valid|cvc/i.test(c)));

  const pk = (await q(`SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    WHERE i.indrelid = 'public.${S}'::regclass AND i.indisprimary`)).map((r) => r.attname);
  check('S4', `${S} — PK 는 org_id 하나(회사당 1줄)`, pk.join() === 'org_id', pk.join(','));

  const def = (await q(`SELECT column_name, column_default FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1 AND column_name IN ('withholding_cycle','tax_emails','unused_kinds')`, [S]));
  const d = Object.fromEntries(def.map((r) => [r.column_name, r.column_default || '']));
  check('S5', '기본값 — 원천세 M · 메일 [] · 쓰지 않는 자료 {}',
    /'M'/.test(d.withholding_cycle) && /'\[\]'/.test(d.tax_emails) && /'\{\}'/.test(d.unused_kinds), JSON.stringify(d));

  const cm = await q(`SELECT c.relname, obj_description(c.oid, 'pg_class') d FROM pg_class c WHERE relname IN ($1, $2)`, [S, F]);
  check('S6', '표 설명이 「세무(S05)」로 시작', cm.length === 2 && cm.every((r) => (r.d || '').startsWith('세무(S05)')),
    cm.map((r) => `${r.relname}=${(r.d || '').slice(0, 12)}`).join(' '));

  const fk = await q(`SELECT conname FROM pg_constraint WHERE conrelid IN ('public.${S}'::regclass, 'public.${F}'::regclass) AND contype = 'f'`);
  check('S7', 'FK 없음 — 계좌 · 카드 지우기 막기는 1-2', fk.length === 0, fk.map((r) => r.conname).join(','));

  for (const [id, t] of [['S8', S], ['S9', F]]) {
    const rls = (await q(`SELECT relrowsecurity r, relforcerowsecurity f,
        (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) n,
        (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'erp_org_scope') o
      FROM pg_class c WHERE relname = $1`, [t]))[0];
    check(id, `${t} — RLS ENABLE + FORCE + 정책은 erp_org_scope 하나`, rls && rls.r && rls.f && rls.n === 1 && rls.o === 1, JSON.stringify(rls));
  }

  const priv = async (t) => (await q(`SELECT
      has_table_privilege('erp_app', 'public.${t}', 'SELECT') sel,
      has_table_privilege('erp_app', 'public.${t}', 'INSERT') ins,
      has_table_privilege('erp_app', 'public.${t}', 'UPDATE') upd,
      has_table_privilege('erp_app', 'public.${t}', 'DELETE') del,
      has_table_privilege('anon', 'public.${t}', 'SELECT') anon,
      has_table_privilege('authenticated', 'public.${t}', 'SELECT') auth`))[0];
  const gs = await priv(S);
  check('S10', `${S} — erp_app 읽기 · 넣기 · 고치기(지우기 없음) / anon · authenticated 없음`,
    gs.sel && gs.ins && gs.upd && !gs.del && !gs.anon && !gs.auth, JSON.stringify(gs));
  const gf = await priv(F);
  check('S11', `${F} — erp_app 읽기 · 넣기 · 고치기 · 지우기 / anon · authenticated 없음`,
    gf.sel && gf.ins && gf.upd && gf.del && !gf.anon && !gf.auth, JSON.stringify(gf));

  const leftover = await q(`SELECT table_name, grantee FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name IN ($1, $2) AND grantee IN ('anon', 'authenticated', 'PUBLIC')`, [S, F]);
  check('S12', 'check-grants 기준 — 두 표에 anon · authenticated · PUBLIC 권한 0건', leftover.length === 0,
    leftover.map((r) => `${r.grantee}:${r.table_name}`).join(','));
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
  const setting = (org) =>
    tryRun(`INSERT INTO public.${S} (org_id, biz_type) VALUES ($1, 'C')`, [org]);
  const account = (id, org, kind, bank, card, number) =>
    tryRun(`INSERT INTO public.${F} (id, org_id, kind, bank_code, card_co_code, number)
      VALUES ($1, $2, $3, $4, $5, $6)`, [id, org, kind, bank, card, number]);
  const settingOrgs = async () =>
    (await q(`SELECT org_id FROM public.${S} WHERE org_id IN ($1, $2) ORDER BY 1`, [ORG_A, ORG_B])).map((r) => r.org_id).join();
  const accountIds = async () =>
    (await q(`SELECT id FROM public.${F} WHERE id LIKE 'v201-%' ORDER BY 1`)).map((r) => r.id).join();

  await ec.query('BEGIN');
  try {
    // --- 넣기 · 기본값 -------------------------------------------------------------
    await scope('operator', null);
    const sa = await setting(ORG_A);
    const sb = await setting(ORG_B);
    check('R1', '운영사 — 두 단체의 설정 줄을 넣는다', sa.code === null && sb.code === null, `${sa.code} ${sb.code}`);
    const row = (await q(`SELECT withholding_cycle w, tax_emails e, unused_kinds u FROM public.${S} WHERE org_id = $1`, [ORG_A]))[0];
    check('R2', '넣은 줄의 기본값 — M · [] · {}',
      row && row.w === 'M' && Array.isArray(row.e) && row.e.length === 0 && Array.isArray(row.u) && row.u.length === 0, JSON.stringify(row));
    const emailsObj = await tryRun(`UPDATE public.${S} SET tax_emails = '{"email":"a@b.c"}'::jsonb WHERE org_id = $1`, [ORG_A]);
    check('R3', '세무사 메일은 목록(배열)만 — 객체는 거절(23514)', emailsObj.code === '23514', `code=${emailsObj.code}`);
    const emailsOk = await tryRun(`UPDATE public.${S} SET tax_emails = '[{"name":"한빛세무회계","email":"tax@example.com"}]'::jsonb,
      unused_kinds = ARRAY['SOCIAL','LOAN'] WHERE org_id = $1`, [ORG_A]);
    check('R4', '세무사 메일 목록 · 쓰지 않는 자료 목록은 저장된다', emailsOk.code === null && emailsOk.rowCount === 1, `code=${emailsOk.code}`);

    const a1 = await account('v201-a-bank', ORG_A, 'B', '004', null, '12345678901234');
    const a2 = await account('v201-a-card', ORG_A, 'C', null, 'KB', '1234');
    const b1 = await account('v201-b-bank', ORG_B, 'B', '081', null, '1234567890');
    check('R5', '번호 바른 값 — 계좌 14 · 10자리, 카드 4자리는 들어간다', [a1, a2, b1].every((r) => r.code === null),
      [a1, a2, b1].map((r) => r.code).join(' '));

    // --- 번호 검사(CHECK) --------------------------------------------------------
    const bad = async (label, args) => ({ label, ...(await account(...args)) });
    const numberCases = [
      await bad('B 4자리', ['v201-x1', ORG_A, 'B', '004', null, '1234']),
      await bad('B 9자리', ['v201-x2', ORG_A, 'B', '004', null, '123456789']),
      await bad('B 문자', ['v201-x3', ORG_A, 'B', '004', null, '12345abcde']),
      await bad('B 하이픈', ['v201-x4', ORG_A, 'B', '004', null, '123-456-7890']),
      await bad('C 5자리', ['v201-x5', ORG_A, 'C', null, 'KB', '12345']),
      await bad('C 3자리', ['v201-x6', ORG_A, 'C', null, 'KB', '123']),
      await bad('C 문자', ['v201-x7', ORG_A, 'C', null, 'KB', 'abcd']),
      await bad('C 하이픈', ['v201-x8', ORG_A, 'C', null, 'KB', '12-4']),
    ];
    check('R6', '★ 번호 검사 — B 4 · 9자리 · 문자 · 하이픈, C 5 · 3자리 · 문자 · 하이픈 모두 거절(23514)',
      numberCases.every((r) => r.code === '23514'), numberCases.map((r) => `${r.label}=${r.code}`).join(' '));

    // --- 기관 코드 칸(kind 에 맞는 칸만) -------------------------------------------
    const instCases = [
      { label: 'B 에 카드사', ...(await account('v201-y1', ORG_A, 'B', null, 'KB', '1234567890')) },
      { label: 'B 에 둘 다', ...(await account('v201-y2', ORG_A, 'B', '004', 'KB', '1234567890')) },
      { label: 'B 에 은행 없음', ...(await account('v201-y3', ORG_A, 'B', null, null, '1234567890')) },
      { label: 'C 에 은행', ...(await account('v201-y4', ORG_A, 'C', '004', null, '1234')) },
      { label: 'C 에 카드사 없음', ...(await account('v201-y5', ORG_A, 'C', null, null, '1234')) },
      { label: '구분 X', ...(await account('v201-y6', ORG_A, 'X', '004', null, '1234567890')) },
    ];
    check('R7', '기관 코드 — kind 에 맞는 칸만 채운다 · 구분은 B · C 뿐(23514)',
      instCases.every((r) => r.code === '23514'), instCases.map((r) => `${r.label}=${r.code}`).join(' '));

    // --- RLS ---------------------------------------------------------------------
    check('R8', '운영사 — 두 표 모두 전부 본다(앱이 org_id 를 직접 걸어야 하는 까닭)',
      (await settingOrgs()) === `${ORG_A},${ORG_B}` && (await accountIds()) === 'v201-a-bank,v201-a-card,v201-b-bank',
      `${await settingOrgs()} / ${await accountIds()}`);

    await scope('tenant', ORG_A);
    check('R9', '회사 A — 자기 단체 줄만(설정 · 계좌 카드)',
      (await settingOrgs()) === `${ORG_A}` && (await accountIds()) === 'v201-a-bank,v201-a-card',
      `${await settingOrgs()} / ${await accountIds()}`);
    const mine = await account('v201-a-bank2', ORG_A, 'B', '020', null, '9876543210');
    check('R10', '회사 A — 자기 단체로 넣기는 된다', mine.code === null, `code=${mine.code}`);
    const otherS = await setting(ORG_B + 1);
    const otherF = await account('v201-x9', ORG_B, 'C', null, 'WOORI', '5678');
    check('R11', '★ 회사 A — 남의 단체로 넣기는 막힌다(42501)', otherS.code === '42501' && otherF.code === '42501',
      `${otherS.code} ${otherF.code}`);
    const updB = await tryRun(`UPDATE public.${F} SET alias = '변조' WHERE id = 'v201-b-bank'`);
    const delB = await tryRun(`DELETE FROM public.${F} WHERE id = 'v201-b-bank'`);
    const updSB = await tryRun(`UPDATE public.${S} SET biz_type = 'I' WHERE org_id = $1`, [ORG_B]);
    check('R12', '회사 A — 남의 단체 줄 고치기 · 지우기는 0줄', updB.rowCount === 0 && delB.rowCount === 0 && updSB.rowCount === 0,
      `${updB.code}/${updB.rowCount} ${delB.code}/${delB.rowCount} ${updSB.code}/${updSB.rowCount}`);
    const moveOut = await tryRun(`UPDATE public.${F} SET org_id = $1 WHERE id = 'v201-a-card'`, [ORG_B]);
    check('R13', '회사 A — 자기 줄을 남의 단체로 옮기기는 막힌다(42501)', moveOut.code === '42501', `code=${moveOut.code}`);
    const delMine = await tryRun(`DELETE FROM public.${F} WHERE id = 'v201-a-bank2'`);
    check('R14', '회사 A — 자기 계좌 · 카드 지우기는 된다', delMine.code === null && delMine.rowCount === 1, `${delMine.code}/${delMine.rowCount}`);

    await scope('operator', null);
    const delS = await tryRun(`DELETE FROM public.${S} WHERE org_id = $1`, [ORG_A]);
    check('R15', '★ 설정 줄은 운영사도 지우기 권한이 없다(42501)', delS.code === '42501', `code=${delS.code}`);

    await scope('tenant', null);
    check('R16', '단체 ID 없는 회사 세션 — 0건', (await settingOrgs()) === '' && (await accountIds()) === '');
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
