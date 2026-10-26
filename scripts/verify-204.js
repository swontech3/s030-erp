/**
 * 204 검증 — 세무(S05) 코드 분류 넷(TAX_INV_DIR · TAX_INV_CLASS · TAX_INV_TYPE · TAX_VENDOR_TP)과
 * 대응표 한 줄(HOMETAX_TAX_INVOICE).
 *
 * 사용: node scripts/verify-204.js .env packages/api/.env
 *
 * ★ 읽기만 한다 — 아무것도 넣지 않는다. 앱과 같은 길로 erp_app 접속 · 운영사 스코프에서 읽는다
 *   (트랜잭션은 ROLLBACK 으로 닫는다). verify-202 와 같은 방식.
 * ★ 고정 코드는 여기서 **DB 쪽**만 본다. 지우기 · 코드값 바꾸기 막기(code-usage.ts `PINNED_CODES`)는
 *   203 · 204 적용 뒤 더하고 `verify-codes` 가 본다.
 * ★ 대응표의 칸 번호가 제목 줄의 그 칸 이름을 가리키는지 맞춰 본다 — 번호가 하나 밀리면 금액이 엉뚱한
 *   칸에서 온다.
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

/** 분류 → [분류 이름, [코드, 이름] 순서대로]. 넷 모두 고정 코드다. 204 와 같은 값이다. */
const WANT = {
  TAX_INV_DIR: ['계산서 구분', [['P', '매입'], ['S', '매출']]],
  TAX_INV_CLASS: ['계산서 종류', [['TAX', '세금계산서']]],
  TAX_INV_TYPE: ['계산서 세부 종류', [['GEN', '일반']]],
  TAX_VENDOR_TP: ['거래처 구분', [['M', '주거래처'], ['G', '일반']]],
};
const CATS = Object.keys(WANT);
const MAP_ID = 'HOMETAX_TAX_INVOICE';
/** 대응표 칸 번호(1부터) → 그 자리에 있어야 할 제목 줄 칸 이름. */
const WANT_COLUMNS = [
  ['writeDate', 1, '작성일자'],
  ['approvalNo', 2, '승인번호'],
  ['supplier.bizNo', 5, '공급자사업자등록번호'],
  ['supplier.name', 7, '상호'],
  ['buyer.bizNo', 10, '공급받는자사업자등록번호'],
  ['buyer.name', 12, '상호'],
  ['totalAmount', 15, '합계금액'],
  ['supplyAmount', 16, '공급가액'],
  ['taxAmount', 17, '세액'],
  ['invClass.col', 18, '전자세금계산서분류'],
  ['invType.col', 19, '전자세금계산서종류'],
];

const results = [];
const check = (id, what, cond, note = '') => results.push({ 항목: id, 내용: what, 결과: cond ? '통과' : '실패', 비고: note });
const at = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

async function codeChecks(q) {
  const masters = await q(`SELECT category, name FROM public.tb_s080_code_masters WHERE build_id = '1' AND category = ANY($1)`, [CATS]);
  check('C1', '분류 넷이 있다', masters.length === CATS.length, masters.map((m) => m.category).join(','));
  const nameOk = CATS.every((c) => masters.find((m) => m.category === c)?.name === WANT[c][0]);
  check('C2', '분류 이름', nameOk, masters.map((m) => `${m.category}=${m.name}`).join(' '));

  const parts = await q(`SELECT category, use_tp FROM public.tb_s080_code_categories WHERE build_id = '1' AND category = ANY($1)`, [CATS]);
  const partOk = CATS.every((c) => {
    const p = parts.filter((r) => r.category === c);
    return p.length === 1 && p[0].use_tp === '000';
  });
  check('C3', '파티션은 분류마다 공통(000) 하나', partOk, parts.map((p) => `${p.category}/${p.use_tp}`).join(' '));

  const lines = await q(`SELECT category, use_tp, code, name, sort_order, is_active
    FROM public.tb_s080_codes_line WHERE build_id = '1' AND category = ANY($1) ORDER BY category, sort_order`, [CATS]);

  let n = 4;
  for (const c of CATS) {
    const [, codes] = WANT[c];
    const got = lines.filter((l) => l.category === c);
    const shape = got.map((l) => `${l.code}:${l.name}`).join(',');
    const want = codes.map(([code, name]) => `${code}:${name}`).join(',');
    // 순서 · 이름까지 같으면 고정 코드의 「빠짐없이 · 더하지 않고」도 함께 맞다
    check(`C${n++}`, `고정 코드 ${c} — 값 ${codes.length}개 · 코드값 · 이름 · 순서`, shape === want, shape);
  }

  check(`C${n++}`, '코드값이 모두 000 파티션 · 켜짐(is_active)', lines.every((l) => l.use_tp === '000' && l.is_active),
    lines.filter((l) => l.use_tp !== '000' || !l.is_active).map((l) => `${l.category}/${l.code}`).join(','));
  check(`C${n++}`, '코드값 합계 6', lines.length === 6, String(lines.length));
  return lines;
}

async function mapChecks(q, lines) {
  const rows = await q(`SELECT id, kind, name, header_row, header_signature, columns, is_active FROM public.tb_s050_import_maps`);
  check('M1', `대응표는 ${MAP_ID} 한 줄`, rows.length === 1 && rows[0].id === MAP_ID, rows.map((r) => r.id).join(','));
  const m = rows.find((r) => r.id === MAP_ID);
  if (!m) return;

  check('M2', '자료 종류 INVOICE · 이름 · 켜짐', m.kind === 'INVOICE' && m.name === '홈택스 전자세금계산서 목록' && m.is_active,
    `${m.kind} ${m.name} ${m.is_active}`);
  check('M3', '제목 줄 6 · 칸 33개', m.header_row === 6 && m.header_signature.length === 33,
    `${m.header_row} / ${m.header_signature.length}`);

  const sig = m.header_signature;
  const cols = m.columns;
  const wrong = WANT_COLUMNS.filter(([path, no, name]) => at(cols, path) !== no || sig[no - 1] !== name);
  check('M4', '★ 칸 번호가 제목 줄의 그 칸 이름을 가리킨다(11칸)', wrong.length === 0,
    wrong.map(([path, no, name]) => `${path}=${at(cols, path)}(바람 ${no} ${name}, 실제 ${sig[(at(cols, path) ?? 0) - 1]})`).join(' '));
  check('M5', '같은 이름 칸이 두 번 — 「상호」 7 · 12 (그래서 번호로 가리킨다)',
    sig.filter((s) => s === '상호').length === 2 && sig.indexOf('상호') === 6 && sig.lastIndexOf('상호') === 11);
  check('M6', '우리 회사 사업자번호 — 1줄 「사업자 등록번호」 이름표 오른쪽',
    cols.ownBizNo && cols.ownBizNo.row === 1 && cols.ownBizNo.label === '사업자 등록번호', JSON.stringify(cols.ownBizNo));

  // 값 바꾸기표의 코드값이 그 분류에 있는가
  const codesOf = (c) => lines.filter((l) => l.category === c).map((l) => l.code);
  const classVals = Object.values(cols.invClass?.values ?? {});
  const typeVals = Object.values(cols.invType?.values ?? {});
  check('M7', '종류 값 바꾸기 — 「세금계산서」→TAX, TAX_INV_CLASS 에 있다',
    JSON.stringify(cols.invClass?.values) === '{"세금계산서":"TAX"}' && classVals.every((v) => codesOf('TAX_INV_CLASS').includes(v)),
    JSON.stringify(cols.invClass?.values));
  check('M8', '세부 종류 값 바꾸기 — 「일반」→GEN 하나(나머지 줄은 넣지 않는다), TAX_INV_TYPE 에 있다',
    JSON.stringify(cols.invType?.values) === '{"일반":"GEN"}' && typeVals.every((v) => codesOf('TAX_INV_TYPE').includes(v)),
    JSON.stringify(cols.invType?.values));
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
      const lines = await codeChecks(q);
      await mapChecks(q, lines);
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
