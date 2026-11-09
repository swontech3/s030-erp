/**
 * 일회용(2026-11-08) — 입금 계좌를 공통 코드로 등록한다(삐용팀 지적: 소스 상수 `CONTRACT_OFFICE.BANK` · `ACCOUNT_HOLDER` → 설정).
 *
 *   분류 `DEPOSIT_ACCT`(입금 계좌), 파티션 `000`(공통)
 *     코드값 `ACCOUNT` — 이름 「입금 계좌」 · 설명 `우리은행 1005-002-433395`(은행과 계좌번호)
 *     코드값 `HOLDER`  — 이름 「예금주」     · 설명 `㈜에스원테크`
 *   · 이름 칸은 사람이 읽는 이름, **값은 설명 칸**(31번 `LAW_CNG_MT` 와 같은 모양)
 *   · 앱은 설명만 읽는다(shared `depositAccountOf`, api `GET /codes`) — 이용계약서 「오피스 정보」 · 정산서 「입금 계좌」
 *   · 바꿀 때는 코드 관리(s030100030)에서 그 줄의 「설명」을 고친다(한 업무는 한 화면)
 *   · 줄이 없거나 설명이 비면 화면은 「입금 계좌가 설정되지 않았습니다」 — 소스 기본값은 없다
 *
 * 모양 — 머리 `cm_1_DEPOSIT_ACCT` · 파티션 `cc_1_DEPOSIT_ACCT_000` · 값 `cl_1_DEPOSIT_ACCT_<코드값>`,
 * 건물 `1`, `is_system = false`, 사용 중, 순서 1 · 2.
 *
 * ★ 분류가 이미 있으면(머리 · 파티션 · 값 중 하나라도) 멈춘다 — 첫 등록만 한다.
 * ★ 기본은 **보기만** 한다(읽기 전용 트랜잭션). `--apply` 일 때만 쓴다(한 트랜잭션, 되읽어 확인).
 * ★ 접속 값은 환경 폴더의 admin.env 다. 값은 출력하지 않는다.
 *
 *   npx tsx scripts/oneoff/2026-11-08-deposit-account-codes.mjs <admin.env>            (보기)
 *   npx tsx scripts/oneoff/2026-11-08-deposit-account-codes.mjs <admin.env> --apply    (쓰기)
 */
import fs from 'node:fs';
import pg from 'pg';
import {
  DEPOSIT_ACCOUNT_CATEGORY,
  DEPOSIT_ACCOUNT_CODE,
  DEPOSIT_ACCOUNT_USE_TP,
  DEPOSIT_HOLDER_CODE,
  depositAccountOf,
} from '../../packages/shared/src/domain/deposit-account.ts';

const args = process.argv.slice(2).filter((a) => a !== '--apply');
const APPLY = process.argv.includes('--apply');
const [envPath] = args;
if (!envPath) {
  console.error('사용법: npx tsx scripts/oneoff/2026-11-08-deposit-account-codes.mjs <admin.env> [--apply]');
  process.exit(2);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').replace(/^﻿/, '').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const BUILD_ID = '1';
const CATEGORY = DEPOSIT_ACCOUNT_CATEGORY;
const USE_TP = DEPOSIT_ACCOUNT_USE_TP;
const MASTER = {
  name: '입금 계좌',
  description:
    '이용계약서 「오피스 정보」의 은행(계좌번호) · 정산서 「입금 계좌」에 찍히는 우리 입금 계좌. 이름 = 사람이 읽는 이름, 설명 = 값(ACCOUNT 은행과 계좌번호 · HOLDER 예금주). 줄이 없거나 설명이 비면 화면에 「입금 계좌가 설정되지 않았습니다」',
};
const PARTITION_DESC = '단일 파티션. 계약서 · 정산서가 설명 칸을 읽는다';

/** [코드값, 이름, 설명(값)] — 지금까지 소스 상수(CONTRACT_OFFICE)에 있던 값 그대로. */
const LINES = [
  [DEPOSIT_ACCOUNT_CODE, '입금 계좌', '우리은행 1005-002-433395'],
  [DEPOSIT_HOLDER_CODE, '예금주', '㈜에스원테크'],
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
    LINES.forEach(([code, name, description], i) => console.log(`  ${i + 1}. ${code} — 이름 ${name} · 설명 ${description}`));
    const shown = depositAccountOf(LINES.map(([code, , description]) => ({ category: CATEGORY, code, description })));
    if (!shown) throw new Error('앱이 이 줄들을 입금 계좌로 읽지 못합니다 — 아무것도 쓰지 않았습니다');
    console.log(`■ 화면에 보일 값: ${shown.account} (예금주 ${shown.holder})`);

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
      `SELECT category, code, name, description FROM public.tb_s080_codes_line WHERE category = $1 AND use_tp = $2 AND is_active = true ORDER BY sort_order`,
      [CATEGORY, USE_TP],
    );
    if (back.map((r) => `${r.code}=${r.name}=${r.description}`).join() !== LINES.map((l) => l.join('=')).join()) {
      throw new Error('되읽은 값이 다릅니다 — 되돌립니다');
    }
    const read = depositAccountOf(back);
    if (!read || read.account !== shown.account || read.holder !== shown.holder) throw new Error('되읽은 값을 앱이 같게 읽지 못합니다 — 되돌립니다');
    await c.query('COMMIT');
    console.log(`✔ 썼습니다 — 머리 1 · 파티션 1 · 값 ${LINES.length}(되읽어 확인)`);
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    await c.end();
  }
})().catch((e) => { console.error(`✘ ${e.message}`); process.exit(1); });
