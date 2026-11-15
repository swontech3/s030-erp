/**
 * 일회용(2026-11-15) — 정산 탭 구분 · 상태 공통 코드 두 분류를 등록한다(대표 지시: 청구 화면 「정산」 탭 검색 · 목록).
 *
 *   분류 `SETTLE_TP`(정산 구분), 파티션 `000`(공통) — EARLY 「중도해지」 · EXPIRE 「기간만료」
 *   분류 `SETTLE_ST`(정산 상태), 파티션 `000`(공통) — WAIT 「대기」 · DONE 「완료」
 *   · 이름 칸은 사람이 읽는 이름. 「전체」는 화면에만 있다.
 *   · 코드값은 앱이 판정한다 — shared `settlement-view.ts`(settleTypeOf · settleStatusOf), API `GET /billing/settlements`
 *     가 행마다 싣는다. 화면은 `GET /codes` 로 이름을 읽는다. 코드 관리는 이 코드값을 바꾸거나 지우지 못한다(PINNED_CODES).
 *
 * 모양 — 머리 `cm_1_<분류>` · 파티션 `cc_1_<분류>_000` · 값 `cl_1_<분류>_<코드값>`,
 * 건물 `1`, `is_system = false`, 사용 중, 순서 1 · 2. (입금 계좌 33 · 납부상태 36 과 같은 모양)
 *
 * ★ 두 분류 중 하나라도 이미 있으면(머리 · 파티션 · 값 어디든) 멈춘다 — 첫 등록만 한다.
 * ★ 기본은 **보기만** 한다(읽기 전용 트랜잭션). `--apply` 일 때만 쓴다(한 트랜잭션, 되읽어 확인).
 * ★ 접속 값은 환경 폴더의 admin.env 다. 값은 출력하지 않는다.
 *
 *   npx tsx scripts/oneoff/2026-11-15-settle-type-status-codes.mjs <admin.env>            (보기)
 *   npx tsx scripts/oneoff/2026-11-15-settle-type-status-codes.mjs <admin.env> --apply    (쓰기)
 */
import fs from 'node:fs';
import pg from 'pg';
import {
  SETTLE_CODE_USE_TP,
  SETTLE_STATUS_CATEGORY,
  SETTLE_STATUS_CODES,
  SETTLE_TYPE_CATEGORY,
  SETTLE_TYPE_CODES,
} from '../../packages/shared/src/domain/settlement-view.ts';

const args = process.argv.slice(2).filter((a) => a !== '--apply');
const APPLY = process.argv.includes('--apply');
const [envPath] = args;
if (!envPath) {
  console.error('사용법: npx tsx scripts/oneoff/2026-11-15-settle-type-status-codes.mjs <admin.env> [--apply]');
  process.exit(2);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').replace(/^﻿/, '').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const BUILD_ID = '1';
const USE_TP = SETTLE_CODE_USE_TP;

/** 분류 둘 — 코드값 순서는 shared 상수 순서와 같아야 한다(아래에서 확인). */
const CATEGORIES = [
  {
    category: SETTLE_TYPE_CATEGORY,
    name: '정산 구분',
    description: '청구 화면(s030200070) 「정산」 탭 검색 · 목록의 구분. 중도해지일이 종료일보다 앞서면 중도해지, 아니면 기간만료(앱이 판정)',
    partitionDesc: '단일 파티션. 정산 탭 검색 「구분」 · 목록 「구분」이 읽는다',
    lines: [['EARLY', '중도해지'], ['EXPIRE', '기간만료']],
    appCodes: SETTLE_TYPE_CODES,
  },
  {
    category: SETTLE_STATUS_CATEGORY,
    name: '정산 상태',
    description: '청구 화면(s030200070) 「정산」 탭 검색 · 목록의 상태. 정산 처리 · 예치금 반환이 남았으면 대기, 아니면 완료(앱이 판정)',
    partitionDesc: '단일 파티션. 정산 탭 검색 「상태」 · 목록 「상태」가 읽는다',
    lines: [['WAIT', '대기'], ['DONE', '완료']],
    appCodes: SETTLE_STATUS_CODES,
  },
];

for (const c of CATEGORIES) {
  if (c.lines.map(([code]) => code).join() !== c.appCodes.join()) {
    console.error(`✘ ${c.category} 코드값이 앱 상수와 다릅니다 — 아무것도 하지 않았습니다`);
    process.exit(1);
  }
}

(async () => {
  const c = new pg.Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
  await c.connect();
  await c.query(APPLY ? 'BEGIN' : 'BEGIN READ ONLY');
  try {
    for (const { category } of CATEGORIES) {
      const { rows: [have] } = await c.query(
        `SELECT (SELECT count(*) FROM public.tb_s080_code_masters WHERE category = $1)::int AS m,
                (SELECT count(*) FROM public.tb_s080_code_categories WHERE category = $1)::int AS p,
                (SELECT count(*) FROM public.tb_s080_codes_line WHERE category = $1)::int AS l`,
        [category],
      );
      if (have.m || have.p || have.l) {
        throw new Error(`분류 ${category} 가 이미 있습니다(머리 ${have.m} · 파티션 ${have.p} · 값 ${have.l}) — 첫 등록만 합니다. 아무것도 쓰지 않았습니다`);
      }
    }

    for (const k of CATEGORIES) {
      console.log(`■ 머리 cm_${BUILD_ID}_${k.category} — ${k.name}`);
      console.log(`■ 파티션 cc_${BUILD_ID}_${k.category}_${USE_TP} — 공통`);
      k.lines.forEach(([code, name], i) => console.log(`  ${i + 1}. ${code} — ${name}`));
    }

    if (!APPLY) { console.log('보기만 했습니다. 쓰려면 --apply.'); await c.query('ROLLBACK'); return; }

    for (const k of CATEGORIES) {
      await c.query(
        `INSERT INTO public.tb_s080_code_masters (code_id, build_id, category, name, description, is_system, updated_at)
         VALUES ($1, $2, $3, $4, $5, false, CURRENT_TIMESTAMP)`,
        [`cm_${BUILD_ID}_${k.category}`, BUILD_ID, k.category, k.name, k.description],
      );
      await c.query(
        `INSERT INTO public.tb_s080_code_categories (code_category_id, build_id, category, use_tp, name, description, is_system, updated_at)
         VALUES ($1, $2, $3, $4, '공통', $5, false, CURRENT_TIMESTAMP)`,
        [`cc_${BUILD_ID}_${k.category}_${USE_TP}`, BUILD_ID, k.category, USE_TP, k.partitionDesc],
      );
      for (const [i, [code, name]] of k.lines.entries()) {
        await c.query(
          `INSERT INTO public.tb_s080_codes_line
             (line_id, build_id, category, use_tp, code, name, sort_order, is_active, is_system, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, true, false, CURRENT_TIMESTAMP)`,
          [`cl_${BUILD_ID}_${k.category}_${code}`, BUILD_ID, k.category, USE_TP, code, name, i + 1],
        );
      }
      const { rows: back } = await c.query(
        `SELECT code, name FROM public.tb_s080_codes_line WHERE category = $1 AND use_tp = $2 AND is_active = true ORDER BY sort_order`,
        [k.category, USE_TP],
      );
      if (back.map((r) => `${r.code}=${r.name}`).join() !== k.lines.map((l) => l.join('=')).join()) {
        throw new Error(`${k.category} 되읽은 값이 다릅니다 — 되돌립니다`);
      }
    }
    await c.query('COMMIT');
    console.log(`✔ 썼습니다 — 분류 ${CATEGORIES.length}(머리 · 파티션 각 1 · 값 2씩, 되읽어 확인)`);
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    await c.end();
  }
})().catch((e) => { console.error(`✘ ${e.message}`); process.exit(1); });
