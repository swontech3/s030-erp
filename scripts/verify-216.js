/**
 * 216 검증 — 세무(S05) 은행 파일 종류 코드 이름(TAX_BANK_FILE TXN 은행거래내역 · XFER 은행이체내역, 2026-11-05 대표 지시).
 *
 * 사용: node scripts/verify-216.js .env packages/api/.env
 * 적용 전 시험: node scripts/verify-216.js .env packages/api/.env --dry-run supabase/migrations/216_tax_bank_file_names.sql
 *   postgres 한 접속 · 한 트랜잭션 안에서 파일을 돌리고(BEGIN; · COMMIT; 줄은 걷음) 읽은 뒤 **늘 ROLLBACK** 한다.
 *
 * ★ 읽기만 한다. 앱과 같은 길(erp_app · 운영사 스코프)에서 읽는다(verify-213 과 같은 방식).
 * ★ 코드값 · 이름 · 순서는 대표가 정한 것 그대로 여기 적어 둔다 — 코드 관리에서 이름을 고치면 실패로 나온다.
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

const CAT = 'TAX_BANK_FILE';
const CAT_NAME = '은행 파일 종류';
/** [코드값, 새 이름] — 순서 = 코드 표 순서. */
const WANT = [['TXN', '은행거래내역'], ['XFER', '은행이체내역']];

const results = [];
const check = (id, what, cond, note = '') => results.push({ 항목: id, 내용: what, 결과: cond ? '통과' : '실패', 비고: note });

async function checks(q) {
  const master = await q(`SELECT name FROM public.tb_s080_code_masters WHERE build_id = '1' AND category = $1`, [CAT]);
  check('N1', `분류 ${CAT} — 이름 「${CAT_NAME}」 그대로`, master.length === 1 && master[0].name === CAT_NAME, master.map((m) => m.name).join(','));
  const lines = await q(`SELECT code, name, use_tp, sort_order, is_active FROM public.tb_s080_codes_line
    WHERE build_id = '1' AND category = $1 ORDER BY sort_order, code`, [CAT]);
  const fmt = (rows) => rows.map(([c, nm], i) => `${i + 1}.${c}=${nm}`).join(' ');
  check('N2', `${CAT} — 코드값 2개 · 새 이름(${WANT.map(([c, nm]) => `${c} ${nm}`).join(' · ')}) · 순서 · 파티션 000 · 모두 켜짐`,
    fmt(lines.map((l) => [l.code, l.name])) === fmt(WANT) &&
    lines.every((l, i) => l.use_tp === '000' && l.sort_order === i + 1 && l.is_active),
    fmt(lines.map((l) => [l.code, l.name])));
  const old = await q(`SELECT count(*)::int n FROM public.tb_s080_codes_line
    WHERE category = $1 AND name IN ('거래내역', '이체 내역')`, [CAT]);
  check('N3', '예전 이름(거래내역 · 이체 내역) 줄이 남지 않았다', old[0].n === 0, String(old[0].n));
}

const bodyOf = (file) => fs.readFileSync(file, 'utf8').replace(/^BEGIN;[ \t]*$/m, '').replace(/^COMMIT;[ \t]*$/m, '');

(async () => {
  if (dryFiles) {
    if (dryFiles.length === 0) throw new Error('--dry-run 뒤에 마이그레이션 파일을 적는다');
    const pc = new Client({ host: rootEnv.DB_HOST, port: +rootEnv.DB_PORT, user: rootEnv.DB_USER, password: rootEnv.DB_PASSWORD, database: rootEnv.DB_NAME });
    await pc.connect();
    const before = (await pc.query(`SELECT code || '=' || name AS v FROM public.tb_s080_codes_line
      WHERE category = $1 ORDER BY sort_order`, [CAT])).rows.map((r) => r.v).join(' ');
    await pc.query('BEGIN');
    try {
      for (const f of dryFiles) { await pc.query(bodyOf(f)); console.log(`(시험) 돌림: ${f}`); }
      await pc.query(`SELECT set_config('app.current_role', 'operator', true)`);
      await checks((s, p) => pc.query(s, p).then((r) => r.rows));
    } finally {
      await pc.query('ROLLBACK');
    }
    const after = (await pc.query(`SELECT code || '=' || name AS v FROM public.tb_s080_codes_line
      WHERE category = $1 ORDER BY sort_order`, [CAT])).rows.map((r) => r.v).join(' ');
    check('Z1', '(시험) ROLLBACK 뒤 이름이 시험 전 그대로 — DB 는 그대로', before === after, `${before} → ${after}`);
    await pc.end();
  } else {
    const erpUrl = apiEnv.ERP_DATABASE_URL || '';
    if (!erpUrl) check('N*', 'erp_app 접속', false, 'packages/api/.env 에 ERP_DATABASE_URL 이 없다');
    else {
      const ec = new Client({ connectionString: erpUrl });
      await ec.connect();
      try {
        await ec.query('BEGIN');
        await ec.query(`SELECT set_config('app.current_role', 'operator', true)`);
        await checks((s, p) => ec.query(s, p).then((r) => r.rows));
      } finally {
        await ec.query('ROLLBACK');
        await ec.end();
      }
    }
  }

  console.table(results);
  const failed = results.filter((r) => r.결과 !== '통과').length;
  console.log(failed === 0 ? `✔ 전부 통과 (${results.length}건)` : `✘ 실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error('✘ 실행 실패:', e.message);
  process.exit(2);
});
