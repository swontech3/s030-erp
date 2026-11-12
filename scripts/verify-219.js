/**
 * 219 검증 — 세무(S05) 세무사 전달 서류 보낸 이력의 받는 사람 1~3 → 1~4 (2026-11-07 대표 결정, 세무사 메일 4명).
 *
 *   tb_s050_handoff_logs.ck_s050_handoff_logs_recipients — cardinality(recipients) BETWEEN 1 AND 4
 *
 * 사용: node scripts/verify-219.js .env packages/api/.env
 * ★ 2026-11-08 ⑧ — 224 뒤에는 보낸 이력 표가 없어 네 항목 모두 「건너뜀」(verify-224 H2 가 받는 사람 1~4 를 잰다).
 * 적용 전 시험: node scripts/verify-219.js .env packages/api/.env --dry-run supabase/migrations/219_tax_handoff_to4.sql
 *   postgres 한 접속 · 한 트랜잭션 안에서 파일을 돌리고(파일의 BEGIN; · COMMIT; 줄은 걷음) 검증한 뒤 **늘 ROLLBACK** 한다.
 *
 * ★ 시험 행은 트랜잭션 안에서 넣고 ROLLBACK 한다. 남는 것이 없다. 시험 값은 모두 지어낸 값이다.
 * ★ 넣기 시험은 표 주인(postgres)으로 한다 — CHECK 는 역할과 상관없다. RLS · 권한은 218 그대로(verify-218 이 잰다).
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

const H = 'tb_s050_handoff_logs';
const CK = 'ck_s050_handoff_logs_recipients';
const ORG_A = 990001;

const results = [];
const check = (id, what, cond, note = '') => results.push({ 항목: id, 내용: what, 결과: cond ? '통과' : '실패', 비고: note });
const skip = (id, what, note) => results.push({ 항목: id, 내용: what, 결과: '건너뜀', 비고: note });

async function checks(pc) {
  const q = (s, p) => pc.query(s, p).then((r) => r.rows);
  // ★ 2026-11-08 ⑧ — 224 가 보낸 이력 표를 최종 발송(tb_s050_handoff_last, 받는 사람 1~4 CHECK 그대로)으로 바꿨으면 건너뛴다(verify-224 가 잰다)
  const replaced = (await q(`SELECT to_regclass('public.${H}') o, to_regclass('public.tb_s050_handoff_last') n`))[0];
  if (replaced.o === null && replaced.n !== null) {
    for (const id of ['K1', 'K2', 'K3', 'K4']) skip(id, `${H} — 받는 사람 1~4`, '224 로 표가 최종 발송으로 바뀜 — verify-224 H2 가 잰다');
    return;
  }
  const def = (await q(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid = to_regclass('public.${H}') AND conname = $1`, [CK]))[0]?.d ?? '';
  // pg 는 BETWEEN 을 「>= 1 AND <= 4」 꼴로 풀어 보여 준다
  check('K1', `${CK} — 받는 사람 1~4`, def.includes('>= 1') && def.includes('<= 4'), def || '없음');
  const n = (await q(`SELECT count(*)::int n FROM pg_constraint WHERE contype = 'c' AND conrelid = to_regclass('public.${H}')`))[0].n;
  check('K2', `${H} — CHECK 7개 그대로(받는 사람 CHECK 만 바뀜)`, n === 7, String(n));

  const tryRun = async (id, to) => {
    await pc.query('SAVEPOINT s');
    try {
      await pc.query(`SELECT set_config('app.current_role', 'operator', true)`);
      await pc.query(`INSERT INTO public.${H} (id, org_id, handoff_tp, period_from, period_to, recipients, file_name, row_count, ok, sent_by)
        VALUES ($1, $2, 'T', '2026-07-01', '2026-09-30', $3, 'v219.xlsx', 1, true, '7')`, [id, ORG_A, to]);
      await pc.query('ROLLBACK TO SAVEPOINT s');
      return null;
    } catch (e) {
      await pc.query('ROLLBACK TO SAVEPOINT s');
      return e.code;
    }
  };
  const four = await tryRun('v219-4', ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com']);
  const five = await tryRun('v219-5', ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com']);
  const none = await tryRun('v219-0', []);
  check('K3', '★ 받는 사람 4명은 들어가고 5명 · 0명은 막힌다(23514)', four === null && five === '23514' && none === '23514',
    `4=${four} 5=${five} 0=${none}`);
  const bad = (await q(`SELECT count(*)::int n FROM public.${H} WHERE cardinality(recipients) NOT BETWEEN 1 AND 4`))[0].n;
  check('K4', '있는 이력은 모두 새 CHECK 에 맞는다', bad === 0, String(bad));
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
    const def = (await pc.query(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid = to_regclass('public.${H}') AND conname = $1`, [CK])).rows[0]?.d ?? '';
    check('Z2', '(시험) ROLLBACK 뒤 CHECK 는 그대로(1~3) — DB 는 그대로', def.includes('>= 1') && def.includes('<= 3'), def);
  }
  await pc.end();

  console.table(results);
  const failed = results.filter((r) => r.결과 === '실패').length;
  const skipped = results.filter((r) => r.결과 === '건너뜀').length;
  console.log(failed === 0 ? `✔ 전부 통과 (${results.length - skipped}건${skipped ? ` · 건너뜀 ${skipped}` : ''})` : `✘ 실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error('✘ 실행 실패:', e.message);
  process.exit(2);
});
