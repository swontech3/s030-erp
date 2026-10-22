/**
 * 일회용(2026-10-22) — 사업목적 카탈로그(030, `tb_s080_biz_purpose_catalog`)의 업종코드 두 줄을 업종 사전(047)에 맞춘다.
 *
 * 사용자 결정(2026-10-22): 카탈로그 업종코드가 047 과 다른 업종을 가리키는 두 줄 —
 *   · 「경영 컨설팅업」  701201(047: 비주거용 건물 임대업) → 741400(047: 경영 컨설팅업)
 *   · 「그 외 기타 분류 안된 협회 및 단체」  940909(047: 기타인적용역자) → 비움(NULL)
 * 「추천」 탭은 카탈로그에 그 업종코드 문구가 있으면 그 문구를 제안한다 — 고치지 않으면 701201(임대업)에 「경영 컨설팅업」이 나온다.
 *
 * ★ 업종코드(`biz_code`)만 바꾼다. 문구 · KSIC · 인허가 칸 · 사용 여부는 건드리지 않는다. `updated_at` 은 지금으로.
 * ★ 하나라도 어긋나면 아무것도 쓰지 않고 멈춘다 — (지금 업종코드, 문구) 줄이 정확히 1건이 아님,
 *   새 업종코드가 047 에 없음 · 사용 안 함, 새 업종코드를 다른 카탈로그 줄이 이미 씀(041 UNIQUE).
 *   두 번 돌리면 「이미 바뀜」으로 멈춘다.
 * ★ 기본은 **보기만** 한다(읽기 전용 트랜잭션). `--apply` 일 때만 쓴다(한 트랜잭션).
 *
 *   node scripts/oneoff/2026-10-22-catalog-biz-code.js .env            (보기)
 *   node scripts/oneoff/2026-10-22-catalog-biz-code.js .env --apply    (쓰기)
 */
const fs = require('fs');
const { Client } = require('pg');

const envPath = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!envPath) {
  console.error('사용법: node scripts/oneoff/2026-10-22-catalog-biz-code.js <.env> [--apply]');
  process.exit(2);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

/** [지금 업종코드, 문구, 새 업종코드(null = 비움)] */
const FIXES = [
  ['701201', '경영 컨설팅업', '741400'],
  ['940909', '그 외 기타 분류 안된 협회 및 단체', null],
];

(async () => {
  const c = new Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
  await c.connect();
  await c.query(APPLY ? 'BEGIN' : 'BEGIN READ ONLY');
  try {
    const bad = [];
    const plan = [];
    for (const [from, text, to] of FIXES) {
      const { rows } = await c.query(
        `SELECT id, biz_code, biz_name, ksic_code, active FROM public.tb_s080_biz_purpose_catalog
          WHERE biz_code = $1 AND btrim(biz_name) = $2 ${APPLY ? 'FOR UPDATE' : ''}`,
        [from, text],
      );
      if (rows.length !== 1) { bad.push(`「${text}」(${from}) 이 ${rows.length}건입니다 — 1건이어야 합니다(이미 바뀜?)`); continue; }
      const row = rows[0];
      const fromName = (await c.query('SELECT item_name FROM public.tb_s080_biz_code WHERE biz_code = $1', [from])).rows[0]?.item_name ?? '(047 에 없음)';
      let toName = '(비움)';
      if (to !== null) {
        const d = (await c.query('SELECT item_name, active FROM public.tb_s080_biz_code WHERE biz_code = $1', [to])).rows[0];
        if (!d) bad.push(`${to}: 047 에 없습니다`);
        else if (!d.active) bad.push(`${to}: 047 에서 사용 안 함입니다`);
        toName = d ? d.item_name : '(없음)';
        const used = (await c.query('SELECT id, biz_name FROM public.tb_s080_biz_purpose_catalog WHERE biz_code = $1', [to])).rows;
        if (used.length) bad.push(`${to}: 다른 카탈로그 줄이 이미 씁니다(${used.map((u) => `「${u.biz_name}」`).join(' · ')})`);
      }
      console.log(`■ 「${row.biz_name}」 (${row.id}${row.active ? '' : ' · 사용 안 함'} · KSIC ${row.ksic_code ?? '—'} 그대로)`);
      console.log(`  업종코드 ${from}(047: ${fromName}) → ${to ?? 'NULL'}${to ? `(047: ${toName})` : ''}`);
      plan.push({ id: row.id, to });
    }
    if (bad.length) throw new Error(`어긋남 ${bad.length} — 아무것도 쓰지 않았습니다\n  ${bad.join('\n  ')}`);

    if (!APPLY) { console.log(`\n바꿀 줄 ${plan.length}. 보기만 했습니다. 쓰려면 --apply.`); await c.query('ROLLBACK'); return; }

    for (const p of plan) {
      const r = await c.query('UPDATE public.tb_s080_biz_purpose_catalog SET biz_code = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [p.id, p.to]);
      if (r.rowCount !== 1) throw new Error(`${p.id}: ${r.rowCount}줄이 바뀌었습니다 — 되돌렸습니다`);
    }
    await c.query('COMMIT');
    console.log(`✔ 썼습니다 — ${plan.length}줄`);
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    await c.end();
  }
})().catch((e) => { console.error(`✘ ${e.message}`); process.exit(1); });
