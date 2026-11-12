/**
 * 213 검증 — 세무(S05) 은행 거래내역 · 이체 내역이 쓰는 코드와 대응표 네 줄.
 *
 *   새 분류      TAX_BANK_FILE(은행 파일 종류) TXN 거래내역 · XFER 이체 내역
 *   더한 코드값  TAX_SKIP_REASON(뺀 줄 종류) 5개 — 12개 뒤에(순서 13~17)
 *   고친 설명    TAX_KIND BANK (206 문구 그대로였을 때만)
 *   대응표       BANK_004_TXN 국민 · BANK_020_TXN 우리 · BANK_081_TXN 하나 거래내역 · BANK_020_XFER 우리 이체 결과
 *
 * 사용: node scripts/verify-213.js .env packages/api/.env
 * 적용 전 시험: node scripts/verify-213.js .env packages/api/.env --dry-run <212.sql> <213.sql>
 *   postgres 한 접속 · 한 트랜잭션 안에서 파일을 돌리고(BEGIN; · COMMIT; 줄은 걷음) 읽은 뒤 **늘 ROLLBACK** 한다.
 *
 * ★ 읽기만 한다 — 아무것도 넣지 않는다. 앱과 같은 길(erp_app · 운영사 스코프)에서 읽는다(verify-209 와 같은 방식).
 * ★★ 코드값 · 이름 · 순서는 대표가 승인한 것(2026-11-01) 그대로 여기 적어 둔다 — 코드 관리에서 이름을 고치면 실패로 나온다.
 * ★ 대응표 칸 번호가 제목 줄의 그 칸 이름을 가리키는지 본다. doc/data-src/ 샘플이 있으면 샘플의 제목 줄과 대응표 제목이
 *   같은지도 본다 — ★ 제목 줄(칸 이름)만 읽고, 값(이름 · 계좌번호 · 금액)은 출력하지 않는다(참/거짓만).
 *
 * 종료코드: 0 = 전부 통과 / 1 = 실패 있음 / 2 = 실행 실패
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const readEnv = (file) =>
  Object.fromEntries(
    fs.readFileSync(file, 'utf8').split(/\r?\n/)
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }),
  );

const rootEnv = readEnv(process.argv[2] || '.env');
const apiEnv = readEnv(process.argv[3] || 'packages/api/.env');
const dryAt = process.argv.indexOf('--dry-run');
const dryFiles = dryAt >= 0 ? process.argv.slice(dryAt + 1) : null;

// ★ 216(2026-11-05)이 이름을 바꿨다 — 거래내역 → 은행거래내역 · 이체 내역 → 은행이체내역(코드값은 그대로)
const FILE_TP = ['TAX_BANK_FILE', '은행 파일 종류', [['TXN', '은행거래내역'], ['XFER', '은행이체내역']]];
const SKIP_OLD = ['nonGeneral', 'noBizNo', 'badAmount', 'noApproval', 'dupInFile', 'otherClass', 'badDate',
  'noCardNo', 'noDescription', 'noAmount', 'badPayMethod', 'badDirection'];
const SKIP_NEW = [
  ['bothInOut', '입금 · 출금이 모두 있음'],
  ['noBalance', '잔액이 없음'],
  ['xferNotDone', '처리완료가 아닌 이체'],
  ['otherAccount', '고른 계좌가 아닌 줄'],
  ['noToAccount', '받는 은행 · 계좌 · 받는분이 빔'],
];
const BANK_DESC_OLD = '통장 거래내역 엑셀. 은행과 계좌를 고릅니다';
// ★ 221(2026-11-07) 에서 설명을 바꿨다(전 「통장 거래내역 · 이체 내역 엑셀. 계좌를 고릅니다」)
const BANK_DESC = '은행별 거래내역 · 이체내역 엑셀 업로드';

/**
 * 대응표 네 줄 — [id, 은행, 파일 종류, 이름, 제목 줄, 제목, [[칸 경로, 번호, 제목 이름]…], 비어야 하는 칸, 계좌번호 자리, 샘플 파일].
 * 계좌번호 자리 = { row, label, stopAt } 또는 null(하나 — 파일에 없음).
 */
const MAPS = [
  ['BANK_004_TXN', '004', 'TXN', '국민은행 거래내역', 7,
    ['No', '거래일시', '보낸분/받는분', '출금액(원)', '입금액(원)', '잔액(원)', '내 통장 표시', '메모', '적요', '처리점', '구분'],
    [['seq', 1, 'No'], ['txnAt', 2, '거래일시'], ['counterparty', 3, '보낸분/받는분'], ['outAmount', 4, '출금액(원)'],
      ['inAmount', 5, '입금액(원)'], ['balance', 6, '잔액(원)'], ['myNote', 7, '내 통장 표시'], ['memo', 8, '메모'], ['description', 9, '적요']],
    [], { row: 1, label: '계좌번호', stopAt: null }, '국민은행_거래내역.xls'],
  ['BANK_020_TXN', '020', 'TXN', '우리은행 거래내역', 4,
    ['No.', '거래일시', '적요', '기재내용', '지급(원)', '입금(원)', '거래후 잔액(원)', '취급점', '메모', '수표·어음·증권금액(원)'],
    [['seq', 1, 'No.'], ['txnAt', 2, '거래일시'], ['description', 3, '적요'], ['counterparty', 4, '기재내용'], ['outAmount', 5, '지급(원)'],
      ['inAmount', 6, '입금(원)'], ['balance', 7, '거래후 잔액(원)'], ['memo', 9, '메모']],
    ['myNote'], { row: 2, label: '계좌번호', stopAt: '예금주' }, '우리은행_거래내역.xlsx'],
  ['BANK_081_TXN', '081', 'TXN', '하나은행 거래내역', 2,
    ['No', '거래일시', '적요', '메모', '의뢰인/수취인', '입금', '출금', '거래후잔액', '구분', '거래점', '거래특이사항'],
    [['seq', 1, 'No'], ['txnAt', 2, '거래일시'], ['description', 3, '적요'], ['memo', 4, '메모'], ['counterparty', 5, '의뢰인/수취인'],
      ['inAmount', 6, '입금'], ['outAmount', 7, '출금'], ['balance', 8, '거래후잔액']],
    ['myNote', 'accountNo'], null, '하나은행_거래내역.xlsx'],
  ['BANK_020_XFER', '020', 'XFER', '우리은행 이체 결과', 2,
    ['No.', '이체일시', '출금계좌번호', '입금은행', '입금계좌번호', '이체금액(원)', '수수료(원)', '수수료후불여부', '받는분',
      '받는분 통장표시', '보내는분 통장표시', '이체결과', '처리내용', '전문(타행)번호', '집금(CMS)번호'],
    [['seq', 1, 'No.'], ['xferAt', 2, '이체일시'], ['fromAccount', 3, '출금계좌번호'], ['toBank', 4, '입금은행'], ['toAccount', 5, '입금계좌번호'],
      ['amount', 6, '이체금액(원)'], ['holder', 9, '받는분'], ['toMemo', 10, '받는분 통장표시'], ['fromMemo', 11, '보내는분 통장표시'],
      ['done.col', 12, '이체결과']],
    [], null, '우리은행_이체결과.xlsx'],
];
const TXN_KEYS = ['seq', 'txnAt', 'description', 'counterparty', 'myNote', 'memo', 'inAmount', 'outAmount', 'balance', 'accountNo'];
const XFER_KEYS = ['seq', 'xferAt', 'fromAccount', 'toBank', 'toAccount', 'amount', 'holder', 'toMemo', 'fromMemo', 'done'];
const at = (obj, p) => p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

const results = [];
const check = (id, what, cond, note = '') => results.push({ 항목: id, 내용: what, 결과: cond ? '통과' : '실패', 비고: note });

async function codeChecks(q) {
  const [cat, name, want] = FILE_TP;
  const master = await q(`SELECT name FROM public.tb_s080_code_masters WHERE build_id = '1' AND category = $1`, [cat]);
  check('C1', `분류 ${cat} — 이름 「${name}」`, master.length === 1 && master[0].name === name, master.map((m) => m.name).join(','));
  const parts = await q(`SELECT use_tp FROM public.tb_s080_code_categories WHERE build_id = '1' AND category = $1`, [cat]);
  const lines = await q(`SELECT code, name, use_tp, sort_order, is_active FROM public.tb_s080_codes_line
    WHERE build_id = '1' AND category = $1 ORDER BY sort_order, code`, [cat]);
  const fmt = (rows) => rows.map(([c, nm], i) => `${i + 1}.${c}=${nm}`).join(' ');
  check('C2', `${cat} — 파티션 000 하나 · 코드값 2개 · 이름 · 순서 그대로 · 모두 켜짐`,
    parts.length === 1 && parts[0].use_tp === '000' && fmt(lines.map((l) => [l.code, l.name])) === fmt(want) &&
    lines.every((l, i) => l.use_tp === '000' && l.sort_order === i + 1 && l.is_active),
    fmt(lines.map((l) => [l.code, l.name])));

  const skip = (await q(`SELECT code, name, use_tp, sort_order, is_active FROM public.tb_s080_codes_line
    WHERE build_id = '1' AND category = 'TAX_SKIP_REASON' ORDER BY sort_order, code`))
    // ★ 215(2026-11-01)가 국세 · 지방세 · 4대보험 · 대출 4개(순서 18~21)를 더했다 — 17번까지만 센다(새 4개는 verify-215)
    .filter((l) => l.sort_order <= 17);
  const wantSkip = [...SKIP_OLD, ...SKIP_NEW.map(([c]) => c)];
  check('C3', 'TAX_SKIP_REASON — 있던 12개 그대로 + 은행 5개(순서 13~17)',
    skip.map((l) => l.code).join(',') === wantSkip.join(',') && skip.every((l, i) => l.sort_order === i + 1 && l.use_tp === '000' && l.is_active),
    skip.map((l) => `${l.sort_order}.${l.code}`).join(' '));
  const badNames = SKIP_NEW.filter(([c, nm]) => skip.find((l) => l.code === c)?.name !== nm);
  check('C4', 'TAX_SKIP_REASON 은행 5개의 이름이 승인 그대로', badNames.length === 0,
    badNames.map(([c, nm]) => `${c}: 바람 ${nm} / 실제 ${skip.find((l) => l.code === c)?.name}`).join(' · '));

  const bank = await q(`SELECT description FROM public.tb_s080_codes_line
    WHERE build_id = '1' AND category = 'TAX_KIND' AND use_tp = '000' AND code = 'BANK'`);
  check('C5', `TAX_KIND BANK 설명 — 「${BANK_DESC}」`, bank.length === 1 && bank[0].description === BANK_DESC, bank.map((b) => b.description).join());
  return (await q(`SELECT code FROM public.tb_s080_codes_line WHERE build_id = '1' AND category = 'BANK' AND is_active`)).map((r) => r.code);
}

/** 샘플 제목 줄 · 계좌번호 줄 — 칸 이름만 돌려준다. 값은 내보내지 않는다(이름표가 있는지 참/거짓만). */
function sampleOf(file, headerRow, acct) {
  const full = path.join('doc', 'data-src', file);
  if (!fs.existsSync(full)) return null;
  const { createRequire } = require('module');
  const XLSX = createRequire(path.resolve('packages/api/package.json'))('xlsx');
  const wb = XLSX.read(fs.readFileSync(full), { type: 'buffer', cellDates: true, UTC: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null, blankrows: true });
  const header = (rows[headerRow - 1] ?? []).map((v) => (v == null ? '' : String(v).trim()));
  while (header.length && header[header.length - 1] === '') header.pop();
  let acctOk = null;
  if (acct) {
    const t = String((rows[acct.row - 1] ?? [])[0] ?? '');
    acctOk = t.trim().startsWith(acct.label) && (acct.stopAt === null || t.includes(acct.stopAt));
  }
  return { header, acctOk };
}

async function mapChecks(q, bankCodes) {
  const has = await q(`SELECT count(*)::int n FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tb_s050_import_maps' AND column_name IN ('bank_code', 'bank_file_tp')`);
  if (has[0].n !== 2) { check('M0', '대응표 표에 은행 칸 둘(bank_code · bank_file_tp)이 있다(212 적용 확인)', false, `${has[0].n}칸`); return; }
  const rows = await q(`SELECT id, kind, name, header_row, header_signature, columns, is_active, bank_code, bank_file_tp
    FROM public.tb_s050_import_maps ORDER BY id`);
  const bankRows = rows.filter((r) => r.kind === 'BANK');
  check('M1', '은행 대응표 네 줄 — 국민 · 우리 · 하나 거래내역 · 우리 이체 결과', bankRows.map((r) => r.id).join(',') ===
    MAPS.map((m) => m[0]).sort().join(','), bankRows.map((r) => `${r.id}:${r.bank_code}:${r.bank_file_tp}`).join(','));
  // ★ 215(2026-11-01)가 국세 · 지방세 · 4대보험 · 대출 대응표 여섯 줄을 더했다 — 계산서 · 카드 · 현금만 센다(새 여섯은 verify-215)
  const others = rows.filter((r) => ['INVOICE', 'CARD', 'CASH'].includes(r.kind));
  check('M2', '다른 대응표 셋(계산서 · 카드 · 현금)은 그대로 · 은행 칸 비움',
    others.map((r) => r.id).join(',') === 'HOMETAX_BIZ_CARD,HOMETAX_TAX_INVOICE,TAX_CASH_STD' &&
    others.every((r) => r.bank_code === null && r.bank_file_tp === null), others.map((r) => r.id).join(','));

  let n = 3;
  for (const [id, bank, tp, name, headerRow, sig, want, nulls, acct, sample] of MAPS) {
    const m = rows.find((r) => r.id === id);
    if (!m) { check(`M${n++}`, `${id} 가 있다`, false); continue; }
    check(`M${n}a`, `${id} — 은행 ${bank} · ${tp} · 이름 「${name}」 · 켜짐 · 제목 줄 ${headerRow} · 칸 ${sig.length}개 이름 그대로 · 은행 코드가 BANK 에 있음`,
      m.kind === 'BANK' && m.bank_code === bank && m.bank_file_tp === tp && m.name === name && m.is_active &&
      m.header_row === headerRow && JSON.stringify(m.header_signature) === JSON.stringify(sig) && bankCodes.includes(bank),
      `${m.bank_code} ${m.bank_file_tp} ${m.name} ${m.is_active} ${m.header_row} ${m.header_signature.length}칸`);

    const keys = tp === 'TXN' ? TXN_KEYS : XFER_KEYS;
    const wrong = want.filter(([p, no, nm]) => at(m.columns, p) !== no || m.header_signature[no - 1] !== nm);
    const extra = Object.keys(m.columns).filter((k) => !keys.includes(k));
    const missing = keys.filter((k) => !(k in m.columns));
    const notNull = nulls.filter((k) => m.columns[k] !== null);
    check(`M${n}b`, `★ ${id} — 칸 번호가 제목 줄의 그 칸 이름을 가리킨다(${want.length}칸) · 칸 모양 그대로 · 없는 칸은 null(${nulls.join(' · ') || '없음'})`,
      wrong.length === 0 && extra.length === 0 && missing.length === 0 && notNull.length === 0,
      [...wrong.map(([p, no, nm]) => `${p}=${at(m.columns, p)}(바람 ${no} ${nm})`), ...extra.map((k) => `더한 칸 ${k}`),
        ...missing.map((k) => `빠진 칸 ${k}`), ...notNull.map((k) => `null 아님 ${k}`)].join(' '));

    if (tp === 'TXN') {
      check(`M${n}c`, `${id} — 계좌번호 자리 ${acct ? `${acct.row}줄 「${acct.label}」${acct.stopAt ? ` · 「${acct.stopAt}」 앞까지` : ''}` : '없음(null)'}`,
        JSON.stringify(m.columns.accountNo) === JSON.stringify(acct), JSON.stringify(m.columns.accountNo));
    } else {
      check(`M${n}c`, `${id} — 처리완료 값 { col 12, values [「처리완료」] }`,
        JSON.stringify(m.columns.done) === JSON.stringify({ col: 12, values: ['처리완료'] }), JSON.stringify(m.columns.done));
    }

    const s = sampleOf(sample, headerRow, acct);
    if (s === null) check(`M${n}d`, `${id} — 샘플 ${sample} 제목 줄 비교`, true, '샘플 없음 — 건너뜀');
    else {
      check(`M${n}d`, `${id} — 샘플 ${sample} 의 ${headerRow}줄 제목이 대응표 제목과 같다${acct ? ' · 계좌번호 이름표가 그 줄에 있다' : ''}`,
        JSON.stringify(s.header) === JSON.stringify(sig) && (acct === null || s.acctOk === true),
        `제목 같음=${JSON.stringify(s.header) === JSON.stringify(sig)} 칸 ${s.header.length}${acct ? ` 이름표=${s.acctOk}` : ''}`);
    }
    n++;
  }
}

const bodyOf = (file) => fs.readFileSync(file, 'utf8').replace(/^BEGIN;[ \t]*$/m, '').replace(/^COMMIT;[ \t]*$/m, '');

(async () => {
  if (dryFiles) {
    if (dryFiles.length === 0) throw new Error('--dry-run 뒤에 마이그레이션 파일을 적는다');
    const pc = new Client({ host: rootEnv.DB_HOST, port: +rootEnv.DB_PORT, user: rootEnv.DB_USER, password: rootEnv.DB_PASSWORD, database: rootEnv.DB_NAME });
    await pc.connect();
    await pc.query('BEGIN');
    try {
      for (const f of dryFiles) { await pc.query(bodyOf(f)); console.log(`(시험) 돌림: ${f}`); }
      // ★ 시험은 postgres 로 읽는다(Supabase 의 postgres 는 erp_app 으로 SET ROLE 을 못 한다). 읽기만이라 결과는 같다
      await pc.query(`SELECT set_config('app.current_role', 'operator', true)`);
      const q = (s, p) => pc.query(s, p).then((r) => r.rows);
      await mapChecks(q, await codeChecks(q));
    } finally {
      await pc.query('ROLLBACK');
    }
    const left = (await pc.query(`SELECT count(*)::int n FROM public.tb_s080_code_masters WHERE category = 'TAX_BANK_FILE'`)).rows[0].n;
    check('Z1', '(시험) ROLLBACK 뒤 새 분류가 없다 — DB 는 그대로', left === 0, String(left));
    await pc.end();
  } else {
    const erpUrl = apiEnv.ERP_DATABASE_URL || '';
    if (!erpUrl) check('C*', 'erp_app 접속', false, 'packages/api/.env 에 ERP_DATABASE_URL 이 없다');
    else {
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
  }

  console.table(results);
  const failed = results.filter((r) => r.결과 !== '통과').length;
  console.log(failed === 0 ? `✔ 전부 통과 (${results.length}건)` : `✘ 실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error('✘ 실행 실패:', e.message);
  process.exit(2);
});
