/**
 * 일회용(2026-11-18 · 통합 방 · 대표 결정) — ERP 쪽 공통 코드 `EMAIL_DOMAIN` 을 「사용 안 함」으로 바꾼다.
 *
 *   이메일 도메인의 주인은 **삐용**이다(s09-mail `docs/코드주인_나누기_20261118.md` §3-1 · 명세 118 — 삐용 줄을
 *   ERP 5줄로 맞췄다). ERP 는 이제 삐용 서버 키 주소로 받아 쓴다(api `bbiyong/sharedCodes.ts` · `routes/lookups.ts`).
 *   그래서 ERP 표의 `EMAIL_DOMAIN` 줄은 아무도 읽지 않는다 — 끈다.
 *
 *   · 바꾸는 것: `tb_s080_codes_line` 의 `category = 'EMAIL_DOMAIN'` 줄 전부(모든 사용타입)의 `is_active` → false.
 *     **지우지 않는다.** 머리 · 사용타입 줄은 그대로 둔다(머리 · 사용타입 표에는 사용 여부 칸이 없다).
 *   · ★ 쓰는 곳이 선언돼 있으면 멈춘다 — `CODE_USAGE`(업무 표에 저장되는 자리)에 줄이 있거나 `PINNED_CODES`
 *     (앱이 상수로 박은 자리)에 있으면. 코드 관리 화면이 끄기를 막는 규칙과 같다(`routes/codes.ts`).
 *   · ★ 줄이 하나도 없으면 멈춘다. 이미 모두 꺼져 있으면 아무것도 하지 않는다(두 번 돌려도 안전).
 *   · ★ 전제: 삐용에서 받아 쓰는 ERP 앱(이 파일과 같은 커밋)이 **먼저** 올라가 있어야 한다 — 옛 앱은
 *     ERP 표에서 읽으므로, 먼저 끄면 계약 폼의 이메일 도메인 선택지가 빈다.
 *
 * ★ 기본은 **보기만** 한다(읽기 전용 트랜잭션). `--apply` 일 때만 쓴다(한 트랜잭션, 되읽어 확인).
 * ★ 접속 값은 환경 폴더의 admin.env 다. 값은 출력하지 않는다.
 *
 *   npx tsx scripts/oneoff/2026-11-18-email-domain-unuse.mjs <admin.env>            (보기)
 *   npx tsx scripts/oneoff/2026-11-18-email-domain-unuse.mjs <admin.env> --apply    (쓰기)
 */
import fs from 'node:fs';
import pg from 'pg';
import { CODE_USAGE, PINNED_CODES } from '../../packages/shared/src/domain/code-usage.ts';

const CATEGORY = 'EMAIL_DOMAIN';
const FILE = 'scripts/oneoff/2026-11-18-email-domain-unuse.mjs';

const args = process.argv.slice(2).filter((a) => a !== '--apply');
const APPLY = process.argv.includes('--apply');
const [envPath] = args;
if (!envPath) {
  console.error(`사용법: npx tsx ${FILE} <admin.env> [--apply]`);
  process.exit(2);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').replace(/^﻿/, '').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

(async () => {
  const declared = CODE_USAGE.filter((r) => r.category === CATEGORY);
  const pinned = PINNED_CODES.filter((r) => r.category === CATEGORY);
  if (declared.length || pinned.length) {
    throw new Error(
      `${CATEGORY} 를 쓰는 자리가 선언돼 있습니다(업무 표 ${declared.map((r) => `${r.table}.${r.column}`).join(', ') || '없음'} · ` +
        `앱 상수 ${pinned.map((r) => r.source).join(', ') || '없음'}) — 끄지 않습니다. 아무것도 쓰지 않았습니다`,
    );
  }

  const c = new pg.Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
  await c.connect();
  await c.query(APPLY ? 'BEGIN' : 'BEGIN READ ONLY');
  try {
    const { rows } = await c.query(
      `SELECT use_tp, code, name, is_active FROM public.tb_s080_codes_line WHERE category = $1 ORDER BY use_tp, sort_order, code`,
      [CATEGORY],
    );
    if (rows.length === 0) throw new Error(`${CATEGORY} 줄이 ERP 표에 없습니다 — 아무것도 쓰지 않았습니다`);
    console.log(`■ ERP 코드 ${CATEGORY} — ${rows.length}줄`);
    for (const r of rows) console.log(`  ${r.use_tp} · ${r.code} — ${r.name} : ${r.is_active ? '사용 → 사용 안 함' : '이미 사용 안 함'}`);
    const on = rows.filter((r) => r.is_active).length;
    if (on === 0) { console.log('바꿀 줄이 없습니다(모두 사용 안 함).'); await c.query('ROLLBACK'); return; }

    if (!APPLY) { console.log(`보기만 했습니다(사용 안 함으로 바꿀 줄 ${on}). 쓰려면 --apply.`); await c.query('ROLLBACK'); return; }

    const { rowCount } = await c.query(
      `UPDATE public.tb_s080_codes_line SET is_active = false, updated_at = CURRENT_TIMESTAMP
        WHERE category = $1 AND is_active = true`,
      [CATEGORY],
    );
    const { rows: [left] } = await c.query(
      `SELECT count(*)::int AS n FROM public.tb_s080_codes_line WHERE category = $1 AND is_active = true`,
      [CATEGORY],
    );
    if (rowCount !== on || left.n !== 0) throw new Error(`되읽은 값이 다릅니다(바꾼 줄 ${rowCount} · 남은 사용 ${left.n}) — 되돌립니다`);
    await c.query('COMMIT');
    console.log(`✔ 썼습니다 — 사용 안 함 ${rowCount}줄(되읽어 확인 · 지우지 않음)`);
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    await c.end();
  }
})().catch((e) => { console.error(`✘ ${e.message}`); process.exit(1); });
