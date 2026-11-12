/**
 * 223 검증 — 세무(S05) 세금 납부 구분 코드(TAX_PAY_SRC, 2026-11-08 대표 수정 ⑥ 메뉴 셋으로 나누기).
 *
 *   NTAX 국세 · LTAX 지방세(켜짐, 고정 코드 — 코드값 = 자료 종류). 「세금 전체」는 선택 상자 첫 줄이고 코드가 아니다.
 *   코드 세 표에 줄만 더한다 — 표 · 칸 · 권한은 그대로.
 *
 * 사용: node scripts/verify-223.js .env packages/api/.env
 * 적용 전 시험: node scripts/verify-223.js .env packages/api/.env --dry-run supabase/migrations/223_tax_pay_src.sql
 *   postgres 한 접속 · 한 트랜잭션 안에서 파일을 돌리고(파일의 BEGIN; · COMMIT; 줄은 걷음) 검증한 뒤 **늘 ROLLBACK** 한다.
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

const CAT = 'TAX_PAY_SRC';
/** 기대값 — [코드값, 이름, 순서, 켜짐]. */
const EXPECTED = [
  ['NTAX', '국세', 1, true],
  ['LTAX', '지방세', 2, true],
];

const results = [];
const check = (id, what, cond, note = '') => results.push({ 항목: id, 내용: what, 결과: cond ? '통과' : '실패', 비고: note });

async function checks(pc) {
  const q = (s, p) => pc.query(s, p).then((r) => r.rows);
  const masters = await q(`SELECT name FROM public.tb_s080_code_masters WHERE build_id = '1' AND category = $1`, [CAT]);
  check('C1', '코드 분류 하나 — 세금 납부 구분', masters.length === 1 && masters[0].name === '세금 납부 구분', masters.map((m) => m.name).join(','));
  const parts = await q(`SELECT use_tp FROM public.tb_s080_code_categories WHERE build_id = '1' AND category = $1`, [CAT]);
  check('C2', '파티션 — 공통(000) 하나', parts.length === 1 && parts[0].use_tp === '000', parts.map((p) => p.use_tp).join(','));
  const lines = await q(`SELECT code, name, sort_order, is_active FROM public.tb_s080_codes_line
    WHERE build_id = '1' AND category = $1 AND use_tp = '000' ORDER BY sort_order`, [CAT]);
  const bad = EXPECTED.filter(([code, name, order, active]) => {
    const l = lines.find((x) => x.code === code);
    return !l || l.name !== name || l.sort_order !== order || l.is_active !== active;
  });
  check('C3', '코드 2줄 — NTAX 국세 · LTAX 지방세(이름 · 순서 · 켜짐)', lines.length === 2 && bad.length === 0, bad.map((b) => b[0]).join(',') || `${lines.length}줄`);
  const kinds = await q(`SELECT code FROM public.tb_s080_codes_line WHERE build_id = '1' AND category = 'TAX_KIND' AND code = ANY($1)`, [['NTAX', 'LTAX']]);
  check('C4', '★ 코드값이 자료 종류(TAX_KIND) 코드값과 같다 — 주소 tab 으로 그대로 쓴다', kinds.length === 2, kinds.map((k) => k.code).join(','));
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
    const n = (await pc.query(`SELECT count(*)::int n FROM public.tb_s080_code_masters WHERE category = $1`, [CAT])).rows[0].n;
    check('Z1', '(시험) ROLLBACK 뒤 분류가 없다 — DB 는 그대로', n === 0, `분류 ${n}`);
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
