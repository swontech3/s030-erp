/**
 * 일회용(2026-11-15) — 납부상태 공통 코드 `PAY_ST` 를 등록한다(대표 지시: 청구 화면 「상태」 선택지).
 *
 *   분류 `PAY_ST`(납부상태), 파티션 `000`(공통)
 *     P 납부대기 · E 납부완료 · O 미납 · C 취소 — 개발 DB 에 있는 이름 · 코드값 · 순서 그대로
 *   · 청구 화면(s030200070) 검색 「상태」가 `GET /codes` 로 읽는다(api routes/lookups.ts, web BillingView).
 *     이름은 화면이 이 줄에서 읽는다 — 소스에 적지 않는다.
 *   · 청구서에 저장되는 값은 P · E · C 셋뿐이다. O(미납)는 화면이 납부기한으로 계산한다(021).
 *   · ★ 파티션 `001`(납부관리용)은 넣지 않는다 — 이 앱의 화면은 쓰지 않는다(옛 S-WonERP 납부 관리 화면이 쓰던 자리).
 *
 * 개발 DB 의 PAY_ST 는 옛 코드관리 화면에서 손으로 넣은 것이다(2026-06-06 · 06-08) — 마이그레이션 ·
 * 일회용이 없어 가동계에 옮길 길이 없었다. 이 파일이 그 길이다.
 *
 * 모양 — 머리 `cm_1_PAY_ST` · 파티션 `cc_1_PAY_ST_000` · 값 `cl_1_PAY_ST_<코드값>`,
 * 건물 `1`, `is_system = false`, 사용 중, 순서 1 ~ 4. (입금 계좌 일회용 33번과 같은 모양)
 *
 * ★ 분류가 이미 있으면(머리 · 파티션 · 값 중 하나라도) 멈춘다 — 첫 등록만 한다.
 * ★ 기본은 **보기만** 한다(읽기 전용 트랜잭션). `--apply` 일 때만 쓴다(한 트랜잭션, 되읽어 확인).
 * ★ 접속 값은 환경 폴더의 admin.env 다. 값은 출력하지 않는다.
 *
 *   npx tsx scripts/oneoff/2026-11-15-pay-status-codes.mjs <admin.env>            (보기)
 *   npx tsx scripts/oneoff/2026-11-15-pay-status-codes.mjs <admin.env> --apply    (쓰기)
 */
import fs from 'node:fs';
import pg from 'pg';

const args = process.argv.slice(2).filter((a) => a !== '--apply');
const APPLY = process.argv.includes('--apply');
const [envPath] = args;
if (!envPath) {
  console.error('사용법: npx tsx scripts/oneoff/2026-11-15-pay-status-codes.mjs <admin.env> [--apply]');
  process.exit(2);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').replace(/^﻿/, '').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const BUILD_ID = '1';
/** web `billing-model.ts` 의 `PAY_ST_CATEGORY` 와 같은 값. 화면은 파티션 000 을 읽는다(api `CONTRACT_FORM_CODES`). */
const CATEGORY = 'PAY_ST';
const USE_TP = '000';
const MASTER = {
  name: '납부상태',
  description:
    '청구 화면(s030200070) 검색 「상태」 선택지. 청구서에 저장되는 값은 P · E · C 셋뿐이고 O(미납)는 화면이 납부기한으로 계산한다',
};
const PARTITION_DESC = '단일 파티션. 청구 화면 검색 「상태」가 읽는다';

/** [코드값, 이름] — 개발 DB 파티션 000 에 있는 그대로(순서 포함). */
const LINES = [
  ['P', '납부대기'],
  ['E', '납부완료'],
  ['O', '미납'],
  ['C', '취소'],
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
