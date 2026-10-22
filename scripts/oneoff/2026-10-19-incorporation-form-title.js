/**
 * 일회용(2026-10-19) — 설립등기신청서 맨 위 줄을 등기 설정 값으로.
 *
 * 사용자 결정(2026-10-19):
 *   설립등기신청서 1쪽 맨 위 칸의 고정 글자 「[양식 제65-1호] 주식회사 설립 등기(발기설립)」를
 *   「{{formNo}} {{formLabel}}」로 바꾸고, 두 자리표시의 이름표(manualFields)를 그 양식에 더한다(이미 있으면 그대로).
 *   값은 등기 설정 발기설립(R_PROMOTER) 줄의 양식호수 · 표시명이다(`incorporation-print.ts`).
 *
 * ★ 바꿀 글자만 바꾼다. 칸 위치 · 칸의 다른 글자(끝 공백) · 법무 표시 · 등기 설정은 건드리지 않는다.
 * ★ 기본은 **보기만** 한다(읽기 전용 트랜잭션). `--apply` 일 때만 쓴다(한 트랜잭션).
 *   보기에는 지금 설정의 발기설립 줄 값으로 그 칸이 어떻게 찍히는지도 보여 준다.
 * ★ 하나라도 어긋나면(양식이 정확히 1건이 아님, 칸 글자에 고정 글자가 정확히 1번이 아님) 아무것도
 *   쓰지 않고 멈춘다(두 번 돌리면 「이미 바뀜」으로 멈춘다).
 *
 *   node scripts/oneoff/2026-10-19-incorporation-form-title.js .env            (보기)
 *   node scripts/oneoff/2026-10-19-incorporation-form-title.js .env --apply    (쓰기)
 */
const fs = require('fs');
const { Client } = require('pg');

const envPath = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!envPath) {
  console.error('사용법: node scripts/oneoff/2026-10-19-incorporation-form-title.js <.env> [--apply]');
  process.exit(2);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const FORM_NAME = '설립등기신청서';
const CELL = { page: 0, row: 0, col: 0 };
const FROM = '[양식 제65-1호] 주식회사 설립 등기(발기설립)';
const TO = '{{formNo}} {{formLabel}}';

/** 이름표 — shared `INCORP_PRINT_FIELDS` 의 label 과 같다. */
const LABEL = { formNo: '양식호수', formLabel: '표시명' };

const show = (s) => JSON.stringify(s.length > 120 ? `${s.slice(0, 117)}…` : s);

(async () => {
  const c = new Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
  await c.connect();
  await c.query(APPLY ? 'BEGIN' : 'BEGIN READ ONLY');
  try {
    const { rows } = await c.query(
      `SELECT id, definition FROM public.tb_s080_form_templates WHERE operator_id = 1 AND name = $1 ${APPLY ? 'FOR UPDATE' : ''}`,
      [FORM_NAME],
    );
    if (rows.length !== 1) throw new Error(`「${FORM_NAME}」 이 ${rows.length}건입니다 — 1건이어야 합니다`);
    const { id, definition } = rows[0];
    if (definition.legal?.domain !== 'incorporation') {
      throw new Error(`「${FORM_NAME}」 의 법무 표시가 ${JSON.stringify(definition.legal ?? null)} 입니다 — incorporation 이어야 합니다`);
    }
    const next = structuredClone(definition);
    const page = next.pages?.[CELL.page];
    if (!page) throw new Error(`「${FORM_NAME}」 에 ${CELL.page + 1}쪽이 없습니다`);
    const hits = page.cells.filter((cl) => cl.row === CELL.row && cl.col === CELL.col);
    if (hits.length !== 1) throw new Error(`「${FORM_NAME}」 ${CELL.page + 1}쪽 r${CELL.row} c${CELL.col} 칸이 ${hits.length}개입니다`);
    const cell = hits[0];
    const before = cell.text ?? '';
    const n = before.split(FROM).length - 1;
    if (n !== 1) throw new Error(`「${FORM_NAME}」 r${CELL.row} c${CELL.col} 글자가 ${show(before)} 입니다 — ${show(FROM)} 가 ${n}번 있습니다(1번이어야 합니다, 이미 바뀜?)`);
    const after = before.replace(FROM, TO);
    cell.text = after;

    console.log(`■ ${FORM_NAME} (${id})`);
    console.log(`  ${CELL.page + 1}쪽 r${CELL.row} c${CELL.col}  ${show(before)}`);
    console.log(`             → ${show(after)}`);
    const manual = Array.isArray(next.manualFields) ? next.manualFields : [];
    const fields = Object.keys(LABEL);
    const added = fields.filter((f) => !manual.some((m) => m.name === f));
    next.manualFields = [...manual, ...added.map((f) => ({ name: f, label: LABEL[f] }))];
    const kept = fields.filter((f) => !added.includes(f));
    console.log(`  이름표 더함: ${added.length ? added.map((f) => `${f}(${LABEL[f]})`).join(' · ') : '없음'}${kept.length ? ` · 이미 있음: ${kept.join(' · ')}` : ''}`);

    // 지금 설정으로 찍히는 결과 — 출력은 발기설립 기본 줄을 쓴다. 줄이 없거나 사용 끔이면 두 값 모두 빈칸
    const { rows: settings } = await c.query(
      `SELECT id, label, form_no, is_active FROM public.tb_s080_doc_form_settings
        WHERE operator_id = 1 AND domain = 'incorporation' AND reg_type_key = 'R_PROMOTER' AND company_type = ''`,
    );
    const s = settings.length === 1 && settings[0].is_active ? settings[0] : null;
    if (settings.length === 1) {
      console.log(`■ 등기 설정 발기설립(R_PROMOTER, 기본 줄, ${settings[0].id}) — 양식호수 ${JSON.stringify(settings[0].form_no)} · 표시명 ${JSON.stringify(settings[0].label)} · 사용 ${settings[0].is_active}`);
    } else {
      console.log(`■ 등기 설정 발기설립 기본 줄이 ${settings.length}건입니다 — 두 값 모두 빈칸으로 봅니다`);
    }
    const printed = after.replace('{{formNo}}', s?.form_no ?? '').replace('{{formLabel}}', s?.label ?? '');
    console.log(`  찍히는 결과  ${show(printed)}`);

    if (!APPLY) {
      await c.query('ROLLBACK');
      console.log('\n보기만 했습니다 — 쓰려면 --apply');
      return;
    }
    await c.query(
      `UPDATE public.tb_s080_form_templates SET definition = $2::jsonb, updated_at = now(), updated_by = 'oneoff-2026-10-19' WHERE id = $1`,
      [id, JSON.stringify(next)],
    );
    await c.query('COMMIT');
    console.log('\n썼습니다 — 양식 1건');
  } catch (e) {
    await c.query('ROLLBACK');
    console.error(`\n멈춤 — ${e.message} (아무것도 쓰지 않았습니다)`);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})();
