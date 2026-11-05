/**
 * 일회용(2026-11-05) — 정관 제2조 목적 목록 행에 「내용에 맞춤」 표시(결정 2026-11-05).
 *
 * 표양식 「정관」 · 「정관(유한회사)」에서 `{{articlesPurposeList}}` 칸 하나에 `fitHeight: true` 를 붙인다.
 * 그 행은 목적 줄 수만큼만 높이를 쓰고(목적이 적으면 제3조가 바로 아래로 올라온다), 저장된 높이 · 다른 칸 ·
 * 다른 행 · 다른 서식은 그대로다. 그리기는 `FormDocument`(`fitRowsOf`)가 한다.
 * ★ 장 나누기(§6-2 20번)는 다시 하지 않는다 — 행이 줄어들기만 하므로 넘침이 없다.
 *
 * ★ 기본은 **보기만** 한다(읽기 전용 트랜잭션). `--apply` 일 때만 한 트랜잭션으로 쓰고 되읽는다.
 *   멈추는 경우(아무것도 쓰지 않는다): 양식이 이름으로 정확히 1건이 아님 · 목록 칸이 정확히 1개가 아님 ·
 *   그 칸의 걸침(rowSpan)이 1 이 아님 · 이미 표시가 있음 · 양식이 보기 뒤에 바뀜(수정 시각) · 고친 정의가 검사에 걸림.
 * ★ 접속 값은 환경 폴더의 admin.env 다. 값은 출력하지 않는다.
 *
 *   npx tsx scripts/oneoff/2026-11-05-articles-purpose-fit.mjs <admin.env>            (보기)
 *   npx tsx scripts/oneoff/2026-11-05-articles-purpose-fit.mjs <admin.env> --apply    (쓰기)
 */
import fs from 'node:fs';
import pg from 'pg';
import { fitRowsOf, migrateDefinition } from '../../packages/shared/src/domain/form-template.ts';

const envPath = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!envPath) {
  console.error('사용법: npx tsx scripts/oneoff/2026-11-05-articles-purpose-fit.mjs <admin.env> [--apply]');
  process.exit(2);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').replace(/^﻿/, '').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const FORM_NAMES = ['정관', '정관(유한회사)'];
const TOKEN = '{{articlesPurposeList}}';
const ACTOR = 'oneoff-2026-11-05';

const c = new pg.Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });

/** 고칠 자리 — 원본 JSON 에서 칸 하나만 바꾼 사본을 만든다(다른 키는 그대로). */
function plan(row) {
  const raw = row.definition;
  const hits = [];
  (raw.pages ?? []).forEach((p, pi) => (p.cells ?? []).forEach((cell, ci) => {
    if (typeof cell.text === 'string' && cell.text.includes(TOKEN)) hits.push({ pi, ci, cell, height: p.rowHeights?.[cell.row] });
  }));
  if (hits.length !== 1) throw new Error(`「${row.name}」 — ${TOKEN} 칸이 ${hits.length}개다(1개여야 한다)`);
  const [h] = hits;
  if ((h.cell.rowSpan ?? 1) !== 1) throw new Error(`「${row.name}」 — 목록 칸의 걸침이 ${h.cell.rowSpan} 이다(1 이어야 한다)`);
  if (h.cell.fitHeight !== undefined) throw new Error(`「${row.name}」 — 이미 표시가 있다(fitHeight=${h.cell.fitHeight})`);
  const next = structuredClone(raw);
  next.pages[h.pi].cells[h.ci].fitHeight = true;
  // 검사 — 앱이 읽는 그대로 읽혀야 하고, 맞춤 행은 이 행 하나뿐이어야 한다
  const def = migrateDefinition(next);
  const fitPages = def.pages.map((p, i) => [i, [...fitRowsOf(p)]]).filter(([, rows]) => rows.length > 0);
  if (fitPages.length !== 1 || fitPages[0][0] !== h.pi || fitPages[0][1].join() !== String(h.cell.row)) {
    throw new Error(`「${row.name}」 — 고친 뒤 맞춤 행이 기대와 다르다: ${JSON.stringify(fitPages)}`);
  }
  return { id: row.id, name: row.name, updatedAt: row.updated_at.toISOString(), page: h.pi + 1, row: h.cell.row + 1, height: h.height, next };
}

async function main() {
  await c.connect();
  await c.query(APPLY ? 'BEGIN' : 'BEGIN READ ONLY');
  try {
    const plans = [];
    for (const name of FORM_NAMES) {
      const rows = (await c.query(
        `SELECT id, name, definition, updated_at FROM public.tb_s080_form_templates WHERE operator_id = 1 AND name = $1`,
        [name],
      )).rows;
      if (rows.length !== 1) throw new Error(`「${name}」 이 ${rows.length}건이다(1건이어야 한다)`);
      plans.push(plan(rows[0]));
    }
    console.table(plans.map((p) => ({ 양식: p.name, 장: p.page, 행: p.row, '저장 높이(cm)': p.height, 바꿀것: 'fitHeight: true (그 칸 하나)', 수정시각: p.updatedAt })));

    if (!APPLY) {
      await c.query('ROLLBACK');
      console.log('보기만 했다 — 쓰려면 --apply');
      return;
    }
    for (const p of plans) {
      const { rows } = await c.query(`SELECT updated_at FROM public.tb_s080_form_templates WHERE id = $1 FOR UPDATE`, [p.id]);
      if (rows.length !== 1 || rows[0].updated_at.toISOString() !== p.updatedAt) throw new Error(`「${p.name}」 이 보기 뒤에 바뀌었다`);
      await c.query(
        `UPDATE public.tb_s080_form_templates SET definition = $2::jsonb, updated_at = now(), updated_by = $3 WHERE id = $1`,
        [p.id, JSON.stringify(p.next), ACTOR],
      );
    }
    // 되읽기 — 맞춤 행 · 저장 높이
    const after = [];
    for (const p of plans) {
      const r = (await c.query(`SELECT definition FROM public.tb_s080_form_templates WHERE id = $1`, [p.id])).rows[0];
      const def = migrateDefinition(r.definition);
      const pg0 = def.pages[p.page - 1];
      after.push({ 양식: p.name, 맞춤행: [...fitRowsOf(pg0)].map((x) => `${p.page}장 ${x + 1}행`).join(), '저장 높이(cm)': pg0.rowHeights[p.row - 1], 장수: def.pages.length });
    }
    console.table(after);
    if (after.some((a, i) => a.맞춤행 !== `${plans[i].page}장 ${plans[i].row}행` || a['저장 높이(cm)'] !== plans[i].height)) throw new Error('되읽은 값이 다르다 — 되돌린다');
    await c.query('COMMIT');
    console.log(`적용했다 — 양식 ${plans.length}건`);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  }
}

main()
  .then(() => c.end())
  .catch(async (e) => {
    console.error('✘ 멈춤:', e.message, '(아무것도 쓰지 않았다)');
    await c.end().catch(() => {});
    process.exit(1);
  });
