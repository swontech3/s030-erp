/**
 * 202 검증 — 세무(S05) 코드 분류 여섯(TAX_WH_CYCLE · TAX_KIND · TAX_BIZ_TP · TAX_FIN_KIND · BANK · CARD_COMPANY).
 *
 * 사용: node scripts/verify-202.js .env packages/api/.env
 *
 * ★ 읽기만 한다 — 아무것도 넣지 않는다. 코드 세 표에는 RLS 가 없지만, 앱과 같은 길로
 *   erp_app 접속 · 운영사 스코프에서 읽는다(트랜잭션은 ROLLBACK 으로 닫는다).
 * ★ 고정 코드(앱이 코드값에 기대는 것)는 여기서 **DB 쪽**만 본다 — 그 코드값이 빠짐없이 · 더하지 않고
 *   있는지. 지우기 · 코드값 바꾸기 막기(code-usage.ts `PINNED_CODES`)는 201 적용 뒤 더하고
 *   `verify-codes` 가 본다.
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

const apiEnv = readEnv(process.argv[3] || 'packages/api/.env');

/** 분류 → [분류 이름, [코드, 이름] 순서대로, 고정 코드인가]. 202 와 같은 값이다. */
const WANT = {
  TAX_WH_CYCLE: ['원천세 신고 주기', [['M', '매월'], ['H', '반기']], true],
  TAX_KIND: ['세무 자료 종류', [
    ['INVOICE', '매입·매출 계산서'], ['CARD', '카드 사용 내역'], ['CASH', '현금 경비'], ['BANK', '은행 입출금'],
    ['NTAX', '국세 납부'], ['LTAX', '지방세 납부'], ['SOCIAL', '4대보험'], ['LOAN', '대출 내역'],
  ], true],
  TAX_BIZ_TP: ['사업자 유형', [['I', '개인 일반과세자'], ['C', '법인 (유한회사 포함)']], false],
  TAX_FIN_KIND: ['계좌·카드 구분', [['B', '은행'], ['C', '카드']], true],
  BANK: ['은행', [['004', '국민은행'], ['020', '우리은행'], ['081', '하나은행']], false],
  CARD_COMPANY: ['카드사', [['KB', '국민카드'], ['WOORI', '우리카드']], false],
};
const CATS = Object.keys(WANT);

const results = [];
const check = (id, what, cond, note = '') => results.push({ 항목: id, 내용: what, 결과: cond ? '통과' : '실패', 비고: note });

async function codeChecks(q) {
  const masters = await q(`SELECT category, name FROM public.tb_s080_code_masters WHERE build_id = '1' AND category = ANY($1)`, [CATS]);
  check('C1', '분류 여섯이 있다', masters.length === CATS.length, masters.map((m) => m.category).join(','));
  const nameOk = CATS.every((c) => masters.find((m) => m.category === c)?.name === WANT[c][0]);
  check('C2', '분류 이름', nameOk, masters.map((m) => `${m.category}=${m.name}`).join(' '));

  const parts = await q(`SELECT category, use_tp FROM public.tb_s080_code_categories WHERE build_id = '1' AND category = ANY($1)`, [CATS]);
  const partOk = CATS.every((c) => {
    const p = parts.filter((r) => r.category === c);
    return p.length === 1 && p[0].use_tp === '000';
  });
  check('C3', '파티션은 분류마다 공통(000) 하나', partOk, parts.map((p) => `${p.category}/${p.use_tp}`).join(' '));

  const lines = await q(`SELECT category, use_tp, code, name, description, sort_order, is_active
    FROM public.tb_s080_codes_line WHERE build_id = '1' AND category = ANY($1) ORDER BY category, sort_order`, [CATS]);

  let n = 4;
  for (const c of CATS) {
    const [, codes] = WANT[c];
    const got = lines.filter((l) => l.category === c);
    const shape = got.map((l) => `${l.code}:${l.name}`).join(',');
    const want = codes.map(([code, name]) => `${code}:${name}`).join(',');
    check(`C${n++}`, `${c} — 값 ${codes.length}개 · 코드값 · 이름 · 순서`, shape === want, shape);
  }

  check(`C${n++}`, '코드값이 모두 000 파티션 · 켜짐(is_active)', lines.every((l) => l.use_tp === '000' && l.is_active),
    lines.filter((l) => l.use_tp !== '000' || !l.is_active).map((l) => `${l.category}/${l.code}`).join(','));

  const wh = lines.filter((l) => l.category === 'TAX_WH_CYCLE');
  check(`C${n++}`, '원천세 신고 주기 — 설명 칸에 안내 문구(M · H 둘 다)',
    wh.length === 2 && wh.every((l) => (l.description || '').trim() !== ''), wh.map((l) => `${l.code}=${l.description}`).join(' / '));

  // 고정 코드 — 앱이 기대는 코드값이 빠짐없이 · 더하지 않고 있는가(DB 쪽)
  for (const c of CATS.filter((x) => WANT[x][2])) {
    const want = WANT[c][1].map(([code]) => code).sort().join(',');
    const got = lines.filter((l) => l.category === c).map((l) => l.code).sort().join(',');
    check(`P-${c}`, `고정 코드 ${c} — 앱이 기대는 코드값 그대로(${want})`, got === want, got);
  }

  const total = lines.length;
  check(`C${n++}`, '코드값 합계 19', total === 19, String(total));
}

(async () => {
  const erpUrl = apiEnv.ERP_DATABASE_URL || '';
  if (!erpUrl) {
    check('C*', 'erp_app 접속', false, 'packages/api/.env 에 ERP_DATABASE_URL 이 없다');
  } else {
    const ec = new Client({ connectionString: erpUrl });
    await ec.connect();
    try {
      await ec.query('BEGIN');
      await ec.query(`SELECT set_config('app.current_role', 'operator', true)`);
      await codeChecks((s, p) => ec.query(s, p).then((r) => r.rows));
    } finally {
      await ec.query('ROLLBACK');
      await ec.end();
    }
  }

  console.table(results);
  const failed = results.filter((r) => r.결과 !== '통과').length;
  console.log(failed === 0 ? `✔ 전부 통과 (${results.length}건)` : `✘ 실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error('✘ 실행 실패:', e.message);
  process.exit(2);
});
