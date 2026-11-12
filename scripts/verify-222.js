/**
 * 222 검증 — 세무(S05) 항목 지정 검색조건 코드(TAX_CLS_STATUS · TAX_CLS_SOURCE) · 카드 줄 「내용」 칸(2026-11-08 대표 수정 ⑤).
 *
 *   구분 L 미지정 · D 지정(켜짐) / 출처 P 매입 · S 매출 · CARD 카드 · CASH 현금경비(켜짐) · PCARD 개인카드 · BANK 은행(사용 안 함)
 *   tb_s050_card_txns.note varchar(100) NULL(기본값 없음) · erp_app 칸 단위 UPDATE
 *
 * 사용: node scripts/verify-222.js .env packages/api/.env
 * 적용 전 시험: node scripts/verify-222.js .env packages/api/.env --dry-run supabase/migrations/222_tax_classify_search.sql
 *   postgres 한 접속 · 한 트랜잭션 안에서 파일을 돌리고(파일의 BEGIN; · COMMIT; 줄은 걷음) 검증한 뒤 **늘 ROLLBACK** 한다.
 *
 * 종료코드: 0 = 전부 통과 / 1 = 실패 있음 / 2 = 실행 실패
 */
const fs = require('fs');
const { Client } = require('pg');

const readEnv = (file) =>
  Object.fromEntries(
    fs.readFileSync(file, 'utf8').split(/\r?\n/)
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }),
  );

const rootEnv = readEnv(process.argv[2] || '.env');
const dryAt = process.argv.indexOf('--dry-run');
const dryFiles = dryAt >= 0 ? process.argv.slice(dryAt + 1) : null;

/** 기대값 — [분류, 코드값, 이름, 순서, 켜짐]. */
const EXPECTED = [
  ['TAX_CLS_STATUS', 'L', '미지정', 1, true],
  ['TAX_CLS_STATUS', 'D', '지정', 2, true],
  ['TAX_CLS_SOURCE', 'P', '매입', 1, true],
  ['TAX_CLS_SOURCE', 'S', '매출', 2, true],
  ['TAX_CLS_SOURCE', 'CARD', '카드', 3, true],
  ['TAX_CLS_SOURCE', 'CASH', '현금경비', 4, true],
  ['TAX_CLS_SOURCE', 'PCARD', '개인카드', 5, false],
  ['TAX_CLS_SOURCE', 'BANK', '은행', 6, false],
];
const CATS = ['TAX_CLS_STATUS', 'TAX_CLS_SOURCE'];

const results = [];
const check = (id, what, cond, note = '') => results.push({ 항목: id, 내용: what, 결과: cond ? '통과' : '실패', 비고: note });

async function checks(pc) {
  const q = (s, p) => pc.query(s, p).then((r) => r.rows);
  const masters = await q(`SELECT category, name FROM public.tb_s080_code_masters WHERE build_id = '1' AND category = ANY($1) ORDER BY category`, [CATS]);
  check('C1', '코드 분류 둘 — 항목 지정 구분 · 항목 지정 출처', masters.length === 2 &&
    masters.find((m) => m.category === 'TAX_CLS_STATUS')?.name === '항목 지정 구분' &&
    masters.find((m) => m.category === 'TAX_CLS_SOURCE')?.name === '항목 지정 출처', masters.map((m) => `${m.category}=${m.name}`).join(','));
  const parts = await q(`SELECT category, use_tp FROM public.tb_s080_code_categories WHERE build_id = '1' AND category = ANY($1)`, [CATS]);
  check('C2', '파티션 — 둘 다 공통(000) 하나', parts.length === 2 && parts.every((p) => p.use_tp === '000'), parts.map((p) => `${p.category}/${p.use_tp}`).join(','));
  const lines = await q(`SELECT category, code, name, sort_order, is_active FROM public.tb_s080_codes_line
    WHERE build_id = '1' AND category = ANY($1) AND use_tp = '000' ORDER BY category DESC, sort_order`, [CATS]);
  const bad = EXPECTED.filter(([cat, code, name, order, active]) => {
    const l = lines.find((x) => x.category === cat && x.code === code);
    return !l || l.name !== name || l.sort_order !== order || l.is_active !== active;
  });
  check('C3', '코드 8줄 — 구분 L 미지정 · D 지정 / 출처 P 매입 · S 매출 · CARD 카드 · CASH 현금경비 (이름 · 순서)', lines.length === 8 && bad.length === 0,
    bad.map((b) => b[1]).join(',') || `${lines.length}줄`);
  check('C4', '★ 개인카드 · 은행은 「사용 안 함」 — 나머지는 켜짐', bad.length === 0 &&
    lines.filter((l) => !l.is_active).map((l) => l.code).sort().join() === 'BANK,PCARD', lines.filter((l) => !l.is_active).map((l) => l.code).join(','));

  const col = (await q(`SELECT data_type, character_maximum_length AS len, is_nullable, column_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tb_s050_card_txns' AND column_name = 'note'`))[0];
  check('N1', 'tb_s050_card_txns.note — varchar(100) · NULL 허용 · 기본값 없음', !!col && col.data_type === 'character varying' &&
    col.len === 100 && col.is_nullable === 'YES' && col.column_default === null, JSON.stringify(col ?? null));
  const priv = (await q(`SELECT has_column_privilege('erp_app', 'public.tb_s050_card_txns', 'note', 'UPDATE') AS u,
    has_column_privilege('erp_app', 'public.tb_s050_card_txns', 'note', 'SELECT') AS s`))[0];
  check('N2', 'erp_app — note 읽기 · 고치기(칸 단위 UPDATE)', priv?.u === true && priv?.s === true, JSON.stringify(priv));
  const others = (await q(`SELECT has_column_privilege('erp_app', 'public.tb_s050_card_txns', 'total_amount', 'UPDATE') AS t`))[0];
  check('N3', '다른 칸 권한은 그대로 — 금액 칸은 여전히 못 고친다', others?.t === false, JSON.stringify(others));
}

const bodyOf = (file) => fs.readFileSync(file, 'utf8').replace(/^BEGIN;[ \t]*$/m, '').replace(/^COMMIT;[ \t]*$/m, '');

(async () => {
  const pc = new Client({ host: rootEnv.DB_HOST, port: +rootEnv.DB_PORT, user: rootEnv.DB_USER, password: rootEnv.DB_PASSWORD, database: rootEnv.DB_NAME });
  await pc.connect();
  await pc.query('BEGIN');
  try {
    if (dryFiles) {
      if (dryFiles.length === 0) throw new Error('--dry-run 뒤에 마이그레이션 파일을 적는다');
      for (const f of dryFiles) { await pc.query(bodyOf(f)); console.log(`(시험) 돌림: ${f}`); }
    }
    await checks(pc);
  } finally {
    await pc.query('ROLLBACK');
  }
  if (dryFiles) {
    const n = (await pc.query(`SELECT count(*)::int n FROM public.tb_s080_code_masters WHERE category = ANY($1)`, [CATS])).rows[0].n;
    const c = (await pc.query(`SELECT count(*)::int n FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'tb_s050_card_txns' AND column_name = 'note'`)).rows[0].n;
    check('Z1', '(시험) ROLLBACK 뒤 분류 · 칸이 없다 — DB 는 그대로', n === 0 && c === 0, `분류 ${n} · 칸 ${c}`);
  }
  await pc.end();

  console.table(results);
  const failed = results.filter((r) => r.결과 !== '통과').length;
  console.log(failed === 0 ? `✔ 전부 통과 (${results.length}건)` : `✘ 실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error('✘ 실행 실패:', e.message);
  process.exit(2);
});
