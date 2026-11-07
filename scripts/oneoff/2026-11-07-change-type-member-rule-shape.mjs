/**
 * 일회용(2026-11-07) — 공통 코드 `LAW_CNG_MT`(법인변경 구분별 회사유형) 줄의 모양을 고친다.
 *
 * 문제: 30번 일회용이 코드값 이름 칸에 규칙 값(R · A)을 넣어, 코드 관리(s030100030)에서 뜻을 알 수 없었다.
 * 사용자 결정(2026-11-07):
 *   · 코드값 이름 = 사람이 읽는 구분 이름(`LAW_CNG_TP` 의 이름과 같게 — 상호변경 · 타관할로의 본점이전 등)
 *   · 규칙 값(쓸 수 있는 회사유형 R · A · R,A)은 **설명** 칸(`description`)에 둔다 — 코드 관리의 줄 수정 대화상자
 *     「설명」에서 보고 고친다. 앱은 설명만 읽는다(api `listChangeTypeRuleRows` → shared `parseChangeTypeRules`)
 *   · 머리(분류)의 설명도 같은 뜻으로 고친다
 *
 * 고치는 것: 각 줄 `name` ← `LAW_CNG_TP`/`000` 의 같은 코드값 이름, `description` ← 지금 `name`(규칙 값 그대로).
 *   코드값 · 순서 · 사용 여부는 그대로. 거르기 결과(회사유형별로 고를 수 있는 구분)가 고치기 전과 같아야 한다.
 *
 * ★ 30 을 먼저(머리 · 파티션 1건 · 값이 있어야 한다). 고친 30 으로 새로 넣은 DB(운영계 등)는 이미 이 모양이라 멈춘다.
 * ★ 모든 줄의 이름이 규칙 값 모양(`R` · `A` · `R,A` 같은 대문자 코드를 쉼표로)이어야 한다 — 아니면 멈춘다
 *   (이미 고친 것 같다 · 섞였다). 코드값이 `LAW_CNG_TP` 에 사용 중으로 없으면 멈춘다.
 * ★ 기본은 **보기만** 한다(읽기 전용 트랜잭션). `--apply` 일 때만 쓴다(한 트랜잭션, 되읽어 확인).
 * ★ 접속 값은 환경 폴더의 admin.env 다. 값은 출력하지 않는다.
 *
 *   npx tsx scripts/oneoff/2026-11-07-change-type-member-rule-shape.mjs <admin.env>            (보기)
 *   npx tsx scripts/oneoff/2026-11-07-change-type-member-rule-shape.mjs <admin.env> --apply    (쓰기)
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
  console.error('사용법: npx tsx scripts/oneoff/2026-11-07-change-type-member-rule-shape.mjs <admin.env> [--apply]');
  process.exit(2);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').replace(/^﻿/, '').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const ACTOR = 'oneoff-2026-11-07';
const CATEGORY = CORP_CHANGE_MEMBER_RULE_CATEGORY;
const USE_TP = CORP_CHANGE_MEMBER_RULE_USE_TP;
/** 30 과 같은 머리 설명(고친 30). */
const MASTER_DESC =
  '법인변경 변경 구분별로 쓸 수 있는 회사유형. 코드값 = 변경 구분(LAW_CNG_TP), 이름 = 구분 이름, 설명 = 쓸 수 있는 회사유형 코드를 쉼표로(예 R · A · R,A). 줄이 없는 구분은 주식회사(R)만 · 회사유형이 비었거나 R · A 가 아닌 회사는 주식회사로 본다';
const RULE_SHAPE = /^\s*[A-Z]+(\s*,\s*[A-Z]+)*\s*$/;
const APP_TYPES = ['NAME', 'HQ', 'HQ_OUT', 'PURPOSE', 'OFFICER', 'CEO_ADDR'];
const MEMBER_CASES = ['R', 'A', 'C', null];

(async () => {
  const c = new pg.Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
  await c.connect();
  await c.query(APPLY ? 'BEGIN' : 'BEGIN READ ONLY');
  try {
    const { rows: [have] } = await c.query(
      `SELECT (SELECT count(*) FROM public.tb_s080_code_masters WHERE category = $1)::int AS m,
              (SELECT count(*) FROM public.tb_s080_code_categories WHERE category = $1 AND use_tp = $2)::int AS p`,
      [CATEGORY, USE_TP],
    );
    if (have.m !== 1 || have.p !== 1) throw new Error(`분류 ${CATEGORY} 의 머리 · 파티션이 1건씩이 아닙니다(머리 ${have.m} · 파티션 ${have.p}) — 30 을 먼저`);
    const { rows: [master] } = await c.query(`SELECT build_id, description FROM public.tb_s080_code_masters WHERE category = $1`, [CATEGORY]);
    const { rows: lines } = await c.query(
      `SELECT line_id, code, name, description, sort_order, is_active FROM public.tb_s080_codes_line
        WHERE category = $1 AND use_tp = $2 ORDER BY sort_order, code`,
      [CATEGORY, USE_TP],
    );
    if (lines.length === 0) throw new Error('줄이 없습니다 — 30 을 먼저');
    const { rows: types } = await c.query(
      `SELECT code, name FROM public.tb_s080_codes_line WHERE category = 'LAW_CNG_TP' AND use_tp = '000' AND is_active = true`,
    );
    const typeName = new Map(types.map((r) => [r.code, r.name]));

    const shaped = lines.filter((l) => RULE_SHAPE.test(l.name ?? ''));
    if (shaped.length === 0) throw new Error('이미 고친 것 같다 — 이름이 규칙 값 모양인 줄이 없습니다. 아무것도 쓰지 않았습니다');
    if (shaped.length !== lines.length) {
      throw new Error(`줄이 섞였습니다(규칙 값 모양 ${shaped.length} / ${lines.length}) — 손으로 보세요. 아무것도 쓰지 않았습니다`);
    }
    const plan = lines.map((l) => {
      const name = typeName.get(l.code);
      if (!name) throw new Error(`${l.code} 가 LAW_CNG_TP/000 에 사용 중으로 없습니다 — 아무것도 쓰지 않았습니다`);
      return { ...l, newName: name, newDesc: l.name.trim() };
    });

    console.log(`■ ${CATEGORY}/${USE_TP} 줄 ${plan.length} — 이름 · 설명`);
    for (const p of plan) {
      console.log(`  ${p.sort_order}. ${p.code}${p.is_active ? '' : '(사용 안 함)'}`);
      console.log(`       전: 이름 ${p.name} · 설명 ${p.description ?? '(빔)'}`);
      console.log(`       뒤: 이름 ${p.newName} · 설명 ${p.newDesc}`);
    }
    console.log('■ 머리 설명');
    console.log(`  전: ${master.description ?? '(빔)'}`);
    console.log(`  뒤: ${MASTER_DESC}`);

    // 거르기 결과 — 전(이름을 규칙으로 읽던 것) · 뒤(설명을 규칙으로 읽는 것)가 같아야 한다. 사용 중인 줄만(앱과 같다).
    const before = parseChangeTypeRules(plan.filter((p) => p.is_active).map((p) => ({ code: p.code, description: p.name })));
    const after = parseChangeTypeRules(plan.filter((p) => p.is_active).map((p) => ({ code: p.code, description: p.newDesc })));
    console.log('■ 회사유형별 고를 수 있는 구분(전 → 뒤)');
    let same = true;
    for (const m of MEMBER_CASES) {
      const pick = (rules) => APP_TYPES.filter((t) => changeTypeAllowedFor(t, m, rules)).map((t) => typeName.get(t) ?? t).join(' · ') || '없음';
      const b = pick(before);
      const a = pick(after);
      if (a !== b) same = false;
      console.log(`  ${m ?? '(빔)'}: ${b}${a === b ? '  (같음)' : `  → ${a}  ✘ 다름`}`);
    }
    if (!same) throw new Error('거르기 결과가 달라집니다 — 아무것도 쓰지 않았습니다');

    if (!APPLY) { console.log('보기만 했습니다. 쓰려면 --apply.'); await c.query('ROLLBACK'); return; }

    for (const p of plan) {
      await c.query(
        `UPDATE public.tb_s080_codes_line SET name = $2, description = $3, updated_at = CURRENT_TIMESTAMP, updated_by = $4 WHERE line_id = $1`,
        [p.line_id, p.newName, p.newDesc, ACTOR],
      );
    }
    await c.query(
      `UPDATE public.tb_s080_code_masters SET description = $2, updated_at = CURRENT_TIMESTAMP, updated_by = $3 WHERE category = $1`,
      [CATEGORY, MASTER_DESC, ACTOR],
    );
    const { rows: back } = await c.query(
      `SELECT code, name, description FROM public.tb_s080_codes_line WHERE category = $1 AND use_tp = $2 ORDER BY sort_order, code`,
      [CATEGORY, USE_TP],
    );
    const { rows: [backMaster] } = await c.query(`SELECT description FROM public.tb_s080_code_masters WHERE category = $1`, [CATEGORY]);
    if (
      back.map((r) => `${r.code}=${r.name}=${r.description}`).join() !== plan.map((p) => `${p.code}=${p.newName}=${p.newDesc}`).join() ||
      backMaster.description !== MASTER_DESC
    ) {
      throw new Error('되읽은 값이 다릅니다 — 되돌립니다');
    }
    await c.query('COMMIT');
    console.log(`✔ 썼습니다 — 줄 ${plan.length} · 머리 설명 1(되읽어 확인)`);
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    await c.end();
  }
})().catch((e) => { console.error(`✘ ${e.message}`); process.exit(1); });
