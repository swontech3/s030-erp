/**
 * 220 검증 — 세무(S05) 거래처 종료 여부 칸(2026-11-07 대표 수정 ③ 거래처).
 *
 *   tb_s050_vendors.is_closed boolean NOT NULL DEFAULT false — 거래 중(false) · 종료(true). 있는 거래처는 모두 거래 중.
 *   표시 · 거르기만 한다 — 자료 올리기의 거래처 자동 등록 · 연결 규칙은 그대로(종료된 거래처에 새 자료가 붙어도 둔다).
 *
 * 사용: node scripts/verify-220.js .env packages/api/.env
 * 적용 전 시험: node scripts/verify-220.js .env packages/api/.env --dry-run supabase/migrations/220_tax_vendor_closed.sql
 *   postgres 한 접속 · 한 트랜잭션 안에서 파일을 돌리고(파일의 BEGIN; · COMMIT; 줄은 걷음) 검증한 뒤 **늘 ROLLBACK** 한다.
 *
 * ★ 시험 행은 트랜잭션 안에서 넣고 ROLLBACK 한다. 남는 것이 없다. 시험 값은 모두 지어낸 값이다.
 * ★ 권한은 그대로다 — erp_app 은 거래처 표에 표 단위 UPDATE 가 있어(203) 새 칸도 고칠 수 있다. 여기서는 그 권한이 있는지만 본다.
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
const dryAt = process.argv.indexOf('--dry-run');
const dryFiles = dryAt >= 0 ? process.argv.slice(dryAt + 1) : null;

const V = 'tb_s050_vendors';
const ORG_A = 990001;

const results = [];
const check = (id, what, cond, note = '') => results.push({ 항목: id, 내용: what, 결과: cond ? '통과' : '실패', 비고: note });

async function checks(pc) {
  const q = (s, p) => pc.query(s, p).then((r) => r.rows);
  const col = (await q(`SELECT data_type, is_nullable, column_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'is_closed'`, [V]))[0];
  check('C1', `${V}.is_closed — boolean · NOT NULL · 기본값 false(거래 중)`,
    !!col && col.data_type === 'boolean' && col.is_nullable === 'NO' && col.column_default === 'false', JSON.stringify(col ?? null));
  const cm = (await q(`SELECT col_description('public.${V}'::regclass, a.attnum) d FROM pg_attribute a
    WHERE a.attrelid = 'public.${V}'::regclass AND a.attname = 'is_closed'`))[0]?.d ?? '';
  check('C2', '칸 설명이 있다(거래 중 · 종료, 표시 · 거르기만)', cm.includes('종료'), cm.slice(0, 40));
  const n = (await q(`SELECT count(*)::int n FROM public.${V} WHERE is_closed`))[0]?.n;
  check('C3', '있는 거래처는 모두 거래 중(종료 0)', n === 0, String(n));
  const pr = (await q(`SELECT has_column_privilege('erp_app', 'public.${V}', 'is_closed', 'UPDATE') u,
    has_column_privilege('erp_app', 'public.${V}', 'is_closed', 'SELECT') s`))[0];
  check('C4', 'erp_app 이 새 칸을 읽고 고칠 수 있다(203 의 표 단위 권한 그대로)', pr.u && pr.s, JSON.stringify(pr));

  await pc.query('SAVEPOINT s');
  try {
    await pc.query(`SELECT set_config('app.current_role', 'operator', true)`);
    await pc.query(`INSERT INTO public.${V} (id, org_id, name, biz_no, vendor_tp, first_kind, first_direction)
      VALUES ('v220-a', $1, '지어낸 거래처', NULL, 'G', 'INVOICE', 'P')`, [ORG_A]);
    const fresh = (await q(`SELECT is_closed FROM public.${V} WHERE id = 'v220-a'`))[0]?.is_closed;
    await pc.query(`UPDATE public.${V} SET is_closed = true WHERE id = 'v220-a'`);
    const closed = (await q(`SELECT is_closed FROM public.${V} WHERE id = 'v220-a'`))[0]?.is_closed;
    let nullCode = null;
    try {
      await pc.query('SAVEPOINT n');
      await pc.query(`UPDATE public.${V} SET is_closed = NULL WHERE id = 'v220-a'`);
    } catch (e) {
      nullCode = e.code;
    } finally {
      await pc.query('ROLLBACK TO SAVEPOINT n');
    }
    check('C5', '★ 새 거래처는 거래 중 · 종료로 바꿀 수 있다 · 비울 수 없다(23502)', fresh === false && closed === true && nullCode === '23502',
      `새=${fresh} 종료=${closed} 비움=${nullCode}`);
  } finally {
    await pc.query('ROLLBACK TO SAVEPOINT s');
  }
}

const bodyOf = (file) => fs.readFileSync(file, 'utf8').replace(/^BEGIN;[ \t]*$/m, '').replace(/^COMMIT;[ \t]*$/m, '');

(async () => {
  const pc = new Client({ host: rootEnv.DB_HOST, port: +rootEnv.DB_PORT, user: rootEnv.DB_USER, password: rootEnv.DB_PASSWORD, database: rootEnv.DB_NAME });
  await pc.connect();
  await pc.query('BEGIN');
  try {
    if (dryFiles) {
      if (dryFiles.length === 0) throw new Error('--dry-run 뒤에 마이그레이션 파일을 적는다');
      for (const f of dryFiles) { await pc.query(bodyOf(f)); console.log(`(시험) 돌림: ${f}`); }
    }
    await checks(pc);
  } finally {
    await pc.query('ROLLBACK');
  }
  if (dryFiles) {
    const left = (await pc.query(`SELECT count(*)::int n FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'is_closed'`, [V])).rows[0].n;
    check('Z2', '(시험) ROLLBACK 뒤 새 칸이 없다 — DB 는 그대로', left === 0, String(left));
  }
  const leftRow = (await pc.query(`SELECT count(*)::int n FROM public.${V} WHERE id LIKE 'v220-%'`)).rows[0].n;
  check('Z1', '롤백 후 시험 줄 0', leftRow === 0, String(leftRow));
  await pc.end();

  console.table(results);
  const failed = results.filter((r) => r.결과 !== '통과').length;
  console.log(failed === 0 ? `✔ 전부 통과 (${results.length}건)` : `✘ 실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error('✘ 실행 실패:', e.message);
  process.exit(2);
});
