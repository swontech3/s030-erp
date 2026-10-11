/**
 * 일회용(2026-10-11) — 법인변경 구분 NAME 의 **이름**을 「상호변경」으로 바꾼다.
 *
 * 사용자 결정(2026-10-11): 코드값(`NAME`)은 그대로, 코드표 `LAW_CNG_TP`/`000` 의 이름만.
 * 화면(목록 · 선택지 · 새 건 · 상세 제목)은 모두 코드표 이름을 읽으므로 소스는 고치지 않는다.
 *
 * ★★ 서류 값도 바뀐다 — 서류의 「등기의 목적」(`{{regPurpose}}`)은 등기 설정의 `reg_purpose` 가 비면
 *    **코드 이름**을 쓴다(shared `buildCasePrintValues`). 보기에서 NAME 설정 줄의 `reg_purpose` 를 함께 찍는다.
 *    목적변경(PURPOSE)은 NAME 설정 줄을 쓰지만 이름은 자기 코드(「목적변경」)라 바뀌지 않는다.
 * ★ 기본은 **보기만** 한다. `--apply` 일 때만 쓴다(한 트랜잭션).
 * ★ 코드 줄이 정확히 1건일 때만 바꾼다. 이미 「상호변경」이면 아무것도 쓰지 않는다(두 번 돌려도 안전).
 *   지금 이름이 무엇이든 보기에 찍는다 — 운영 DB 의 이름이 개발 DB 와 다를 수 있다.
 *
 *   node scripts/oneoff/2026-10-11-rename-corp-change-name.js .env            (보기)
 *   node scripts/oneoff/2026-10-11-rename-corp-change-name.js .env --apply    (쓰기)
 */
const fs = require('fs');
const { Client } = require('pg');

const envPath = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!envPath) {
  console.error('사용법: node scripts/oneoff/2026-10-11-rename-corp-change-name.js <.env> [--apply]');
  process.exit(2);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const NEW_NAME = '상호변경';

(async () => {
  const c = new Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
  await c.connect();
  await c.query('BEGIN');
  try {
    const { rows } = await c.query(
      `SELECT line_id, build_id, name FROM public.tb_s080_codes_line
        WHERE category = 'LAW_CNG_TP' AND use_tp = '000' AND code = 'NAME' FOR UPDATE`,
    );
    if (rows.length !== 1) throw new Error(`LAW_CNG_TP/000/NAME 줄이 ${rows.length}건입니다 — 1건이어야 합니다`);
    const line = rows[0];

    const settings = (await c.query(
      `SELECT company_type, label, reg_purpose FROM public.tb_s080_doc_form_settings
        WHERE domain = 'corp-change' AND reg_type_key = 'NAME' ORDER BY company_type`,
    )).rows;
    const cases = (await c.query(
      `SELECT status, count(*)::int n FROM public.tb_s080_corp_changes WHERE change_type = 'NAME' GROUP BY status ORDER BY status`,
    )).rows;

    console.log(`■ 코드 LAW_CNG_TP/000/NAME (build ${line.build_id}, ${line.line_id})`);
    console.log(`  전 이름: ${line.name}`);
    console.log(`  후 이름: ${NEW_NAME}`);
    console.log('  바뀌는 것: 이름 하나. 코드값 NAME · 순서 · 사용여부 · 다른 구분은 그대로');
    console.log('\n■ 서류 「등기의 목적」(regPurpose) — 설정 reg_purpose 가 비면 코드 이름이 나간다');
    for (const s of settings) {
      const shown = s.reg_purpose ?? `(비어 있음 → 「${line.name}」 → 「${NEW_NAME}」 로 바뀜)`;
      console.log(`  NAME 설정 회사유형 '${s.company_type}' · ${s.label ?? '(이름 없음)'} · reg_purpose = ${shown}`);
    }
    if (settings.length === 0) console.log('  NAME 설정 줄 없음 → 상호변경 서류의 등기의 목적은 코드 이름 → 바뀐다');
    console.log(`\n■ 상호변경(NAME) 건: ${cases.length === 0 ? '0건' : cases.map((r) => `${r.status} ${r.n}건`).join(' · ')}`);

    if (line.name === NEW_NAME) {
      await c.query('ROLLBACK');
      console.log('\n이미 「상호변경」입니다 — 아무것도 쓰지 않았습니다');
      return;
    }
    if (!APPLY) {
      await c.query('ROLLBACK');
      console.log('\n보기만 했습니다 — 쓰려면 --apply');
      return;
    }
    await c.query(
      `UPDATE public.tb_s080_codes_line SET name = $2, updated_at = now(), updated_by = 'oneoff-2026-10-11' WHERE line_id = $1`,
      [line.line_id, NEW_NAME],
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
