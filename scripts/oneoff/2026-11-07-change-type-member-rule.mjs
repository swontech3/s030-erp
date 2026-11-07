/**
 * 일회용(2026-11-07) — 법인변경 구분별로 쓸 수 있는 회사유형을 공통 코드로 등록한다.
 *
 * 사용자 결정(2026-11-07):
 *   · 분류 `LAW_CNG_MT`(법인변경 구분별 회사유형), 파티션 `000`(공통)
 *     코드값 = 변경 구분(`LAW_CNG_TP` 의 코드값), 이름 = 사람이 읽는 구분 이름(`LAW_CNG_TP` 의 이름과 같게),
 *     설명 = 쓸 수 있는 회사유형 코드를 쉼표로(예 `R` · `A` · `R,A`) — 코드 모양 고침(결정 2026-11-07, 31 참고)
 *   · 시작 값: NAME · PURPOSE · OFFICER · CEO_ADDR · HQ = R / HQ_OUT = A
 *   · 줄이 없는 구분은 주식회사(R)만 · 회사유형이 비었거나 R · A 가 아닌 회사는 주식회사로 본다
 *   · 새 건 대화상자 거르기 · 서버 거절(첫 저장 · 저장 · 작성완료)이 이 코드 하나를 읽는다
 *     (shared `parseChangeTypeRules` · `changeTypeAllowedFor`, api `readChangeTypeRules`)
 *   · 바꿀 때는 코드 관리(s030100030)에서 그 줄의 「설명」을 고친다(한 업무는 한 화면)
 *
 * 모양은 2026-10-27-ai-setting-codes.js 와 같다 — 머리 `cm_1_LAW_CNG_MT` · 파티션 `cc_1_LAW_CNG_MT_000` ·
 * 값 `cl_1_LAW_CNG_MT_<코드값>`, 건물 `1`, `is_system = false`, 사용 중, 순서 = `LAW_CNG_TP` 의 순서를 따른 1..6.
 *
 * ★ 분류가 이미 있으면(머리 · 파티션 · 값 중 하나라도) 멈춘다 — 첫 등록만 한다.
 * ★ 줄의 코드값이 `LAW_CNG_TP`/`000` 에 사용 중으로 없으면 멈춘다. 설명의 회사유형이 `MEMBER_TYPE` 에 없으면 멈춘다.
 * ★ 기본은 **보기만** 한다(읽기 전용 트랜잭션). `--apply` 일 때만 쓴다(한 트랜잭션, 되읽어 확인).
 * ★ 접속 값은 환경 폴더의 admin.env 다. 값은 출력하지 않는다.
 *
 *   npx tsx scripts/oneoff/2026-11-07-change-type-member-rule.mjs <admin.env>            (보기)
 *   npx tsx scripts/oneoff/2026-11-07-change-type-member-rule.mjs <admin.env> --apply    (쓰기)
 */
import fs from 'node:fs';
import pg from 'pg';
import {
  CORP_CHANGE_MEMBER_RULE_CATEGORY,
  CORP_CHANGE_MEMBER_RULE_USE_TP,
  changeTypeAllowedFor,
  parseChangeTypeRules,
} from '../../packages/shared/src/domain/corp-change.ts';

const args = process.argv.slice(2).filter((a) => a !== '--apply');
const APPLY = process.argv.includes('--apply');
const [envPath] = args;
if (!envPath) {
  console.error('사용법: npx tsx scripts/oneoff/2026-11-07-change-type-member-rule.mjs <admin.env> [--apply]');
  process.exit(2);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').replace(/^﻿/, '').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const BUILD_ID = '1';
const CATEGORY = CORP_CHANGE_MEMBER_RULE_CATEGORY;
const USE_TP = CORP_CHANGE_MEMBER_RULE_USE_TP;
const MASTER = {
  name: '법인변경 구분별 회사유형',
  description:
    '법인변경 변경 구분별로 쓸 수 있는 회사유형. 코드값 = 변경 구분(LAW_CNG_TP), 이름 = 구분 이름, 설명 = 쓸 수 있는 회사유형 코드를 쉼표로(예 R · A · R,A). 줄이 없는 구분은 주식회사(R)만 · 회사유형이 비었거나 R · A 가 아닌 회사는 주식회사로 본다',
};
const PARTITION_DESC = '단일 파티션. 법인변경 새 건 대화상자 거르기 · 첫 저장 · 저장 · 작성완료 거절이 쓴다';

/** 코드값 → 설명(쓸 수 있는 회사유형). 순서는 LAW_CNG_TP 의 순서를 따른다. */
const START = { NAME: 'R', HQ: 'R', PURPOSE: 'R', OFFICER: 'R', CEO_ADDR: 'R', HQ_OUT: 'A' };

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
    const { rows: members } = await c.query(
      `SELECT DISTINCT code FROM public.tb_s080_codes_line WHERE category = 'MEMBER_TYPE' AND is_active = true`,
    );
    const memberCodes = new Set(members.map((r) => r.code));
    const typeName = new Map(types.map((r) => [r.code, r.name]));
    for (const [code, name] of Object.entries(START)) {
      if (!typeName.has(code)) throw new Error(`${code} 가 LAW_CNG_TP/000 에 사용 중으로 없습니다 — 아무것도 쓰지 않았습니다`);
      for (const m of name.split(',')) if (!memberCodes.has(m)) throw new Error(`회사유형 ${m} 가 MEMBER_TYPE 에 없습니다`);
    }
    /** [코드값, 이름(= LAW_CNG_TP 이름), 설명(= 규칙)] */
    const LINES = types.filter((t) => t.code in START).map((t) => [t.code, t.name, START[t.code]]);

    console.log(`■ 머리 cm_${BUILD_ID}_${CATEGORY} — ${MASTER.name}`);
    console.log(`■ 파티션 cc_${BUILD_ID}_${CATEGORY}_${USE_TP} — 공통`);
    LINES.forEach(([code, name, rule], i) => console.log(`  ${i + 1}. ${code} — 이름 ${name} · 설명 ${rule}`));
    const noLine = types.filter((t) => !(t.code in START)).map((t) => `${t.code}(${t.name})`);
    console.log(`■ 줄이 없는 구분(주식회사만): ${noLine.join(' · ') || '없음'}`);

    // 이 규칙으로 회사유형마다 고를 수 있는 구분(앱이 아는 구분만 — 대화상자의 선택지와 같다)
    const rules = parseChangeTypeRules(LINES.map(([code, , description]) => ({ code, description })));
    const appTypes = ['NAME', 'HQ', 'HQ_OUT', 'PURPOSE', 'OFFICER', 'CEO_ADDR'];
    console.log('■ 회사유형별 고를 수 있는 구분');
    for (const m of ['R', 'A', 'C', null]) {
      const ok = types.filter((t) => appTypes.includes(t.code) && changeTypeAllowedFor(t.code, m, rules)).map((t) => t.name);
      console.log(`  ${m === null ? '(빔 → 주식회사로 봄)' : m === 'C' ? 'C(R · A 아님 → 주식회사로 봄)' : m}: ${ok.join(' · ') || '없음'}`);
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
