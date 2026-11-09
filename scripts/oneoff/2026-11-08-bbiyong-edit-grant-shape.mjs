/**
 * 일회용(2026-11-08) — 공통 코드 `BBIYONG_EDIT_GRANT`(파티션 000) 세 줄의 모양을 고친다(`LAW_CNG_MT` 와 같은 모양).
 *
 * 문제: 13 · 14 · 34번 일회용이 코드값 이름 칸에 값(`화면코드:키`)을 넣어, 코드 관리(s030100030)에서 뜻을 알 수 없었다.
 * 사용자 결정(2026-11-08):
 *   · 코드값 이름 = 사람이 읽는 이름 — ORG_SELF 「회사 정보 수정 키」 · MEMBER_SELF 「직원 정보 수정 키」 ·
 *     OPERATOR 「단체관리 수정 키(운영사)」
 *   · 값(`화면코드:키`)은 **설명** 칸(`description`)에 둔다 — 앱은 설명만 읽는다
 *     (api `receiveGrantName` · `canEditLegalCompany` → `parseEditGrant`). 설명이 비면 그 규칙은 없는 것
 *   · 바꿀 때는 코드 관리에서 그 줄의 「설명」을 고친다(한 업무는 한 화면)
 *   · 머리(분류)의 설명도 같은 뜻으로 고친다
 *
 * 고치는 것: 각 줄 `name` ← 위 이름, `description` ← 지금 `name`(값 그대로). 코드값 · 순서 · 사용 여부는 그대로.
 *   ★ 판정 결과가 고치기 전과 같아야 한다 — 줄마다 고치기 전 이름과 고친 뒤 설명을 앱의 해석(`parseEditGrant`)으로
 *     읽어 같은지, 시험 메뉴 몇 개에서 `hasEditGrant` 결과가 같은지 본다(보기 · 쓰기 둘 다, 쓰기는 되읽은 값으로).
 *
 * ★ 13 · 14 · 34 를 먼저(머리 · 파티션 1건 · 세 줄이 있어야 한다). 고친 모양으로 새로 넣은 DB 는 멈춘다.
 * ★ 세 줄의 이름이 모두 값 모양(`화면코드:키`)이어야 한다 — 아니면 멈춘다(이미 고친 것 같다 · 섞였다).
 * ★ 기본은 **보기만** 한다(읽기 전용 트랜잭션). `--apply` 일 때만 쓴다(한 트랜잭션, 되읽어 확인).
 * ★ 접속 값은 환경 폴더의 admin.env 다. 값은 출력하지 않는다.
 *
 *   npx tsx scripts/oneoff/2026-11-08-bbiyong-edit-grant-shape.mjs <admin.env>            (보기)
 *   npx tsx scripts/oneoff/2026-11-08-bbiyong-edit-grant-shape.mjs <admin.env> --apply    (쓰기)
 */
import fs from 'node:fs';
import pg from 'pg';

const args = process.argv.slice(2).filter((a) => a !== '--apply');
const APPLY = process.argv.includes('--apply');
const [envPath] = args;
if (!envPath) {
  console.error('사용법: npx tsx scripts/oneoff/2026-11-08-bbiyong-edit-grant-shape.mjs <admin.env> [--apply]');
  process.exit(2);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').replace(/^﻿/, '').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
// ★ 앱의 해석 함수를 그대로 쓴다. 그 파일이 끌어오는 env.ts 가 환경 폴더를 읽는다 — 이 스크립트는 그 접속을 쓰지 않는다.
const { parseEditGrant, hasEditGrant, EDIT_GRANT_CATEGORY, EDIT_GRANT_USE_TP } = await import(
  '../../packages/api/src/legal/companyEditGrant.ts'
);

const CATEGORY = EDIT_GRANT_CATEGORY;
const USE_TP = EDIT_GRANT_USE_TP;
/** 코드값 → 사람이 읽는 이름. */
const NAMES = {
  ORG_SELF: '회사 정보 수정 키',
  MEMBER_SELF: '직원 정보 수정 키',
  OPERATOR: '단체관리 수정 키(운영사)',
};
const MASTER_DESC =
  '삐용 화면 · 기능 키로 ERP 수정을 열고, 받기의 운영사를 가린다. 코드값 = 여는 자리, 이름 = 사람이 읽는 이름, 설명 = 「삐용 화면코드:키」(예 S021100010:F002). 설명이 비면 그 규칙은 없다(아무에게도 열지 않는다)';
/** 판정 비교에 쓰는 시험 메뉴 — 키 있음 · 보기만 · 옛 모양 · 거절. */
const SAMPLE_MENUS = [
  { kind: 'ok', screens: ['S021100010'], keys: { S021100010: ['F002'] } },
  { kind: 'ok', screens: ['S021100010'], keys: { S021100010: ['F001'] } },
  { kind: 'ok', screens: ['S021100010', 'S021100021', 'S021100030'] },
  { kind: 'ok', screens: ['S021100021'], keys: { S021100021: ['F002'] } },
  { kind: 'ok', screens: ['S021100030'], keys: { S021100030: ['F002'] } },
  { kind: 'rejected' },
];
const verdicts = (value) => {
  const g = parseEditGrant(value);
  return JSON.stringify({ g, has: SAMPLE_MENUS.map((m) => (g ? hasEditGrant(m, g) : false)) });
};

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
    if (have.m !== 1 || have.p !== 1) throw new Error(`머리 · 파티션이 1건씩이 아닙니다(머리 ${have.m} · 파티션 ${have.p}) — 13 을 먼저. 아무것도 쓰지 않았습니다`);
    const { rows: lines } = await c.query(
      `SELECT code, name, description, sort_order, is_active FROM public.tb_s080_codes_line
        WHERE category = $1 AND use_tp = $2 ORDER BY sort_order, code`,
      [CATEGORY, USE_TP],
    );
    const codes = lines.map((l) => l.code).sort().join();
    if (codes !== Object.keys(NAMES).sort().join()) {
      throw new Error(`줄이 ${Object.keys(NAMES).join(' · ')} 셋이 아닙니다(${codes || '없음'}) — 13 · 14 · 34 를 먼저. 아무것도 쓰지 않았습니다`);
    }
    for (const l of lines) {
      if (!parseEditGrant(l.name)) throw new Error(`${l.code} 의 이름이 값 모양(화면코드:키)이 아닙니다 — 이미 고친 것 같습니다. 아무것도 쓰지 않았습니다`);
    }
    /** [코드값, 새 이름, 새 설명(= 지금 이름), 판정(전)] */
    const PLAN = lines.map((l) => [l.code, NAMES[l.code], l.name.trim(), verdicts(l.name)]);
    console.log(`■ ${CATEGORY}/${USE_TP} 줄 ${PLAN.length}`);
    for (const [code, name, description, before] of PLAN) {
      const same = verdicts(description) === before;
      console.log(`  ${code} — 이름 ${name} · 설명 ${description} · 판정 전후 ${same ? '같음' : '★다름'}`);
      if (!same) throw new Error(`${code} 판정이 달라집니다 — 아무것도 쓰지 않았습니다`);
    }
    console.log(`■ 머리 설명 → ${MASTER_DESC}`);

    if (!APPLY) { console.log('보기만 했습니다. 쓰려면 --apply.'); await c.query('ROLLBACK'); return; }

    for (const [code, name, description] of PLAN) {
      await c.query(
        `UPDATE public.tb_s080_codes_line SET name = $4, description = $5, updated_at = CURRENT_TIMESTAMP
          WHERE category = $1 AND use_tp = $2 AND code = $3`,
        [CATEGORY, USE_TP, code, name, description],
      );
    }
    await c.query(
      `UPDATE public.tb_s080_code_masters SET description = $2, updated_at = CURRENT_TIMESTAMP WHERE category = $1`,
      [CATEGORY, MASTER_DESC],
    );
    const { rows: back } = await c.query(
      `SELECT code, name, description, sort_order, is_active FROM public.tb_s080_codes_line
        WHERE category = $1 AND use_tp = $2 ORDER BY sort_order, code`,
      [CATEGORY, USE_TP],
    );
    for (const [code, name, description, before] of PLAN) {
      const b = back.find((r) => r.code === code);
      const old = lines.find((r) => r.code === code);
      if (!b || b.name !== name || b.description !== description || b.sort_order !== old.sort_order || b.is_active !== old.is_active) {
        throw new Error(`${code} 되읽은 값이 다릅니다 — 되돌립니다`);
      }
      if (verdicts(b.description) !== before) throw new Error(`${code} 되읽은 판정이 다릅니다 — 되돌립니다`);
    }
    await c.query('COMMIT');
    console.log(`✔ 썼습니다 — 줄 ${PLAN.length} · 머리 설명 1(되읽어 확인 · 판정 전후 같음)`);
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    await c.end();
  }
})().catch((e) => { console.error(`✘ ${e.message}`); process.exit(1); });
