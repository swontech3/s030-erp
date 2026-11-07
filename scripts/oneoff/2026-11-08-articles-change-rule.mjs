/**
 * 일회용(2026-11-08) — 정관이 바뀌는 변경 구분을 공통 코드로 등록한다(설계 `doc/법무_정관_최종본_설계.md` §1-3 · §8-10).
 *
 * 사용자 결정(2026-11-08):
 *   · 분류 `LAW_CNG_AR`(정관이 바뀌는 변경 구분), 파티션 `000`(공통)
 *     코드값 = 변경 구분(`LAW_CNG_TP` 의 코드값), 이름 = 사람이 읽는 구분 이름(`LAW_CNG_TP` 의 이름과 같게),
 *     설명 = 바꾸는 조항 역할을 쉼표로(`TRADE_NAME` · `PURPOSE` · `HQ` · `NOTICE`)
 *   · 시작 값: NAME = TRADE_NAME · PURPOSE = PURPOSE · HQ = HQ,NOTICE · HQ_OUT = HQ,NOTICE
 *   · 줄이 없거나 설명이 비면 정관이 바뀌지 않는 구분(임원 · 대표자 주소 · 대표이사변경)
 *   · 법인변경 [서류 출력]의 「변경된 정관」 · 정관 변경 건 안내가 이 코드 하나를 읽는다
 *     (shared `parseArticlesRules`, api `readArticlesRules`)
 *   · 바꿀 때는 코드 관리(s030100030)에서 그 줄의 「설명」을 고친다(한 업무는 한 화면)
 *
 * 모양은 31번(`LAW_CNG_MT`)과 같다 — 머리 `cm_1_LAW_CNG_AR` · 파티션 `cc_1_LAW_CNG_AR_000` ·
 * 값 `cl_1_LAW_CNG_AR_<코드값>`, 건물 `1`, `is_system = false`, 사용 중, 순서 = `LAW_CNG_TP` 의 순서를 따른 1..4.
 *
 * ★ 분류가 이미 있으면(머리 · 파티션 · 값 중 하나라도) 멈춘다 — 첫 등록만 한다.
 * ★ 줄의 코드값이 `LAW_CNG_TP`/`000` 에 사용 중으로 없으면 멈춘다. 설명의 역할이 앱이 아는 역할이 아니면 멈춘다.
 * ★ 기본은 **보기만** 한다(읽기 전용 트랜잭션). `--apply` 일 때만 쓴다(한 트랜잭션, 되읽어 확인).
 * ★ 접속 값은 환경 폴더의 admin.env 다. 값은 출력하지 않는다.
 *
 *   npx tsx scripts/oneoff/2026-11-08-articles-change-rule.mjs <admin.env>            (보기)
 *   npx tsx scripts/oneoff/2026-11-08-articles-change-rule.mjs <admin.env> --apply    (쓰기)
 */
import fs from 'node:fs';
import pg from 'pg';
import {
  ARTICLE_ROLES,
  ARTICLES_RULE_CATEGORY,
  ARTICLES_RULE_USE_TP,
  articlesRolesFor,
  parseArticlesRules,
} from '../../packages/shared/src/domain/legal-articles.ts';

const args = process.argv.slice(2).filter((a) => a !== '--apply');
const APPLY = process.argv.includes('--apply');
const [envPath] = args;
if (!envPath) {
  console.error('사용법: npx tsx scripts/oneoff/2026-11-08-articles-change-rule.mjs <admin.env> [--apply]');
  process.exit(2);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').replace(/^﻿/, '').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const BUILD_ID = '1';
const CATEGORY = ARTICLES_RULE_CATEGORY;
const USE_TP = ARTICLES_RULE_USE_TP;
const MASTER = {
  name: '정관이 바뀌는 변경 구분',
  description:
    '법인변경 변경 구분 중 정관이 바뀌는 것. 코드값 = 변경 구분(LAW_CNG_TP), 이름 = 구분 이름, 설명 = 바꾸는 조항 역할을 쉼표로(TRADE_NAME 상호 · PURPOSE 목적 · HQ 본점 · NOTICE 공고방법). 줄이 없거나 설명이 비면 정관이 바뀌지 않는 구분',
};
const PARTITION_DESC = '단일 파티션. 법인변경 [서류 출력]의 「변경된 정관」 · 정관 변경 건 안내 · 작성완료 · 완료 반영이 쓴다';

/** 코드값 → 설명(바꾸는 조항 역할). 순서는 LAW_CNG_TP 의 순서를 따른다. */
const START = { NAME: 'TRADE_NAME', HQ: 'HQ,NOTICE', HQ_OUT: 'HQ,NOTICE', PURPOSE: 'PURPOSE' };

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
    const { rows: types } = await c.query(
      `SELECT code, name FROM public.tb_s080_codes_line
        WHERE category = 'LAW_CNG_TP' AND use_tp = '000' AND is_active = true ORDER BY sort_order, code`,
    );
    const typeName = new Map(types.map((r) => [r.code, r.name]));
    for (const [code, rule] of Object.entries(START)) {
      if (!typeName.has(code)) throw new Error(`${code} 가 LAW_CNG_TP/000 에 사용 중으로 없습니다 — 아무것도 쓰지 않았습니다`);
      for (const r of rule.split(',')) if (!ARTICLE_ROLES.includes(r)) throw new Error(`역할 ${r} 를 앱이 모릅니다`);
    }
    /** [코드값, 이름(= LAW_CNG_TP 이름), 설명(= 역할)] */
    const LINES = types.filter((t) => t.code in START).map((t) => [t.code, t.name, START[t.code]]);

    console.log(`■ 머리 cm_${BUILD_ID}_${CATEGORY} — ${MASTER.name}`);
    console.log(`■ 파티션 cc_${BUILD_ID}_${CATEGORY}_${USE_TP} — 공통`);
    LINES.forEach(([code, name, rule], i) => console.log(`  ${i + 1}. ${code} — 이름 ${name} · 설명 ${rule}`));
    const rules = parseArticlesRules(LINES.map(([code, , description]) => ({ code, description })));
    console.log('■ 구분별 바뀌는 조항');
    for (const t of types) {
      const roles = articlesRolesFor(t.code, rules);
      console.log(`  ${t.code}(${t.name}): ${roles.length ? roles.join(' · ') : '정관이 바뀌지 않는다'}`);
    }

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
      `SELECT code, name, description FROM public.tb_s080_codes_line WHERE category = $1 AND use_tp = $2 AND is_active = true ORDER BY sort_order`,
      [CATEGORY, USE_TP],
    );
    if (back.map((r) => `${r.code}=${r.name}=${r.description}`).join() !== LINES.map((l) => l.join('=')).join()) {
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
