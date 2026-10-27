/**
 * 일회용(2026-10-27) — 공통 코드 `AI_SETTING`(파티션 000)에 켜고 끄기 줄 `ENABLED = N` 을 더한다.
 *
 * 사용자 결정(2026-10-27):
 *   · AI 추천은 이번 이행에서 끈다 — 로컬 LLM 준비 후 쓴다. 만든 AI 코드는 지우지 않는다
 *   · `ENABLED` 가 `Y` 가 아니면 「추천」 탭에 [AI 추천] 버튼이 없고, AI 주소는 일반 추천만 준다(키가 있어도)
 *     서버는 shared `aiEnabledOf` 로 읽는다(`routes/bizRecommend.ts` 의 `recommendPageOp` · `prepareAiOp`)
 *   · 켤 때는 코드 관리(s030100030)에서 이름을 `Y` 로 고친다(한 업무는 한 화면)
 *
 * 모양은 2026-10-27-ai-setting-codes.js 의 줄과 같다 — 값 `cl_1_AI_SETTING_ENABLED`,
 * 건물 `1`, `is_system = false`, 사용 중, 순서 = 그 파티션의 가장 큰 순서 + 1.
 *
 * ★ 머리 · 파티션이 정확히 1건씩 있어야 하고(15번을 먼저), `ENABLED` 줄이 없어야 한다 — 아니면 멈춘다.
 * ★ 기본은 **보기만** 한다(읽기 전용 트랜잭션). `--apply` 일 때만 쓴다(한 트랜잭션).
 * ★ 접속 값은 환경 폴더의 admin.env(DB_HOST · DB_PORT · DB_USER · DB_PASSWORD · DB_NAME)다. 값은 출력하지 않는다.
 *
 *   node scripts/oneoff/2026-10-27-ai-setting-enabled.js <admin.env>            (보기)
 *   node scripts/oneoff/2026-10-27-ai-setting-enabled.js <admin.env> --apply    (쓰기)
 */
const fs = require('fs');
const { Client } = require('pg');

const envPath = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!envPath) {
  console.error('사용법: node scripts/oneoff/2026-10-27-ai-setting-enabled.js <admin.env> [--apply]');
  process.exit(2);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const BUILD_ID = '1';
const CATEGORY = 'AI_SETTING';
const USE_TP = '000';
const LINE = {
  code: 'ENABLED',
  name: 'N',
  description: 'AI 추천 켜고 끄기 — Y 일 때만 [AI 추천] 버튼이 보이고 AI 를 부른다. 이번 이행은 N(로컬 LLM 준비 후 켬)',
};

(async () => {
  const c = new Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
  await c.connect();
  await c.query(APPLY ? 'BEGIN' : 'BEGIN READ ONLY');
  try {
    const { rows: [have] } = await c.query(
      `SELECT (SELECT count(*) FROM public.tb_s080_code_masters WHERE category = $1)::int AS m,
              (SELECT count(*) FROM public.tb_s080_code_categories WHERE category = $1 AND use_tp = $2)::int AS p,
              (SELECT count(*) FROM public.tb_s080_codes_line WHERE category = $1 AND use_tp = $2 AND code = $3)::int AS l,
              (SELECT count(*) FROM public.tb_s080_codes_line WHERE line_id = $4)::int AS id,
              (SELECT coalesce(max(sort_order), 0) FROM public.tb_s080_codes_line WHERE category = $1 AND use_tp = $2)::int AS max_sort`,
      [CATEGORY, USE_TP, LINE.code, `cl_${BUILD_ID}_${CATEGORY}_${LINE.code}`],
    );
    if (have.m !== 1 || have.p !== 1) {
      throw new Error(`분류 ${CATEGORY} 의 머리 · 파티션이 1건씩이 아닙니다(머리 ${have.m} · 파티션 ${have.p}) — 15번을 먼저. 아무것도 쓰지 않았습니다`);
    }
    if (have.l || have.id) {
      throw new Error(`${LINE.code} 줄이 이미 있습니다 — 한 번만 더합니다. 아무것도 쓰지 않았습니다`);
    }
    const sort = have.max_sort + 1;
    const { rows: now } = await c.query(
      `SELECT code, name, sort_order FROM public.tb_s080_codes_line WHERE category = $1 AND use_tp = $2 ORDER BY sort_order, code`,
      [CATEGORY, USE_TP],
    );
    console.log(`■ 지금 ${CATEGORY}/${USE_TP} 줄 ${now.length}`);
    now.forEach((r) => console.log(`  ${r.sort_order}. ${r.code} = ${r.name}`));
    console.log(`■ 더할 줄 cl_${BUILD_ID}_${CATEGORY}_${LINE.code}`);
    console.log(`  ${sort}. ${LINE.code} = ${LINE.name}`);

    if (!APPLY) { console.log('보기만 했습니다. 쓰려면 --apply.'); await c.query('ROLLBACK'); return; }

    await c.query(
      `INSERT INTO public.tb_s080_codes_line
         (line_id, build_id, category, use_tp, code, name, description, sort_order, is_active, is_system, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, false, CURRENT_TIMESTAMP)`,
      [`cl_${BUILD_ID}_${CATEGORY}_${LINE.code}`, BUILD_ID, CATEGORY, USE_TP, LINE.code, LINE.name, LINE.description, sort],
    );
    const { rows: [back] } = await c.query(
      `SELECT name FROM public.tb_s080_codes_line WHERE category = $1 AND use_tp = $2 AND code = $3`,
      [CATEGORY, USE_TP, LINE.code],
    );
    if (back?.name !== LINE.name) throw new Error('되읽은 이름이 다릅니다 — 되돌립니다');
    await c.query('COMMIT');
    console.log(`✔ 썼습니다 — 값 1(${LINE.code} = ${LINE.name}, 되읽어 확인)`);
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    await c.end();
  }
})().catch((e) => { console.error(`✘ ${e.message}`); process.exit(1); });
