/**
 * 일회용(2026-10-11) — 「사내이사 중임승낙서」의 법무 표시 회사유형을 전체(ALL) → 주식회사(R)로 바꾼다.
 *
 * 사용자 결정(2026-10-11): 취임승낙서와 같이 주식회사 전용으로(문구에 「주주총회」 · 「사내이사」).
 * ★ 법무 표시의 다른 칸(변경 구분 · 단위 · 임원 구분)과 양식 내용은 건드리지 않는다.
 * ★ 기본은 **보기만** 한다. `--apply` 일 때만 쓴다(한 트랜잭션).
 * ★ 양식이 정확히 1건이고, 법무 표시가 있고, 회사유형이 지금 ALL 일 때만 바꾼다 — 아니면 멈춘다(두 번 돌려도 안전).
 *
 *   node scripts/oneoff/2026-10-11-reelect-form-company-type.js .env            (보기)
 *   node scripts/oneoff/2026-10-11-reelect-form-company-type.js .env --apply    (쓰기)
 */
const fs = require('fs');
const { Client } = require('pg');

const envPath = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!envPath) {
  console.error('사용법: node scripts/oneoff/2026-10-11-reelect-form-company-type.js <.env> [--apply]');
  process.exit(2);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const NAME = '사내이사 중임승낙서';

(async () => {
  const c = new Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
  await c.connect();
  await c.query('BEGIN');
  try {
    const { rows } = await c.query(
      `SELECT id, definition FROM public.tb_s080_form_templates WHERE operator_id = 1 AND name = $1 FOR UPDATE`,
      [NAME],
    );
    if (rows.length !== 1) throw new Error(`「${NAME}」 이 ${rows.length}건입니다 — 1건이어야 합니다`);
    const { id, definition } = rows[0];
    const legal = definition.legal;
    if (!legal) throw new Error('법무 표시가 없습니다');
    if (legal.companyType !== 'ALL') throw new Error(`회사유형이 이미 ${legal.companyType} 입니다 — 손대지 않습니다`);

    const next = { ...definition, legal: { ...legal, companyType: 'R' } };
    console.log(`■ ${NAME} (${id})`);
    console.log(`  전 legal: ${JSON.stringify(legal)}`);
    console.log(`  후 legal: ${JSON.stringify(next.legal)}`);
    console.log('  바뀌는 것: 회사유형 ALL → R 하나. 칸 · 자리표시 · 다른 표시 칸은 그대로');

    if (!APPLY) {
      await c.query('ROLLBACK');
      console.log('\n보기만 했습니다 — 쓰려면 --apply');
      return;
    }
    await c.query(
      `UPDATE public.tb_s080_form_templates SET definition = $2::jsonb, updated_at = now(), updated_by = 'oneoff-2026-10-11' WHERE id = $1`,
      [id, JSON.stringify(next)],
    );
    await c.query('COMMIT');
    console.log('\n썼습니다 — 1건');
  } catch (e) {
    await c.query('ROLLBACK');
    console.error(`\n멈춤 — ${e.message} (아무것도 쓰지 않았습니다)`);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})();
