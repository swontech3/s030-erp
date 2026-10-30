/**
 * 209 검증 — 세무(S05) 카드 · 현금 경비 코드와 대응표 두 줄.
 *
 *   새 분류 셋   TAX_PAY_METHOD(지급방법) · TAX_PROOF(증빙) · TAX_CARD_DEDUCT(카드 공제 여부)
 *   더한 코드값  TAX_SKIP_REASON(뺀 줄 종류) 5개 — 205 의 7개 뒤에 · 205 badDate 이름 「날짜가 맞지 않음」
 *   고친 설명    TAX_KIND CARD · CASH (옛 문구였을 때만)
 *   대응표       HOMETAX_BIZ_CARD(홈택스 사업용 신용카드) · TAX_CASH_STD(현금 경비 표준 양식)
 *
 * 사용: node scripts/verify-209.js .env packages/api/.env
 *
 * ★ 읽기만 한다 — 아무것도 넣지 않는다. 앱과 같은 길로 erp_app 접속 · 운영사 스코프에서 읽는다
 *   (트랜잭션은 ROLLBACK 으로 닫는다). verify-204 와 같은 방식.
 * ★★ 코드값 · 이름 · 순서는 대표가 승인한 표(2026-10-30) 그대로 여기 적어 둔다 — 코드 관리에서 이름을 고치면
 *    C 항목이 실패로 나온다(비고의 실제 값을 보고 판단).
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

/** 승인된 새 분류 — [분류, 이름, [[코드값, 이름], …(순서대로)]]. */
const NEW_CATS = [
  ['TAX_PAY_METHOD', '지급방법', [['CASH', '현금'], ['TRANSFER', '계좌이체(직원 정산)'], ['OWNER', '대표 개인 돈']]],
  ['TAX_PROOF', '증빙', [['RECEIPT', '영수증'], ['SIMPLE', '간이영수증'], ['CASHRCPT', '현금영수증'], ['PCARD', '개인카드 영수증'], ['NONE', '없음']]],
  ['TAX_CARD_DEDUCT', '카드 공제 여부', [['Y', '공제'], ['N', '불공제']]],
];
/** 205 의 7개(그대로) + 209 가 더한 5개 — 순서까지. ★ 공제 여부를 모르는 줄은 빼지 않고 경고한다(대표 2026-10-30). */
const SKIP_OLD = ['nonGeneral', 'noBizNo', 'badAmount', 'noApproval', 'dupInFile', 'otherClass', 'badDate'];
const SKIP_NEW = [
  ['noCardNo', '카드번호 없음'],
  ['noDescription', '품명 없음'],
  ['noAmount', '매출액 · 매입액이 모두 빔'],
  ['bothAmounts', '매출액 · 매입액을 모두 적음'],
  ['badPayMethod', '지급방법이 비었거나 목록에 없음'],
];
const KIND_DESC = {
  CARD: '홈택스 사업용 신용카드 사용내역 엑셀 그대로 올립니다',
  CASH: '표준양식. 항목 칸을 비워 두면 매출 · 매입 항목 지정에서 붙입니다',
};

const CARD_MAP = 'HOMETAX_BIZ_CARD';
const CASH_MAP = 'TAX_CASH_STD';
const CARD_SIG = ['승인일자', '카드사', '카드번호', '가맹점사업자번호', '가맹점명', '공급가액', '세액', '비과세', '합계',
  '가맹점유형', '업태', '업종', '공제여부결정', '비고'];
const CASH_SIG = ['날짜', '품명', '거래처', '항목', '매출액', '매입액', '지급방법', '증빙'];
/** [대응표 칸 경로, 칸 번호(1부터), 제목 줄의 그 칸 이름]. */
const CARD_COLUMNS = [
  ['useDate', 1, '승인일자'], ['cardNo', 3, '카드번호'], ['merchantBizNo', 4, '가맹점사업자번호'], ['merchantName', 5, '가맹점명'],
  ['supplyAmount', 6, '공급가액'], ['taxAmount', 7, '세액'], ['nontaxAmount', 8, '비과세'], ['totalAmount', 9, '합계'],
  ['vatDeduct.col', 13, '공제여부결정'], ['deductNote', 14, '비고'],
];
const CASH_COLUMNS = [
  ['useDate', 1, '날짜'], ['description', 2, '품명'], ['vendorName', 3, '거래처'], ['item', 4, '항목'],
  ['salesAmount', 5, '매출액'], ['purchaseAmount', 6, '매입액'], ['payMethod', 7, '지급방법'], ['proof', 8, '증빙'],
];
const at = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

const results = [];
const check = (id, what, cond, note = '') => results.push({ 항목: id, 내용: what, 결과: cond ? '통과' : '실패', 비고: note });

async function codeChecks(q) {
  let n = 1;
  for (const [cat, name, want] of NEW_CATS) {
    const master = await q(`SELECT name FROM public.tb_s080_code_masters WHERE build_id = '1' AND category = $1`, [cat]);
    check(`C${n++}`, `분류 ${cat} — 이름 「${name}」`, master.length === 1 && master[0].name === name, master.map((m) => m.name).join(','));
    const parts = await q(`SELECT use_tp FROM public.tb_s080_code_categories WHERE build_id = '1' AND category = $1`, [cat]);
    const lines = await q(`SELECT code, name, use_tp, sort_order, is_active FROM public.tb_s080_codes_line
      WHERE build_id = '1' AND category = $1 ORDER BY sort_order, code`, [cat]);
    const fmt = (rows) => rows.map(([c, nm], i) => `${i + 1}.${c}=${nm}`).join(' ');
    check(`C${n++}`, `${cat} — 파티션 000 하나 · 코드값 ${want.length}개 · 이름 · 순서가 승인 표 그대로 · 모두 켜짐`,
      parts.length === 1 && parts[0].use_tp === '000' &&
      fmt(lines.map((l) => [l.code, l.name])) === fmt(want) &&
      lines.every((l, i) => l.use_tp === '000' && l.sort_order === i + 1 && l.is_active),
      fmt(lines.map((l) => [l.code, l.name])));
  }

  const skip = await q(`SELECT code, name, use_tp, sort_order, is_active FROM public.tb_s080_codes_line
    WHERE build_id = '1' AND category = 'TAX_SKIP_REASON' ORDER BY sort_order, code`);
  const wantSkip = [...SKIP_OLD, ...SKIP_NEW.map(([c]) => c)];
  check(`C${n++}`, `TAX_SKIP_REASON — 205 의 7개 그대로 + 새 5개(순서 8~12)`,
    skip.map((l) => l.code).join(',') === wantSkip.join(',') && skip.every((l, i) => l.sort_order === i + 1 && l.use_tp === '000' && l.is_active),
    skip.map((l) => `${l.sort_order}.${l.code}`).join(' '));
  const newNames = SKIP_NEW.filter(([c, nm]) => skip.find((l) => l.code === c)?.name !== nm);
  check(`C${n++}`, 'TAX_SKIP_REASON 새 5개의 이름이 승인 표 그대로', newNames.length === 0,
    newNames.map(([c, nm]) => `${c}: 바람 ${nm} / 실제 ${skip.find((l) => l.code === c)?.name}`).join(' · '));
  const badDate = skip.find((l) => l.code === 'badDate')?.name;
  check(`C${n++}`, 'TAX_SKIP_REASON badDate 이름 — 「날짜가 맞지 않음」(카드 · 현금도 쓴다)', badDate === '날짜가 맞지 않음', String(badDate));

  const kinds = await q(`SELECT code, description FROM public.tb_s080_codes_line
    WHERE build_id = '1' AND category = 'TAX_KIND' AND use_tp = '000' AND code = ANY($1) ORDER BY code`, [Object.keys(KIND_DESC)]);
  const badDesc = Object.entries(KIND_DESC).filter(([c, d]) => kinds.find((k) => k.code === c)?.description !== d);
  check(`C${n++}`, 'TAX_KIND CARD · CASH 설명 — 홈택스 · 「매출 · 매입 항목 지정」 문구', badDesc.length === 0,
    kinds.map((k) => `${k.code}=${k.description}`).join(' / '));
  return { deductCodes: (await q(`SELECT code FROM public.tb_s080_codes_line WHERE build_id = '1' AND category = 'TAX_CARD_DEDUCT'`)).map((r) => r.code) };
}

async function mapChecks(q, { deductCodes }) {
  const rows = await q(`SELECT id, kind, name, header_row, header_signature, columns, is_active FROM public.tb_s050_import_maps ORDER BY id`);
  check('M1', '대응표 세 줄 — 계산서(204) · 카드 · 현금, 자료 종류마다 하나',
    rows.map((r) => `${r.id}:${r.kind}`).join(',') === `${CARD_MAP}:CARD,HOMETAX_TAX_INVOICE:INVOICE,${CASH_MAP}:CASH`,
    rows.map((r) => `${r.id}:${r.kind}`).join(','));

  const plan = [
    ['M2', CARD_MAP, 'CARD', '홈택스 사업용 신용카드 사용내역', 2, CARD_SIG, CARD_COLUMNS],
    ['M3', CASH_MAP, 'CASH', '현금 경비 표준 양식', 2, CASH_SIG, CASH_COLUMNS],
  ];
  for (const [id, mapId, kind, name, headerRow, sig, want] of plan) {
    const m = rows.find((r) => r.id === mapId);
    if (!m) { check(`${id}a`, `${mapId} 가 있다`, false); continue; }
    check(`${id}a`, `${mapId} — 자료 종류 ${kind} · 이름 · 켜짐 · 제목 줄 ${headerRow} · 칸 ${sig.length}개 이름 그대로`,
      m.kind === kind && m.name === name && m.is_active && m.header_row === headerRow &&
      JSON.stringify(m.header_signature) === JSON.stringify(sig),
      `${m.kind} ${m.name} ${m.is_active} ${m.header_row} ${JSON.stringify(m.header_signature)}`);
    const wrong = want.filter(([path, no, nm]) => at(m.columns, path) !== no || m.header_signature[no - 1] !== nm);
    const extra = Object.keys(m.columns).filter((k) => !want.some(([path]) => path.split('.')[0] === k));
    check(`${id}b`, `★ ${mapId} — 칸 번호가 제목 줄의 그 칸 이름을 가리킨다(${want.length}칸, 더한 칸 없음)`,
      wrong.length === 0 && extra.length === 0,
      [...wrong.map(([path, no, nm]) => `${path}=${at(m.columns, path)}(바람 ${no} ${nm})`), ...extra.map((k) => `더한 칸 ${k}`)].join(' '));
  }

  const card = rows.find((r) => r.id === CARD_MAP);
  const vals = card?.columns?.vatDeduct?.values ?? {};
  check('M4', '카드 공제 값 바꾸기 — 「공제」→Y · 「불공제」→N, TAX_CARD_DEDUCT 에 있다',
    JSON.stringify(vals) === '{"공제":"Y","불공제":"N"}' && Object.values(vals).every((v) => deductCodes.includes(v)), JSON.stringify(vals));
  const cash = rows.find((r) => r.id === CASH_MAP);
  check('M5', '현금 — 항목 · 지급방법 · 증빙은 바꾸기표 없이 칸 번호만(코드 표 이름으로 바꾼다, 결정 18)',
    !!cash && ['item', 'payMethod', 'proof'].every((k) => typeof cash.columns[k] === 'number'), JSON.stringify(cash?.columns));
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
      const q = (s, p) => ec.query(s, p).then((r) => r.rows);
      await mapChecks(q, await codeChecks(q));
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
