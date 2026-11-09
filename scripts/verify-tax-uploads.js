/**
 * 세무 자료 올리기(s050200010) · 거래처(s050100020) 검증 — **앱이 실제 DB 에서** 하는 일만 잰다.
 *
 * 사용: npm run verify:tax-uploads   (= npx tsx scripts/verify-tax-uploads.js)
 *
 * ★★ 표 구조 · RLS · UNIQUE · FK 는 `scripts/verify-203.js` 가, 코드 · 대응표는 `verify-204.js` 가 잰다.
 *    여기는 그 위의 앱 처리다: 회사별 막기 · 같은 파일 409 · 겹친 파일은 새 줄만 · 거래처 자동 등록 · 승격 ·
 *    덮지 않기 · 사용자가 내린 일반은 그대로 · 먼저 생긴 곳에 붙임 · 합치기 · 파일 지우기 · 거래처 지우기.
 * ★★ API 의 풀(`db/pool.ts`)로 접속한다 — erp_app. 라우트가 쓰는 처리(`routes/taxUploads.ts` ·
 *    `routes/taxVendors.ts` 의 …Op)를 그대로 부른다.
 * ★ 엑셀은 SheetJS 로 **지어낸 값**을 써서 만든다 — 원본 샘플(doc/data-src/)을 쓰지 않는다. 제목 줄은 DB 의 대응표에서 읽는다.
 * ★ 1-6(2026-11-01): 국세 · 지방세 · 4대보험 · 대출(D1~D15) — 납부번호 · 처음 보는 세목 · CSV · 같은 달 막기 · 주민번호 남기지 않기 ·
 *   대출 끝 4자리 · 개수 맞추기 · 지우기 · 회사별 막기.
 * ★ 1-4 보완(2026-10-31): 미리보기의 「이미 올린 줄 위치」(alreadyWhere) — 계산서 · 카드 · 현금, 여러 파일, 다른 단체.
 * ★ 1-4(2026-10-30): 카드 사용 내역 · 현금 경비 — 끝 4자리만 남기기 · 개수 맞추기 · 같은 결제 두 번 · 경고 ·
 *   가맹점 거래처(일반) · 현금 항목(파일) · 목록 · 양식 내려받기 · 거래처 지우기 막기 · 합치기 · 파일 지우기(C · X 줄).
 * ★ 시험 행은 **한 트랜잭션 안에서 넣고 ROLLBACK 한다.** DB 에 남는 것이 없다(마지막 Z1 이 센다).
 *   시험 단체는 verify-201 · 203 과 같은 대역(990001 · 990002) — 회사 정보가 없어 「우리 번호 없음」 경고가 붙는다.
 *
 * 종료코드: 0 = 전부 통과 / 1 = 실패 있음 / 2 = 실행 실패
 */
import * as XLSX from 'xlsx';
import { pool, closePool } from '../packages/api/src/db/pool.ts';
import { applyCompanyScope } from '../packages/api/src/db/withCompanyScope.ts';
import { insertVendor, loadImportMap } from '../packages/api/src/db/taxUploads.ts';
import {
  deleteUploadsOp,
  listUploadsOp,
  previewUploadOp,
  uploadInvoicesOp,
  uploadOp,
} from '../packages/api/src/routes/taxUploads.ts';
import { cashTemplateOp } from '../packages/api/src/routes/taxCardCash.ts';
import {
  closeVendorsOp,
  editVendorOp,
  exportVendorsOp,
  listVendorsOp,
  setVendorTypeOp,
} from '../packages/api/src/routes/taxVendors.ts';

const ORG_A = 990001;
const ORG_B = 990002;
const ACTOR = 'v-tax-up';
const MONTH = '2026-09';
const results = [];
const check = (id, what, cond, note = '') =>
  results.push({ 항목: id, 내용: what, 결과: cond ? '통과' : '실패', 비고: typeof note === 'string' ? note : JSON.stringify(note) });

const tenant = (orgId) => ({ role: 'tenant', companyId: null, orgId });
const OPERATOR = { role: 'operator', companyId: null, orgId: ORG_A };

/** 지어낸 사업자번호(숫자 10자리). 끝자리 검증은 보지 않는다 — 경고만 붙는다. */
const OWN = '9900000001';
const P = { p1: '9900000011', p2: '9900000012', p3: '9900000013', p4: '9900000014', p5: '9900000015', p6: '9900000016' };
const dash = (d) => `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;

/**
 * 지어낸 홈택스 목록 엑셀(xls). `sales` 면 우리가 공급자. rows: { no, partner, name, date? }.
 * `tag` 는 같은 줄이라도 파일 지문이 달라지게 머리 줄에 넣는 글자.
 */
function makeXls(header, { sales = true, rows, tag }) {
  const aoa = [
    ['사업자 등록번호', dash(OWN), '상호', '지어낸 시험 회사', '대표자 명', '지어낸 대표'],
    [],
    ['총 합계금액', 0, '총 공급가액', 0, '총 세액', 0],
    [],
    [`지어낸 안내 ${tag}`],
    header,
    ...rows.map((r) => {
      const line = new Array(header.length).fill('');
      line[0] = r.date ?? '2026-09-10';
      line[1] = `V-TAXUP-${r.no}`;
      line[4] = dash(sales ? OWN : r.partner);
      line[6] = sales ? '지어낸 시험 회사' : r.name;
      line[9] = dash(sales ? r.partner : OWN);
      line[11] = sales ? r.name : '지어낸 시험 회사';
      line[14] = 110000;
      line[15] = 100000;
      line[16] = 10000;
      line[17] = '세금계산서';
      line[18] = '일반';
      return line;
    }),
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '세금계산서');
  return new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType: 'xls' }));
}

/**
 * 지어낸 홈택스 사업용 신용카드 사용내역(xls) — 1줄 「총 사용금액」(tag 를 넣어 지문을 가른다) · 2줄 제목 줄.
 * rows: { card, date?, biz?, total, deduct?, note? } — 카드번호는 16자리 그대로 넣는다(앱이 끝 4자리만 남기는지 본다).
 */
function makeCardXls(header, { rows, tag }) {
  const first = new Array(header.length).fill('');
  first[12] = `총 사용금액 : 0(원) ${tag}`;
  const aoa = [
    first,
    header,
    ...rows.map((r) => [
      r.date ?? '2026-09-11', '(지어낸)카드', r.card, r.biz ?? '', '지어낸 가맹점',
      r.total, 0, 0, r.total, '일반과세자', '지어낸 업태', '지어낸 업종', r.deduct ?? '공제', r.note ?? '',
    ]),
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '카드');
  return new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType: 'xls' }));
}

/**
 * 지어낸 현금 경비 표준 양식(xlsx) — 1줄 제목 줄(210). rows: [날짜, 구분, 품명, 거래처, 항목, 금액, 결제방법, 증빙].
 * 날짜가 숫자면 엑셀 날짜 값(일련값)으로 넣고 날짜 서식을 건다 — 사용자가 양식의 날짜 칸에 적은 것과 같다.
 */
function makeCashXlsx(header, rows) {
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  rows.forEach((r, i) => { if (typeof r[0] === 'number') ws[XLSX.utils.encode_cell({ r: i + 1, c: 0 })].z = 'yyyy-mm-dd'; });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '현금 경비');
  return new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

/* ── 은행(1-5, 2026-11-01) ─────────────────────────────────────────────────── */

/** 엑셀 한 장 — `bookType` xls · xlsx. */
function sheetBytes(aoa, bookType) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Sheet 1');
  return new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType }));
}

/** 지어낸 국민 거래내역(xls) — 1~6줄 머리(1줄 첫 칸 계좌번호, tag 로 지문을 가른다) · 7줄 제목. rows: [No, 일시, 상대, 출금, 입금, 잔액]. */
function makeKbXls(header, { acct, rows, tag }) {
  return sheetBytes([
    [`계좌번호 : ${acct}`, '', '', '', '', '최초대출일 : '],
    [`총잔액 : 0 ${tag}`], ['계좌명 : 지어낸 통장'], ['출금가능액 : 0'], ['출금합계 : 0', '', '', '', '', '입금합계 : 0'],
    ['조회기간 : 2026.09.01 ~ 2026.09.30'],
    header,
    ...rows.map(([no, at, cp, out, inn, bal]) => [no, at, cp, out, inn, bal, '지어낸 표시', '', '전자금융', '지어낸 점', '']),
  ], 'xls');
}

/** 지어낸 우리 거래내역(xlsx) — 1~3줄 머리(2줄 계좌번호 · 예금주) · 4줄 제목 · 마지막 합계 줄. rows: [No, 일시, 기재내용, 지급, 입금, 잔액]. */
function makeWrXlsx(header, { acct, rows, tag }) {
  return sheetBytes([
    Array(10).fill(`우리은행 거래내역조회 ${tag}`),
    Array(10).fill(`계좌번호 : ${acct}        예금주 : (지어낸)`),
    Array(10).fill('조회기간 : 2026.09.01~2026.09.30     '),
    header,
    ...rows.map(([no, at, cp, out, inn, bal]) => [no, at, '인터넷', cp, out, inn, bal, '지어낸 점', '', 0]),
    ['', `총 ${rows.length}건`, '', '', '0원', '0원', 0, '', '', 0],
  ], 'xlsx');
}

/** 지어낸 하나 거래내역(xlsx) — 1줄 제목 글 · 2줄 제목 · 빈 금액 칸 · 마지막 합계 줄. ★ 계좌번호 없음. */
function makeHnXlsx(header, { rows, tag }) {
  return sheetBytes([
    [`거래내역조회 ${tag}`],
    header,
    ...rows.map(([no, at, inn, out, bal]) => [no, at, '대체', null, '지어낸 의뢰인', inn, out, bal, '타행이체', '지어낸 점', 'null']),
    [null, '합   계', null, null, null, 0, 0, null, null, null, null],
  ], 'xlsx');
}

/** 지어낸 우리 이체 결과(xlsx) — 1줄 제목 글(tag) · 2줄 제목 · 마지막 합계 줄. rows: [No, 일시, 출금계좌, 받는 계좌, 금액, 결과]. */
function makeWrXferXlsx(header, { rows, tag }) {
  return sheetBytes([
    Array(15).fill(`인터넷 이체 결과조회 ${tag}`),
    header,
    ...rows.map(([no, at, from, to, amount, done]) =>
      [no, at, from, '지어낸은행', to, amount, 0, '', '지어낸 받는분', '지어낸 받는표시', '지어낸 보낸표시', done ?? '처리완료', '정상 처리되었습니다.', '', '']),
    ['', `총 ${rows.length}건`, '', '', '', '0원', '0원', '', '', '', '', '', '', '', ''],
  ], 'xlsx');
}

/**
 * 은행 거래내역 · 이체 내역 — 계좌 고르기 · 은행 대응표 · 계좌번호 맞추기 · 개수 맞추기 · 이미 올린 줄 위치 ·
 * 이체 덧붙이기(±60초 · 끝 4자리만) · 이체 먼저 막기 · 지우기(이체 칸 비우기 · CASCADE · 덧붙인 수 다시 세기) · 회사별 막기.
 * ★ 값은 모두 지어낸 것. 제목 줄은 DB 의 대응표(213)에서 읽는다.
 */
async function bankChecks(c) {
  const KB = '12345678901234';
  const WR = '1234567890123';
  const HN = '12345678901';
  const acct = (id, org, bank, number, alias, active = true) =>
    c.query(`INSERT INTO public.tb_s050_fin_accounts (id, org_id, kind, bank_code, number, alias, is_active)
             VALUES ($1, $2, 'B', $3, $4, $5, $6)`, [id, org, bank, number, alias, active]);
  await acct('v-bank-kb', ORG_A, '004', KB, '지어낸 국민');
  await acct('v-bank-wr', ORG_A, '020', WR, '지어낸 우리');
  await acct('v-bank-hn', ORG_A, '081', HN, null);
  await acct('v-bank-off', ORG_A, '004', '99999999999999', '안 쓰는 통장', false);
  await applyCompanyScope(c, tenant(ORG_B));
  await acct('v-bank-b', ORG_B, '004', KB, '회사 B 국민');
  await applyCompanyScope(c, tenant(ORG_A));

  const sig = async (id) => (await c.query(`SELECT header_signature FROM public.tb_s050_import_maps WHERE id = $1`, [id])).rows[0]?.header_signature;
  const [kbSig, wrSig, hnSig, xfSig] = [await sig('BANK_004_TXN'), await sig('BANK_020_TXN'), await sig('BANK_081_TXN'), await sig('BANK_020_XFER')];
  if (!kbSig || !wrSig || !hnSig || !xfSig) throw new Error('은행 대응표가 없다 — 213 을 먼저');
  const T = (accountId) => ({ accountId, fileTp: 'TXN' });
  const X = (accountId) => ({ accountId, fileTp: 'XFER' });
  const pv = (name, bytes, bank) => previewUploadOp(c, ORG_A, 'BANK', name, bytes, bank);
  const up = (name, bytes, bank) => uploadOp(c, ORG_A, 'BANK', name, bytes, ACTOR, bank);
  const where = (r) => (r.ok ? JSON.stringify(r.data.alreadyWhere) : 'X');

  // ── 목록 — 카드 켜짐 · 계좌 선택지 · 은행마다 받는 파일 종류 ──
  const list = await listUploadsOp(c, ORG_A, MONTH);
  const ba = (id) => list.bankAccounts.find((a) => a.id === id);
  check('B1', '★ 목록 — 은행 입출금 카드 켜짐 · 계좌 선택지는 사용 중인 은행 계좌만(안 쓰는 통장 · 카드 빼고) · 은행마다 받는 파일 종류(우리만 이체) · 은행 · 파일 종류 이름(코드 표)',
    list.cards.find((x) => x.kind === 'BANK')?.enabled === true &&
    list.bankAccounts.map((a) => a.id).sort().join() === 'v-bank-hn,v-bank-kb,v-bank-wr' &&
    ba('v-bank-kb')?.fileTps.join() === 'TXN' && ba('v-bank-wr')?.fileTps.join() === 'TXN,XFER' && ba('v-bank-hn')?.fileTps.join() === 'TXN' &&
    ba('v-bank-kb')?.alias === '지어낸 국민' && list.codes.banks.length >= 3 && list.codes.bankFileTps.map((x) => x.code).join() === 'TXN,XFER',
    { accounts: list.bankAccounts, banks: list.codes.banks.length, tps: list.codes.bankFileTps });

  // ── 이체 내역을 먼저 올리면 막는다 ──
  const xf1 = makeWrXferXlsx(xfSig, { tag: 'xf1', rows: [
    [1, '2026.09.20 10:00:01', '1234-567-890123', '111-2222-33334444', 50000],
    [2, '2026.09.20 11:00:00', '1234-567-890123', '55566677788', 70000],
    [3, '2026.09.20 12:00:00', '9999-999-999999', '55566677788', 30000],
  ] });
  const early = await pv('xf1.xlsx', xf1, X('v-bank-wr'));
  check('B2', '★ 이체 내역을 거래내역보다 먼저 — 400 「그 계좌 거래내역을 먼저 올리세요」', !early.ok && early.status === 400 && early.error === 'no_bank_txns', early);

  // ── 국민 거래내역 ──
  const kb1 = makeKbXls(kbSig, { acct: '123456-78-901234', tag: 'kb1', rows: [
    [1, '2026.09.01 09:10:11', '지어낸 가', 10000, 0, 90000],
    [2, '2026.09.02 10:00:00', '지어낸 나', 0, 5000, 95000],
    [3, '2026.09.02 10:00:00', '지어낸 다', 0, 5000, 100000],
    [4, '2026.09.03 25:00:00', '지어낸 라', 1000, 0, 99000],
  ] });
  const kpv = await pv('kb1.xls', kb1, T('v-bank-kb'));
  check('B3', '국민 미리보기 — 넣을 3줄 · 날짜 틀린 1줄(badDate) · 9월 3줄 · 앞줄(거래일시 초까지 · 내 통장 표시) · 경고 없음 · 뺀 줄 이름은 은행 거래내역 키만',
    kpv.ok && kpv.data.kind === 'BANK' && kpv.data.bankFileTp === 'TXN' && kpv.data.toInsert === 3 && kpv.data.excluded.badDate === 1 &&
    kpv.data.byMonth[0]?.count === 3 && kpv.data.sample[0]?.txnAt === '2026-09-01 09:10:11' && kpv.data.sample[0]?.myNote === '지어낸 표시' &&
    kpv.data.warnings.length === 0 && kpv.data.skipReasons.map((x) => x.code).join() === 'badAmount,badDate,noAmount,bothInOut,noBalance',
    kpv.ok ? { toInsert: kpv.data.toInsert, excluded: kpv.data.excluded, skip: kpv.data.skipReasons.map((x) => x.code) } : kpv);
  const kup = await up('kb1.xls', kb1, T('v-bank-kb'));
  const kbRows = (await c.query(`SELECT account_no, bank_code, to_char(txn_at, 'YYYY-MM-DD HH24:MI:SS') at, in_amount::int i, out_amount::int o, balance::int b, my_note_src
    FROM public.tb_s050_bank_txns WHERE org_id = $1 ORDER BY txn_at, balance`, [ORG_A])).rows;
  check('B4', '★ 국민 올리기 — 3줄 · 계좌번호 · 은행 코드 · 거래일시 초까지 · 같은 초 같은 금액 두 줄은 잔액으로 갈려 둘 다 · 파일에 은행 칸(TXN · 계좌 · 별칭)',
    kup.ok && kup.data.insertedCount === 3 && kbRows.length === 3 && kbRows.every((r) => r.account_no === KB && r.bank_code === '004') &&
    kbRows[0].at === '2026-09-01 09:10:11' && kbRows[0].o === 10000 && kbRows[1].b === 95000 && kbRows[2].b === 100000 && kbRows[0].my_note_src === '지어낸 표시' &&
    kup.data.file.bankFileTp === 'TXN' && JSON.stringify(kup.data.file.account) === JSON.stringify({ bankCode: '004', accountNo: KB, alias: '지어낸 국민' }),
    kup.ok ? { rows: kbRows.length, file: kup.data.file } : kup);

  const kb2 = makeKbXls(kbSig, { acct: '123456-78-901234', tag: 'kb2', rows: [
    [1, '2026.09.02 10:00:00', '지어낸 나', 0, 5000, 95000],
    [2, '2026.09.02 10:00:00', '지어낸 다', 0, 5000, 100000],
    [3, '2026.10.01 08:00:00', '지어낸 마', 2000, 0, 98000],
  ] });
  const kpv2 = await pv('kb2.xls', kb2, T('v-bank-kb'));
  check('B5', '★ 겹친 기간 — 이미 올린 2줄은 건너뛰고(개수 맞추기) 새 1줄(10월) · 이미 올린 줄 위치 「9월 · kb1.xls 2줄」',
    kpv2.ok && kpv2.data.toInsert === 1 && kpv2.data.alreadyUploaded === 2 && kpv2.data.byMonth.map((m) => m.month).join() === '2026-10' &&
    where(kpv2) === JSON.stringify([{ month: '2026-09', fileName: 'kb1.xls', count: 2 }]), where(kpv2));

  const kbOther = makeKbXls(kbSig, { acct: '999999-99-999999', tag: 'kbx', rows: [[1, '2026.09.05 09:00:00', '지어낸', 100, 0, 900]] });
  const mism = await pv('kbx.xls', kbOther, T('v-bank-kb'));
  const off = await pv('kb1.xls', kb1, T('v-bank-off'));
  const noMap = await pv('kb1.xls', kb1, X('v-bank-kb'));
  check('B6', '★ 막기 — 파일 계좌번호가 고른 계좌와 다름(account_mismatch) · 안 쓰는 계좌(no_account) · 대응표 없는 은행 파일 종류(no_import_map) — 모두 400',
    !mism.ok && mism.error === 'account_mismatch' && !off.ok && off.error === 'no_account' && !noMap.ok && noMap.error === 'no_import_map' &&
    [mism, off, noMap].every((r) => r.status === 400), [mism, off, noMap].map((r) => r.error));

  // ── 하나 — 계좌번호 없음 경고 ──
  const hn1 = makeHnXlsx(hnSig, { tag: 'hn1', rows: [[1, '2026-09-05 08:00:01', 3000, null, 13000], [2, '2026-09-06 08:00:02', null, 1000, 12000]] });
  const hup = await up('hn1.xlsx', hn1, T('v-bank-hn'));
  check('B7', '하나 — 합계 줄은 빼고 2줄 · 빈 금액 칸은 0 · 파일에 계좌번호가 없어 경고하고 받는다',
    hup.ok && hup.data.insertedCount === 2 && hup.data.warnings.map((w) => w.code).join() === 'bank_account_unchecked', hup.ok ? hup.data : hup);

  // ── 우리 거래내역 → 이체 덧붙이기 ──
  const wr1 = makeWrXlsx(wrSig, { acct: WR, tag: 'wr1', rows: [
    [1, '2026.09.20 10:00:00', '지어낸 보낸표시', 50000, 0, 450000],
    [2, '2026.09.20 15:00:00', '지어낸', 50000, 0, 400000],
    [3, '2026.09.21 09:00:00', '지어낸', 0, 10000, 410000],
  ] });
  const wup = await up('wr1.xlsx', wr1, T('v-bank-wr'));
  const xpv = await pv('xf1.xlsx', xf1, X('v-bank-wr'));
  check('B8', '★ 우리 이체 미리보기 — 1줄 짝(1초 차) · 1줄 짝 없음(경고) · 다른 계좌 1줄 뺌 · ★ 받는 계좌는 끝 4자리만(응답 어디에도 전체 번호 없음)',
    wup.ok && wup.data.insertedCount === 3 && xpv.ok && xpv.data.bankFileTp === 'XFER' && xpv.data.toInsert === 1 && xpv.data.alreadyUploaded === 0 &&
    xpv.data.excluded.otherAccount === 1 && xpv.data.sample.map((s) => s.status).join() === 'match,none' &&
    xpv.data.sample[0].toAccountLast4 === '4444' && !JSON.stringify(xpv.data).includes('33334444') && !JSON.stringify(xpv.data).includes('55566677788') &&
    xpv.data.warnings.map((w) => w.code).join() === 'xfer_unmatched' &&
    xpv.data.skipReasons.map((x) => x.code).join() === 'badAmount,badDate,noAmount,xferNotDone,otherAccount,noToAccount',
    xpv.ok ? { toInsert: xpv.data.toInsert, statuses: xpv.data.sample.map((s) => s.status), warnings: xpv.data.warnings } : xpv);
  const xup = await up('xf1.xlsx', xf1, X('v-bank-wr'));
  const att = (await c.query(`SELECT to_char(t.txn_at, 'HH24:MI:SS') at, t.xfer_bank_src, t.xfer_account_last4, t.xfer_holder_src, t.xfer_to_memo_src, t.xfer_from_memo_src, t.xfer_account_no, f.file_name
    FROM public.tb_s050_bank_txns t JOIN public.tb_s050_upload_files f ON f.id = t.xfer_file_id WHERE t.org_id = $1`, [ORG_A])).rows;
  check('B9', '★ 이체 올리기 — 10:00:00 출금 줄 하나에 받는 은행 · 끝 4자리 + 전체 번호(225) · 받는분 · 메모 둘을 덧붙인다 · 새 줄은 넣지 않는다 · 파일 덧붙인 수 1 · 응답에 전체 번호 없음',
    xup.ok && xup.data.insertedCount === 1 && xup.data.file.bankFileTp === 'XFER' && xup.data.file.insertedCount === 1 &&
    att.length === 1 && att[0].at === '10:00:00' && att[0].xfer_bank_src === '지어낸은행' && att[0].xfer_account_last4 === '4444' &&
    att[0].xfer_holder_src === '지어낸 받는분' && att[0].xfer_to_memo_src === '지어낸 받는표시' && att[0].xfer_from_memo_src === '지어낸 보낸표시' &&
    att[0].xfer_account_no === '111222233334444' && !JSON.stringify(xup).includes('33334444') &&
    (await c.query(`SELECT count(*)::int n FROM public.tb_s050_bank_txns WHERE org_id = $1`, [ORG_A])).rows[0].n === 8,
    { up: xup.ok ? xup.data.insertedCount : xup, att });

  const xf2 = makeWrXferXlsx(xfSig, { tag: 'xf2', rows: [
    [1, '2026.09.20 10:00:01', '1234-567-890123', '111-2222-33334444', 50000],
    [2, '2026.09.20 15:00:30', '1234-567-890123', '12121212', 50000],
  ] });
  const xpv2 = await pv('xf2.xlsx', xf2, X('v-bank-wr'));
  check('B10', '★ 겹친 이체 파일 — 이미 덧붙인 줄은 건너뛰고(위치 「9월 · xf1.xlsx 1줄」) 새 1줄(15:00 출금, 30초 차)만 덧붙인다',
    xpv2.ok && xpv2.data.toInsert === 1 && xpv2.data.alreadyUploaded === 1 && xpv2.data.sample.map((s) => s.status).join() === 'already,match' &&
    where(xpv2) === JSON.stringify([{ month: '2026-09', fileName: 'xf1.xlsx', count: 1 }]), where(xpv2));

  // ── 지우기 ──
  const files = (await listUploadsOp(c, ORG_A, MONTH)).files;
  const fid = (name) => files.find((f) => f.fileName === name)?.id;
  const chkX = await deleteUploadsOp(c, ORG_A, [fid('xf1.xlsx')], true);
  const delX = await deleteUploadsOp(c, ORG_A, [fid('xf1.xlsx')]);
  const left = (await c.query(`SELECT count(*)::int n, count(xfer_file_id)::int x FROM public.tb_s050_bank_txns WHERE org_id = $1`, [ORG_A])).rows[0];
  check('B11', '★ 이체 파일 지우기 — 확인: 빠질 줄 0 · 덧붙인 정보 1줄이 지워짐 / 지우면 이체 칸만 비우고 거래내역 줄은 그대로',
    chkX.ok && chkX.data.deletedRows === 0 && chkX.data.xferDetached === 1 && delX.ok && delX.data.deletedFiles === 1 && left.n === 8 && left.x === 0,
    { chk: chkX.ok ? chkX.data : chkX, left });

  const xup3 = await up('xf1.xlsx', xf1, X('v-bank-wr'));
  const files2 = (await listUploadsOp(c, ORG_A, MONTH)).files;
  const wrId = files2.find((f) => f.fileName === 'wr1.xlsx')?.id;
  const chkW = await deleteUploadsOp(c, ORG_A, [wrId], true);
  const delW = await deleteUploadsOp(c, ORG_A, [wrId]);
  const xFile = (await listUploadsOp(c, ORG_A, MONTH)).files.find((f) => f.fileName === 'xf1.xlsx');
  const xFileAny = (await c.query(`SELECT count(*)::int n FROM public.tb_s050_upload_files WHERE org_id = $1 AND file_name = 'xf1.xlsx'`, [ORG_A])).rows[0].n;
  check('B12', '★ 거래내역 파일 지우기 — 확인: 빠질 줄 3 · 덧붙인 이체 1줄도 빠짐 / 지우면 줄이 함께(CASCADE) · 이체 파일 기록은 남고 덧붙인 수는 다시 세어 0',
    xup3.ok && xup3.data.insertedCount === 1 && chkW.ok && chkW.data.deletedRows === 3 && chkW.data.xferDetached === 1 &&
    delW.ok && delW.data.deletedFiles === 1 && xFileAny === 1 && (xFile === undefined || xFile.insertedCount === 0),
    { chk: chkW.ok ? chkW.data : chkW, xFile, xFileAny });

  // ── 회사별 막기 ──
  await applyCompanyScope(c, tenant(ORG_B));
  const bUseA = await previewUploadOp(c, ORG_B, 'BANK', 'kb1.xls', kb1, T('v-bank-kb'));
  const bOwn = await previewUploadOp(c, ORG_B, 'BANK', 'kb1.xls', kb1, T('v-bank-b'));
  const bList = await listUploadsOp(c, ORG_B, MONTH);
  check('B13', '★ 회사 B — 회사 A 의 계좌 id 는 못 쓴다(no_account) · 자기 계좌로는 같은 파일도 새 줄 3(이미 올린 줄 위치 없음) · 계좌 선택지는 자기 것만',
    !bUseA.ok && bUseA.error === 'no_account' && bOwn.ok && bOwn.data.toInsert === 3 && bOwn.data.alreadyWhere.length === 0 && bOwn.data.sameFile === null &&
    bList.bankAccounts.map((a) => a.id).join() === 'v-bank-b', { bUseA: bUseA.ok || bUseA.error, bOwn: bOwn.ok ? bOwn.data.toInsert : bOwn });
  await applyCompanyScope(c, tenant(ORG_A));
}

/**
 * 국세 · 지방세 · 4대보험 · 대출(1-6) — 대응표 · 납부번호 중복 · 비용 판정 · 처음 보는 세목 · 4대보험 CSV · 같은 달 막기 ·
 * 주민번호 남기지 않기 · 대출 끝 4자리 · 개수 맞추기 · 이미 올린 줄 위치 · 지우기(CASCADE) · 회사별 막기.
 * ★ 값은 모두 지어낸 것. 제목 줄은 DB 의 대응표(215)에서 읽는다. 주민번호 칸에는 지어낸 표시 글자만 넣는다.
 */
async function paySocialLoanChecks(c) {
  const sig = async (id) => (await c.query(`SELECT header_signature FROM public.tb_s050_import_maps WHERE id = $1`, [id])).rows[0]?.header_signature;
  const [ntSig, ltSig, hiSig, eiSig, lnSig] =
    [await sig('HOMETAX_NTAX_PAY'), await sig('WETAX_LTAX_PAY'), await sig('SOCIAL_HI'), await sig('SOCIAL_EI_IA'), await sig('BANK_020_LOAN')];
  if (!ntSig || !ltSig || !hiSig || !eiSig || !lnSig) throw new Error('국세 · 지방세 · 4대보험 · 대출 대응표가 없다 — 215 를 먼저');
  const pv = (org, kind, name, bytes, social = null) => previewUploadOp(c, org, kind, name, bytes, null, social);
  const up = (org, kind, name, bytes, social = null) => uploadOp(c, org, kind, name, bytes, ACTOR, null, social);
  const where = (r) => (r.ok ? JSON.stringify(r.data.alreadyWhere) : 'X');
  const RRN_MARK = 'V-RRN-MARK';

  const ntax = (tag, rows) => sheetBytes([[`국세 ${tag}`], ntSig, ...rows.map(([date, item, amount, no, pen]) =>
    [date, item, '지어낸 회사 (가***)', amount, no, null, '지어낸세무서(000)', amount, 0, 0, 0, pen ?? 0, null])], 'xls');
  const ltax = (tag, rows) => sheetBytes([
    [null, null, null, `나의 납부확인 ${tag}`], [null, '총 건수 : ', `${rows.length}건`], ltSig,
    ...rows.map(([no, item, date, amount, target]) => [null, no, null, null, null, item, '지어낸분', '지어낸 회사', date, amount, '지어낸시청', '지어낸납부', target])], 'xls');
  const csv = (header, rows, tag) => new TextEncoder().encode(
    [...Array(6).fill(tag), header.join(','), ...rows.map((r) => r.join(','))].join('\r\n') + '\r\n');
  const hiRow = (no, name, base, hi, ltc) => {
    const r = Array(31).fill('');
    r[0] = '1'; r[1] = no; r[2] = RRN_MARK; r[3] = name; r[4] = base; r[5] = '건강'; r[6] = hi; r[7] = '0'; r[13] = hi;
    r[18] = '요양'; r[19] = ltc; r[20] = '0'; r[26] = ltc;
    return r;
  };
  const loan = (tag, rows, no = '9999-888-777666') => sheetBytes([[`우리은행 대출거래내역 ${tag}`], [`대출 계좌번호 : ${no}`], lnSig,
    ...rows.map(([date, draw, bal, repay, int, late, refund, fee, tp]) => [1, date, draw, bal, repay, int, late, refund, fee, tp, '2026.09.01', '2026.10.01', '지어낸점'])], 'xlsx');

  // ── 목록 — 여덟 카드 · 코드 이름 ──
  const list = await listUploadsOp(c, ORG_A, MONTH);
  // ★ 2026-11-07 ④ — 4대보험 카드를 뺐다(인사 시스템으로 넘김 · 코드 이름 · 올린 파일 · 올리기는 그대로) · LOAN 설명은 221 문구
  check('D1', '목록 — 일곱 카드가 모두 열림(4대보험 카드 없음) · 4대보험 종류(NP · HI · LTC · EI · IA) · 대출 거래 구분(D · R) 이름은 코드 표에서 · 카드 설명 SOCIAL 은 215 · LOAN 은 221 문구',
    list.cards.filter((k) => k.enabled).map((k) => k.kind).join() === 'INVOICE,CARD,CASH,BANK,NTAX,LTAX,LOAN' &&
    !list.cards.some((k) => k.kind === 'SOCIAL') && list.codes.kinds.some((k) => k.code === 'SOCIAL') &&
    list.codes.socialInsTps.map((x) => x.code).join() === 'NP,HI,LTC,EI,IA' && list.codes.loanTps.map((x) => x.code).join() === 'D,R' &&
    list.codes.kinds.find((k) => k.code === 'SOCIAL')?.description?.startsWith('사회보험 통합징수포털') === true &&
    list.codes.kinds.find((k) => k.code === 'LOAN')?.description?.startsWith('원금 · 이자가 있는 은행별 대출내역') === true,
    { socialInsTps: list.codes.socialInsTps, loanTps: list.codes.loanTps });

  // ── 국세 ──
  const nt1 = ntax('nt1', [
    ['2026-09-10', '부가가치세', 125000, 'V-NT-1', 500],
    ['2026-09-10', '지어낸세목', 3300, 'V-NT-2'],
    ['2026-09-11', '부가가치세', 1000, ''],
    ['2026-09-12', '근로소득세(갑)', 2000, 'V-NT-1'],
  ]);
  const npv = await pv(ORG_A, 'NTAX', 'nt1.xls', nt1);
  check('D2', '★ 국세 미리보기 — 넣을 2줄 · 납부번호 없음 1 · 파일 안 겹친 번호 1 · 비용 판정(부가가치세 아님 · 지어낸세목 비용) · 「처음 보는 세목」 경고는 지어낸세목만 · 뺀 줄 이름은 납부 키만',
    npv.ok && npv.data.kind === 'NTAX' && npv.data.toInsert === 2 && npv.data.excluded.noPayNo === 1 && npv.data.excluded.dupPayNo === 1 &&
    npv.data.sample[0]?.expense === false && npv.data.sample[1]?.expense === true && npv.data.sample[0]?.penalty === 500 &&
    npv.data.warnings.length === 1 && npv.data.warnings[0].code === 'tax_item_new' && npv.data.warnings[0].message.includes('지어낸세목') &&
    !npv.data.warnings[0].message.includes('근로소득세') &&
    npv.data.skipReasons.map((x) => x.code).join() === 'badAmount,badDate,noAmount,noPayNo,dupPayNo',
    npv.ok ? { toInsert: npv.data.toInsert, excluded: npv.data.excluded, warnings: npv.data.warnings, skip: npv.data.skipReasons.map((x) => x.code) } : npv);
  const nup = await up(ORG_A, 'NTAX', 'nt1.xls', nt1);
  const ntRows = (await c.query(`SELECT kind, pay_no, to_char(pay_date, 'YYYY-MM-DD') d, tax_item_src, amount::int a, penalty_amount::int p, belong_month, pay_method_src
    FROM public.tb_s050_tax_payments WHERE org_id = $1 ORDER BY pay_no`, [ORG_A])).rows;
  check('D3', '국세 올리기 — 2줄 · 종류 NTAX · 가산금 따로 · 귀속 · 납부방법 비움',
    nup.ok && nup.data.insertedCount === 2 && ntRows.length === 2 && ntRows.every((r) => r.kind === 'NTAX' && r.belong_month === null && r.pay_method_src === null) &&
    ntRows[0].pay_no === 'V-NT-1' && ntRows[0].a === 125000 && ntRows[0].p === 500 && ntRows[1].p === 0, ntRows);
  const nt2 = ntax('nt2', [['2026-09-10', '지어낸세목', 3300, 'V-NT-2'], ['2026-10-05', '부가가치세', 7000, 'V-NT-3']]);
  const npv2 = await pv(ORG_A, 'NTAX', 'nt2.xls', nt2);
  check('D4', '★ 겹친 국세 파일 — 이미 있는 납부번호 1줄은 건너뛰고 새 1줄 · 위치 「9월 · nt1.xls」 · 이제 지어낸세목은 처음이 아님(경고 없음)',
    npv2.ok && npv2.data.toInsert === 1 && npv2.data.alreadyUploaded === 1 && where(npv2) === '[{"month":"2026-09","fileName":"nt1.xls","count":1}]' &&
    npv2.data.warnings.length === 0, npv2.ok ? { toInsert: npv2.data.toInsert, where: npv2.data.alreadyWhere, warnings: npv2.data.warnings } : npv2);

  // ── 지방세 ──
  const lt1 = ltax('lt1', [['V-NT-1', '지방소득세 특별징수분', '2026.09.30', '12,340', '2026년 08월 귀속분']]);
  const lup = await up(ORG_A, 'LTAX', 'lt1.xls', lt1);
  const ltRow = (await c.query(`SELECT to_char(belong_month, 'YYYY-MM') bm, pay_method_src, penalty_amount, amount::int a FROM public.tb_s050_tax_payments
    WHERE org_id = $1 AND kind = 'LTAX'`, [ORG_A])).rows;
  check('D5', '지방세 올리기 — 쉼표 금액 · 귀속 연월(과세대상) · 납부방법 · 가산금 비움 · 국세와 같은 납부번호도 따로 들어간다(종류마다)',
    lup.ok && lup.data.insertedCount === 1 && ltRow.length === 1 && ltRow[0].bm === '2026-08' && ltRow[0].pay_method_src === '지어낸납부' &&
    ltRow[0].penalty_amount === null && ltRow[0].a === 12340, ltRow);

  // ── 4대보험 ──
  const HI = { insTp: 'HI', noticeMonth: MONTH };
  const hi1 = csv(hiSig, [hiRow('11111111111', '지어낸가', '3000000', '107850', '14170'), hiRow('22222222222', '지어낸나', '2000000', '71900', '9450')], 'hi1');
  const hpv = await pv(ORG_A, 'SOCIAL', 'hi1.csv', hi1, HI);
  check('D6', '★ 4대보험 건강 미리보기(CSV) — 넣을 2사람 · 보험별 합계 건강 2줄 · 장기요양 2줄 · 앞줄에 주민번호 칸 없음 · 고른 보험 · 고지 연월',
    hpv.ok && hpv.data.kind === 'SOCIAL' && hpv.data.toInsert === 2 && hpv.data.socialInsTp === 'HI' && hpv.data.noticeMonth === MONTH &&
    JSON.stringify(hpv.data.byInsTp) === '[{"insTp":"HI","count":2,"amount":179750},{"insTp":"LTC","count":2,"amount":23620}]' &&
    !JSON.stringify(hpv.data).includes(RRN_MARK) && hpv.data.sample[0]?.memberNoLast4 === '1111',
    hpv.ok ? { toInsert: hpv.data.toInsert, byInsTp: hpv.data.byInsTp } : hpv);
  const hup = await up(ORG_A, 'SOCIAL', 'hi1.csv', hi1, HI);
  const siRows = (await c.query(`SELECT ins_tp, member_name_src, member_no_last4, notice_amount::int a, pay_base::int b, to_char(notice_month, 'YYYY-MM') m
    FROM public.tb_s050_social_ins WHERE org_id = $1 ORDER BY member_name_src, ins_tp`, [ORG_A])).rows;
  const leak = (await c.query(`SELECT count(*)::int n FROM public.tb_s050_social_ins s WHERE s.org_id = $1 AND row_to_json(s)::text LIKE $2`,
    [ORG_A, `%${RRN_MARK}%`])).rows[0].n;
  check('D7', '★ 4대보험 올리기 — 2사람 4줄(건강 · 장기요양) · 끝 4자리 · 보수월액 · 고지 연월 · 파일 기록(보험 · 연월 · 들어간 사람 2) · 주민번호 칸 글자는 어디에도 없음',
    hup.ok && hup.data.insertedCount === 2 && hup.data.file.social?.insTp === 'HI' && hup.data.file.social?.noticeMonth === MONTH &&
    hup.data.file.rowCount === 2 && hup.data.file.insertedCount === 2 && siRows.length === 4 && leak === 0 &&
    siRows[0].ins_tp === 'HI' && siRows[1].ins_tp === 'LTC' && siRows[0].member_no_last4 === '1111' && siRows[0].b === 3000000 && siRows.every((r) => r.m === MONTH),
    { rows: siRows.length, leak, file: hup.ok ? hup.data.file.social : hup });
  const hi2 = csv(hiSig, [hiRow('33333333333', '지어낸다', '1000000', '35950', '4720')], 'hi2');
  const dup = [await pv(ORG_A, 'SOCIAL', 'hi2.csv', hi2, HI), await up(ORG_A, 'SOCIAL', 'hi2.csv', hi2, HI)];
  const otherMonth = await pv(ORG_A, 'SOCIAL', 'hi2.csv', hi2, { insTp: 'HI', noticeMonth: '2026-10' });
  check('D8', '★ 같은 달 같은 보험 파일 — 미리보기 · 올리기 모두 409 「먼저 지우세요」(결정 11) · 다른 달은 된다',
    dup.every((r) => !r.ok && r.status === 409 && r.error === 'social_month_exists' && r.message.includes('먼저 지우세요') && r.message.includes('hi1.csv')) &&
    otherMonth.ok && otherMonth.data.toInsert === 1, dup.map((r) => (r.ok ? 'ok' : r.message)));
  const ei = csv(eiSig, [['1', '44444444444', RRN_MARK, '지어낸가', '61500', '3000000', '']], 'ei');
  const ia = csv(eiSig, [['1', '44444444444', RRN_MARK, '지어낸가', '22500', '3000000', '']], 'ia');
  const eup = await up(ORG_A, 'SOCIAL', 'ei.csv', ei, { insTp: 'EI', noticeMonth: MONTH });
  const iup = await up(ORG_A, 'SOCIAL', 'ia.csv', ia, { insTp: 'IA', noticeMonth: MONTH });
  const npAsHi = await pv(ORG_A, 'SOCIAL', 'ei.csv', csv(eiSig, [['1', '1', RRN_MARK, '가', '1', '1', '']], 'x'), { insTp: 'NP', noticeMonth: MONTH });
  check('D9', '고용 · 산재 — 같은 모양 파일을 고른 보험 종류로 따로 넣는다 · 연금으로 고르면 양식이 맞지 않음(제목 줄이 다름)',
    eup.ok && iup.ok && eup.data.insertedCount === 1 && iup.data.insertedCount === 1 && !npAsHi.ok && npAsHi.error === 'format_mismatch',
    { eup: eup.ok || eup, iup: iup.ok || iup, npAsHi: npAsHi.ok || npAsHi.error });

  // ── 대출 ──
  const ln1 = loan('ln1', [
    ['2026.09.25', 0, 1000000, null, 3000, 200, 50, 10, '이자납입'],
    ['2026.09.26', 0, 1000000, null, 0, 0, 0, 0, '이자납입'],
    ['2026.09.30', 0, 0, 1000000, 1000, 0, 0, 0, '원금상환/이자납입'],
  ]);
  const lnpv = await pv(ORG_A, 'LOAN', 'ln1.xlsx', ln1);
  const lnup = await up(ORG_A, 'LOAN', 'ln1.xlsx', ln1);
  const lnRows = (await c.query(`SELECT bank_code, loan_no_last4, txn_tp, principal_amount::int p, interest_amount::int i, fee_amount::int f, balance::int b
    FROM public.tb_s050_loan_txns WHERE org_id = $1 ORDER BY txn_date`, [ORG_A])).rows;
  check('D10', '★ 대출 — 끝 4자리 · 기관 020 · 이자 = 정상 + 연체 − 환출 · 수수료 따로 · 상환 · 모두 0 인 줄은 뺀다(noLoanAmount)',
    lnpv.ok && lnpv.data.kind === 'LOAN' && lnpv.data.loanNoLast4 === '7666' && lnpv.data.bankCode === '020' && lnpv.data.excluded.noLoanAmount === 1 &&
    lnup.ok && lnup.data.insertedCount === 2 && lnRows.length === 2 && lnRows.every((r) => r.bank_code === '020' && r.loan_no_last4 === '7666' && r.txn_tp === 'R') &&
    lnRows[0].i === 3150 && lnRows[0].f === 10 && lnRows[1].p === 1000000 && lnRows[1].b === 0,
    { pv: lnpv.ok ? lnpv.data.excluded : lnpv, rows: lnRows });
  const ln2 = loan('ln2', [['2026.09.25', 0, 1000000, null, 3000, 200, 50, 10, '이자납입'], ['2026.10.25', 0, 1000000, null, 3000, 0, 0, 0, '이자납입']]);
  const lnpv2 = await pv(ORG_A, 'LOAN', 'ln2.xlsx', ln2);
  const lnOther = await pv(ORG_A, 'LOAN', 'ln3.xlsx', loan('ln3', [['2026.09.25', 0, 1000000, null, 3000, 200, 50, 10, '이자납입']], '1111-222-333444'));
  check('D11', '★ 겹친 대출 파일 — 같은 줄 1줄은 건너뛰고 새 1줄(개수 맞추기) · 위치 「9월 · ln1.xlsx」 · 다른 대출번호면 같은 줄도 새 줄',
    lnpv2.ok && lnpv2.data.toInsert === 1 && lnpv2.data.alreadyUploaded === 1 && where(lnpv2) === '[{"month":"2026-09","fileName":"ln1.xlsx","count":1}]' &&
    lnOther.ok && lnOther.data.toInsert === 1 && lnOther.data.alreadyUploaded === 0, { pv2: where(lnpv2), other: lnOther.ok ? lnOther.data.toInsert : lnOther });

  // ── CSV 는 4대보험만 · 목록 · 회사별 막기 ──
  const csvAsTax = await pv(ORG_A, 'NTAX', 'a.csv', csv(ntSig, [], 'a'));
  check('D12', 'CSV 는 4대보험만 — 국세에 CSV 를 보내면 「엑셀 파일만」(not_spreadsheet)', !csvAsTax.ok && csvAsTax.error === 'not_spreadsheet', csvAsTax);
  const list2 = await listUploadsOp(c, ORG_A, MONTH);
  const cardOf = (k) => list2.cards.find((x) => x.kind === k)?.fileCount;
  const hiFile = list2.files.find((f) => f.fileName === 'hi1.csv');
  // ★ 2026-11-07 ④ — 4대보험 카드는 없다. 이미 올린 4대보험 파일은 올린 파일 목록에 그대로 있다
  const socialFiles = list2.files.filter((f) => f.kind === 'SOCIAL').length;
  check('D13', '9월 목록 — 국세 1(미리보기만 한 nt2 는 없음) · 지방세 1 · 대출 1 파일 · 4대보험 카드 없음 · 올린 파일에 4대보험 3(건강 · 고용 · 산재) · 4대보험 파일에 보험 · 연월',
    cardOf('NTAX') === 1 && cardOf('LTAX') === 1 && cardOf('SOCIAL') === undefined && socialFiles === 3 && cardOf('LOAN') === 1 &&
    hiFile?.social?.insTp === 'HI' && hiFile.social.noticeMonth === MONTH && hiFile.account === null,
    { NTAX: cardOf('NTAX'), LTAX: cardOf('LTAX'), SOCIAL: cardOf('SOCIAL'), socialFiles, LOAN: cardOf('LOAN') });
  await applyCompanyScope(c, tenant(ORG_B));
  const bSeen = [
    (await c.query(`SELECT count(*)::int n FROM public.tb_s050_tax_payments`)).rows[0].n,
    (await c.query(`SELECT count(*)::int n FROM public.tb_s050_social_ins`)).rows[0].n,
    (await c.query(`SELECT count(*)::int n FROM public.tb_s050_loan_txns`)).rows[0].n,
  ];
  const bHi = await pv(ORG_B, 'SOCIAL', 'hi1.csv', hi1, HI);
  const bNt = await up(ORG_B, 'NTAX', 'nt1.xls', nt1);
  const bDel = await deleteUploadsOp(c, ORG_B, [hup.ok ? hup.data.file.id : 'x']);
  check('D14', '★ 회사 B — A 의 납부 · 4대보험 · 대출 줄이 안 보임 · 같은 달 막기 · 납부번호는 단체마다 · A 의 파일 지우기는 404',
    bSeen.every((n) => n === 0) && bHi.ok && bHi.data.toInsert === 2 && bNt.ok && bNt.data.insertedCount === 2 && !bDel.ok && bDel.status === 404,
    { bSeen, bHi: bHi.ok || bHi, bNt: bNt.ok ? bNt.data.insertedCount : bNt });
  await applyCompanyScope(c, tenant(ORG_A));

  // ── 지우기 ──
  const del = await deleteUploadsOp(c, ORG_A, [hup.ok ? hup.data.file.id : 'x']);
  const leftHi = (await c.query(`SELECT count(*)::int n FROM public.tb_s050_social_ins WHERE org_id = $1 AND ins_tp IN ('HI', 'LTC')`, [ORG_A])).rows[0].n;
  const again = await pv(ORG_A, 'SOCIAL', 'hi2.csv', hi2, HI);
  check('D15', '★ 4대보험 파일 지우기 — 그 파일의 4줄이 빠짐(CASCADE) · 그다음 같은 달 같은 보험을 다시 올릴 수 있다',
    del.ok && del.data.deletedFiles === 1 && del.data.deletedRows === 4 && leftHi === 0 && again.ok && again.data.toInsert === 1,
    { del: del.ok ? del.data : del, leftHi, again: again.ok || again });
}

/** 같은 트랜잭션 안에서 실패할 수 있는 일 — 실패하면 그 자리까지만 되돌린다. */
async function attempt(c, fn) {
  await c.query('SAVEPOINT s');
  try {
    const value = await fn();
    await c.query('RELEASE SAVEPOINT s');
    return { value, code: null };
  } catch (e) {
    await c.query('ROLLBACK TO SAVEPOINT s');
    return { value: null, code: e.code ?? e.message };
  }
}

async function main() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    try {
      await applyCompanyScope(c, tenant(ORG_A));
      const map = await loadImportMap(c, 'INVOICE');
      if (!map) throw new Error('대응표 HOMETAX_TAX_INVOICE 가 없다 — 204 를 먼저');
      const xls = (o) => makeXls(map.headerSignature, o);
      const vendorsOf = async (orgId) => (await listVendorsOp(c, orgId)).vendors;
      // ★ 2026-11-07 — 목록 API 에서 「처음 생긴 자료」(first_kind · first_direction)를 뺐다. 자동 등록 규칙은 그대로라 DB 칸에서 읽는다
      const firstOf = async (id) =>
        (await c.query(`SELECT first_kind k, first_direction d FROM public.tb_s050_vendors WHERE id = $1`, [id])).rows[0] ?? null;
      const vendorByBiz = async (orgId, biz) => (await vendorsOf(orgId)).filter((v) => v.bizNo === biz);
      const invoiceVendor = async (orgId, no) =>
        (await c.query(`SELECT vendor_id FROM public.tb_s050_invoices WHERE org_id = $1 AND approval_no = $2`, [orgId, `V-TAXUP-${no}`])).rows[0]?.vendor_id ?? null;
      const upload = (orgId, name, bytes) => uploadInvoicesOp(c, orgId, 'INVOICE', name, bytes, ACTOR);
      const where = (pv) => (pv.ok ? JSON.stringify(pv.data.alreadyWhere) : 'X');

      // ── 첫 파일 — 미리보기 · 올리기 · 자동 등록 ──
      const f1 = xls({ tag: 'f1', rows: [{ no: 1, partner: P.p1, name: '지어낸 가' }, { no: 2, partner: P.p1, name: '지어낸 가' }, { no: 3, partner: P.p2, name: '지어낸 나' }] });
      const pv1 = await previewUploadOp(c, ORG_A, 'INVOICE', 'f1.xls', f1);
      check('U1', '미리보기 — 매출(S) · 넣을 3줄 · 9월 3줄 · 앞줄 · 「우리 번호 없음」 경고 · 뺀 줄 종류 이름(코드 표) · 쓰지 않는다',
        pv1.ok && pv1.data.direction === 'S' && pv1.data.toInsert === 3 && pv1.data.byMonth[0]?.count === 3 &&
        pv1.data.sample.length === 3 && pv1.data.warnings.some((w) => w.code === 'own_biz_no_unchecked') &&
        // 뺀 줄 종류 이름은 코드 표(TAX_SKIP_REASON, 205)에서 — 키 순서 그대로 7개
        pv1.data.skipReasons?.map((s) => s.code).join() === Object.keys(pv1.data.excluded).join() &&
        pv1.data.skipReasons.every((s) => s.name.trim() !== '') &&
        (await vendorsOf(ORG_A)).length === 0,
        pv1.ok ? { dir: pv1.data.direction, toInsert: pv1.data.toInsert, byMonth: pv1.data.byMonth } : pv1);
      const up1 = await upload(ORG_A, 'f1.xls', f1);
      const v1 = await vendorByBiz(ORG_A, P.p1);
      const f1First = v1[0] ? await firstOf(v1[0].id) : null;
      check('U2', '올리기 — 3줄 · 거래처 2곳 자동 등록 · 주거래처(M) · 거래 중 · 처음 생긴 자료 INVOICE/S(DB) · 첫 거래월 9월',
        up1.ok && up1.data.insertedCount === 3 && up1.data.vendorsCreated === 2 &&
        v1.length === 1 && v1[0].vendorTp === 'M' && v1[0].closed === false && f1First?.k === 'INVOICE' && f1First.d === 'S' &&
        v1[0].firstMonth === MONTH,
        up1.ok ? { inserted: up1.data.insertedCount, created: up1.data.vendorsCreated, v1, f1First } : up1);

      // ── 같은 파일 409 ──
      const again = await upload(ORG_A, 'f1-다시.xls', f1);
      const pvAgain = await previewUploadOp(c, ORG_A, 'INVOICE', 'f1.xls', f1);
      check('U3', '★ 같은 파일(지문) — 올리기 409 · 미리보기는 sameFile 로 알린다',
        !again.ok && again.status === 409 && pvAgain.ok && pvAgain.data.sameFile?.id === up1.data?.file.id, again);

      // ── 겹친 파일은 새 줄만 ──
      const f2 = xls({ tag: 'f2', rows: [
        { no: 1, partner: P.p1, name: '지어낸 가' }, { no: 2, partner: P.p1, name: '지어낸 가' }, { no: 3, partner: P.p2, name: '지어낸 나' },
        { no: 4, partner: P.p3, name: '지어낸 다' }, { no: 5, partner: P.p1, name: '지어낸 가' },
      ] });
      const pv2 = await previewUploadOp(c, ORG_A, 'INVOICE', 'f2.xls', f2);
      const up2 = await upload(ORG_A, 'f2.xls', f2);
      check('U4', '★ 겹친 파일 — 이미 올린 승인번호 3줄은 건너뛰고 새 2줄만(미리보기와 같은 수)',
        pv2.ok && pv2.data.toInsert === 2 && pv2.data.alreadyUploaded === 3 &&
        up2.ok && up2.data.insertedCount === 2 && up2.data.alreadyUploaded === 3 && up2.data.file.rowCount === 5 &&
        (await invoiceVendor(ORG_A, 1)) === v1[0].id,
        up2.ok ? up2.data : up2);
      check('U4b', '★ 이미 올린 줄 위치 — 건너뛸 3줄은 「9월 · f1.xls」(그 줄 날짜의 달 · 승인번호가 들어 있는 파일)',
        where(pv2) === JSON.stringify([{ month: '2026-09', fileName: 'f1.xls', count: 3 }]), where(pv2));

      // ── 승격 · 사용자가 내린 일반은 그대로 ──
      const g4 = await insertVendor(c, ORG_A, { name: '미리 있던 일반', bizNo: P.p4, vendorTp: 'G', firstKind: 'BANK', firstDirection: null }, ACTOR);
      const g5 = await insertVendor(c, ORG_A, { name: '사용자가 내린 일반', bizNo: P.p5, vendorTp: 'M', firstKind: 'INVOICE', firstDirection: 'S' }, ACTOR);
      const setG = await setVendorTypeOp(c, ORG_A, [g5], 'G', ACTOR);
      const f3 = xls({ tag: 'f3', rows: [{ no: 6, partner: P.p4, name: '파일의 다른 이름' }, { no: 7, partner: P.p5, name: '지어낸 마' }] });
      const up3 = await upload(ORG_A, 'f3.xls', f3);
      const v4 = (await vendorByBiz(ORG_A, P.p4))[0];
      const v5 = (await vendorByBiz(ORG_A, P.p5))[0];
      check('U5', '★ 승격 — 업로드가 만든 적 없는 일반(G) 거래처에 계산서가 오면 주거래처(M)로',
        up3.ok && up3.data.vendorsPromoted === 1 && up3.data.vendorsCreated === 0 && v4.vendorTp === 'M' && v4.id === g4,
        { promoted: up3.data?.vendorsPromoted, v4 });
      check('U6', '★ 사용자가 내린 일반은 업로드가 바꾸지 않는다(tp_set_by_user)',
        setG.ok && v5.vendorTp === 'G' && v5.tpSetByUser === true, v5);
      check('U7', '★ 덮지 않기 — 이미 있는 거래처의 이름은 파일 이름으로 바뀌지 않는다(처음 생긴 자료도 그대로, DB)',
        v4.name === '미리 있던 일반' && (await firstOf(v4.id))?.k === 'BANK', v4);

      // ── 사용자가 고친 이름 · 번호는 다시 올려도 그대로 ──
      const edit = await editVendorOp(c, ORG_A, v1[0].id, { name: '사용자가 고친 이름' }, ACTOR);
      const f4 = xls({ tag: 'f4', rows: [{ no: 8, partner: P.p1, name: '파일의 새 이름' }] });
      const up4 = await upload(ORG_A, 'f4.xls', f4);
      const v1b = (await vendorByBiz(ORG_A, P.p1))[0];
      check('U8', '★ 사용자가 고친 거래처 이름은 다음 업로드가 덮지 않는다 · 번호 칸을 안 보내면 번호 그대로',
        edit.ok && up4.ok && v1b.name === '사용자가 고친 이름' && v1b.bizNo === P.p1 && (await invoiceVendor(ORG_A, 8)) === v1[0].id, v1b);

      // ── 같은 번호 거래처 — 먼저 생긴 곳에 붙인다 ──
      const v2 = (await vendorByBiz(ORG_A, P.p2))[0];
      const dupP2 = await insertVendor(c, ORG_A, { name: '나중 생긴 같은 번호', bizNo: P.p2, vendorTp: 'G', firstKind: 'BANK', firstDirection: null }, ACTOR);
      await c.query(`UPDATE public.tb_s050_vendors SET created_at = created_at + interval '1 second' WHERE id = $1`, [dupP2]);
      const f5 = xls({ tag: 'f5', rows: [{ no: 9, partner: P.p2, name: '지어낸 나' }] });
      await upload(ORG_A, 'f5.xls', f5);
      // ★ 2026-11-07 — 「같은 사업자번호」 묶음 알림은 합치기와 함께 없앴다. 업로드가 먼저 생긴 곳에 붙이는 규칙만 본다
      check('U9', '★ 같은 사업자번호 거래처 둘 — 업로드는 먼저 생긴 곳에 붙인다',
        (await invoiceVendor(ORG_A, 9)) === v2.id && dupP2 !== v2.id, { v2: v2.id, dupP2 });

      // ── 매입 파일 ──
      const f6 = xls({ tag: 'f6', sales: false, rows: [{ no: 10, partner: P.p6, name: '지어낸 공급자' }] });
      const up6 = await upload(ORG_A, 'f6.xls', f6);
      const v6 = (await vendorByBiz(ORG_A, P.p6))[0];
      check('U10', '매입 파일 — 공급자 칸이 거래처 · 구분 P(DB)', up6.ok && up6.data.file.direction === 'P' && (await firstOf(v6?.id))?.d === 'P' && v6.name === '지어낸 공급자', v6);

      // ── 목록 ──
      const ups = await listUploadsOp(c, ORG_A, MONTH);
      const inv = ups.cards.find((k) => k.kind === 'INVOICE');
      // ★ 1-5(2026-11-01): 은행 입출금(BANK) 카드도 열린다 · 1-6(2026-11-01): 국세 · 지방세 · 4대보험 · 대출도(D1 이 자세히 본다)
      // ★ 2026-11-07 ④ — 4대보험 카드를 뺐다(일곱 카드)
      check('U11', '자료 올리기 목록 — 일곱 카드가 모두 열림(1-4 · 1-5 · 1-6, 4대보험 뺌) · 그 달 파일 수 · 코드 이름은 코드 표에서',
        inv?.enabled === true && inv.fileCount === 6 &&
        ups.cards.filter((k) => k.enabled).map((k) => k.kind).join() === 'INVOICE,CARD,CASH,BANK,NTAX,LTAX,LOAN' &&
        ups.files.length === 6 && ups.codes.invDirs.map((d) => d.code).join() === 'P,S' &&
        // 카드 설명은 코드 설명 칸에서(비어 있으면 null) · 사업자 유형 이름(설정이 없으면 null)
        ups.codes.kinds.every((k) => 'description' in k) && 'bizTypeName' in ups && ups.bizTypeName === null,
        { inv, files: ups.files.length, dirs: ups.codes.invDirs });

      // ── ★ 2026-11-07 거래처 — 첫 거래월 · [거래종료] · [수정]으로 되돌리기 · 엑셀(합치기 · 지우기는 없앴다) ──
      const v3 = (await vendorByBiz(ORG_A, P.p3))[0];
      const dbFirst = (await c.query(`SELECT to_char(min(write_date), 'YYYY-MM') m FROM public.tb_s050_invoices WHERE org_id = $1 AND vendor_id = $2`,
        [ORG_A, v3.id])).rows[0].m;
      const noDeal = await insertVendor(c, ORG_A, { name: '거래 없는 곳', bizNo: null, vendorTp: 'G', firstKind: 'CASH', firstDirection: null }, ACTOR);
      check('V1', '★ 첫 거래월 — 붙은 계산서의 가장 이른 달(읽을 때 셈) · 줄이 없으면 null',
        v3.firstMonth === dbFirst && dbFirst !== null && (await vendorsOf(ORG_A)).find((v) => v.id === noDeal)?.firstMonth === null,
        { v3: v3.firstMonth, dbFirst });
      const closed = await closeVendorsOp(c, ORG_A, [v3.id, noDeal], ACTOR);
      const afterClose = await vendorsOf(ORG_A);
      const xOpen = await exportVendorsOp(c, ORG_A, { q: '', tp: null, closed: 'open' }, '2026-11-07');
      const xClosed = await exportVendorsOp(c, ORG_A, { q: '', tp: null, closed: 'closed' }, '2026-11-07');
      const rowsOf = (x) => {
        const wb = XLSX.read(x.data.bytes, { type: 'array' });
        return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
      };
      const openRows = xOpen.ok ? rowsOf(xOpen) : [];
      const closedRows = xClosed.ok ? rowsOf(xClosed) : [];
      check('V2', '★ [거래종료] — 2곳을 종료로(지우지 않음) · 엑셀은 걸린 조건 결과만(거래 중 / 종료) · 파일 이름 · 칸 다섯',
        closed.ok && closed.data.closed === 2 && afterClose.filter((v) => v.closed).map((v) => v.id).sort().join() === [v3.id, noDeal].sort().join() &&
        xOpen.ok && xOpen.data.fileName === '거래처_2026-11-07.xlsx' && openRows[0]?.join() === '거래처명,사업자번호,구분,종료여부,첫 거래월' &&
        openRows.length === 1 + afterClose.filter((v) => !v.closed).length && closedRows.length === 3 &&
        closedRows.slice(1).every((r) => r[3] === '종료'),
        { closed: closed.ok ? closed.data : closed, open: openRows.length, closedRows: closedRows.length });
      const reopen = await editVendorOp(c, ORG_A, noDeal, { name: null, closed: false }, ACTOR);
      // 종료된 거래처(v3)의 사업자번호로 새 계산서를 올린다 — 붙는지 본 뒤 그 파일은 지워 뒤 검증의 파일 수를 그대로 둔다
      const f7 = xls({ tag: 'f7', rows: [{ no: 11, partner: P.p3, name: '종료 뒤 계산서' }] });
      const up7 = await upload(ORG_A, 'f7.xls', f7);
      const after7 = (await invoiceVendor(ORG_A, 11)) === v3.id && up7.ok && up7.data.vendorsCreated === 0;
      if (up7.ok) await deleteUploadsOp(c, ORG_A, [up7.data.file.id]);
      check('V3', '★ [수정] 「거래 중」으로 되돌리기 · 종료된 거래처에 새 계산서가 와도 그대로 붙는다(자동 등록 · 연결 규칙 그대로) · 종료는 그대로',
        reopen.ok && reopen.data.closed === false && after7 &&
        (await vendorsOf(ORG_A)).find((v) => v.id === v3.id)?.closed === true,
        { reopen: reopen.ok ? reopen.data.closed : reopen, after7 });

      // ── 회사별 막기 ──
      await applyCompanyScope(c, tenant(ORG_B));
      const bList = await vendorsOf(ORG_B);
      const bEdit = await editVendorOp(c, ORG_B, v1[0].id, { name: '가로챔' }, ACTOR);
      const bType = await setVendorTypeOp(c, ORG_B, [v1[0].id], 'G', ACTOR);
      const bClose = await closeVendorsOp(c, ORG_B, [v1[0].id], ACTOR);
      const bDel = await deleteUploadsOp(c, ORG_B, [up1.data.file.id]);
      const bX = await exportVendorsOp(c, ORG_B, { q: '', tp: null, closed: 'all' }, '2026-11-07');
      check('U13', '★ 회사 B — A 의 거래처 · 파일이 안 보이고, A 의 id 로 고치기 · 구분 · 거래종료 · 파일 지우기는 404 · 엑셀에도 A 거래처 없음',
        bList.length === 0 && [bEdit, bType, bClose, bDel].every((r) => !r.ok && r.status === 404) &&
        (await listUploadsOp(c, ORG_B, MONTH)).files.length === 0 && bX.ok && rowsOf(bX).length === 1,
        [bEdit, bType, bClose, bDel].map((r) => r.status));
      const bUp = await upload(ORG_B, 'f1.xls', f1);
      check('U14', '같은 파일 · 같은 승인번호라도 다른 단체면 따로 들어간다', bUp.ok && bUp.data.insertedCount === 3, bUp.ok ? bUp.data.insertedCount : bUp);
      const crossWrite = await attempt(c, () => upload(ORG_A, 'b가-a에.xls', xls({ tag: 'x', rows: [{ no: 99, partner: P.p1, name: '가' }] })));
      check('U15', '★ 회사 B 세션으로 A 단체에 올리면 DB 가 막는다(42501)', crossWrite.code === '42501', crossWrite.code ?? crossWrite.value);

      // ── 운영사 세션도 자기 단체만 — 처리는 넘긴 단체만 본다 ──
      await applyCompanyScope(c, OPERATOR);
      check('U16', '운영사 세션 — A 의 목록에 B 의 파일이 섞이지 않는다',
        (await listUploadsOp(c, ORG_A, MONTH)).files.every((f) => f.id !== bUp.data?.file.id));

      // ── 파일 지우기 ──
      await applyCompanyScope(c, tenant(ORG_A));
      const pre = await deleteUploadsOp(c, ORG_A, [up1.data.file.id], true);
      const stillThere = (await listUploadsOp(c, ORG_A, MONTH)).files.some((f) => f.id === up1.data.file.id);
      const del = await deleteUploadsOp(c, ORG_A, [up1.data.file.id]);
      check('U17a', '★ 지우기 전 확인 — 지우기와 같은 수(빠질 줄 · 겹쳤을 수 있는 파일)를 주고, 지우지 않는다',
        pre.ok && stillThere && del.ok && JSON.stringify(pre.data) === JSON.stringify(del.data), { pre: pre.ok ? pre.data : pre });
      const gone = (await c.query(`SELECT count(*)::int n FROM public.tb_s050_invoices WHERE org_id = $1 AND approval_no = ANY($2)`,
        [ORG_A, ['V-TAXUP-1', 'V-TAXUP-2', 'V-TAXUP-3']])).rows[0].n;
      check('U17', '★ 파일 지우기 — 그 파일의 3줄이 빠지고, 뒤에 올린 겹친 파일(f2, 건너뛴 3줄)을 알린다 · 거래처는 남는다',
        del.ok && del.data.deletedFiles === 1 && del.data.deletedRows === 3 && gone === 0 &&
        del.data.laterFilesWithSkips.some((f) => f.id === up2.data.file.id && f.skippedRows === 3) &&
        (await vendorByBiz(ORG_A, P.p1)).length === 1,
        del.ok ? del.data : del);
      const ghost = await deleteUploadsOp(c, ORG_A, [up2.data.file.id, 'v-tax-up-none']);
      check('U18', '없는 id 가 섞이면 404 · 아무것도 지우지 않는다',
        !ghost.ok && ghost.status === 404 && (await listUploadsOp(c, ORG_A, MONTH)).files.some((f) => f.id === up2.data.file.id));

      // ★ 거래처 지우기(U19a ~ U21)는 2026-11-07 화면 · API 에서 없앴다

      // ══ 카드 사용 내역(1-4) ══
      const cardMap = await loadImportMap(c, 'CARD');
      if (!cardMap) throw new Error('대응표 HOMETAX_BIZ_CARD 가 없다 — 209 를 먼저');
      const cardXls = (o) => makeCardXls(cardMap.headerSignature, o);
      await c.query(`INSERT INTO public.tb_s050_fin_accounts (id, org_id, kind, card_co_code, number, alias)
        VALUES ('v-tax-up-card', $1, 'C', 'KB', '4821', '지어낸 카드')`, [ORG_A]);
      const FULL = '1111-2222-3333-4821';
      const NEW_BIZ = '9900000021';
      const cardRows1 = [
        { card: FULL, biz: dash(P.p1), total: 11000 },
        { card: FULL, biz: dash(NEW_BIZ), total: 22000, deduct: '불공제', note: '선택불공제' },
        { card: '1111-2222-3333-0001', total: 3000, deduct: '면세' },
        { card: FULL, biz: dash(NEW_BIZ), total: -5000, deduct: '불공제', note: '당연불공제' },
        { card: '', total: 1000 },
        { card: FULL, date: '2026-13-40', total: 1000 },
      ];
      const k1 = cardXls({ tag: 'k1', rows: cardRows1 });
      const cpv = await previewUploadOp(c, ORG_A, 'CARD', 'k1.xls', k1);
      check('C1', '★ 카드 미리보기 — 넣을 4줄 · 취소(음수) 줄 포함 · 매입/매출 없음 · 뺀 줄(카드번호 · 날짜) · 등록 안 된 카드 · 공제 모름 경고 · 뺀 줄 이름은 카드 키만',
        cpv.ok && cpv.data.kind === 'CARD' && cpv.data.direction === null && cpv.data.toInsert === 4 && cpv.data.alreadyUploaded === 0 &&
        JSON.stringify(cpv.data.excluded) === JSON.stringify({ noCardNo: 1, badDate: 1, badAmount: 0 }) &&
        cpv.data.skipReasons.map((x) => x.code).join() === 'badAmount,badDate,noCardNo' &&
        cpv.data.warnings.map((w) => `${w.code}:${w.count}`).sort().join() === 'card_deduct_unknown:1,card_unregistered:1' &&
        cpv.data.sample.some((x) => x.totalAmount === -5000),
        cpv.ok ? { toInsert: cpv.data.toInsert, excluded: cpv.data.excluded, skip: cpv.data.skipReasons, warnings: cpv.data.warnings } : cpv);
      check('C2', '★★ 카드번호 전체가 미리보기 응답 어디에도 없다 — 끝 4자리만',
        cpv.ok && !/1111-?2222|111122223333/.test(JSON.stringify(cpv.data)) && cpv.data.sample.every((x) => /^[0-9]{4}$/.test(x.cardLast4)));

      const cup = await uploadOp(c, ORG_A, 'CARD', 'k1.xls', k1, ACTOR);
      const newV = await vendorByBiz(ORG_A, NEW_BIZ);
      const p1v = await vendorByBiz(ORG_A, P.p1);
      const stored = (await c.query(`SELECT card_last4, merchant_name_src, deduct_note_src, vat_deduct FROM public.tb_s050_card_txns WHERE org_id = $1`, [ORG_A])).rows;
      check('C3', '★ 카드 올리기 — 4줄 · 새 가맹점은 일반(G) 거래처 · 처음 생긴 자료 CARD · 매입/매출 없음 · 있는 주거래처는 그대로(승격 · 이름 덮기 없음) · 파일 매입/매출 비움',
        cup.ok && cup.data.insertedCount === 4 && cup.data.vendorsCreated === 1 && cup.data.vendorsPromoted === 0 && cup.data.file.direction === null &&
        newV.length === 1 && newV[0].vendorTp === 'G' && (await firstOf(newV[0].id))?.k === 'CARD' && (await firstOf(newV[0].id))?.d === null &&
        newV[0].firstMonth === (await c.query(`SELECT to_char(min(use_date), 'YYYY-MM') m FROM public.tb_s050_card_txns WHERE org_id = $1 AND vendor_id = $2`, [ORG_A, newV[0].id])).rows[0].m &&
        p1v.length === 1 && p1v[0].vendorTp === 'M' && p1v[0].name !== '지어낸 가맹점',
        { cup: cup.ok ? { ins: cup.data.insertedCount, created: cup.data.vendorsCreated, dir: cup.data.file.direction } : cup, newV, p1v });
      check('C4', '★★ DB 에도 끝 4자리만 · 공제 모름은 비움 · 불공제 사유는 글 그대로',
        stored.length === 4 && stored.every((x) => /^[0-9]{4}$/.test(x.card_last4)) &&
        !JSON.stringify(stored).includes('1111') && stored.filter((x) => x.vat_deduct === null).length === 1 &&
        stored.some((x) => x.deduct_note_src === '선택불공제'), stored.map((x) => [x.card_last4, x.vat_deduct, x.deduct_note_src]));

      const sameCard = await uploadOp(c, ORG_A, 'CARD', 'k1-again.xls', k1, ACTOR);
      const twin = { card: FULL, biz: dash(P.p2), total: 7700, date: '2026-09-12' };
      const k2 = cardXls({ tag: 'k2', rows: [...cardRows1.slice(0, 4), twin, twin] });
      const cpv2 = await previewUploadOp(c, ORG_A, 'CARD', 'k2.xls', k2);
      const cup2 = await uploadOp(c, ORG_A, 'CARD', 'k2.xls', k2, ACTOR);
      check('C5', '★ 개수 맞추기 — 같은 파일은 409 · 겹친 파일은 이미 올린 4줄을 건너뛰고, 같은 날 같은 가게 같은 금액 두 줄은 둘 다 넣는다',
        !sameCard.ok && sameCard.status === 409 && cpv2.ok && cpv2.data.toInsert === 2 && cpv2.data.alreadyUploaded === 4 &&
        cup2.ok && cup2.data.insertedCount === 2 && cup2.data.alreadyUploaded === 4,
        { same: sameCard.status, pv: cpv2.ok ? [cpv2.data.toInsert, cpv2.data.alreadyUploaded] : cpv2, up: cup2.ok ? cup2.data.insertedCount : cup2 });
      check('C5b', '★ 카드 이미 올린 줄 위치 — 「9월 · k1.xls」 4줄', where(cpv2) === JSON.stringify([{ month: '2026-09', fileName: 'k1.xls', count: 4 }]), where(cpv2));
      const k3 = cardXls({ tag: 'k3', rows: [...cardRows1.slice(0, 4), twin, twin, { card: FULL, biz: dash(P.p3), total: 990, date: '2026-10-02' }] });
      const cpv3 = await previewUploadOp(c, ORG_A, 'CARD', 'k3.xls', k3);
      check('C5c', '★ 여러 파일에 걸치면 파일마다 한 줄 — 「9월 · k1.xls」 4 · 「9월 · k2.xls」 2(같은 날 두 줄), 새 10월 줄은 넣을 줄',
        cpv3.ok && cpv3.data.toInsert === 1 && cpv3.data.alreadyUploaded === 6 &&
        where(cpv3) === JSON.stringify([{ month: '2026-09', fileName: 'k1.xls', count: 4 }, { month: '2026-09', fileName: 'k2.xls', count: 2 }]),
        where(cpv3));

      // ══ 현금 경비(1-4) ══
      await c.query(`INSERT INTO public.tb_s050_settings (org_id, biz_type, withholding_cycle, tax_emails, unused_kinds)
        VALUES ($1, 'C', 'M', '[]'::jsonb, '{}')`, [ORG_A]);
      // ★ 2026-11-07 대표 결정 — 자료 올리기는 「쓰지 않는 자료」를 보지 않는다(값 · DB 칸은 그대로, 2단계 이번 달 할 일에서 쓴다)
      await c.query(`UPDATE public.tb_s050_settings SET unused_kinds = '{CASH,SOCIAL}' WHERE org_id = $1`, [ORG_A]);
      const unusedCards = (await listUploadsOp(c, ORG_A, MONTH)).cards;
      check('X0', '★ 쓰지 않는 자료가 저장돼 있어도 자료 올리기 카드에 그 값이 없다(배지 · 링크 · 「다 한 자료」 세기 없음)',
        unusedCards.length === 7 && unusedCards.every((k) => !('unused' in k)), unusedCards.map((k) => Object.keys(k).join('/')).slice(0, 1));
      await c.query(`UPDATE public.tb_s050_settings SET unused_kinds = '{}' WHERE org_id = $1`, [ORG_A]);
      const cashMap = await loadImportMap(c, 'CASH');
      if (!cashMap) throw new Error('대응표 TAX_CASH_STD 가 없다 — 209 를 먼저');
      // ★ 210 — 1줄 제목 · 구분 + 금액. 첫 줄 날짜는 엑셀 날짜 값(46278 = 2026-09-13) — 하루 밀리지 않는지(readSheet UTC)
      const cashRows1 = [
        [46278, '매입', '지어낸 점심', '지어낸 식당', '식대·회의비', 15000, '현금', '영수증'],
        ['2026-09-14 15:20', '매출', '지어낸 판매', '지어낸 손님', '식대·회의비', 30000, '계좌이체', ''],
        ['2026-09-15', '매입', '지어낸 간식', '', '복리후생비', 4000, '대표 개인 돈', ''],
        ['2026-09-16', '매입', '지어낸 문구', '', '', 2000, '현금', '카드전표'],
        ['2026-09-17', '매입', '지어낸 택시', '', '', 9000, '', ''],
        ['2026-09-18', '환불', '지어낸 구분 틀림', '', '', 100, '현금', ''],
      ];
      const x1 = makeCashXlsx(cashMap.headerSignature, cashRows1);
      const xpv = await previewUploadOp(c, ORG_A, 'CASH', 'x1.xlsx', x1);
      check('X1', '★ 현금 미리보기 — 넣을 4줄(매출 1 포함) · 뺀 줄(결제방법 · 구분) · 항목 모름 · 증빙 모름 · 매출 항목 무시 경고 · 뺀 줄 이름은 현금 키만',
        xpv.ok && xpv.data.kind === 'CASH' && xpv.data.direction === null && xpv.data.toInsert === 4 &&
        xpv.data.excluded.badPayMethod === 1 && xpv.data.excluded.badDirection === 1 &&
        xpv.data.skipReasons.map((x) => x.code).join() === 'badAmount,badDate,noDescription,noAmount,badPayMethod,badDirection' &&
        xpv.data.warnings.map((w) => w.code).sort().join() === 'cash_item_unknown,cash_proof_unknown,cash_sales_item_ignored',
        xpv.ok ? { toInsert: xpv.data.toInsert, excluded: xpv.data.excluded, warnings: xpv.data.warnings.map((w) => w.code) } : xpv);
      const vCount = (await vendorsOf(ORG_A)).length;
      const xup = await uploadOp(c, ORG_A, 'CASH', 'x1.xlsx', x1, ACTOR);
      const cashStored = (await c.query(`SELECT use_date::text AS d, description, direction, item_code, classified_by, classified_at IS NOT NULL AS at, pay_method, proof
        FROM public.tb_s050_cash_txns WHERE org_id = $1 ORDER BY use_date`, [ORG_A])).rows;
      check('X2', '★ 현금 올리기 — 4줄 · 엑셀 날짜 값 · 시각 붙은 날짜는 그 날 · 파일에 적은 항목은 바로 지정 건(올린 사람 · 때) · 매출 줄은 항목 없음 · 거래처 표는 그대로',
        xup.ok && xup.data.insertedCount === 4 && xup.data.vendorsCreated === 0 && (await vendorsOf(ORG_A)).length === vCount &&
        cashStored[0]?.d === '2026-09-13' && cashStored[1]?.d === '2026-09-14' &&
        cashStored[0]?.item_code === 'MEAL' && cashStored[0].classified_by === ACTOR && cashStored[0].at && cashStored[0].proof === 'RECEIPT' &&
        cashStored[1]?.direction === 'S' && cashStored[1].item_code === null && cashStored[1].pay_method === 'TRANSFER' &&
        cashStored[2]?.item_code === null && cashStored[3]?.proof === null,
        cashStored);
      const x2 = makeCashXlsx(cashMap.headerSignature, [...cashRows1, ['2026-09-19', '매입', '지어낸 우표', '', '', 500, '현금', '없음']]);
      const xpv2 = await previewUploadOp(c, ORG_A, 'CASH', 'x2.xlsx', x2);
      check('X3', '★ 현금 개수 맞추기 — 고친 파일을 다시 올리면 이미 올린 4줄은 건너뛰고 새 1줄만',
        xpv2.ok && xpv2.data.toInsert === 1 && xpv2.data.alreadyUploaded === 4, xpv2.ok ? [xpv2.data.toInsert, xpv2.data.alreadyUploaded] : xpv2);
      check('X3b', '★ 현금 이미 올린 줄 위치 — 「9월 · x1.xlsx」 4줄', where(xpv2) === JSON.stringify([{ month: '2026-09', fileName: 'x1.xlsx', count: 4 }]), where(xpv2));

      const ups2 = await listUploadsOp(c, ORG_A, MONTH);
      const kc = (k) => ups2.cards.find((x) => x.kind === k)?.fileCount;
      check('X4', '자료 올리기 목록 — 카드 파일 2 · 현금 파일 1, 올린 파일 목록에 카드 · 현금 파일(매입/매출 비움)',
        kc('CARD') === 2 && kc('CASH') === 1 && ups2.files.filter((f) => f.kind !== 'INVOICE').every((f) => f.direction === null) &&
        ups2.files.filter((f) => f.kind === 'CARD').length === 2, { CARD: kc('CARD'), CASH: kc('CASH') });

      const tpl = await cashTemplateOp(c, ORG_A);
      const twb = tpl.ok ? XLSX.read(tpl.data.bytes, { type: 'array' }) : null;
      const head = twb ? XLSX.utils.sheet_to_json(twb.Sheets['현금 경비'], { header: 1, defval: '' })[0] : null;
      const itemsAoa = twb ? XLSX.utils.sheet_to_json(twb.Sheets['항목 목록'], { header: 1 }) : [];
      const listOf = (name) => (twb?.Sheets[name] ? XLSX.utils.sheet_to_json(twb.Sheets[name], { header: 1 }).flat() : []);
      check('X5', '★ 양식 내려받기 — 파일 이름 · 시트 여섯(현금 경비 · 안내 · 구분 · 항목 · 결제방법 · 증빙 목록) · 1줄 제목 줄 = 대응표 그대로 · ' +
        '항목 목록 = 그 회사(법인) 17개 · 구분 = 매입 · 매출 · 결제방법 = 코드 표 이름(계좌이체)',
        tpl.ok && tpl.data.fileName === '현금경비_양식.xlsx' &&
        twb.SheetNames.join() === '현금 경비,안내,구분 목록,항목 목록,결제방법 목록,증빙 목록' &&
        JSON.stringify(head) === JSON.stringify(cashMap.headerSignature) && itemsAoa.length === 1 + 17 &&
        listOf('구분 목록').join() === '구분,매입,매출' && listOf('결제방법 목록').join() === '결제방법,현금,계좌이체,대표 개인 돈',
        { name: tpl.ok ? tpl.data.fileName : tpl, sheets: twb?.SheetNames, items: itemsAoa.length, dirs: listOf('구분 목록'), pays: listOf('결제방법 목록') });

      // ★ X6 · X7(카드 거래처 지우기 · 합치기)은 2026-11-07 화면 · API 에서 없앴다

      const k1File = ups2.files.find((f) => f.fileName === 'k1.xls');
      const delCheck = await deleteUploadsOp(c, ORG_A, [k1File.id], true);
      check('X8', '★ 카드 파일 지우기 전 확인 — 그 파일 4줄이 빠지고, 뒤에 올린 겹친 카드 파일(건너뛴 4줄)을 알린다',
        delCheck.ok && delCheck.data.deletedRows === 4 && delCheck.data.laterFilesWithSkips.some((f) => f.fileName === 'k2.xls' && f.skippedRows === 4),
        delCheck.ok ? delCheck.data : delCheck);

      await applyCompanyScope(c, tenant(ORG_B));
      const bCard = await previewUploadOp(c, ORG_B, 'CARD', 'k1.xls', k1);
      check('X9', '★ 회사 B — 같은 카드 파일도 B 에는 새 줄 4(개수 맞추기 · 이미 올린 줄 위치는 단체마다) · B 에 등록된 카드가 없어 4줄 경고',
        bCard.ok && bCard.data.toInsert === 4 && bCard.data.sameFile === null && bCard.data.alreadyWhere?.length === 0 &&
        bCard.data.warnings.find((w) => w.code === 'card_unregistered')?.count === 4, bCard.ok ? bCard.data.warnings : bCard);
      await applyCompanyScope(c, tenant(ORG_A));

      await bankChecks(c);
      await paySocialLoanChecks(c);
    } finally {
      await c.query('ROLLBACK');
    }

    // ★ 스코프(set_config … true)는 트랜잭션 안에서만 산다 — 밖에서 세면 RLS 가 0줄을 줘서 늘 통과한다
    await c.query('BEGIN');
    try {
      await applyCompanyScope(c, OPERATOR);
      const n = async (t) => (await c.query(`SELECT count(*)::int n FROM public.${t} WHERE org_id = ANY($1)`, [[ORG_A, ORG_B]])).rows[0].n;
      const [f, v, i] = [await n('tb_s050_upload_files'), await n('tb_s050_vendors'), await n('tb_s050_invoices')];
      const [cd, cs, st, fa] = [await n('tb_s050_card_txns'), await n('tb_s050_cash_txns'), await n('tb_s050_settings'), await n('tb_s050_fin_accounts')];
      const bk = await n('tb_s050_bank_txns');
      const [tp, si, ln] = [await n('tb_s050_tax_payments'), await n('tb_s050_social_ins'), await n('tb_s050_loan_txns')];
      check('Z1', '롤백 후 시험 줄 0 (운영사 스코프로 센다)',
        f === 0 && v === 0 && i === 0 && cd === 0 && cs === 0 && st === 0 && fa === 0 && bk === 0 && tp === 0 && si === 0 && ln === 0,
        `파일 ${f} · 거래처 ${v} · 계산서 ${i} · 카드 ${cd} · 현금 ${cs} · 설정 ${st} · 계좌·카드 ${fa} · 은행 ${bk} · 납부 ${tp} · 4대보험 ${si} · 대출 ${ln}`);
    } finally {
      await c.query('ROLLBACK');
    }
  } finally {
    c.release();
  }
}

main()
  .then(async () => {
    await closePool();
    console.table(results);
    const failed = results.filter((r) => r.결과 !== '통과').length;
    console.log(failed === 0 ? `✔ 전부 통과 (${results.length}건)` : `✘ 실패 ${failed}건`);
    process.exit(failed === 0 ? 0 : 1);
  })
  .catch(async (e) => {
    console.error('✘ 실행 실패:', e.message);
    await closePool().catch(() => {});
    process.exit(2);
  });
