/**
 * 세무 세금 납부 · 4대보험 · 대출내역(s050300040 · 050 · 060 — 2026-11-08 메뉴 셋으로 나눔, P17~P19) 검증 — **앱이 실제 DB 에서** 하는 일만 잰다(1-7, 2026-11-02).
 *
 * 사용: npm run verify:tax-payments   (= npx tsx scripts/verify-tax-payments.js)
 *
 * ★★ 표 구조 · 권한 · CHECK 는 `scripts/verify-214.js` 가 잰다. 여기는 그 위의 읽기다:
 *    탭마다 줄 · 줄 수 · 날짜 최신순 · 비용 여부(코드 이름) · 기간 직접 지정 · 4대보험 고지 연월 거르기 · 대출 요약 ·
 *    파일 거르기(탭을 파일 종류로) · 이 화면 자료가 아닌 파일 404 · 회사별 막기 · 합계가 DB 와 같은지 · 엑셀.
 * ★★ API 의 풀(`db/pool.ts`)로 접속한다 — erp_app. 라우트가 쓰는 처리(`routes/taxPayments.ts` 의 …Op)를 그대로 부른다.
 * ★ 시험 줄은 지어낸 값으로 **한 트랜잭션 안에서 넣고 ROLLBACK 한다.** DB 에 남는 것이 없다(마지막 Z1 이 센다).
 *   시험 단체는 verify-201 · 203 과 같은 대역(990001 · 990002).
 *
 * 종료코드: 0 = 전부 통과 / 1 = 실패 있음 / 2 = 실행 실패
 */
import * as XLSX from 'xlsx';
import { pool, closePool } from '../packages/api/src/db/pool.ts';
import { applyCompanyScope } from '../packages/api/src/db/withCompanyScope.ts';
import { exportPaymentsOp, listPaymentsOp } from '../packages/api/src/routes/taxPayments.ts';
import { loanSummary, payTotals } from '../packages/shared/src/domain/tax-payments.ts';

const ORG_A = 990001;
const ORG_B = 990002;
const MONTH = '2026-09';
const results = [];
const check = (id, what, cond, note = '') =>
  results.push({ 항목: id, 내용: what, 결과: cond ? '통과' : '실패', 비고: typeof note === 'string' ? note : JSON.stringify(note) });

const tenant = (orgId) => ({ role: 'tenant', companyId: null, orgId });
const OPERATOR = { role: 'operator', companyId: null, orgId: ORG_A };
const query = (over = {}) => ({ month: MONTH, tab: 'NTAX', from: null, to: null, fileId: null, ...over });
const ids = (rows) => rows.map((r) => r.id).join();

async function main() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    try {
      // ── 시험 줄 — 운영사 세션으로 두 단체에 넣는다(지어낸 값) ──
      await applyCompanyScope(c, OPERATOR);
      const file = (id, org, kind, mapId, h, extra = {}) =>
        c.query(`INSERT INTO public.tb_s050_upload_files (id, org_id, kind, map_id, direction, file_name, file_hash, file_size,
            row_count, inserted_count, social_ins_tp, notice_month)
          VALUES ($1, $2, $3, $4, $5, $6, $7, 1000, 3, 3, $8, $9::date)`,
        [id, org, kind, mapId, kind === 'INVOICE' ? 'P' : null, `${id}.xls`, h.repeat(64), extra.insTp ?? null, extra.month ?? null]);
      await file('vpay-fn', ORG_A, 'NTAX', 'HOMETAX_NTAX_PAY', '1');
      await file('vpay-fl', ORG_A, 'LTAX', 'WETAX_LTAX_PAY', '2');
      await file('vpay-fs', ORG_A, 'SOCIAL', 'SOCIAL_HI', '3', { insTp: 'HI', month: '2026-09-01' });
      await file('vpay-fs8', ORG_A, 'SOCIAL', 'SOCIAL_NP', '4', { insTp: 'NP', month: '2026-08-01' });
      await file('vpay-fo', ORG_A, 'LOAN', 'BANK_020_LOAN', '5');
      await file('vpay-fi', ORG_A, 'INVOICE', 'HOMETAX_TAX_INVOICE', '6');
      await file('vpay-fb', ORG_B, 'NTAX', 'HOMETAX_NTAX_PAY', '7');

      const pay = (id, org, fileId, kind, date, item, amount, penalty, belong = null, method = null) =>
        c.query(`INSERT INTO public.tb_s050_tax_payments (id, org_id, file_id, kind, pay_date, tax_item_src, pay_no, amount,
            penalty_amount, belong_month, office_src, pay_method_src)
          VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10::date, '지어낸 관서', $11)`,
        [id, org, fileId, kind, date, item, `VPAY-${id}`, amount, penalty, belong, method]);
      await pay('vpay-n1', ORG_A, 'vpay-fn', 'NTAX', '2026-09-10', '근로소득세(갑)', 100000, 0);
      await pay('vpay-n2', ORG_A, 'vpay-fn', 'NTAX', '2026-09-25', '지어낸 세목', 30000, 1000);
      await pay('vpay-n8', ORG_A, 'vpay-fn', 'NTAX', '2026-08-10', '근로소득세(갑)', 90000, 0); // 같은 파일 · 8월 줄
      await pay('vpay-l1', ORG_A, 'vpay-fl', 'LTAX', '2026-09-10', '지방소득세 특별징수분', 10000, null, '2026-08-01', '계좌이체');
      await pay('vpay-nb', ORG_B, 'vpay-fb', 'NTAX', '2026-09-10', '근로소득세(갑)', 777, 0);

      const soc = (id, fileId, month, tp, name, amount, base) =>
        c.query(`INSERT INTO public.tb_s050_social_ins (id, org_id, file_id, notice_month, ins_tp, member_name_src, member_no_last4,
            notice_amount, pay_base) VALUES ($1, $2, $3, $4::date, $5, $6, '1234', $7, $8)`,
        [id, ORG_A, fileId, month, tp, name, amount, base]);
      await soc('vpay-s1', 'vpay-fs', '2026-09-01', 'HI', '지어낸 갑', 100000, 3000000);
      await soc('vpay-s2', 'vpay-fs', '2026-09-01', 'LTC', '지어낸 갑', 13000, null);
      await soc('vpay-s3', 'vpay-fs', '2026-09-01', 'HI', '지어낸 을', 50000, 1500000);
      await soc('vpay-s8', 'vpay-fs8', '2026-08-01', 'NP', '지어낸 갑', 135000, null);

      const loan = (id, date, tp, p, i, fe, b, last4 = '5678') =>
        c.query(`INSERT INTO public.tb_s050_loan_txns (id, org_id, file_id, bank_code, loan_no_last4, txn_date, txn_tp, txn_type_src,
            principal_amount, interest_amount, fee_amount, balance) VALUES ($1, $2, 'vpay-fo', '020', $3, $4::date, $5, '지어낸 거래', $6, $7, $8, $9)`,
        [id, ORG_A, last4, date, tp, p, i, fe, b]);
      await loan('vpay-o1', '2026-09-01', 'D', 10000000, 0, 5000, 10000000);
      await loan('vpay-o2', '2026-09-25', 'R', 1000000, 40000, 0, 9000000);
      await loan('vpay-o8', '2026-08-25', 'R', 0, 30000, 0, 0, '9999');

      // ── 국세 · 지방세 ──
      await applyCompanyScope(c, tenant(ORG_A));
      const n = await listPaymentsOp(c, ORG_A, query());
      check('P1', '★ 국세 탭 — 그 달 국세 줄만(8월 · 지방세 · 남의 단체 빠짐) · 납부일 최신순',
        n.ok && ids(n.data.pays) === 'vpay-n2,vpay-n1' && n.data.social.length === 0 && n.data.loans.length === 0,
        n.ok ? ids(n.data.pays) : n);
      const n1 = n.ok ? n.data.pays.find((r) => r.id === 'vpay-n1') : null;
      const n2 = n.ok ? n.data.pays.find((r) => r.id === 'vpay-n2') : null;
      check('P2', '★ 비용 여부 — 코드 「비용이 아닌 세목」 이름이면 비용 아님(근로소득세(갑)), 목록에 없으면 비용 · 가산금 그대로',
        n1?.expense === false && n2?.expense === true && n2.penalty === 1000 && n1.penalty === 0, { n1, n2 });
      check('P3', '탭마다 줄 수 — 같은 달(국세 2 · 지방세 1 · 4대보험 3 · 대출 2)',
        n.ok && JSON.stringify(n.data.counts) === JSON.stringify({ NTAX: 2, LTAX: 1, SOCIAL: 3, LOAN: 2 }), n.ok ? n.data.counts : n);
      const sumDb = (await c.query(`SELECT sum(amount)::int a, sum(penalty_amount)::int p FROM public.tb_s050_tax_payments
        WHERE org_id = $1 AND kind = 'NTAX' AND pay_date >= '2026-09-01' AND pay_date < '2026-10-01'`, [ORG_A])).rows[0];
      const tot = n.ok ? payTotals(n.data.pays) : null;
      check('P4', '합계 — 화면 합계(전체 · 가산금)가 DB 합과 같다 · 비용 30,000 · 비용 아님 100,000',
        tot?.amount === sumDb.a && tot.penalty === sumDb.p && tot.expense === 30000 && tot.nonExpense === 100000, { tot, sumDb });

      const l = await listPaymentsOp(c, ORG_A, query({ tab: 'LTAX' }));
      const l1 = l.ok ? l.data.pays[0] : null;
      check('P5', '지방세 탭 — 귀속 연월 YYYY-MM · 납부방법 · 가산금 없음(null) · 비용 아님(목록 이름)',
        l.ok && l.data.pays.length === 1 && l1.belongMonth === '2026-08' && l1.payMethod === '계좌이체' && l1.penalty === null &&
        l1.expense === false, l1);

      const nr = await listPaymentsOp(c, ORG_A, query({ from: '2026-08-01', to: '2026-09-30' }));
      check('P6', '기간 직접 지정 — 8 · 9월 국세 줄 셋 · 줄 수도 같은 기간',
        nr.ok && ids(nr.data.pays) === 'vpay-n2,vpay-n1,vpay-n8' && nr.data.counts.NTAX === 3, nr.ok ? ids(nr.data.pays) : nr);

      // ── 4대보험 ──
      const s = await listPaymentsOp(c, ORG_A, query({ tab: 'SOCIAL' }));
      check('P7', '★ 4대보험 탭 — 고지 연월 9월 줄만 · 보험 종류(코드 순) · 이름 순 · 끝 4자리만 · 코드 이름 다섯',
        s.ok && ids(s.data.social) === 'vpay-s1,vpay-s3,vpay-s2' && s.data.social.every((r) => r.noticeMonth === '2026-09' && r.memberLast4 === '1234') &&
        s.data.codes.socialIns.length === 5, s.ok ? ids(s.data.social) : s);
      const sr = await listPaymentsOp(c, ORG_A, query({ tab: 'SOCIAL', from: '2026-08-20', to: '2026-09-03' }));
      check('P8', '★ 4대보험 기간 직접 지정은 고지 연월로(결정 ⑥) — 8월 20일 ~ 9월 3일이면 8월 · 9월 고지 모두',
        sr.ok && sr.data.social.length === 4 && sr.data.counts.SOCIAL === 4, sr.ok ? sr.data.counts : sr);

      // ── 대출 ──
      const o = await listPaymentsOp(c, ORG_A, query({ tab: 'LOAN' }));
      const sum = o.ok ? loanSummary(o.data.loans) : [];
      check('P9', '★ 대출 탭 — 그 달 거래 최신순 · 요약 실행 원금 10,000,000 · 상환 원금 1,000,000 · 이자 40,000 · 수수료 5,000(잔액 없음)',
        o.ok && ids(o.data.loans) === 'vpay-o2,vpay-o1' && sum.length === 1 && sum[0].draw === 10000000 && sum[0].repay === 1000000 &&
        sum[0].interest === 40000 && sum[0].fee === 5000 && !('balance' in sum[0]) && o.data.codes.banks.some((b) => b.code === '020'),
        { rows: o.ok ? ids(o.data.loans) : o, sum });

      // ── ⑥ 메뉴 셋(2026-11-08) — 세금 전체 · 보험 거르기 ──
      const pa = await listPaymentsOp(c, ORG_A, query({ tab: 'PAY' }));
      check('P17', '★ 세금 전체(PAY) — 그 달 국세 · 지방세 한 목록 · 납부일 최신순(같은 날은 국세 먼저) · 줄마다 구분(kind) · 선택지 코드 TAX_PAY_SRC 국세 · 지방세',
        pa.ok && ids(pa.data.pays) === 'vpay-n2,vpay-n1,vpay-l1' && pa.data.pays.map((r) => r.kind).join() === 'NTAX,NTAX,LTAX' &&
        pa.data.codes.paySrcs.map((x) => `${x.code}=${x.name}`).join() === 'NTAX=국세,LTAX=지방세',
        pa.ok ? { pays: ids(pa.data.pays), srcs: pa.data.codes.paySrcs } : pa);
      const hi = await listPaymentsOp(c, ORG_A, query({ tab: 'SOCIAL', ins: 'HI' }));
      const np = await listPaymentsOp(c, ORG_A, query({ tab: 'SOCIAL', ins: 'NP' }));
      check('P18', '★ 4대보험 보험 거르기 — 건강보험은 장기요양까지(셋) · 국민연금은 9월 고지 없음(0줄)',
        hi.ok && ids(hi.data.social) === 'vpay-s1,vpay-s3,vpay-s2' && np.ok && np.data.social.length === 0,
        { hi: hi.ok ? ids(hi.data.social) : hi, np: np.ok ? np.data.social.length : np });
      const xp = await exportPaymentsOp(c, ORG_A, query({ tab: 'PAY' }));
      const xpw = xp.ok ? XLSX.read(xp.data.bytes, { type: 'array' }) : null;
      const rowsOf = (nm) => (xpw ? XLSX.utils.sheet_to_json(xpw.Sheets[nm], { header: 1 }).length : -1);
      check('P19', '엑셀 세금 전체 — 이름 세금납부_2026-09.xlsx · 시트 국세(제목 + 2) · 지방세(제목 + 1)',
        xp.ok && xp.data.fileName === '세금납부_2026-09.xlsx' && JSON.stringify(xpw.SheetNames) === JSON.stringify(['국세', '지방세']) &&
        rowsOf('국세') === 3 && rowsOf('지방세') === 2, xp.ok ? { name: xp.data.fileName, sheets: xpw.SheetNames } : xp);

      // ── 파일로 들어오기 ──
      const f = await listPaymentsOp(c, ORG_A, query({ tab: 'NTAX', fileId: 'vpay-fo' }));
      check('P10', '★ 파일 — 탭을 파일 종류(대출)로 바꾸고 그 파일 줄만(달과 상관없이 셋) · 다른 탭 수 0 · 파일 띠 이름',
        f.ok && f.data.query.tab === 'LOAN' && f.data.loans.length === 3 && f.data.counts.LOAN === 3 && f.data.counts.NTAX === 0 &&
        f.data.file?.fileName === 'vpay-fo.xls', f.ok ? { tab: f.data.query.tab, counts: f.data.counts, file: f.data.file } : f);
      const fi = await listPaymentsOp(c, ORG_A, query({ fileId: 'vpay-fi' }));
      const fb = await listPaymentsOp(c, ORG_A, query({ fileId: 'vpay-fb' }));
      const fx = await listPaymentsOp(c, ORG_A, query({ fileId: 'vpay-none' }));
      check('P11', '이 화면 자료가 아닌 파일(계산서) · 남의 단체 파일 · 없는 파일은 404',
        !fi.ok && fi.status === 404 && !fb.ok && fb.status === 404 && !fx.ok && fx.status === 404, { fi, fb, fx });

      // ── 엑셀 ──
      const read = (bytes) => {
        const wb = XLSX.read(bytes, { type: 'array' });
        return wb.SheetNames.map((nm) => [nm, XLSX.utils.sheet_to_json(wb.Sheets[nm], { header: 1, defval: null })]);
      };
      const xn = await exportPaymentsOp(c, ORG_A, query());
      const sn = xn.ok ? read(xn.data.bytes) : [];
      check('P12', '엑셀 국세 — 이름 국세납부_2026-09.xlsx · 시트 「국세」 하나 · 화면과 같은 줄 수(제목 + 2)',
        xn.ok && xn.data.fileName === '국세납부_2026-09.xlsx' && sn.length === 1 && sn[0][0] === '국세' && sn[0][1].length === 3,
        xn.ok ? { name: xn.data.fileName, sheets: sn.map(([nm, r]) => `${nm}:${r.length}`) } : xn);
      const xs = await exportPaymentsOp(c, ORG_A, query({ tab: 'SOCIAL', from: '2026-08-01', to: '2026-09-30' }));
      const ss = xs.ok ? read(xs.data.bytes) : [];
      const totalRow = ss[1]?.[1]?.at(-1);
      check('P13', '★ 엑셀 4대보험 — 이름 4대보험_2026-08~2026-09.xlsx · 사람별 + 「보험 종류별 합계」 시트 · 합계 줄 = 4명 · 298,000',
        xs.ok && xs.data.fileName === '4대보험_2026-08~2026-09.xlsx' && ss.length === 2 && ss[0][1].length === 5 &&
        ss[1][0] === '보험 종류별 합계' && totalRow?.[0] === '합계' && totalRow[1] === 4 && totalRow[2] === 298000,
        xs.ok ? { name: xs.data.fileName, sheets: ss.map(([nm, r]) => `${nm}:${r.length}`), totalRow } : xs);
      const xo = await exportPaymentsOp(c, ORG_A, query({ fileId: 'vpay-fo' }));
      check('P14', '엑셀 파일로 — 대출_2026-09.xlsx · 그 파일 세 줄', xo.ok && xo.data.fileName === '대출_2026-09.xlsx' &&
        read(xo.data.bytes)[0][1].length === 4, xo.ok ? xo.data.fileName : xo);

      // ── 회사별 막기 ──
      await applyCompanyScope(c, tenant(ORG_B));
      const b = await listPaymentsOp(c, ORG_B, query());
      const bf = await listPaymentsOp(c, ORG_B, query({ fileId: 'vpay-fo' }));
      check('P15', '★ 회사 B — 자기 국세 한 줄만 · A 의 줄 수 0 · A 의 파일은 404',
        b.ok && ids(b.data.pays) === 'vpay-nb' && b.data.counts.SOCIAL === 0 && b.data.counts.LOAN === 0 && !bf.ok && bf.status === 404,
        b.ok ? { pays: ids(b.data.pays), counts: b.data.counts, bf: bf.ok ? 'ok' : bf.status } : b);
      await applyCompanyScope(c, OPERATOR);
      const op = await listPaymentsOp(c, ORG_A, query());
      check('P16', '★ 운영사 세션도 자기 단체만 — RLS 가 B 를 보여 줘도 A 의 국세 두 줄만',
        op.ok && ids(op.data.pays) === 'vpay-n2,vpay-n1', op.ok ? ids(op.data.pays) : op);
    } finally {
      await c.query('ROLLBACK');
    }

    // ★ 스코프(set_config … true)는 트랜잭션 안에서만 산다 — 밖에서 세면 RLS 가 0줄을 줘서 늘 통과한다
    await c.query('BEGIN');
    try {
      await applyCompanyScope(c, OPERATOR);
      const cnt = async (t) => (await c.query(`SELECT count(*)::int n FROM public.${t} WHERE org_id = ANY($1)`, [[ORG_A, ORG_B]])).rows[0].n;
      const [f, p, s, l] = [await cnt('tb_s050_upload_files'), await cnt('tb_s050_tax_payments'), await cnt('tb_s050_social_ins'), await cnt('tb_s050_loan_txns')];
      check('Z1', '롤백 후 시험 줄 0 (운영사 스코프로 센다)', f === 0 && p === 0 && s === 0 && l === 0,
        `파일 ${f} · 납부 ${p} · 4대보험 ${s} · 대출 ${l}`);
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
