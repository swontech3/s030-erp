/**
 * 세무 부가세 조회(s050400020) 검증 — **앱이 실제 DB 에서** 하는 일만 잰다(1-8, 2026-11-05).
 *
 * 사용: npm run verify:tax-vat   (= npx tsx scripts/verify-tax-vat.js)
 *
 * ★★ 계산 규칙 하나하나는 shared `tax-vat.test.ts` 가 잰다. 여기는 그 위의 읽기다:
 *    신고 기간(법인 분기 · 개인 반기, 설정의 사업자 유형) · 세는 범위 · 매출세액 · 매입세액 · 카드 공제(Y) · 현금 매출 ·
 *    공제가 안 될 수 있는 매입(코드 TAX_NODEDUCT_ITEM, 217) · 미지정 건 · 기간 고르기 · 맞지 않는 기간 400 · 설정 없음 ·
 *    엑셀(매출 · 매입 시트) · 회사별 막기.
 * ★★ API 의 풀(`db/pool.ts`)로 접속한다 — erp_app. 라우트가 쓰는 처리(`routes/taxVat.ts` 의 …Op)를 그대로 부른다.
 * ★ 시험 줄은 지어낸 값으로 **한 트랜잭션 안에서 넣고 ROLLBACK 한다.** DB 에 남는 것이 없다(마지막 Z1 이 센다).
 *   시험 단체는 verify-201 · 203 과 같은 대역(990001 · 990002).
 *
 * 종료코드: 0 = 전부 통과 / 1 = 실패 있음 / 2 = 실행 실패
 */
import * as XLSX from 'xlsx';
import { pool, closePool } from '../packages/api/src/db/pool.ts';
import { applyCompanyScope } from '../packages/api/src/db/withCompanyScope.ts';
import { exportVatOp, vatOp } from '../packages/api/src/routes/taxVat.ts';

const ORG_A = 990001;
const ORG_B = 990002;
const MONTH = '2026-09';
/** 이번 달 고정 — 신고 기간 선택지가 날짜에 따라 달라지지 않게(11-06). */
const THIS_MONTH = '2026-11';
const results = [];
const check = (id, what, cond, note = '') =>
  results.push({ 항목: id, 내용: what, 결과: cond ? '통과' : '실패', 비고: typeof note === 'string' ? note : JSON.stringify(note) });

const tenant = (orgId) => ({ role: 'tenant', companyId: null, orgId });
const OPERATOR = { role: 'operator', companyId: null, orgId: ORG_A };
const query = (over = {}) => ({ month: MONTH, periodId: null, ...over });

async function main() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    try {
      // ── 시험 줄 — 운영사 세션으로 두 단체에 넣는다(지어낸 값) ──
      await applyCompanyScope(c, OPERATOR);
      await c.query(`INSERT INTO public.tb_s050_settings (org_id, biz_type, withholding_cycle, tax_emails, unused_kinds)
        VALUES ($1, 'C', 'M', '[]'::jsonb, '{}')`, [ORG_A]);
      const file = (id, org, kind, mapId, dir, h) =>
        c.query(`INSERT INTO public.tb_s050_upload_files (id, org_id, kind, map_id, direction, file_name, file_hash, file_size,
            row_count, inserted_count) VALUES ($1, $2, $3, $4, $5, $6, $7, 1000, 3, 3)`,
        [id, org, kind, mapId, dir, `${id}.xls`, h.repeat(64)]);
      await file('vvat-fs', ORG_A, 'INVOICE', 'HOMETAX_TAX_INVOICE', 'S', '1');
      await file('vvat-fp', ORG_A, 'INVOICE', 'HOMETAX_TAX_INVOICE', 'P', '2');
      await file('vvat-fc', ORG_A, 'CARD', 'HOMETAX_BIZ_CARD', null, '3');
      await file('vvat-fx', ORG_A, 'CASH', 'TAX_CASH_STD', null, '4');
      await file('vvat-fb', ORG_B, 'INVOICE', 'HOMETAX_TAX_INVOICE', 'S', '5');
      for (const [id, org] of [['vvat-va', ORG_A], ['vvat-vb', ORG_B]]) {
        await c.query(`INSERT INTO public.tb_s050_vendors (id, org_id, name, biz_no, vendor_tp, first_kind, first_direction)
          VALUES ($1, $2, '지어낸 거래처', NULL, 'M', 'INVOICE', 'S')`, [id, org]);
      }
      const inv = (id, org, fileId, vendorId, dir, date, supply, tax, item = null) =>
        c.query(`INSERT INTO public.tb_s050_invoices (id, org_id, file_id, vendor_id, direction, approval_no, write_date,
            partner_name_src, partner_biz_no_src, supply_amount, tax_amount, total_amount, inv_class, inv_type, item_code)
          VALUES ($1, $2, $3, $4, $5, $6, $7::date, '지어낸 거래처', '9900000011', $8::bigint, $9::bigint, $8::bigint + $9::bigint,
                  'TAX', 'GEN', $10::text)`,
        [id, org, fileId, vendorId, dir, `V-VAT-${id}`, date, supply, tax, item]);
      await inv('vvat-s1', ORG_A, 'vvat-fs', 'vvat-va', 'S', '2026-07-03', 1000000, 100000);
      await inv('vvat-s2', ORG_A, 'vvat-fs', 'vvat-va', 'S', '2026-09-20', 300000, 30000);
      await inv('vvat-s6', ORG_A, 'vvat-fs', 'vvat-va', 'S', '2026-06-30', 10000, 1000); // 2분기
      await inv('vvat-p1', ORG_A, 'vvat-fp', 'vvat-va', 'P', '2026-08-01', 200000, 20000, 'VEHICLE');
      await inv('vvat-p2', ORG_A, 'vvat-fp', 'vvat-va', 'P', '2026-08-02', 50000, 5000);
      await inv('vvat-sb', ORG_B, 'vvat-fb', 'vvat-vb', 'S', '2026-07-03', 7770, 777);
      const card = (id, date, tax, deduct, item) =>
        c.query(`INSERT INTO public.tb_s050_card_txns (id, org_id, file_id, vendor_id, card_last4, use_date, merchant_name_src,
            merchant_biz_no_src, supply_amount, tax_amount, nontax_amount, total_amount, vat_deduct, item_code)
          VALUES ($1, $2, 'vvat-fc', NULL, '4821', $3::date, '지어낸 가맹점', NULL, $4::bigint * 10, $4::bigint, 0, $4::bigint * 11,
                  $5::text, $6::text)`,
        [id, ORG_A, date, tax, deduct, item]);
      await card('vvat-c1', '2026-07-10', 1000, 'Y', 'MEAL');
      await card('vvat-c2', '2026-07-11', 2000, 'Y', 'ENTERTAIN');
      await card('vvat-c3', '2026-07-12', 500, 'N', 'ENTERTAIN');
      await card('vvat-c4', '2026-07-13', 300, null, null);
      const cash = (id, dir, date, amount, item) =>
        c.query(`INSERT INTO public.tb_s050_cash_txns (id, org_id, file_id, use_date, description, vendor_name_src, direction, amount,
            pay_method, item_code) VALUES ($1, $2, 'vvat-fx', $3::date, '지어낸 품명', NULL, $4, $5, 'CASH', $6::text)`,
        [id, ORG_A, date, dir, amount, item]);
      await cash('vvat-x1', 'S', '2026-07-14', 55000, null);
      await cash('vvat-x2', 'P', '2026-07-15', 4000, null);

      // ── 회사 A · 법인 ──
      await applyCompanyScope(c, tenant(ORG_A));
      const r = await vatOp(c, ORG_A, query(), THIS_MONTH);
      const v = r.ok ? r.data.vat : null;
      check('V1', '★ 법인 9월 — 2026년 3분기 예정 · 마감 10-25 · 선택지 최근 3년 이번 달(11월)까지 시작한 12개 · 센 범위 7~9월',
        r.ok && r.data.period?.id === '2026-Q3' && r.data.period.deadline === '2026-10-25' && r.data.query.periodId === '2026-Q3' &&
        r.data.periods.length === 12 && r.data.periods[0].id === '2026-Q4' && r.data.periods[11].id === '2024-Q1' && r.data.rangeLabel === '7~9월',
        r.ok ? { period: r.data.period?.id, periods: r.data.periods.map((p) => p.id), range: r.data.rangeLabel } : r);
      check('V2', '★ 매출세액 130,000(계산서 세액 합, 6월 줄 빠짐) · 매입세액 25,000 · 카드 공제(Y) 3,000 · 낼 세금 102,000',
        v && v.sales.tax === 130000 && v.sales.supply === 1300000 && v.purchase.tax === 25000 && v.card.tax === 3000 && v.payable === 102000,
        v ? { sales: v.sales, purchase: v.purchase, card: v.card, payable: v.payable } : r);
      check('V3', '★ 공제가 안 될 수 있는 매입 — 코드 표(217) 순서 접대비 2,000(공제 카드만) · 차량유지비 20,000 · 최대 22,000',
        v && JSON.stringify(v.nodeduct.lines.map((l) => [l.itemCode, l.label, l.tax])) ===
          JSON.stringify([['ENTERTAIN', '접대비', 2000], ['VEHICLE', '차량유지비', 20000]]) && v.nodeduct.total === 22000,
        v ? v.nodeduct : r);
      check('V4', '현금 매출 55,000(세액 계산 없음) · 미지정 건 3(계산서 · 카드 · 현금 매입)',
        v && v.cashSales === 55000 && v.unassignedCount === 3, v ? { cash: v.cashSales, left: v.unassignedCount } : r);
      const db = (await c.query(`SELECT sum(tax_amount)::int t FROM public.tb_s050_invoices
        WHERE org_id = $1 AND direction = 'S' AND write_date >= '2026-07-01' AND write_date < '2026-10-01'`, [ORG_A])).rows[0];
      check('V5', '매출세액이 DB 합과 같다', v && v.sales.tax === db.t, { db: db.t });

      const q2 = await vatOp(c, ORG_A, query({ periodId: '2026-Q2' }), THIS_MONTH);
      check('V6', '기간 고르기 — 2분기 확정(4~6월) · 매출세액 1,000 · 마감 07-25',
        q2.ok && q2.data.period?.id === '2026-Q2' && q2.data.rangeLabel === '4~6월' && q2.data.vat?.sales.tax === 1000 &&
        q2.data.period.deadline === '2026-07-25', q2.ok ? { p: q2.data.period?.id, tax: q2.data.vat?.sales.tax } : q2);
      const bad = await vatOp(c, ORG_A, query({ periodId: '2026-H1' }), THIS_MONTH);
      const future = await vatOp(c, ORG_A, query({ periodId: '2027-Q1' }), THIS_MONTH);
      check('V7', '법인에 반기 기간 · 이번 달(11월) 뒤에 시작하는 기간은 400', !bad.ok && bad.status === 400 && !future.ok && future.status === 400,
        { bad: bad.ok ? 'ok' : bad.status, future: future.ok ? 'ok' : future.status });

      // ── 엑셀 ──
      const read = (bytes) => {
        const wb = XLSX.read(bytes, { type: 'array' });
        return wb.SheetNames.map((nm) => [nm, XLSX.utils.sheet_to_json(wb.Sheets[nm], { header: 1, defval: null })]);
      };
      const x = await exportVatOp(c, ORG_A, query());
      const sh = x.ok ? read(x.data.bytes) : [];
      check('V8', '★ 엑셀 — 부가세_2026년3분기.xlsx · 시트 매출(제목 + 2) · 매입(제목 + 계산서 2 + 카드 4) · 칸 일곱',
        x.ok && x.data.fileName === '부가세_2026년3분기.xlsx' && sh.map(([nm, r]) => `${nm}:${r.length}`).join() === '매출:3,매입:7' &&
        sh[1][1][0].join() === '작성일,거래처,사업자번호,공급가액,세액,자료,공제 여부',
        x.ok ? { name: x.data.fileName, sheets: sh.map(([nm, r]) => `${nm}:${r.length}`), head: sh[1]?.[1]?.[0] } : x);
      const cardRow = sh[1]?.[1]?.find((row) => row[5] === '카드' && row[4] === 500);
      check('V9', '엑셀 매입 카드 줄 — 자료 「카드」 · 공제 여부는 코드 이름(불공제)', cardRow?.[6] === '불공제', cardRow ?? null);

      // ── 개인 ──
      await applyCompanyScope(c, OPERATOR);
      await c.query(`UPDATE public.tb_s050_settings SET biz_type = 'I' WHERE org_id = $1`, [ORG_A]);
      await applyCompanyScope(c, tenant(ORG_A));
      const iv = await vatOp(c, ORG_A, query(), THIS_MONTH);
      check('V10', '★ 개인 9월 — 2026년 2기 확정(7~12월) · 마감 2027-01-25 · 예정고지 10-25 · 센 범위 7~9월 · 같은 합',
        iv.ok && iv.data.period?.id === '2026-H2' && iv.data.period.deadline === '2027-01-25' && iv.data.period.prepayDeadline === '2026-10-25' &&
        iv.data.rangeLabel === '7~9월' && iv.data.vat?.payable === 102000, iv.ok ? { p: iv.data.period, pay: iv.data.vat?.payable } : iv);

      // ── 회사별 막기 · 설정 없음 ──
      await applyCompanyScope(c, tenant(ORG_B));
      const b0 = await vatOp(c, ORG_B, query(), THIS_MONTH);
      const bx = await exportVatOp(c, ORG_B, query());
      check('V11', '설정 없는 회사 — 기간 · 계산 없음(화면은 세무 설정 안내) · 엑셀은 400',
        b0.ok && b0.data.period === null && b0.data.vat === null && b0.data.periods.length === 0 && !bx.ok && bx.status === 400,
        { b0: b0.ok ? b0.data.period : b0, bx: bx.ok ? 'ok' : bx.status });
      await applyCompanyScope(c, OPERATOR);
      await c.query(`INSERT INTO public.tb_s050_settings (org_id, biz_type, withholding_cycle, tax_emails, unused_kinds)
        VALUES ($1, 'C', 'M', '[]'::jsonb, '{}')`, [ORG_B]);
      await applyCompanyScope(c, tenant(ORG_B));
      const b = await vatOp(c, ORG_B, query(), THIS_MONTH);
      check('V12', '★ 회사 B — 자기 매출세액 777 만 · A 의 매입 · 카드 없음',
        b.ok && b.data.vat?.sales.tax === 777 && b.data.vat.purchase.tax === 0 && b.data.vat.card.tax === 0, b.ok ? b.data.vat : b);
      await applyCompanyScope(c, OPERATOR);
      const op = await vatOp(c, ORG_A, query(), THIS_MONTH);
      check('V13', '★ 운영사 세션도 자기 단체만 — RLS 가 B 를 보여 줘도 A 의 매출세액 130,000',
        op.ok && op.data.vat?.sales.tax === 130000, op.ok ? op.data.vat?.sales : op);
    } finally {
      await c.query('ROLLBACK');
    }

    // ★ 스코프(set_config … true)는 트랜잭션 안에서만 산다 — 밖에서 세면 RLS 가 0줄을 줘서 늘 통과한다
    await c.query('BEGIN');
    try {
      await applyCompanyScope(c, OPERATOR);
      const cnt = async (t) => (await c.query(`SELECT count(*)::int n FROM public.${t} WHERE org_id = ANY($1)`, [[ORG_A, ORG_B]])).rows[0].n;
      const tables = ['tb_s050_upload_files', 'tb_s050_invoices', 'tb_s050_card_txns', 'tb_s050_cash_txns', 'tb_s050_settings', 'tb_s050_vendors'];
      const n = [];
      for (const t of tables) n.push(await cnt(t));
      check('Z1', '롤백 후 시험 줄 0 (운영사 스코프로 센다)', n.every((x) => x === 0), tables.map((t, i) => `${t.slice(8)} ${n[i]}`).join(' · '));
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
