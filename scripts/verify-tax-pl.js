/**
 * 세무 월별 손익(s050400010) 검증 — **앱이 실제 DB 에서** 하는 일만 잰다(1-8, 2026-11-05).
 *
 * 사용: npm run verify:tax-pl   (= npx tsx scripts/verify-tax-pl.js)
 *
 * ★★ 계산 규칙 하나하나는 shared `tax-pl.test.ts` 가 잰다. 여기는 그 위의 읽기다:
 *    계산서 · 카드 · 현금 · 국세 · 지방세 · 대출 줄을 실제 표에서 읽어 번 돈 · 쓴 돈 · 항목 순서(코드) · 미지정 건 · 사업과 무관 ·
 *    4대보험 빠짐(결정 1) · 비용 아닌 세목 빠짐(코드 이름) · 막대(한 해) · 합계가 DB 와 같은지 · 회사별 막기.
 * ★★ API 의 풀(`db/pool.ts`)로 접속한다 — erp_app. 라우트가 쓰는 처리(`routes/taxPl.ts` 의 plOp)를 그대로 부른다.
 * ★ 시험 줄은 지어낸 값으로 **한 트랜잭션 안에서 넣고 ROLLBACK 한다.** DB 에 남는 것이 없다(마지막 Z1 이 센다).
 *   시험 단체는 verify-201 · 203 과 같은 대역(990001 · 990002).
 *
 * 종료코드: 0 = 전부 통과 / 1 = 실패 있음 / 2 = 실행 실패
 */
import { pool, closePool } from '../packages/api/src/db/pool.ts';
import { applyCompanyScope } from '../packages/api/src/db/withCompanyScope.ts';
import { plOp } from '../packages/api/src/routes/taxPl.ts';

const ORG_A = 990001;
const ORG_B = 990002;
const MONTH = '2026-09';
const results = [];
const check = (id, what, cond, note = '') =>
  results.push({ 항목: id, 내용: what, 결과: cond ? '통과' : '실패', 비고: typeof note === 'string' ? note : JSON.stringify(note) });

const tenant = (orgId) => ({ role: 'tenant', companyId: null, orgId });
const OPERATOR = { role: 'operator', companyId: null, orgId: ORG_A };
const lines = (ls) => ls.map((l) => `${l.key}=${l.amount}`).join(' ');

async function main() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    try {
      // ── 시험 줄 — 운영사 세션으로 두 단체에 넣는다(지어낸 값) ──
      await applyCompanyScope(c, OPERATOR);
      await c.query(`INSERT INTO public.tb_s050_settings (org_id, biz_type, withholding_cycle, tax_emails, unused_kinds)
        VALUES ($1, 'C', 'M', '[]'::jsonb, '{}')`, [ORG_A]);
      const file = (id, org, kind, mapId, dir, h, extra = {}) =>
        c.query(`INSERT INTO public.tb_s050_upload_files (id, org_id, kind, map_id, direction, file_name, file_hash, file_size,
            row_count, inserted_count, social_ins_tp, notice_month)
          VALUES ($1, $2, $3, $4, $5, $6, $7, 1000, 3, 3, $8, $9::date)`,
        [id, org, kind, mapId, dir, `${id}.xls`, h.repeat(64), extra.insTp ?? null, extra.month ?? null]);
      await file('vpl-fs', ORG_A, 'INVOICE', 'HOMETAX_TAX_INVOICE', 'S', '1');
      await file('vpl-fp', ORG_A, 'INVOICE', 'HOMETAX_TAX_INVOICE', 'P', '2');
      await file('vpl-fc', ORG_A, 'CARD', 'HOMETAX_BIZ_CARD', null, '3');
      await file('vpl-fx', ORG_A, 'CASH', 'TAX_CASH_STD', null, '4');
      await file('vpl-fn', ORG_A, 'NTAX', 'HOMETAX_NTAX_PAY', null, '5');
      await file('vpl-fo', ORG_A, 'LOAN', 'BANK_020_LOAN', null, '6');
      await file('vpl-fso', ORG_A, 'SOCIAL', 'SOCIAL_HI', null, '7', { insTp: 'HI', month: '2026-09-01' });
      await file('vpl-fb', ORG_B, 'INVOICE', 'HOMETAX_TAX_INVOICE', 'S', '8');
      for (const [id, org] of [['vpl-va', ORG_A], ['vpl-vb', ORG_B]]) {
        await c.query(`INSERT INTO public.tb_s050_vendors (id, org_id, name, biz_no, vendor_tp, first_kind, first_direction)
          VALUES ($1, $2, '지어낸 거래처', NULL, 'M', 'INVOICE', 'S')`, [id, org]);
      }
      const inv = (id, org, fileId, vendorId, dir, date, supply, partner, item = null) =>
        c.query(`INSERT INTO public.tb_s050_invoices (id, org_id, file_id, vendor_id, direction, approval_no, write_date,
            partner_name_src, partner_biz_no_src, supply_amount, tax_amount, total_amount, inv_class, inv_type, item_code)
          VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, '9900000011', $9::bigint, $9::bigint / 10, $9::bigint + $9::bigint / 10, 'TAX', 'GEN', $10::text)`,
        [id, org, fileId, vendorId, dir, `V-PL-${id}`, date, partner, supply, item]);
      await inv('vpl-s1', ORG_A, 'vpl-fs', 'vpl-va', 'S', '2026-09-03', 1000000, '지어낸 매출처');
      await inv('vpl-s8', ORG_A, 'vpl-fs', 'vpl-va', 'S', '2026-08-10', 500000, '지어낸 매출처');
      await inv('vpl-p1', ORG_A, 'vpl-fp', 'vpl-va', 'P', '2026-09-05', 200000, '지어낸 매입처', 'RENT');
      await inv('vpl-p2', ORG_A, 'vpl-fp', 'vpl-va', 'P', '2026-09-06', 50000, '지어낸 매입처');
      await inv('vpl-p3', ORG_A, 'vpl-fp', 'vpl-va', 'P', '2026-09-07', 30000, '지어낸 매입처', 'NONBIZ_TAXPRO');
      await inv('vpl-sb', ORG_B, 'vpl-fb', 'vpl-vb', 'S', '2026-09-03', 777, '지어낸 B 매출처');
      const card = (id, date, total, tax, deduct, item) =>
        c.query(`INSERT INTO public.tb_s050_card_txns (id, org_id, file_id, vendor_id, card_last4, use_date, merchant_name_src,
            merchant_biz_no_src, supply_amount, tax_amount, nontax_amount, total_amount, vat_deduct, item_code)
          VALUES ($1, $2, 'vpl-fc', NULL, '4821', $3::date, '지어낸 가맹점', NULL, $4::bigint - $5::bigint, $5::bigint, 0, $4::bigint, $6::text, $7::text)`,
        [id, ORG_A, date, total, tax, deduct, item]);
      await card('vpl-c1', '2026-09-10', 11000, 1000, 'Y', 'MEAL'); // 비용 10,000
      await card('vpl-c2', '2026-09-11', 22000, 2000, 'N', 'MEAL'); // 비용 22,000
      await card('vpl-c3', '2026-09-12', 5500, 500, 'Y', 'ENTERTAIN'); // 비용 5,000
      await card('vpl-c4', '2026-09-13', 3300, 300, 'N', null); // 미지정 3,300
      const cash = (id, dir, date, amount, item) =>
        c.query(`INSERT INTO public.tb_s050_cash_txns (id, org_id, file_id, use_date, description, vendor_name_src, direction, amount,
            pay_method, item_code) VALUES ($1, $2, 'vpl-fx', $3::date, '지어낸 품명', NULL, $4, $5, 'CASH', $6::text)`,
        [id, ORG_A, date, dir, amount, item]);
      await cash('vpl-x1', 'S', '2026-09-14', 70000, null);
      await cash('vpl-x2', 'P', '2026-09-15', 8000, 'UNKNOWN');
      await cash('vpl-x3', 'P', '2026-09-16', 4000, null);
      const pay = (id, date, item, amount) =>
        c.query(`INSERT INTO public.tb_s050_tax_payments (id, org_id, file_id, kind, pay_date, tax_item_src, pay_no, amount, penalty_amount)
          VALUES ($1, $2, 'vpl-fn', 'NTAX', $3::date, $4, $5, $6, 0)`, [id, ORG_A, date, item, `VPL-${id}`, amount]);
      await pay('vpl-n1', '2026-09-10', '근로소득세(갑)', 100000); // 비용 아님(코드 이름)
      await pay('vpl-n2', '2026-09-25', '지어낸 세목', 30000);
      const loan = (id, date, tp, p, i, fe) =>
        c.query(`INSERT INTO public.tb_s050_loan_txns (id, org_id, file_id, bank_code, loan_no_last4, txn_date, txn_tp, txn_type_src,
            principal_amount, interest_amount, fee_amount, balance) VALUES ($1, $2, 'vpl-fo', '020', '5678', $3::date, $4, '지어낸 거래', $5, $6, $7, 0)`,
        [id, ORG_A, date, tp, p, i, fe]);
      await loan('vpl-o1', '2026-09-01', 'D', 10000000, 0, 5000);
      await loan('vpl-o2', '2026-09-25', 'R', 1000000, 40000, 0);
      await c.query(`INSERT INTO public.tb_s050_social_ins (id, org_id, file_id, notice_month, ins_tp, member_name_src, notice_amount)
        VALUES ('vpl-so', $1, 'vpl-fso', '2026-09-01', 'HI', '지어낸 갑', 100000)`, [ORG_A]);

      // ── 회사 A ──
      await applyCompanyScope(c, tenant(ORG_A));
      const r = await plOp(c, ORG_A, MONTH);
      const d = r.ok ? r.data.pl.detail : null;
      check('L1', '번 돈 — 매출 계산서 공급가액 1,000,000 · 현금 매출 70,000(8월 줄 빠짐)',
        d && lines(d.income) === 'SALES_INVOICE=1000000 CASH_SALES=70000' && d.incomeTotal === 1070000, d ? lines(d.income) : r);
      check('L2', '★ 비용 — 항목 코드 순서(월세 · 식대 · 접대비 · 잘 모름) · 카드 공제 줄은 세액 뺌 · 세금 · 대출 이자 · 대출 수수료 · 미지정 57,300(11-06)',
        d && lines(d.expense) ===
          'ITEM:RENT=200000 ITEM:MEAL=32000 ITEM:ENTERTAIN=5000 ITEM:UNKNOWN=8000 TAX=30000 LOAN_INTEREST=40000 LOAN_FEE=5000 UNASSIGNED=57300' &&
          d.expense[0].label === '사무실 월세' && d.expense.find((l) => l.key === 'TAX').note === '지어낸 세목',
        d ? lines(d.expense) : r);
      check('L3', '★ 4대보험 · 비용 아닌 세목(근로소득세(갑)) · 대출 원금은 비용에 없다 — 합계 377,300(미지정 포함) · 이익 692,700',
        d && d.expenseTotal === 377300 && d.profit === 692700, d ? { total: d.expenseTotal, profit: d.profit } : r);
      check('L4', '★ 미지정 건 — 계산서 · 카드 · 현금 매입 중 항목 빈 셋 · 57,300 / 사업과 무관 30,000 따로',
        d && d.unassigned.count === 3 && d.unassigned.amount === 57300 && d.nonBiz === 30000, d ? { u: d.unassigned, nonBiz: d.nonBiz } : r);
      const by = r.ok ? Object.fromEntries(r.data.pl.months.map((m) => [m.month, m])) : {};
      check('L5', '막대 — 2026년 12칸 · 8월 번 돈 500,000 · 9월 = 내역 합계 · 10월 자료 없음',
        r.ok && r.data.pl.months.length === 12 && by['2026-08'].income === 500000 && by['2026-08'].hasData &&
        by['2026-09'].income === 1070000 && by['2026-09'].expense === 377300 && !by['2026-10'].hasData, by['2026-09']);
      const db = (await c.query(`SELECT sum(supply_amount)::int s FROM public.tb_s050_invoices
        WHERE org_id = $1 AND direction = 'S' AND write_date >= '2026-09-01' AND write_date < '2026-10-01'`, [ORG_A])).rows[0];
      const bizName = (await c.query(`SELECT name FROM public.tb_s080_codes_line
        WHERE build_id = '1' AND category = 'TAX_BIZ_TP' AND use_tp = '000' AND code = 'C'`)).rows[0]?.name;
      check('L6', '매출 줄이 DB 합과 같다 · 사업자 유형 이름 = 코드 TAX_BIZ_TP C 의 이름', d && d.income[0].amount === db.s &&
        bizName && r.data.bizTypeName === bizName, { db: db.s, name: r.ok ? r.data.bizTypeName : null, bizName });

      // ── 회사별 막기 ──
      await applyCompanyScope(c, tenant(ORG_B));
      const b = await plOp(c, ORG_B, MONTH);
      check('L7', '★ 회사 B — 자기 매출 777 만 · A 의 줄 없음 · 설정 없음(사업자 유형 이름 null)',
        b.ok && b.data.pl.detail.incomeTotal === 777 && b.data.pl.detail.expenseTotal === 0 && b.data.bizTypeName === null,
        b.ok ? b.data.pl.detail : b);
      await applyCompanyScope(c, OPERATOR);
      const op = await plOp(c, ORG_A, MONTH);
      check('L8', '★ 운영사 세션도 자기 단체만 — RLS 가 B 를 보여 줘도 A 의 번 돈 1,070,000',
        op.ok && op.data.pl.detail.incomeTotal === 1070000, op.ok ? op.data.pl.detail.incomeTotal : op);
    } finally {
      await c.query('ROLLBACK');
    }

    // ★ 스코프(set_config … true)는 트랜잭션 안에서만 산다 — 밖에서 세면 RLS 가 0줄을 줘서 늘 통과한다
    await c.query('BEGIN');
    try {
      await applyCompanyScope(c, OPERATOR);
      const cnt = async (t) => (await c.query(`SELECT count(*)::int n FROM public.${t} WHERE org_id = ANY($1)`, [[ORG_A, ORG_B]])).rows[0].n;
      const tables = ['tb_s050_upload_files', 'tb_s050_invoices', 'tb_s050_card_txns', 'tb_s050_cash_txns', 'tb_s050_tax_payments',
        'tb_s050_loan_txns', 'tb_s050_social_ins', 'tb_s050_settings', 'tb_s050_vendors'];
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
