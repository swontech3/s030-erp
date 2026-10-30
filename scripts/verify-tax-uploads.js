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
  deleteVendorsOp,
  editVendorOp,
  listVendorsOp,
  mergeVendorsOp,
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

/** 지어낸 현금 경비 표준 양식(xlsx) — 1줄 안내 · 2줄 제목 줄. rows: [날짜, 품명, 거래처, 항목, 매출액, 매입액, 지급방법, 증빙]. */
function makeCashXlsx(header, rows) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['지어낸 안내'], header, ...rows]), '현금 경비');
  return new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
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
      const vendorsOf = async (orgId) => (await listVendorsOp(c, orgId, MONTH)).vendors;
      const vendorByBiz = async (orgId, biz) => (await vendorsOf(orgId)).filter((v) => v.bizNo === biz);
      const invoiceVendor = async (orgId, no) =>
        (await c.query(`SELECT vendor_id FROM public.tb_s050_invoices WHERE org_id = $1 AND approval_no = $2`, [orgId, `V-TAXUP-${no}`])).rows[0]?.vendor_id ?? null;
      const upload = (orgId, name, bytes) => uploadInvoicesOp(c, orgId, 'INVOICE', name, bytes, ACTOR);

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
      check('U2', '올리기 — 3줄 · 거래처 2곳 자동 등록 · 주거래처(M) · 처음 생긴 자료 INVOICE/S',
        up1.ok && up1.data.insertedCount === 3 && up1.data.vendorsCreated === 2 &&
        v1.length === 1 && v1[0].vendorTp === 'M' && v1[0].firstKind === 'INVOICE' && v1[0].firstDirection === 'S' && v1[0].monthCount === 2,
        up1.ok ? { inserted: up1.data.insertedCount, created: up1.data.vendorsCreated, v1 } : up1);

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
      check('U7', '★ 덮지 않기 — 이미 있는 거래처의 이름은 파일 이름으로 바뀌지 않는다',
        v4.name === '미리 있던 일반' && v4.firstKind === 'BANK', v4);

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
      const list = await listVendorsOp(c, ORG_A, MONTH);
      check('U9', '★ 같은 사업자번호 거래처 둘 — 업로드는 먼저 생긴 곳에 붙이고, 목록은 묶음으로 알린다',
        (await invoiceVendor(ORG_A, 9)) === v2.id && list.sameBizNoGroups.some((g) => g.join() === [v2.id, dupP2].join()),
        list.sameBizNoGroups);

      // ── 매입 파일 ──
      const f6 = xls({ tag: 'f6', sales: false, rows: [{ no: 10, partner: P.p6, name: '지어낸 공급자' }] });
      const up6 = await upload(ORG_A, 'f6.xls', f6);
      const v6 = (await vendorByBiz(ORG_A, P.p6))[0];
      check('U10', '매입 파일 — 공급자 칸이 거래처 · 구분 P', up6.ok && up6.data.file.direction === 'P' && v6?.firstDirection === 'P' && v6.name === '지어낸 공급자', v6);

      // ── 목록 ──
      const ups = await listUploadsOp(c, ORG_A, MONTH);
      const inv = ups.cards.find((k) => k.kind === 'INVOICE');
      check('U11', '자료 올리기 목록 — 계산서 · 카드 · 현금 카드가 열림(1-4) · 그 달 파일 수 · 코드 이름은 코드 표에서',
        inv?.enabled === true && inv.fileCount === 6 &&
        ups.cards.filter((k) => k.enabled).map((k) => k.kind).join() === 'INVOICE,CARD,CASH' &&
        ups.files.length === 6 && ups.codes.invDirs.map((d) => d.code).join() === 'P,S' &&
        // 카드 설명은 코드 설명 칸에서(비어 있으면 null) · 사업자 유형 이름(설정이 없으면 null)
        ups.codes.kinds.every((k) => 'description' in k) && 'bizTypeName' in ups && ups.bizTypeName === null,
        { inv, files: ups.files.length, dirs: ups.codes.invDirs });

      // ── 합치기 ──
      const v3 = (await vendorByBiz(ORG_A, P.p3))[0];
      const nullBiz = await insertVendor(c, ORG_A, { name: '번호 없는 남길 곳', bizNo: P.p6, vendorTp: 'G', firstKind: 'CASH', firstDirection: null }, ACTOR);
      await editVendorOp(c, ORG_A, nullBiz, { name: null, bizNo: null }, ACTOR);
      const merge = await mergeVendorsOp(c, ORG_A, nullBiz, [v3.id], ACTOR);
      const after = (await vendorsOf(ORG_A)).find((v) => v.id === nullBiz);
      check('U12', '★ 합치기 — 계산서를 남길 곳으로 옮기고 · 주거래처면 주거래처 · 빈 번호는 다른 곳 번호 · 합친 곳 지움',
        merge.ok && merge.data.movedRows === 1 && after?.vendorTp === 'M' && after.bizNo === P.p3 &&
        (await invoiceVendor(ORG_A, 4)) === nullBiz && !(await vendorsOf(ORG_A)).some((v) => v.id === v3.id),
        { merge: merge.ok ? merge.data.movedRows : merge, after });

      // ── 회사별 막기 ──
      const aZero = await insertVendor(c, ORG_A, { name: '남의 단체가 지우려는 곳', bizNo: null, vendorTp: 'G', firstKind: 'BANK', firstDirection: null }, ACTOR);
      await applyCompanyScope(c, tenant(ORG_B));
      const bList = await vendorsOf(ORG_B);
      const bEdit = await editVendorOp(c, ORG_B, v1[0].id, { name: '가로챔' }, ACTOR);
      const bType = await setVendorTypeOp(c, ORG_B, [v1[0].id], 'G', ACTOR);
      const bMerge = await mergeVendorsOp(c, ORG_B, v1[0].id, [v2.id], ACTOR);
      const bDel = await deleteUploadsOp(c, ORG_B, [up1.data.file.id]);
      // 거래 0건인 A 의 거래처 — B 가 지우려 해도 404 · 그대로 남는다
      const bVDel = await deleteVendorsOp(c, ORG_B, [aZero]);
      check('U13', '★ 회사 B — A 의 거래처 · 파일이 안 보이고, A 의 id 로 고치기 · 구분 · 합치기 · 파일 지우기 · 거래처 지우기는 404',
        bList.length === 0 && [bEdit, bType, bMerge, bDel, bVDel].every((r) => !r.ok && r.status === 404) &&
        (await listUploadsOp(c, ORG_B, MONTH)).files.length === 0,
        [bEdit, bType, bMerge, bDel, bVDel].map((r) => r.status));
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

      // ── 거래처 지우기 — 거래 0건(전체 기간)만 ──
      check('U19a', '★ 남의 단체가 지우려 한 거래 0건 거래처는 A 에 그대로 남아 있다',
        (await vendorsOf(ORG_A)).some((v) => v.id === aZero));
      const z2 = await insertVendor(c, ORG_A, { name: '거래 없는 곳', bizNo: null, vendorTp: 'G', firstKind: 'CASH', firstDirection: null }, ACTOR);
      const v1c = (await vendorByBiz(ORG_A, P.p1))[0];
      // 8월에는 거래가 없는 거래처 — 그 달 0건이어도 9월 거래가 있으니 막혀야 한다
      const v1Aug = (await listVendorsOp(c, ORG_A, '2026-08')).vendors.find((v) => v.id === v1c.id);
      const mixed = await deleteVendorsOp(c, ORG_A, [z2, v1c.id]);
      const afterMixed = await vendorsOf(ORG_A);
      check('U19', '★ 거래가 있는 거래처가 하나라도 섞이면 409 · 아무것도 지우지 않는다(이번 달 거래 0건이어도 전체 기간으로 본다)',
        !mixed.ok && mixed.status === 409 && mixed.message === '거래가 있는 거래처는 지울 수 없습니다' &&
        v1Aug?.monthCount === 0 && v1c.totalCount > 0 && afterMixed.some((v) => v.id === z2) && afterMixed.some((v) => v.id === v1c.id),
        { mixed, v1Aug: v1Aug?.monthCount, v1Total: v1c.totalCount });
      const vDel = await deleteVendorsOp(c, ORG_A, [z2, aZero]);
      const afterDel = await vendorsOf(ORG_A);
      check('U20', '★ 거래 0건 거래처 지우기 — 고른 2곳이 지워진다',
        vDel.ok && vDel.data.deleted === 2 && !afterDel.some((v) => v.id === z2 || v.id === aZero),
        vDel.ok ? vDel.data : vDel);
      const vGhost = await deleteVendorsOp(c, ORG_A, [v1c.id, 'v-tax-up-none']);
      check('U21', '없는 거래처 id 가 섞이면 404', !vGhost.ok && vGhost.status === 404, vGhost);

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
        newV.length === 1 && newV[0].vendorTp === 'G' && newV[0].firstKind === 'CARD' && newV[0].firstDirection === null && newV[0].totalCount === 2 &&
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

      // ══ 현금 경비(1-4) ══
      await c.query(`INSERT INTO public.tb_s050_settings (org_id, biz_type, withholding_cycle, tax_emails, unused_kinds)
        VALUES ($1, 'C', 'M', '[]'::jsonb, '{}')`, [ORG_A]);
      const cashMap = await loadImportMap(c, 'CASH');
      if (!cashMap) throw new Error('대응표 TAX_CASH_STD 가 없다 — 209 를 먼저');
      const cashRows1 = [
        ['2026-09-13', '지어낸 점심', '지어낸 식당', '식대·회의비', '', 15000, '현금', '영수증'],
        ['2026-09-14', '지어낸 판매', '지어낸 손님', '식대·회의비', 30000, '', '계좌이체(직원 정산)', ''],
        ['2026-09-15', '지어낸 간식', '', '복리후생비', '', 4000, '대표 개인 돈', ''],
        ['2026-09-16', '지어낸 문구', '', '', '', 2000, '현금', '카드전표'],
        ['2026-09-17', '지어낸 택시', '', '', '', 9000, '', ''],
        ['2026-09-18', '지어낸 둘다', '', '', 100, 100, '현금', ''],
      ];
      const x1 = makeCashXlsx(cashMap.headerSignature, cashRows1);
      const xpv = await previewUploadOp(c, ORG_A, 'CASH', 'x1.xlsx', x1);
      check('X1', '★ 현금 미리보기 — 넣을 4줄(매출 1 포함) · 뺀 줄(지급방법 · 둘 다) · 항목 모름 · 증빙 모름 · 매출 항목 무시 경고 · 뺀 줄 이름은 현금 키만',
        xpv.ok && xpv.data.kind === 'CASH' && xpv.data.direction === null && xpv.data.toInsert === 4 &&
        xpv.data.excluded.badPayMethod === 1 && xpv.data.excluded.bothAmounts === 1 &&
        xpv.data.skipReasons.map((x) => x.code).join() === 'badAmount,badDate,noDescription,noAmount,bothAmounts,badPayMethod' &&
        xpv.data.warnings.map((w) => w.code).sort().join() === 'cash_item_unknown,cash_proof_unknown,cash_sales_item_ignored',
        xpv.ok ? { toInsert: xpv.data.toInsert, excluded: xpv.data.excluded, warnings: xpv.data.warnings.map((w) => w.code) } : xpv);
      const vCount = (await vendorsOf(ORG_A)).length;
      const xup = await uploadOp(c, ORG_A, 'CASH', 'x1.xlsx', x1, ACTOR);
      const cashStored = (await c.query(`SELECT description, direction, item_code, classified_by, classified_at IS NOT NULL AS at, pay_method, proof
        FROM public.tb_s050_cash_txns WHERE org_id = $1 ORDER BY use_date`, [ORG_A])).rows;
      check('X2', '★ 현금 올리기 — 4줄 · 파일에 적은 항목은 바로 지정 건(올린 사람 · 때) · 매출 줄은 항목 없음 · 거래처 표는 그대로',
        xup.ok && xup.data.insertedCount === 4 && xup.data.vendorsCreated === 0 && (await vendorsOf(ORG_A)).length === vCount &&
        cashStored[0]?.item_code === 'MEAL' && cashStored[0].classified_by === ACTOR && cashStored[0].at && cashStored[0].proof === 'RECEIPT' &&
        cashStored[1]?.direction === 'S' && cashStored[1].item_code === null && cashStored[1].pay_method === 'TRANSFER' &&
        cashStored[2]?.item_code === null && cashStored[3]?.proof === null,
        cashStored);
      const x2 = makeCashXlsx(cashMap.headerSignature, [...cashRows1, ['2026-09-19', '지어낸 우표', '', '', '', 500, '현금', '없음']]);
      const xpv2 = await previewUploadOp(c, ORG_A, 'CASH', 'x2.xlsx', x2);
      check('X3', '★ 현금 개수 맞추기 — 고친 파일을 다시 올리면 이미 올린 4줄은 건너뛰고 새 1줄만',
        xpv2.ok && xpv2.data.toInsert === 1 && xpv2.data.alreadyUploaded === 4, xpv2.ok ? [xpv2.data.toInsert, xpv2.data.alreadyUploaded] : xpv2);

      const ups2 = await listUploadsOp(c, ORG_A, MONTH);
      const kc = (k) => ups2.cards.find((x) => x.kind === k)?.fileCount;
      check('X4', '자료 올리기 목록 — 카드 파일 2 · 현금 파일 1, 올린 파일 목록에 카드 · 현금 파일(매입/매출 비움)',
        kc('CARD') === 2 && kc('CASH') === 1 && ups2.files.filter((f) => f.kind !== 'INVOICE').every((f) => f.direction === null) &&
        ups2.files.filter((f) => f.kind === 'CARD').length === 2, { CARD: kc('CARD'), CASH: kc('CASH') });

      const tpl = await cashTemplateOp(c, ORG_A);
      const twb = tpl.ok ? XLSX.read(tpl.data.bytes, { type: 'array' }) : null;
      const head = twb ? XLSX.utils.sheet_to_json(twb.Sheets['현금 경비'], { header: 1, defval: '' })[1] : null;
      const itemsAoa = twb ? XLSX.utils.sheet_to_json(twb.Sheets['항목 목록'], { header: 1 }) : [];
      check('X5', '★ 양식 내려받기 — 파일 이름 · 시트 넷 · 2줄 제목 줄 = 대응표 그대로 · 항목 목록 = 그 회사(법인) 17개',
        tpl.ok && tpl.data.fileName === '현금경비_양식.xlsx' && twb.SheetNames.length === 4 &&
        JSON.stringify(head) === JSON.stringify(cashMap.headerSignature) && itemsAoa.length === 1 + 17,
        { name: tpl.ok ? tpl.data.fileName : tpl, sheets: twb?.SheetNames, items: itemsAoa.length });

      const delCardV = await deleteVendorsOp(c, ORG_A, [newV[0].id]);
      check('X6', '★ 카드 줄이 있는 거래처는 지울 수 없다(409)', !delCardV.ok && delCardV.status === 409, delCardV);
      const mergedCard = await mergeVendorsOp(c, ORG_A, p1v[0].id, [newV[0].id], ACTOR);
      const movedCard = (await c.query(`SELECT count(*)::int n FROM public.tb_s050_card_txns WHERE org_id = $1 AND vendor_id = $2`, [ORG_A, p1v[0].id])).rows[0].n;
      check('X7', '★ 합치기 — 카드 줄도 남길 곳으로 옮긴다', mergedCard.ok && movedCard === 3, { merged: mergedCard.ok, movedCard });

      const k1File = ups2.files.find((f) => f.fileName === 'k1.xls');
      const delCheck = await deleteUploadsOp(c, ORG_A, [k1File.id], true);
      check('X8', '★ 카드 파일 지우기 전 확인 — 그 파일 4줄이 빠지고, 뒤에 올린 겹친 카드 파일(건너뛴 4줄)을 알린다',
        delCheck.ok && delCheck.data.deletedRows === 4 && delCheck.data.laterFilesWithSkips.some((f) => f.fileName === 'k2.xls' && f.skippedRows === 4),
        delCheck.ok ? delCheck.data : delCheck);

      await applyCompanyScope(c, tenant(ORG_B));
      const bCard = await previewUploadOp(c, ORG_B, 'CARD', 'k1.xls', k1);
      check('X9', '★ 회사 B — 같은 카드 파일도 B 에는 새 줄 4(개수 맞추기는 단체마다) · B 에 등록된 카드가 없어 4줄 경고',
        bCard.ok && bCard.data.toInsert === 4 && bCard.data.sameFile === null &&
        bCard.data.warnings.find((w) => w.code === 'card_unregistered')?.count === 4, bCard.ok ? bCard.data.warnings : bCard);
      await applyCompanyScope(c, tenant(ORG_A));
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
      check('Z1', '롤백 후 시험 줄 0 (운영사 스코프로 센다)', f === 0 && v === 0 && i === 0 && cd === 0 && cs === 0 && st === 0 && fa === 0,
        `파일 ${f} · 거래처 ${v} · 계산서 ${i} · 카드 ${cd} · 현금 ${cs} · 설정 ${st} · 계좌·카드 ${fa}`);
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
