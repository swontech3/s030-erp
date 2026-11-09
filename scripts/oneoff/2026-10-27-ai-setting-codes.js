/**
 * 일회용(2026-10-27) — 사업목적 [AI 추천] 설정을 공통 코드로 등록한다.
 *
 * 사용자 결정(2026-10-27):
 *   · 설정값은 공통 코드 — 분류 `AI_SETTING`, 파티션 `000`(공통), 코드값 = 설정 이름, 이름 = 값
 *     MODEL = claude-sonnet-5-5 · MAX_PICKS = 5 · REASON_MAX = 100 · MAX_TOKENS = 1000
 *   · 서버는 `packages/api/src/routes/bizRecommend.ts` 의 `prepareAiOp` 가 읽는다(shared `parseAiSettings`)
 *   · 바꿀 때는 코드 관리(s030100030)에서 이름을 고친다(한 업무는 한 화면)
 *   · 키는 여기 두지 않는다 — erp-api.env `ANTHROPIC_API_KEY`
 *
 * 모양은 2026-10-25-bbiyong-edit-grant-codes.js 와 같다 — 머리 `cm_1_AI_SETTING` · 파티션 `cc_1_AI_SETTING_000` ·
 * 값 `cl_1_AI_SETTING_<코드값>`, 건물 `1`, `is_system = false`, 사용 중, 순서 1..4.
 *
 * ★ 분류가 이미 있으면(머리 · 파티션 · 값 중 하나라도) 멈춘다 — 첫 등록만 한다.
 * ★ 기본은 **보기만** 한다(읽기 전용 트랜잭션). `--apply` 일 때만 쓴다(한 트랜잭션).
 * ★ 접속 값은 환경 폴더의 admin.env(DB_HOST · DB_PORT · DB_USER · DB_PASSWORD · DB_NAME)다. 값은 출력하지 않는다.
 *
 *   node scripts/oneoff/2026-10-27-ai-setting-codes.js <admin.env>            (보기)
 *   node scripts/oneoff/2026-10-27-ai-setting-codes.js <admin.env> --apply    (쓰기)
 */
const fs = require('fs');
const { Client } = require('pg');

const envPath = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!envPath) {
  console.error('사용법: node scripts/oneoff/2026-10-27-ai-setting-codes.js <admin.env> [--apply]');
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
const MASTER = {
  name: 'AI 설정',
  description: '사업목적 [AI 추천] 설정. 코드값 = 설정 이름, 이름 = 값. 키는 여기 두지 않는다(erp-api.env)',
};
const PARTITION_DESC = '단일 파티션. 사업목적 추천 탭 [AI 추천](prepareAiOp)이 쓴다';

/** [코드값, 이름(값), 설명] — 순서대로 sort_order 1.. */
const LINES = [
  ['MODEL', 'claude-sonnet-5-5', '부를 모델 이름'],
  ['MAX_PICKS', '5', 'AI 가 고르는 업종 최대 수'],
  ['REASON_MAX', '100', '이유 글자 상한 — 넘는 줄은 버린다'],
  ['MAX_TOKENS', '1000', 'AI 답 최대 길이(토큰)'],
];

(async () => {
  const c = new Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
  await c.connect();
  await c.query(APPLY ? 'BEGIN' : 'BEGIN READ ONLY');
  try {
    if (LINES.slice(1).some(([, v]) => !/^[1-9][0-9]*$/.test(v))) throw new Error('숫자 설정이 양의 정수가 아닙니다');
    const { rows: [have] } = await c.query(
      `SELECT (SELECT count(*) FROM public.tb_s080_code_masters WHERE category = $1)::int AS m,
              (SELECT count(*) FROM public.tb_s080_code_categories WHERE category = $1)::int AS p,
              (SELECT count(*) FROM public.tb_s080_codes_line WHERE category = $1)::int AS l`,
      [CATEGORY],
    );
    if (have.m || have.p || have.l) {
      throw new Error(`분류 ${CATEGORY} 가 이미 있습니다(머리 ${have.m} · 파티션 ${have.p} · 값 ${have.l}) — 첫 등록만 합니다. 아무것도 쓰지 않았습니다`);
    }
    console.log(`■ 머리 cm_${BUILD_ID}_${CATEGORY} — ${MASTER.name}`);
    console.log(`■ 파티션 cc_${BUILD_ID}_${CATEGORY}_${USE_TP} — 공통`);
    LINES.forEach(([code, name], i) => console.log(`  ${i + 1}. ${code} = ${name}`));

    if (!APPLY) { console.log('보기만 했습니다. 쓰려면 --apply.'); await c.query('ROLLBACK'); return; }

    await c.query(
      `INSERT INTO public.tb_s080_code_masters (code_id, build_id, category, name, description, is_system, updated_at)
       VALUES ($1, $2, $3, $4, $5, false, CURRENT_TIMESTAMP)`,
      [`cm_${BUILD_ID}_${CATEGORY}`, BUILD_ID, CATEGORY, MASTER.name, MASTER.description],
    );
    await c.query(
      `INSERT INTO public.tb_s080_code_categories (code_category_id, build_id, category, use_tp, name, description, is_system, updated_at)
       VALUES ($1, $2, $3, $4, '공통', $5, false, CURRENT_TIMESTAMP)`,
      [`cc_${BUILD_ID}_${CATEGORY}_${USE_TP}`, BUILD_ID, CATEGORY, USE_TP, PARTITION_DESC],
    );
    for (const [i, [code, name, description]] of LINES.entries()) {
      await c.query(
        `INSERT INTO public.tb_s080_codes_line
           (line_id, build_id, category, use_tp, code, name, description, sort_order, is_active, is_system, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, false, CURRENT_TIMESTAMP)`,
        [`cl_${BUILD_ID}_${CATEGORY}_${code}`, BUILD_ID, CATEGORY, USE_TP, code, name, description, i + 1],
      );
    }
    const { rows: back } = await c.query(
      `SELECT code, name FROM public.tb_s080_codes_line WHERE category = $1 AND use_tp = $2 ORDER BY sort_order`,
      [CATEGORY, USE_TP],
    );
    if (back.map((r) => `${r.code}=${r.name}`).join() !== LINES.map(([code, name]) => `${code}=${name}`).join()) {
      throw new Error('되읽은 값이 다릅니다 — 되돌립니다');
    }
    await c.query('COMMIT');
    console.log(`✔ 썼습니다 — 머리 1 · 파티션 1 · 값 ${LINES.length}(되읽어 확인)`);
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    await c.end();
  }
})().catch((e) => { console.error(`✘ ${e.message}`); process.exit(1); });
