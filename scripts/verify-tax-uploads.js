/**
 * 세무 자료 올리기(s050200010) · 거래처(s050100020) 검증 — **앱이 실제 DB 에서** 하는 일만 잰다.
 *
 * 사용: npm run verify:tax-uploads   (= npx tsx scripts/verify-tax-uploads.js)
 *
 * ★★ 표 구조 · RLS · UNIQUE · FK 는 `scripts/verify-203.js` 가, 코드 · 대응표는 `verify-204.js` 가 잰다.
 *    여기는 그 위의 앱 처리다: 회사별 막기 · 같은 파일 409 · 겹친 파일은 새 줄만 · 거래처 자동 등록 · 승격 ·
 *    덮지 않기 · 사용자가 내린 일반은 그대로 · 먼저 생긴 곳에 붙임 · 합치기 · 파일 지우기.
 * ★★ API 의 풀(`db/pool.ts`)로 접속한다 — erp_app. 라우트가 쓰는 처리(`routes/taxUploads.ts` ·
 *    `routes/taxVendors.ts` 의 …Op)를 그대로 부른다.
 * ★ 엑셀은 SheetJS 로 **지어낸 값**을 써서 만든다 — 원본 샘플(doc/data-src/)을 쓰지 않는다. 제목 줄은 DB 의 대응표에서 읽는다.
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
} from '../packages/api/src/routes/taxUploads.ts';
import {
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
      check('U1', '미리보기 — 매출(S) · 넣을 3줄 · 9월 3줄 · 앞줄 · 「우리 번호 없음」 경고 · 쓰지 않는다',
        pv1.ok && pv1.data.direction === 'S' && pv1.data.toInsert === 3 && pv1.data.byMonth[0]?.count === 3 &&
        pv1.data.sample.length === 3 && pv1.data.warnings.some((w) => w.code === 'own_biz_no_unchecked') &&
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
      check('U11', '자료 올리기 목록 — 세금계산서 카드만 열림 · 그 달 파일 수 · 코드 이름은 코드 표에서',
        inv?.enabled === true && inv.fileCount === 6 && ups.cards.filter((k) => k.enabled).length === 1 &&
        ups.files.length === 6 && ups.codes.invDirs.map((d) => d.code).join() === 'P,S',
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
      await applyCompanyScope(c, tenant(ORG_B));
      const bList = await vendorsOf(ORG_B);
      const bEdit = await editVendorOp(c, ORG_B, v1[0].id, { name: '가로챔' }, ACTOR);
      const bType = await setVendorTypeOp(c, ORG_B, [v1[0].id], 'G', ACTOR);
      const bMerge = await mergeVendorsOp(c, ORG_B, v1[0].id, [v2.id], ACTOR);
      const bDel = await deleteUploadsOp(c, ORG_B, [up1.data.file.id]);
      check('U13', '★ 회사 B — A 의 거래처 · 파일이 안 보이고, A 의 id 로 고치기 · 구분 · 합치기 · 지우기는 404',
        bList.length === 0 && [bEdit, bType, bMerge, bDel].every((r) => !r.ok && r.status === 404) &&
        (await listUploadsOp(c, ORG_B, MONTH)).files.length === 0,
        [bEdit, bType, bMerge, bDel].map((r) => r.status));
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
      const del = await deleteUploadsOp(c, ORG_A, [up1.data.file.id]);
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
    } finally {
      await c.query('ROLLBACK');
    }

    // ★ 스코프(set_config … true)는 트랜잭션 안에서만 산다 — 밖에서 세면 RLS 가 0줄을 줘서 늘 통과한다
    await c.query('BEGIN');
    try {
      await applyCompanyScope(c, OPERATOR);
      const n = async (t) => (await c.query(`SELECT count(*)::int n FROM public.${t} WHERE org_id = ANY($1)`, [[ORG_A, ORG_B]])).rows[0].n;
      const [f, v, i] = [await n('tb_s050_upload_files'), await n('tb_s050_vendors'), await n('tb_s050_invoices')];
      check('Z1', '롤백 후 시험 줄 0 (운영사 스코프로 센다)', f === 0 && v === 0 && i === 0, `파일 ${f} · 거래처 ${v} · 계산서 ${i}`);
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
