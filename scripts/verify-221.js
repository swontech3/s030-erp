/**
 * 221 검증 — 세무(S05) 자료 종류 코드(TAX_KIND) 이름 · 설명(2026-11-07 대표 수정 ④ 자료 올리기).
 *
 *   이름 4줄(INVOICE · BANK · NTAX · LTAX) · 설명 7줄(SOCIAL 만 그대로)을 바꾼다. 코드값 · 순서 · 켜짐은 그대로.
 *
 * 사용: node scripts/verify-221.js .env packages/api/.env
 * 적용 전 시험: node scripts/verify-221.js .env packages/api/.env --dry-run supabase/migrations/221_tax_kind_card_texts.sql
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

/** 221 뒤 기대값 — [코드값, 이름, 설명, 순서]. */
const EXPECTED = [
  ['INVOICE', '매출 · 매입파일', '홈택스에서 받은 엑셀 파일 업로드', 1],
  ['CARD', '카드 사용 내역', '홈택스 사업용 신용카드 엑셀 파일 업로드', 2],
  ['CASH', '현금 경비', '표준양식을 받아 작성한 엑셀 파일 업로드', 3],
  ['BANK', '은행거래 및 이체내역', '은행별 거래내역 · 이체내역 엑셀 업로드', 4],
  ['NTAX', '국세 납부 내역', '홈택스 납부내역 엑셀 파일 업로드', 5],
  ['LTAX', '지방세 내역', '위택스 · 이택스 납부내역 엑셀 파일 업로드', 6],
  ['SOCIAL', '4대보험', '사회보험 통합징수포털 가입자별 고지 내역 CSV. 보험 종류와 고지 연월을 고릅니다', 7],
  ['LOAN', '대출 내역', '원금 · 이자가 있는 은행별 대출내역 엑셀 파일 업로드', 8],
];
/** 221 앞 이름 — 시험 뒤 ROLLBACK 확인용. */
const OLD_NAMES = { INVOICE: '매입·매출 계산서', BANK: '은행 입출금', NTAX: '국세 납부', LTAX: '지방세 납부' };

const results = [];
const check = (id, what, cond, note = '') => results.push({ 항목: id, 내용: what, 결과: cond ? '통과' : '실패', 비고: note });

const kindRows = (pc) =>
  pc.query(`SELECT code, name, description, sort_order, is_active FROM public.tb_s080_codes_line
    WHERE build_id = '1' AND category = 'TAX_KIND' AND use_tp = '000' ORDER BY sort_order`).then((r) => r.rows);

async function checks(pc) {
  const rows = await kindRows(pc);
  check('K1', 'TAX_KIND 코드값 8줄 그대로(코드값 · 순서)', rows.length === 8 && rows.every((r, i) => r.code === EXPECTED[i][0] && r.sort_order === EXPECTED[i][3]),
    rows.map((r) => r.code).join(','));
  const nameBad = EXPECTED.filter(([code, name]) => rows.find((r) => r.code === code)?.name !== name).map(([c]) => c);
  check('K2', '이름 — INVOICE 매출 · 매입파일 · BANK 은행거래 및 이체내역 · NTAX 국세 납부 내역 · LTAX 지방세 내역(나머지 그대로)', nameBad.length === 0, nameBad.join(',') || '8줄 맞음');
  const descBad = EXPECTED.filter(([code, , desc]) => rows.find((r) => r.code === code)?.description !== desc).map(([c]) => c);
  check('K3', '설명 — 7줄 새 설명 · SOCIAL 은 그대로', descBad.length === 0, descBad.join(',') || '8줄 맞음');
  check('K4', '모두 켜짐 그대로', rows.every((r) => r.is_active === true));
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
    const rows = await kindRows(pc);
    const back = Object.entries(OLD_NAMES).every(([code, name]) => rows.find((r) => r.code === code)?.name === name);
    check('Z1', '(시험) ROLLBACK 뒤 예전 이름 그대로 — DB 는 그대로', back);
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
