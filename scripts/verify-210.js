/**
 * 210 검증 — 세무(S05) 현금 경비 표준 양식 다시 만들기(구분 + 금액 한 칸 · 결제방법).
 *
 *   대응표       TAX_CASH_STD — 1줄 제목 · 날짜 · 구분 · 품명 · 거래처 · 항목 · 금액 · 결제방법 · 증빙
 *   분류 이름    TAX_PAY_METHOD 「지급방법」→「결제방법」 · TRANSFER 「계좌이체(직원 정산)」→「계좌이체」(뜻은 설명 칸)
 *   뺀 줄 종류   badDirection 더함 · bothAmounts 지움 · noAmount · badPayMethod 이름 — 순서 8~12 빈틈 없이
 *
 * 사용: node scripts/verify-210.js .env packages/api/.env
 *
 * ★ 읽기만 한다 — 아무것도 넣지 않는다. 앱과 같은 길로 erp_app 접속 · 운영사 스코프에서 읽는다
 *   (트랜잭션은 ROLLBACK 으로 닫는다). verify-209 와 같은 방식.
 * ★★ 이름 · 순서는 대표가 승인한 표(2026-10-31) 그대로 여기 적어 둔다 — 코드 관리에서 이름을 고치면 실패로 나온다.
 * ★ 대응표의 칸 번호가 제목 줄의 그 칸 이름을 가리키는지 맞춰 본다 — 번호가 하나 밀리면 금액이 엉뚱한 칸에서 온다.
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

const CASH_MAP = 'TAX_CASH_STD';
const CASH_SIG = ['날짜', '구분', '품명', '거래처', '항목', '금액', '결제방법', '증빙'];
/** [대응표 칸 이름, 칸 번호(1부터), 제목 줄의 그 칸 이름]. */
const CASH_COLUMNS = [
  ['useDate', 1, '날짜'], ['direction', 2, '구분'], ['description', 3, '품명'], ['vendorName', 4, '거래처'],
  ['item', 5, '항목'], ['amount', 6, '금액'], ['payMethod', 7, '결제방법'], ['proof', 8, '증빙'],
];
const PAY_METHODS = [['CASH', '현금'], ['TRANSFER', '계좌이체'], ['OWNER', '대표 개인 돈']];
/** 205 의 7개 + 카드 · 현금 — 순서까지(bothAmounts 는 없다). */
const SKIP = [
  'nonGeneral', 'noBizNo', 'badAmount', 'noApproval', 'dupInFile', 'otherClass', 'badDate',
  'noCardNo', 'noDescription', 'noAmount', 'badPayMethod', 'badDirection',
];
const SKIP_NAMES = {
  noAmount: '금액이 빔',
  badPayMethod: '결제방법이 비었거나 목록에 없음',
  badDirection: '구분이 비었거나 목록에 없음',
};

const results = [];
const check = (id, what, cond, note = '') => results.push({ 항목: id, 내용: what, 결과: cond ? '통과' : '실패', 비고: note });

async function run(q) {
  const maps = await q(`SELECT id, kind, name, header_row, header_signature, columns, is_active FROM public.tb_s050_import_maps WHERE id = $1`, [CASH_MAP]);
  const m = maps[0];
  check('M1', `${CASH_MAP} — 현금 · 켜짐 · 제목 줄 1 · 칸 8개 이름 그대로`,
    !!m && m.kind === 'CASH' && m.is_active && m.header_row === 1 && JSON.stringify(m.header_signature) === JSON.stringify(CASH_SIG),
    m ? `${m.kind} ${m.is_active} ${m.header_row} ${JSON.stringify(m.header_signature)}` : '없음');
  const wrong = m ? CASH_COLUMNS.filter(([k, no, nm]) => m.columns[k] !== no || m.header_signature[no - 1] !== nm) : CASH_COLUMNS;
  const extra = m ? Object.keys(m.columns).filter((k) => !CASH_COLUMNS.some(([w]) => w === k)) : [];
  check('M2', `★ ${CASH_MAP} — 칸 번호가 제목 줄의 그 칸 이름을 가리킨다(8칸 · 매출액 · 매입액 칸 없음)`,
    wrong.length === 0 && extra.length === 0,
    [...wrong.map(([k, no, nm]) => `${k}=${m?.columns?.[k]}(바람 ${no} ${nm})`), ...extra.map((k) => `더한 칸 ${k}`)].join(' '));

  const master = await q(`SELECT name, description FROM public.tb_s080_code_masters WHERE build_id = '1' AND category = 'TAX_PAY_METHOD'`);
  check('C1', '분류 TAX_PAY_METHOD — 이름 「결제방법」 · 설명이 「결제방법 목록」 시트를 말한다',
    master.length === 1 && master[0].name === '결제방법' && master[0].description.includes('결제방법 목록') && !master[0].description.includes('지급방법'),
    master.map((x) => `${x.name} / ${x.description}`).join(','));
  const pays = await q(`SELECT code, name, description, sort_order, is_active FROM public.tb_s080_codes_line
    WHERE build_id = '1' AND category = 'TAX_PAY_METHOD' ORDER BY sort_order, code`);
  const fmt = (rows) => rows.map(([c, nm], i) => `${i + 1}.${c}=${nm}`).join(' ');
  check('C2', 'TAX_PAY_METHOD — 코드값 그대로 · TRANSFER 이름 「계좌이체」 · 순서 · 모두 켜짐',
    fmt(pays.map((p) => [p.code, p.name])) === fmt(PAY_METHODS) && pays.every((p, i) => p.sort_order === i + 1 && p.is_active),
    fmt(pays.map((p) => [p.code, p.name])));
  const transfer = pays.find((p) => p.code === 'TRANSFER');
  check('C3', 'TRANSFER 설명 칸에 「직원 정산」 뜻', !!transfer?.description && transfer.description.includes('직원 정산'), String(transfer?.description));

  const skip = await q(`SELECT code, name, use_tp, sort_order, is_active FROM public.tb_s080_codes_line
    WHERE build_id = '1' AND category = 'TAX_SKIP_REASON' ORDER BY sort_order, code`);
  check('C4', '★ TAX_SKIP_REASON — bothAmounts 없음 · badDirection 더함 · 순서 1~12 빈틈 없이 · 모두 켜짐',
    skip.map((l) => l.code).join(',') === SKIP.join(',') && skip.every((l, i) => l.sort_order === i + 1 && l.use_tp === '000' && l.is_active),
    skip.map((l) => `${l.sort_order}.${l.code}`).join(' '));
  const badNames = Object.entries(SKIP_NAMES).filter(([c, nm]) => skip.find((l) => l.code === c)?.name !== nm);
  check('C5', '뺀 줄 이름 — 금액이 빔 · 결제방법이 … · 구분이 …', badNames.length === 0,
    badNames.map(([c, nm]) => `${c}: 바람 ${nm} / 실제 ${skip.find((l) => l.code === c)?.name}`).join(' · '));

  const dirs = await q(`SELECT code, name FROM public.tb_s080_codes_line
    WHERE build_id = '1' AND category = 'TAX_INV_DIR' AND use_tp = '000' AND is_active ORDER BY sort_order, code`);
  check('C6', '구분 목록(TAX_INV_DIR) — P 매입 · S 매출 그대로(양식 「구분 목록」 시트가 쓴다)',
    dirs.map((d) => `${d.code}=${d.name}`).join(',') === 'P=매입,S=매출', dirs.map((d) => `${d.code}=${d.name}`).join(','));
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
      await run((s, p) => ec.query(s, p).then((r) => r.rows));
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
