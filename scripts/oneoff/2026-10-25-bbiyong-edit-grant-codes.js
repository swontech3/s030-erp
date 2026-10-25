/**
 * 일회용(2026-10-25) — 법무 회사 정보 수정을 여는 삐용 화면 · 키를 공통 코드로 등록한다.
 *
 * 사용자 결정(2026-10-25):
 *   · 법무 회사 정보는 운영사 또는 삐용 「내 단체 정보」(S021100021)에 수정 키 F002 가 있는 그 회사 사용자가 고친다
 *   · 화면코드 · 키는 공통 코드에 등록해 읽는다 — 분류 `BBIYONG_EDIT_GRANT`, 파티션 `000`(공통),
 *     코드값 `ORG_SELF`, 이름 = `화면코드:키`(`S021100021:F002`). 서버는 `packages/api/src/legal/companyEditGrant.ts` 가 읽는다
 *   · 바꿀 때는 코드 관리(s030100030)에서 이름을 고친다(한 업무는 한 화면)
 *
 * 모양은 기존 시드와 같다 — 머리 `cm_1_BBIYONG_EDIT_GRANT` · 파티션 `cc_1_BBIYONG_EDIT_GRANT_000` ·
 * 값 `cl_1_BBIYONG_EDIT_GRANT_ORG_SELF`, 건물 `1`, `is_system = false`, 사용 중, 순서 1.
 *
 * ★ 분류가 이미 있으면(머리 · 파티션 · 값 중 하나라도) 멈춘다 — 첫 등록만 한다.
 * ★ 기본은 **보기만** 한다(읽기 전용 트랜잭션). `--apply` 일 때만 쓴다(한 트랜잭션).
 * ★ 접속 값은 환경 폴더의 admin.env(DB_HOST · DB_PORT · DB_USER · DB_PASSWORD · DB_NAME)다. 값은 출력하지 않는다.
 *
 *   node scripts/oneoff/2026-10-25-bbiyong-edit-grant-codes.js <admin.env>            (보기)
 *   node scripts/oneoff/2026-10-25-bbiyong-edit-grant-codes.js <admin.env> --apply    (쓰기)
 */
const fs = require('fs');
const { Client } = require('pg');

const envPath = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!envPath) {
  console.error('사용법: node scripts/oneoff/2026-10-25-bbiyong-edit-grant-codes.js <admin.env> [--apply]');
  process.exit(2);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const BUILD_ID = '1';
const CATEGORY = 'BBIYONG_EDIT_GRANT';
const USE_TP = '000';
const MASTER = {
  name: '삐용 수정 권한',
  description: '삐용 화면 · 기능 키로 ERP 수정을 연다. 코드값 = 여는 자리, 이름 = 「삐용 화면코드:키」',
};
const PARTITION_DESC = '단일 파티션. 법무 회사 정보 수정 열기(companyEditGrant)가 쓴다';

/** [코드값, 이름, 설명] — 순서대로 sort_order 1.. */
const LINES = [
  ['ORG_SELF', 'S021100021:F002', '법무 회사 정보 수정 — 삐용 「내 단체 정보」 화면의 수정 키가 있는 그 회사 사용자에게 연다'],
];

(async () => {
  const c = new Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
  await c.connect();
  await c.query(APPLY ? 'BEGIN' : 'BEGIN READ ONLY');
  try {
    if (LINES.some(([, name]) => !/^[A-Za-z0-9]+:[A-Za-z0-9]+$/.test(name))) throw new Error('이름이 「화면코드:키」 모양이 아닙니다');
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
    await c.query('COMMIT');
    console.log(`✔ 썼습니다 — 머리 1 · 파티션 1 · 값 ${LINES.length}`);
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    await c.end();
  }
})().catch((e) => { console.error(`✘ ${e.message}`); process.exit(1); });
