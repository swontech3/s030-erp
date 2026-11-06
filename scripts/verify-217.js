/**
 * 217 검증 — 세무(S05) 「공제 안 될 수 있는 매입 항목」 코드 분류(TAX_NODEDUCT_ITEM, 1-8 · 2026-11-05 대표 결정 4).
 *
 *   분류 TAX_NODEDUCT_ITEM · 파티션 000 하나 · 코드 줄 넷 — 코드 이름 = 출금 항목(TAX_ITEM_OUT) 코드값
 *     ENTERTAIN 접대비 · NONBIZ_TAXPRO 사업과 무관(법인) · NONBIZ_OWNER 사업과 무관(개인) · VEHICLE 차량유지비
 *
 * 사용: node scripts/verify-217.js .env packages/api/.env
 * 적용 전 시험: node scripts/verify-217.js .env packages/api/.env --dry-run supabase/migrations/217_tax_nodeduct_items.sql
 *   postgres 한 접속 · 한 트랜잭션 안에서 파일을 돌리고(BEGIN; · COMMIT; 줄은 걷음) 읽은 뒤 **늘 ROLLBACK** 한다.
 *
 * ★ 읽기만 한다. 앱과 같은 길(erp_app · 운영사 스코프)에서 읽는다(verify-213 · 215 와 같은 방식).
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

const CAT = 'TAX_NODEDUCT_ITEM';
const CAT_NAME = '공제 안 될 수 있는 매입 항목';
/** [코드값, 이름(= 출금 항목 코드값)] — 순서 = 코드 표 순서. */
const WANT = [['ENTERTAIN', 'ENTERTAIN'], ['NONBIZ_TAXPRO', 'NONBIZ_TAXPRO'], ['NONBIZ_OWNER', 'NONBIZ_OWNER'], ['VEHICLE', 'VEHICLE']];

const results = [];
const check = (id, what, cond, note = '') => results.push({ 항목: id, 내용: what, 결과: cond ? '통과' : '실패', 비고: note });

async function checks(q) {
  const master = await q(`SELECT name FROM public.tb_s080_code_masters WHERE build_id = '1' AND category = $1`, [CAT]);
  check('N1', `분류 ${CAT} — 이름 「${CAT_NAME}」`, master.length === 1 && master[0].name === CAT_NAME, master.map((m) => m.name).join(','));
  const parts = await q(`SELECT use_tp FROM public.tb_s080_code_categories WHERE build_id = '1' AND category = $1`, [CAT]);
  const lines = await q(`SELECT code, name, use_tp, sort_order, is_active FROM public.tb_s080_codes_line
    WHERE build_id = '1' AND category = $1 ORDER BY sort_order, code`, [CAT]);
  const fmt = (rows) => rows.map(([c, nm], i) => `${i + 1}.${c}=${nm}`).join(' ');
  check('N2', `${CAT} — 파티션 000 하나 · 코드값 ${WANT.length}개 · 이름 · 순서 그대로 · 모두 켜짐`,
    parts.length === 1 && parts[0].use_tp === '000' && fmt(lines.map((l) => [l.code, l.name])) === fmt(WANT) &&
    lines.every((l, i) => l.use_tp === '000' && l.sort_order === i + 1 && l.is_active),
    fmt(lines.map((l) => [l.code, l.name])));
  // ★ 코드 이름은 출금 항목 코드값이다 — 어느 파티션(001 법인 · 002 개인)에든 있어야 한다
  const items = (await q(`SELECT DISTINCT code FROM public.tb_s080_codes_line WHERE build_id = '1' AND category = 'TAX_ITEM_OUT'`)).map((r) => r.code);
  const missing = lines.filter((l) => !items.includes(l.name)).map((l) => l.name);
  check('N3', '코드 이름이 모두 출금 항목(TAX_ITEM_OUT) 코드값이다', lines.length > 0 && missing.length === 0, missing.join(',') || `${lines.length}줄`);
}

const bodyOf = (file) => fs.readFileSync(file, 'utf8').replace(/^BEGIN;[ \t]*$/m, '').replace(/^COMMIT;[ \t]*$/m, '');

(async () => {
  if (dryFiles) {
    if (dryFiles.length === 0) throw new Error('--dry-run 뒤에 마이그레이션 파일을 적는다');
    const pc = new Client({ host: rootEnv.DB_HOST, port: +rootEnv.DB_PORT, user: rootEnv.DB_USER, password: rootEnv.DB_PASSWORD, database: rootEnv.DB_NAME });
    await pc.connect();
    await pc.query('BEGIN');
    try {
      for (const f of dryFiles) { await pc.query(bodyOf(f)); console.log(`(시험) 돌림: ${f}`); }
      await pc.query(`SELECT set_config('app.current_role', 'operator', true)`);
      await checks((s, p) => pc.query(s, p).then((r) => r.rows));
    } finally {
      await pc.query('ROLLBACK');
    }
    const left = (await pc.query(`SELECT count(*)::int n FROM public.tb_s080_code_masters WHERE category = $1`, [CAT])).rows[0].n;
    check('Z1', '(시험) ROLLBACK 뒤 새 분류가 없다 — DB 는 그대로', left === 0, String(left));
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
