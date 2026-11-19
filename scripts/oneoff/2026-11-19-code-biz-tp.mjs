/**
 * 일회용(2026-11-19) — 코드 관리 「업무구분」 공통 코드 `CODE_BIZ_TP` 를 등록한다(사용자 지시: 선택지를 화면에 박지 않는다).
 *
 *   분류 `CODE_BIZ_TP`(업무구분), 파티션 `000`(공통)
 *     BBIYONG 「삐용」 · ERP 「ERP」 — 이름 칸은 사람이 읽는 이름
 *   · 코드 관리(s030100030) 왼쪽 걸러 보기 선택지 · 목록 딱지가 `GET /codes` 로 이름을 읽는다(api routes/lookups.ts).
 *   · 코드값은 앱이 판정한다(그 줄이 온 표 — 삐용 공통 코드 표면 BBIYONG, ERP 공통 코드 표면 ERP,
 *     shared `code-biz-tp.ts`). 코드 관리는 이 코드값을 바꾸거나 지우지 못한다(PINNED_CODES). 이름은 고칠 수 있다.
 *
 * 모양 — 머리 `cm_1_CODE_BIZ_TP` · 파티션 `cc_1_CODE_BIZ_TP_000` · 값 `cl_1_CODE_BIZ_TP_<코드값>`,
 * 건물 `1`, `is_system = false`, 사용 중, 순서 1 · 2. (납부상태 36 · 정산 37 과 같은 모양)
 *
 * ★ 분류가 이미 있으면(머리 · 파티션 · 값 중 하나라도) 멈춘다 — 첫 등록만 한다.
 * ★ 기본은 **보기만** 한다(읽기 전용 트랜잭션). `--apply` 일 때만 쓴다(한 트랜잭션, 되읽어 확인).
 * ★ 접속 값은 환경 폴더의 admin.env 다. 값은 출력하지 않는다.
 *
 *   npx tsx scripts/oneoff/2026-11-19-code-biz-tp.mjs <admin.env>            (보기)
 *   npx tsx scripts/oneoff/2026-11-19-code-biz-tp.mjs <admin.env> --apply    (쓰기)
 */
import fs from 'node:fs';
import pg from 'pg';
import { CODE_BIZ_TP_CATEGORY, CODE_BIZ_TP_CODES, CODE_BIZ_TP_USE_TP } from '../../packages/shared/src/domain/code-biz-tp.ts';

const args = process.argv.slice(2).filter((a) => a !== '--apply');
const APPLY = process.argv.includes('--apply');
const [envPath] = args;
if (!envPath) {
  console.error('사용법: npx tsx scripts/oneoff/2026-11-19-code-biz-tp.mjs <admin.env> [--apply]');
  process.exit(2);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').replace(/^﻿/, '').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const BUILD_ID = '1';
const CATEGORY = CODE_BIZ_TP_CATEGORY;
const USE_TP = CODE_BIZ_TP_USE_TP;
const MASTER = {
  name: '업무구분',
  description:
    '코드 관리(s030100030) 왼쪽 목록의 업무구분 — 그 코드가 온 표(BBIYONG 삐용 공통 코드 · ERP ERP 공통 코드). 이름이 걸러 보기 선택지 · 목록 딱지에 보인다',
};
const PARTITION_DESC = '단일 파티션. 코드 관리 왼쪽 걸러 보기 · 딱지가 읽는다';

/** [코드값, 이름] — 코드값은 앱의 것(shared `CODE_BIZ_TP_CODES`), 이름은 사람이 읽는 이름. */
const LINES = [
  [CODE_BIZ_TP_CODES.bbiyong, '삐용'],
  [CODE_BIZ_TP_CODES.erp, 'ERP'],
];

(async () => {
  const c = new pg.Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
  await c.connect();
  await c.query(APPLY ? 'BEGIN' : 'BEGIN READ ONLY');
  try {
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
    LINES.forEach(([code, name], i) => console.log(`  ${i + 1}. ${code} — ${name}`));

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
    for (const [i, [code, name]] of LINES.entries()) {
      await c.query(
        `INSERT INTO public.tb_s080_codes_line
           (line_id, build_id, category, use_tp, code, name, sort_order, is_active, is_system, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, false, CURRENT_TIMESTAMP)`,
        [`cl_${BUILD_ID}_${CATEGORY}_${code}`, BUILD_ID, CATEGORY, USE_TP, code, name, i + 1],
      );
    }
    const { rows: back } = await c.query(
      `SELECT code, name FROM public.tb_s080_codes_line WHERE category = $1 AND use_tp = $2 AND is_active = true ORDER BY sort_order`,
      [CATEGORY, USE_TP],
    );
    if (back.map((r) => `${r.code}=${r.name}`).join() !== LINES.map((l) => l.join('=')).join()) {
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
