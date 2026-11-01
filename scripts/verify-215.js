/**
 * 215 검증 — 세무(S05) 국세 · 지방세 · 4대보험 · 대출이 쓰는 코드와 대응표 여섯 줄.
 *
 *   새 분류      TAX_SOCIAL_INS(4대보험 종류) NP · HI · LTC · EI · IA
 *               TAX_TAX_NOEXP(비용이 아닌 세목) 8개 — 코드 이름 = 파일의 세목 글자
 *               TAX_LOAN_TP(대출 거래 구분) D 실행 · R 상환
 *   더한 코드값  TAX_SKIP_REASON(뺀 줄 종류) 4개 — 17개 뒤에(순서 18~21)
 *   대응표       HOMETAX_NTAX_PAY · WETAX_LTAX_PAY · SOCIAL_HI · SOCIAL_NP · SOCIAL_EI_IA · BANK_020_LOAN
 *
 * 사용: node scripts/verify-215.js .env packages/api/.env
 * 적용 전 시험: node scripts/verify-215.js .env packages/api/.env --dry-run <214.sql> <215.sql>
 *   postgres 한 접속 · 한 트랜잭션 안에서 파일을 돌리고(BEGIN; · COMMIT; 줄은 걷음) 읽은 뒤 **늘 ROLLBACK** 한다.
 *
 * ★ 읽기만 한다 — 아무것도 넣지 않는다. 앱과 같은 길(erp_app · 운영사 스코프)에서 읽는다(verify-213 과 같은 방식).
 * ★★ 코드값 · 이름 · 순서는 대표가 승인한 것(2026-11-01) 그대로 여기 적어 둔다 — 코드 관리에서 이름을 고치면 실패로 나온다.
 * ★ 대응표 칸 번호가 제목 줄의 그 칸 이름을 가리키는지 본다. doc/data-src/ 샘플이 있으면 샘플의 제목 줄과 대응표 제목이
 *   같은지도 본다 — ★ 제목 줄(칸 이름)만 읽고 값(이름 · 주민번호 · 번호 · 금액)은 읽어 내보내지 않는다(참/거짓만).
 *   ★ 4대보험 대응표는 3번째 칸(주민번호)을 가리키는 칸이 없어야 한다.
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

/** [분류, 이름, [[코드값, 이름]…]] — 순서 = 코드 표 순서. */
const CATS = [
  ['TAX_SOCIAL_INS', '4대보험 종류', [['NP', '국민연금'], ['HI', '건강보험'], ['LTC', '장기요양'], ['EI', '고용보험'], ['IA', '산재보험']]],
  ['TAX_TAX_NOEXP', '비용이 아닌 세목', [
    ['W_LABOR', '근로소득세(갑)'], ['W_BIZ', '사업소득세'], ['L_WH', '지방소득세 특별징수분'], ['VAT', '부가가치세'],
    ['CIT', '법인세'], ['PIT', '종합소득세'], ['L_CIT', '지방소득세 법인소득분'], ['L_PIT', '지방소득세 종합소득분']]],
  ['TAX_LOAN_TP', '대출 거래 구분', [['D', '실행'], ['R', '상환']]],
];
const SKIP_OLD = ['nonGeneral', 'noBizNo', 'badAmount', 'noApproval', 'dupInFile', 'otherClass', 'badDate',
  'noCardNo', 'noDescription', 'noAmount', 'badPayMethod', 'badDirection',
  'bothInOut', 'noBalance', 'xferNotDone', 'otherAccount', 'noToAccount'];
const SKIP_NEW = [
  ['noPayNo', '납부번호 없음'],
  ['dupPayNo', '파일 안에서 겹친 납부번호'],
  ['noMemberName', '가입자 이름 없음'],
  ['noLoanAmount', '원금 · 이자 · 수수료가 모두 0'],
];
/** 카드 설명 — 206 문구를 바꿈(2026-11-01 대표 승인 A). NTAX · LTAX 는 206 그대로. */
const KIND_DESC = {
  SOCIAL: '사회보험 통합징수포털 가입자별 고지 내역 CSV. 보험 종류와 고지 연월을 고릅니다',
  LOAN: '은행 대출거래내역 엑셀. 원금 · 이자를 나눠 읽습니다 — 이자만 비용입니다',
};
const KINDS_UNCHANGED =['INVOICE', 'CARD', 'CASH', 'BANK', 'NTAX', 'LTAX', 'SOCIAL', 'LOAN'];
const OLD_MAPS = ['BANK_004_TXN', 'BANK_020_TXN', 'BANK_020_XFER', 'BANK_081_TXN', 'HOMETAX_BIZ_CARD', 'HOMETAX_TAX_INVOICE', 'TAX_CASH_STD'];

const PAY_KEYS = ['payDate', 'taxItem', 'amount', 'payNo', 'office', 'penalty', 'belongMonth', 'payMethod'];
const SOCIAL_KEYS = ['seq', 'memberNo', 'name', 'payBase', 'lines'];
const LOAN_KEYS = ['seq', 'txnDate', 'drawAmount', 'balance', 'repayAmount', 'interest', 'lateInterest', 'refundInterest', 'fee', 'txnType', 'loanNo'];
const HI_SIG = ['순번', '증번호', '주민번호', '성명', '보수월액',
  '구분', '산출보험료', '정산보험료', '정산사유', '정산적용기간', '감면사유', '연말정산', '환급금이자', '고지보험료', '회계', '영업소기호', '직종', '취득일/상실일',
  '구분', '산출보험료', '정산보험료', '정산사유', '정산적용기간', '감면사유', '연말정산', '환급금이자', '고지보험료', '회계', '영업소기호', '직종', '취득일/상실일'];

/**
 * 대응표 여섯 — { id, kind, name, headerRow, sig, want:[[칸 경로, 번호, 제목 이름]…], nulls, keys, bank, tps, extra, samples }.
 * `extra` = 칸 번호가 아닌 값(계좌번호 자리 · 보험 줄 모양)을 그대로 견줄 것.
 */
const MAPS = [
  {
    id: 'HOMETAX_NTAX_PAY', kind: 'NTAX', name: '홈택스 국세 납부내역', headerRow: 2,
    sig: ['납부일자', '세목', '납세자명', '납부세액', '전자납부번호', '귀속연도', '수납관서', '내국세액', '교육세액', '방위세액', '농어촌특별세액', '가산금', '비고'],
    want: [['payDate', 1, '납부일자'], ['taxItem', 2, '세목'], ['amount', 4, '납부세액'], ['payNo', 5, '전자납부번호'], ['office', 7, '수납관서'],
      ['penalty', 12, '가산금']],
    nulls: ['belongMonth', 'payMethod'], keys: PAY_KEYS, bank: null, tps: null, extra: {}, samples: ['국세납부현황.xls'],
  },
  {
    id: 'WETAX_LTAX_PAY', kind: 'LTAX', name: '위택스 지방세 납부내역', headerRow: 3,
    sig: ['', '납세번호', '', '', '', '세목', '구분', '납세자', '납부일자', '납부금액', '납부기관', '납부방법', '과세대상'],
    want: [['payNo', 2, '납세번호'], ['taxItem', 6, '세목'], ['payDate', 9, '납부일자'], ['amount', 10, '납부금액'], ['office', 11, '납부기관'],
      ['payMethod', 12, '납부방법'], ['belongMonth', 13, '과세대상']],
    nulls: ['penalty'], keys: PAY_KEYS, bank: null, tps: null, extra: {}, samples: ['지방세납부현황.xls'],
  },
  {
    id: 'SOCIAL_HI', kind: 'SOCIAL', name: '건강보험 고지 내역(장기요양 포함)', headerRow: 7, sig: HI_SIG,
    want: [['seq', 1, '순번'], ['memberNo', 2, '증번호'], ['name', 4, '성명'], ['payBase', 5, '보수월액'],
      ['lines.HI.HI', 14, '고지보험료'], ['lines.HI.LTC', 27, '고지보험료']],
    nulls: [], keys: SOCIAL_KEYS, bank: null, tps: ['HI'], extra: { lines: { HI: { HI: 14, LTC: 27 } } }, samples: ['건강보험.csv'],
  },
  {
    id: 'SOCIAL_NP', kind: 'SOCIAL', name: '국민연금 고지 내역', headerRow: 7,
    sig: ['순번', '국민연금번호', '주민번호', '가입자명', '정산사유', '정산적용기간', '결정보험료'],
    want: [['seq', 1, '순번'], ['memberNo', 2, '국민연금번호'], ['name', 4, '가입자명'], ['lines.NP.NP', 7, '결정보험료']],
    nulls: ['payBase'], keys: SOCIAL_KEYS, bank: null, tps: ['NP'], extra: { lines: { NP: { NP: 7 } } }, samples: ['국민연금.csv'],
  },
  {
    id: 'SOCIAL_EI_IA', kind: 'SOCIAL', name: '고용 · 산재보험 고지 내역', headerRow: 7,
    sig: ['순번', '원부번호', '주민번호', '가입자명', '결정보험료', '월평균보수월액', '비고'],
    want: [['seq', 1, '순번'], ['memberNo', 2, '원부번호'], ['name', 4, '가입자명'], ['payBase', 6, '월평균보수월액'],
      ['lines.EI.EI', 5, '결정보험료'], ['lines.IA.IA', 5, '결정보험료']],
    nulls: [], keys: SOCIAL_KEYS, bank: null, tps: ['EI', 'IA'], extra: { lines: { EI: { EI: 5 }, IA: { IA: 5 } } },
    samples: ['고용보험.csv', '산재보험.csv'],
  },
  {
    id: 'BANK_020_LOAN', kind: 'LOAN', name: '우리은행 대출거래내역', headerRow: 3,
    sig: ['No.', '거래일', '거래원금(원)', '대출잔액(원)', '원금상환', '정상이자(원)', '연체이자(원)', '환출이자(원)', '수수료(원)', '거래종류', '최종이수일', '다음 납입일', '거래점'],
    want: [['seq', 1, 'No.'], ['txnDate', 2, '거래일'], ['drawAmount', 3, '거래원금(원)'], ['balance', 4, '대출잔액(원)'], ['repayAmount', 5, '원금상환'],
      ['interest', 6, '정상이자(원)'], ['lateInterest', 7, '연체이자(원)'], ['refundInterest', 8, '환출이자(원)'], ['fee', 9, '수수료(원)'],
      ['txnType', 10, '거래종류']],
    nulls: [], keys: LOAN_KEYS, bank: '020', tps: null,
    extra: { loanNo: { row: 2, label: '대출 계좌번호', stopAt: null } }, samples: ['우리은행_대출내역.xlsx'],
  },
];
const at = (obj, p) => p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
/** 대응표 칸 값 안의 칸 번호를 모두 모은다(줄 번호 `row` 는 칸 번호가 아니다). */
const colNumbers = (v, key = '') => {
  if (typeof v === 'number') return key === 'row' ? [] : [v];
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => colNumbers(x, k));
  return [];
};

const results = [];
const check = (id, what, cond, note = '') => results.push({ 항목: id, 내용: what, 결과: cond ? '통과' : '실패', 비고: note });

async function codeChecks(q) {
  let n = 1;
  for (const [cat, name, want] of CATS) {
    const master = await q(`SELECT name FROM public.tb_s080_code_masters WHERE build_id = '1' AND category = $1`, [cat]);
    check(`C${n}a`, `분류 ${cat} — 이름 「${name}」`, master.length === 1 && master[0].name === name, master.map((m) => m.name).join(','));
    const parts = await q(`SELECT use_tp FROM public.tb_s080_code_categories WHERE build_id = '1' AND category = $1`, [cat]);
    const lines = await q(`SELECT code, name, use_tp, sort_order, is_active FROM public.tb_s080_codes_line
      WHERE build_id = '1' AND category = $1 ORDER BY sort_order, code`, [cat]);
    const fmt = (rows) => rows.map(([c, nm], i) => `${i + 1}.${c}=${nm}`).join(' ');
    check(`C${n}b`, `${cat} — 파티션 000 하나 · 코드값 ${want.length}개 · 이름 · 순서 그대로 · 모두 켜짐`,
      parts.length === 1 && parts[0].use_tp === '000' && fmt(lines.map((l) => [l.code, l.name])) === fmt(want) &&
      lines.every((l, i) => l.use_tp === '000' && l.sort_order === i + 1 && l.is_active),
      fmt(lines.map((l) => [l.code, l.name])));
    n++;
  }

  const skip = await q(`SELECT code, name, use_tp, sort_order, is_active FROM public.tb_s080_codes_line
    WHERE build_id = '1' AND category = 'TAX_SKIP_REASON' ORDER BY sort_order, code`);
  const wantSkip = [...SKIP_OLD, ...SKIP_NEW.map(([c]) => c)];
  check(`C${n++}`, 'TAX_SKIP_REASON — 있던 17개 그대로 + 새 4개(순서 18~21)',
    skip.map((l) => l.code).join(',') === wantSkip.join(',') && skip.every((l, i) => l.sort_order === i + 1 && l.use_tp === '000' && l.is_active),
    skip.map((l) => `${l.sort_order}.${l.code}`).join(' '));
  const badNames = SKIP_NEW.filter(([c, nm]) => skip.find((l) => l.code === c)?.name !== nm);
  check(`C${n++}`, 'TAX_SKIP_REASON 새 4개의 이름이 승인 그대로', badNames.length === 0,
    badNames.map(([c, nm]) => `${c}: 바람 ${nm} / 실제 ${skip.find((l) => l.code === c)?.name}`).join(' · '));

  const kinds = await q(`SELECT code FROM public.tb_s080_codes_line WHERE build_id = '1' AND category = 'TAX_KIND' AND use_tp = '000' ORDER BY sort_order`);
  check(`C${n++}`, 'TAX_KIND 8종은 그대로(더하지 않음)', kinds.map((k) => k.code).join(',') === KINDS_UNCHANGED.join(','), kinds.map((k) => k.code).join(','));
  const desc = await q(`SELECT code, description FROM public.tb_s080_codes_line
    WHERE build_id = '1' AND category = 'TAX_KIND' AND use_tp = '000' AND code = ANY($1) ORDER BY code`, [Object.keys(KIND_DESC)]);
  const badDesc = Object.entries(KIND_DESC).filter(([c, d]) => desc.find((r) => r.code === c)?.description !== d);
  check(`C${n++}`, 'TAX_KIND SOCIAL · LOAN 설명이 승인 문구(2026-11-01 A)', badDesc.length === 0,
    badDesc.map(([c]) => `${c}: ${desc.find((r) => r.code === c)?.description}`).join(' · '));
  return (await q(`SELECT code FROM public.tb_s080_codes_line WHERE build_id = '1' AND category = 'BANK' AND is_active`)).map((r) => r.code);
}

/** 샘플 제목 줄 — 칸 이름만 돌려준다. 값은 내보내지 않는다. CSV 는 옛 한글 부호(cp949)로 푼다. */
function sampleOf(file, headerRow, loanNo) {
  const full = path.join('doc', 'data-src', file);
  if (!fs.existsSync(full)) return null;
  let rows;
  if (file.endsWith('.csv')) {
    const text = new TextDecoder('euc-kr').decode(fs.readFileSync(full));
    // ★ 제목 줄 하나만 나눈다 — 자료 줄(주민번호 칸이 있는 줄)은 읽지 않는다
    const line = text.split(/\r?\n/)[headerRow - 1] ?? '';
    rows = { [headerRow - 1]: line.split(',') };
  } else {
    const { createRequire } = require('module');
    const XLSX = createRequire(path.resolve('packages/api/package.json'))('xlsx');
    const wb = XLSX.read(fs.readFileSync(full), { type: 'buffer', cellDates: true, UTC: true });
    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null, blankrows: true });
  }
  const header = (rows[headerRow - 1] ?? []).map((v) => (v == null ? '' : String(v).trim()));
  while (header.length && header[header.length - 1] === '') header.pop();
  let labelOk = null;
  if (loanNo) labelOk = String((rows[loanNo.row - 1] ?? [])[0] ?? '').trim().startsWith(loanNo.label);
  return { header, labelOk };
}

async function mapChecks(q, bankCodes) {
  const has = await q(`SELECT count(*)::int n FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tb_s050_import_maps' AND column_name = 'social_ins_tps'`);
  if (has[0].n !== 1) { check('M0', '대응표 표에 4대보험 칸(social_ins_tps)이 있다(214 적용 확인)', false, `${has[0].n}칸`); return; }
  const rows = await q(`SELECT id, kind, name, header_row, header_signature, columns, is_active, bank_code, bank_file_tp, social_ins_tps
    FROM public.tb_s050_import_maps ORDER BY id`);
  const newIds = MAPS.map((m) => m.id);
  check('M1', '새 대응표 여섯 — 국세 · 지방세 · 건강 · 연금 · 고용·산재 · 우리은행 대출',
    rows.filter((r) => newIds.includes(r.id)).map((r) => r.id).join(',') === [...newIds].sort().join(','),
    rows.filter((r) => ['NTAX', 'LTAX', 'SOCIAL', 'LOAN'].includes(r.kind)).map((r) => r.id).join(','));
  const others = rows.filter((r) => !newIds.includes(r.id));
  check('M2', '있던 대응표 일곱(계산서 · 카드 · 현금 · 은행 넷)은 그대로 · 4대보험 칸 비움',
    others.map((r) => r.id).join(',') === OLD_MAPS.join(',') && others.every((r) => r.social_ins_tps === null), others.map((r) => r.id).join(','));

  let n = 3;
  for (const m of MAPS) {
    const r = rows.find((x) => x.id === m.id);
    if (!r) { check(`M${n++}`, `${m.id} 가 있다`, false); continue; }
    check(`M${n}a`, `${m.id} — ${m.kind} · 「${m.name}」 · 켜짐 · 제목 줄 ${m.headerRow} · 칸 ${m.sig.length}개 이름 그대로 · 은행 ${m.bank ?? '없음'} · 보험 ${m.tps ? m.tps.join('/') : '없음'}`,
      r.kind === m.kind && r.name === m.name && r.is_active && r.header_row === m.headerRow &&
      JSON.stringify(r.header_signature) === JSON.stringify(m.sig) && r.bank_code === m.bank && r.bank_file_tp === null &&
      JSON.stringify(r.social_ins_tps) === JSON.stringify(m.tps) && (m.bank === null || bankCodes.includes(m.bank)),
      `${r.kind} ${r.name} ${r.is_active} ${r.header_row} ${r.header_signature.length}칸 ${r.bank_code} ${JSON.stringify(r.social_ins_tps)}`);

    const wrong = m.want.filter(([p, no, nm]) => at(r.columns, p) !== no || r.header_signature[no - 1] !== nm);
    const extra = Object.keys(r.columns).filter((k) => !m.keys.includes(k));
    const missing = m.keys.filter((k) => !(k in r.columns));
    const notNull = m.nulls.filter((k) => r.columns[k] !== null);
    const shapes = Object.entries(m.extra).filter(([k, v]) => JSON.stringify(r.columns[k]) !== JSON.stringify(v));
    check(`M${n}b`, `★ ${m.id} — 칸 번호가 제목 줄의 그 칸 이름을 가리킨다(${m.want.length}칸) · 칸 모양 그대로 · 없는 칸은 null(${m.nulls.join(' · ') || '없음'})`,
      wrong.length === 0 && extra.length === 0 && missing.length === 0 && notNull.length === 0 && shapes.length === 0,
      [...wrong.map(([p, no, nm]) => `${p}=${at(r.columns, p)}(바람 ${no} ${nm})`), ...extra.map((k) => `더한 칸 ${k}`),
        ...missing.map((k) => `빠진 칸 ${k}`), ...notNull.map((k) => `null 아님 ${k}`), ...shapes.map(([k]) => `모양 다름 ${k}`)].join(' '));

    if (m.kind === 'SOCIAL') {
      const nums = colNumbers(r.columns);
      check(`M${n}c`, `★ ${m.id} — 3번째 칸(주민번호)을 가리키는 칸이 없다 · 보험 줄 열쇠 = 보험 종류 목록`,
        !nums.includes(3) && r.header_signature[2] === '주민번호' &&
        JSON.stringify(Object.keys(r.columns.lines ?? {})) === JSON.stringify(m.tps), `칸 번호 ${nums.join(',')}`);
    }

    for (const [i, sample] of m.samples.entries()) {
      const s = sampleOf(sample, m.headerRow, m.extra.loanNo);
      const tag = `M${n}d${m.samples.length > 1 ? i + 1 : ''}`;
      if (s === null) check(tag, `${m.id} — 샘플 ${sample} 제목 줄 비교`, true, '샘플 없음 — 건너뜀');
      else {
        check(tag, `${m.id} — 샘플 ${sample} 의 ${m.headerRow}줄 제목이 대응표 제목과 같다${m.extra.loanNo ? ' · 2줄 첫 칸이 「대출 계좌번호」' : ''}`,
          JSON.stringify(s.header) === JSON.stringify(m.sig) && (s.labelOk === null || s.labelOk === true),
          `제목 같음=${JSON.stringify(s.header) === JSON.stringify(m.sig)} 칸 ${s.header.length}${s.labelOk === null ? '' : ` 이름표=${s.labelOk}`}`);
      }
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
      await pc.query(`SELECT set_config('app.current_role', 'operator', true)`);
      const q = (s, p) => pc.query(s, p).then((r) => r.rows);
      await mapChecks(q, await codeChecks(q));
    } finally {
      await pc.query('ROLLBACK');
    }
    const left = (await pc.query(`SELECT count(*)::int n FROM public.tb_s080_code_masters
      WHERE category IN ('TAX_SOCIAL_INS', 'TAX_TAX_NOEXP', 'TAX_LOAN_TP')`)).rows[0].n;
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
