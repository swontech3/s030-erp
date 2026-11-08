/**
 * 세무 세무사 전달 서류(s050500010) 검증 — **앱이 실제 DB 에서** 하는 일만 잰다(1-9, 2026-11-07).
 *
 * 사용: npm run verify:tax-handoff   (= npx tsx scripts/verify-tax-handoff.js)
 *
 * ★★ 주소 · 본문 · 보내기 흐름 하나하나는 shared `tax-handoff.test.ts` · api `taxHandoff.test.ts` 가 잰다. 여기는 그 위의 읽기다:
 *    시트 아홉 이름 · 순서 · 줄 수가 **각 화면과 같은지**(항목 지정 「이번 달 자료 전체」 · 세금 · 4대보험 · 대출 — 같은 기간),
 *    은행 · 이체 줄(세는 범위 · 별칭 또는 끝 4자리 · 전체 번호 안 나감) · 미지정 건 수(부가세 조회와 같음) · 엑셀 ·
 *    ★ 다른 회사 줄이 안 들어가는지(운영사 세션도) · 최종 발송 회사별 막기 · 보내기(가짜 메일 — 성공만 최종 발송을 덮어쓰고 실패는 남기지 않음, 11-08 ⑧ 224).
 * ★★ API 의 풀(`db/pool.ts`)로 접속한다 — erp_app. 라우트가 쓰는 처리(`routes/taxHandoff.ts` 의 handoffOp · sendHandoff)를 그대로 부른다.
 * ★ 시험 줄은 지어낸 값으로 **한 트랜잭션 안에서 넣고 ROLLBACK 한다.** DB 에 남는 것이 없다(마지막 Z1 이 센다).
 *   시험 단체는 verify-201 · 203 과 같은 대역(990001 · 990002). ★ 메일은 실제로 보내지 않는다(가짜 Mailer).
 *
 * 종료코드: 0 = 전부 통과 / 1 = 실패 있음 / 2 = 실행 실패
 */
import * as XLSX from 'xlsx';
import { pool, closePool } from '../packages/api/src/db/pool.ts';
import { applyCompanyScope } from '../packages/api/src/db/withCompanyScope.ts';
import { upsertHandoffLast } from '../packages/api/src/db/taxHandoff.ts';
import { buildXlsx } from '../packages/api/src/lib/xlsxExport.ts';
import { handoffOp, sendHandoff } from '../packages/api/src/routes/taxHandoff.ts';
import { listClassifyOp } from '../packages/api/src/routes/taxClassify.ts';
import { listPaymentsOp } from '../packages/api/src/routes/taxPayments.ts';
import { vatOp } from '../packages/api/src/routes/taxVat.ts';

const ORG_A = 990001;
const ORG_B = 990002;
const MONTH = '2026-09';
/** 이번 달 고정 — 신고 기간 선택지가 날짜에 따라 달라지지 않게(부가세 조회 검증과 같다). */
const THIS_MONTH = '2026-11';
const ACCT_A = '1002123456789'; // 별칭 있음
const ACCT_A2 = '110987654321'; // 별칭 없음 → 끝 4321
const ACCT_B = '9990001112223';
const results = [];
const check = (id, what, cond, note = '') =>
  results.push({ 항목: id, 내용: what, 결과: cond ? '통과' : '실패', 비고: typeof note === 'string' ? note : JSON.stringify(note) });

const tenant = (orgId) => ({ role: 'tenant', companyId: null, orgId });
const OPERATOR = { role: 'operator', companyId: null, orgId: ORG_A };
const Q = { month: MONTH, tp: 'T', periodId: null };
const OPTS = { mailReady: true, thisMonth: THIS_MONTH };
const session = (orgId) => ({ erpSid: 'v', s020MemberId: 7, s020OrgId: orgId, companyId: null, role: 'tenant', expiresAt: new Date(), lastActiveAt: null });

async function main() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    try {
      // ── 시험 줄 — 운영사 세션으로 두 단체에 넣는다(지어낸 값) ──
      await applyCompanyScope(c, OPERATOR);
      const settings = (org, emails) => c.query(`INSERT INTO public.tb_s050_settings (org_id, biz_type, withholding_cycle, tax_emails, unused_kinds)
        VALUES ($1, 'C', 'M', $2::jsonb, '{}')`, [org, JSON.stringify(emails)]);
      await settings(ORG_A, [{ name: '김세무', email: 'tax@example.com' }, { name: null, email: 'ceo@example.com' }]);
      await settings(ORG_B, [{ name: null, email: 'b-tax@example.com' }]);
      const acct = (id, org, number, alias) => c.query(`INSERT INTO public.tb_s050_fin_accounts (id, org_id, kind, bank_code, number, alias)
        VALUES ($1, $2, 'B', '004', $3, $4)`, [id, org, number, alias]);
      await acct('vho-a1', ORG_A, ACCT_A, '지어낸 운영 통장');
      await acct('vho-a2', ORG_A, ACCT_A2, null);
      await acct('vho-b1', ORG_B, ACCT_B, 'B 회사 통장');

      const file = (id, org, kind, mapId, h, x = {}) =>
        c.query(`INSERT INTO public.tb_s050_upload_files (id, org_id, kind, map_id, direction, file_name, file_hash, file_size,
            row_count, inserted_count, bank_file_tp, account_no, bank_code)
          VALUES ($1, $2, $3, $4, $5, $6, $7, 1000, 3, 3, $8, $9, $10)`,
        [id, org, kind, mapId, x.dir ?? null, `${id}.xls`, h.repeat(64), x.tp ?? null, x.acct ?? null, x.bank ?? null]);
      await file('vho-fp', ORG_A, 'INVOICE', 'HOMETAX_TAX_INVOICE', '1', { dir: 'P' });
      await file('vho-fs', ORG_A, 'INVOICE', 'HOMETAX_TAX_INVOICE', '2', { dir: 'S' });
      await file('vho-fc', ORG_A, 'CARD', 'HOMETAX_BIZ_CARD', '3');
      await file('vho-fx', ORG_A, 'CASH', 'TAX_CASH_STD', '4');
      await file('vho-ft', ORG_A, 'BANK', 'BANK_004_TXN', '5', { tp: 'TXN', acct: ACCT_A, bank: '004' });
      await file('vho-fw', ORG_A, 'BANK', 'BANK_020_XFER', '6', { tp: 'XFER', acct: ACCT_A, bank: '020' });
      await file('vho-fn', ORG_A, 'NTAX', 'HOMETAX_NTAX_PAY', '7');
      await file('vho-fl', ORG_A, 'LTAX', 'WETAX_LTAX_PAY', '8');
      await file('vho-fo', ORG_A, 'LOAN', 'BANK_020_LOAN', '9');
      await file('vho-bs', ORG_B, 'INVOICE', 'HOMETAX_TAX_INVOICE', 'a', { dir: 'S' });
      await file('vho-bt', ORG_B, 'BANK', 'BANK_004_TXN', 'b', { tp: 'TXN', acct: ACCT_B, bank: '004' });
      await file('vho-bn', ORG_B, 'NTAX', 'HOMETAX_NTAX_PAY', 'c');

      for (const [id, org] of [['vho-va', ORG_A], ['vho-vb', ORG_B]]) {
        await c.query(`INSERT INTO public.tb_s050_vendors (id, org_id, name, biz_no, vendor_tp, first_kind, first_direction)
          VALUES ($1, $2, $3, NULL, 'M', 'INVOICE', 'S')`, [id, org, org === ORG_A ? '지어낸 거래처' : 'B회사거래처표시']);
      }
      const inv = (id, org, fileId, vendorId, dir, date, item = null) =>
        c.query(`INSERT INTO public.tb_s050_invoices (id, org_id, file_id, vendor_id, direction, approval_no, write_date,
            partner_name_src, partner_biz_no_src, supply_amount, tax_amount, total_amount, inv_class, inv_type, item_code)
          VALUES ($1, $2, $3, $4, $5, $6, $7::date, '지어낸 거래처', '9900000011', 10000, 1000, 11000, 'TAX', 'GEN', $8::text)`,
        [id, org, fileId, vendorId, dir, `V-HO-${id}`, date, item]);
      await inv('vho-p1', ORG_A, 'vho-fp', 'vho-va', 'P', '2026-07-02');
      await inv('vho-p2', ORG_A, 'vho-fp', 'vho-va', 'P', '2026-09-30', 'MEAL');
      await inv('vho-p0', ORG_A, 'vho-fp', 'vho-va', 'P', '2026-06-30'); // 2분기 — 빠진다
      await inv('vho-s1', ORG_A, 'vho-fs', 'vho-va', 'S', '2026-08-15');
      await inv('vho-sb', ORG_B, 'vho-bs', 'vho-vb', 'S', '2026-08-15');
      const card = (id, date, item) =>
        c.query(`INSERT INTO public.tb_s050_card_txns (id, org_id, file_id, vendor_id, card_last4, use_date, merchant_name_src,
            merchant_biz_no_src, supply_amount, tax_amount, nontax_amount, total_amount, vat_deduct, item_code)
          VALUES ($1, $2, 'vho-fc', NULL, '4821', $3::date, '지어낸 가맹점', NULL, 1000, 100, 0, 1100, 'Y', $4::text)`,
        [id, ORG_A, date, item]);
      await card('vho-c1', '2026-07-10', null);
      await card('vho-c2', '2026-08-10', 'MEAL');
      await card('vho-c3', '2026-07-11', null);
      await c.query(`INSERT INTO public.tb_s050_cash_txns (id, org_id, file_id, use_date, description, vendor_name_src, direction, amount,
          pay_method, item_code) VALUES ('vho-x1', $1, 'vho-fx', '2026-07-14', '지어낸 품명', NULL, 'P', 4000, 'CASH', NULL)`, [ORG_A]);

      const txn = (id, org, fileId, acctNo, at, inn, out) =>
        c.query(`INSERT INTO public.tb_s050_bank_txns (id, org_id, file_id, account_no, bank_code, txn_at, description_src, counterparty_src,
            my_note_src, memo_src, in_amount, out_amount, balance)
          VALUES ($1, $2, $3, $4, '004', $5::timestamp, '지어낸 적요', $6, NULL, '지어낸 메모', $7, $8, 50000)`,
        [id, org, fileId, acctNo, at, org === ORG_A ? '지어낸 상대' : 'B회사상대표시', inn, out]);
      await txn('vho-t1', ORG_A, 'vho-ft', ACCT_A, '2026-07-01 00:00:00', 9000, 0);
      await txn('vho-t2', ORG_A, 'vho-ft', ACCT_A2, '2026-08-05 13:00:00', 0, 3000);
      await txn('vho-t3', ORG_A, 'vho-ft', ACCT_A, '2026-09-30 23:59:59', 0, 7000);
      await txn('vho-t0', ORG_A, 'vho-ft', ACCT_A, '2026-10-01 00:00:00', 0, 1); // 4분기 — 빠진다
      await txn('vho-tb', ORG_B, 'vho-bt', ACCT_B, '2026-08-05 13:00:00', 0, 5555);
      await c.query(`UPDATE public.tb_s050_bank_txns SET xfer_file_id = 'vho-fw', xfer_bank_src = '지어낸은행', xfer_account_last4 = '1111',
          xfer_holder_src = '지어낸 받는분', xfer_to_memo_src = '받는 글', xfer_from_memo_src = '보낸 글' WHERE id = 'vho-t2'`);

      const pay = (id, org, fileId, kind, date) =>
        c.query(`INSERT INTO public.tb_s050_tax_payments (id, org_id, file_id, kind, pay_date, tax_item_src, pay_no, amount,
            penalty_amount, belong_month, office_src, pay_method_src)
          VALUES ($1, $2, $3, $4, $5::date, '부가가치세', $6, 50000, $7, NULL, '지어낸 관서', $8)`,
        [id, org, fileId, kind, date, `VHO-${id}`, kind === 'NTAX' ? 0 : null, kind === 'LTAX' ? '지어낸 방법' : null]);
      await pay('vho-n1', ORG_A, 'vho-fn', 'NTAX', '2026-07-25');
      await pay('vho-l1', ORG_A, 'vho-fl', 'LTAX', '2026-08-31');
      await pay('vho-l2', ORG_A, 'vho-fl', 'LTAX', '2026-09-01');
      await pay('vho-nb', ORG_B, 'vho-bn', 'NTAX', '2026-07-25');
      await c.query(`INSERT INTO public.tb_s050_loan_txns (id, org_id, file_id, bank_code, loan_no_last4, txn_date, txn_tp, txn_type_src,
          principal_amount, interest_amount, fee_amount, balance)
        VALUES ('vho-o1', $1, 'vho-fo', '020', '5678', '2026-09-20', 'R', '지어낸 거래', 0, 3000, 0, 1000000)`, [ORG_A]);

      // ── 회사 A ──
      await applyCompanyScope(c, tenant(ORG_A));
      const r = await handoffOp(c, ORG_A, Q, OPTS);
      const d = r.ok ? r.data.response : null;
      check('T1', '★ 법인 9월 — 2026년 3분기 · 종류 T 부가세 납부(동작) · M 원천세 납부(준비 중) · 받는 사람은 세무 설정 메일 둘 · 파일 이름',
        d && d.period?.id === '2026-Q3' && d.query.periodId === '2026-Q3' && d.rangeLabel === '7~9월' &&
        JSON.stringify(d.tps.map((t) => [t.code, t.name, t.ready])) === JSON.stringify([['T', '부가세 납부', true], ['M', '원천세 납부', false]]) &&
        d.recipients.map((x) => x.email).join() === 'tax@example.com,ceo@example.com' && d.fileName === '세무자료_부가세_2026년3분기.xlsx',
        d ? { p: d.period?.id, tps: d.tps, to: d.recipients, f: d.fileName } : r);
      const counts = d ? Object.fromEntries(d.sheets.map((s) => [s.key, s.rows.length])) : {};
      check('T2', '★ 시트 아홉 — 이름 · 순서 그대로',
        d && d.sheets.map((s) => s.name).join() === '매입,매출,카드,은행거래내역,이체내역,현금,국세,지방세,대출', d ? d.sheets.map((s) => s.name) : r);

      // 각 화면과 같은 기간으로 센 줄 수
      const range = { from: '2026-07-01', to: '2026-09-30' };
      const cls = await listClassifyOp(c, ORG_A, { month: MONTH, view: 'all', kind: 'all', ...range, fileId: null });
      const k = cls.ok ? cls.data.counts.kinds : {};
      check('T3', '★ 매입 2 · 매출 1 · 카드 3 · 현금 1 — 항목 지정 「이번 달 자료 전체」(같은 기간) 칩 수와 같다(6월 줄 빠짐)',
        cls.ok && counts.P === k.P && counts.S === k.S && counts.CARD === k.CARD && counts.CASH === k.CASH &&
        counts.P === 2 && counts.S === 1 && counts.CARD === 3 && counts.CASH === 1, { sheets: counts, screen: k });
      const payCounts = {};
      for (const tab of ['NTAX', 'LTAX', 'LOAN']) {
        const p = await listPaymentsOp(c, ORG_A, { month: MONTH, tab, ...range, fileId: null });
        payCounts[tab] = p.ok ? p.data.counts[tab] : -1;
      }
      check('T4', '★ 국세 1 · 지방세 2 · 대출 1 — 세금 · 4대보험 · 대출 화면(같은 기간) 탭 수와 같다',
        counts.NTAX === payCounts.NTAX && counts.LTAX === payCounts.LTAX && counts.LOAN === payCounts.LOAN &&
        counts.NTAX === 1 && counts.LTAX === 2 && counts.LOAN === 1, { sheets: counts, screen: payCounts });
      const dbBank = (await c.query(`SELECT count(*)::int n, count(xfer_file_id)::int x FROM public.tb_s050_bank_txns
        WHERE org_id = $1 AND txn_at >= '2026-07-01' AND txn_at < '2026-10-01'`, [ORG_A])).rows[0];
      const bank = d?.sheets.find((s) => s.key === 'BANK');
      const xfer = d?.sheets.find((s) => s.key === 'XFER');
      check('T5', '★ 은행거래내역 3(7-01 00:00 · 9-30 23:59 포함, 10-01 빠짐) · 이체내역 1 — DB 의 그 기간 줄 수와 같다 · 거래일시 순',
        bank && xfer && bank.rows.length === dbBank.n && xfer.rows.length === dbBank.x && dbBank.n === 3 && dbBank.x === 1 &&
        bank.rows.map((x) => x[0]).join() === '2026-07-01 00:00:00,2026-08-05 13:00:00,2026-09-30 23:59:59',
        { bank: bank?.rows.length, xfer: xfer?.rows.length, db: dbBank });
      check('T6', '★ 계좌 — 별칭 「지어낸 운영 통장」 · 별칭 없으면 「끝 4321」 · 이체 줄 칸(받는 은행 · 끝 4자리 · 받는분 · 금액 · 통장표시 둘)',
        bank && xfer && bank.rows.map((x) => x[1]).join() === '지어낸 운영 통장,끝 4321,지어낸 운영 통장' &&
        JSON.stringify(xfer.rows[0]) === JSON.stringify(['2026-08-05 13:00:00', '끝 4321', '지어낸은행', '1111', '지어낸 받는분', 3000, '받는 글', '보낸 글']),
        { bank: bank?.rows.map((x) => x[1]), xfer: xfer?.rows[0] });
      const flat = JSON.stringify(d?.sheets ?? []);
      check('T7', '★ 계좌 전체 번호가 시트에 나가지 않는다', d && !flat.includes(ACCT_A) && !flat.includes(ACCT_A2), '');
      const v = await vatOp(c, ORG_A, { month: MONTH, periodId: null }, THIS_MONTH);
      check('T8', '미지정 건 수 · 가장 이른 달 — 부가세 조회와 같다(계산서 1 · 카드 2 · 현금 1 = 4 · 2026-07) · 처음엔 미발송 · 내용 처음 값',
        d && v.ok && d.unassignedCount === v.data.vat.unassignedCount && d.unassignedCount === 4 &&
        d.unassignedFirstMonth === v.data.vat.unassignedFirstMonth && d.unassignedFirstMonth === '2026-07' && d.last === null &&
        d.mailText === `안녕하세요. ${d.companyName ? `${d.companyName} ` : ''}2026년 3분기 부가세 신고 자료입니다.`,
        { handoff: d?.unassignedCount, first: d?.unassignedFirstMonth, vat: v.ok ? v.data.vat.unassignedCount : v, last: d?.last, text: d?.mailText });
      check('T9', '★ 다른 회사 줄이 안 들어간다 — B 의 거래처 · 상대 · 금액 · 계좌가 A 시트에 없다',
        d && !flat.includes('B회사') && !flat.includes('5555') && !flat.includes(ACCT_B) && !flat.includes('VHO-vho-nb'), '');

      // ── 엑셀 ──
      const wb = r.ok ? XLSX.read(buildXlsx(r.data.sheets), { type: 'array' }) : null;
      const xs = wb ? wb.SheetNames.map((nm) => [nm, XLSX.utils.sheet_to_json(wb.Sheets[nm], { header: 1, defval: null }).length - 1]) : [];
      check('T10', '★ 엑셀 — 시트 아홉 이름 · 줄 수가 미리보기와 같다',
        d && xs.map(([nm, n]) => `${nm}:${n}`).join() === d.sheets.map((s) => `${s.name}:${s.rows.length}`).join(), xs);

      // ── 운영사 세션도 자기 단체만 ──
      await applyCompanyScope(c, OPERATOR);
      const op = await handoffOp(c, ORG_A, Q, OPTS);
      const opFlat = op.ok ? JSON.stringify(op.data.response.sheets) : '';
      check('T11', '★ 운영사 세션도 자기 단체만 — RLS 가 B 를 보여 줘도 A 의 줄 수 그대로 · B 줄 없음',
        op.ok && op.data.response.sheets.map((s) => s.rows.length).join() === d?.sheets.map((s) => s.rows.length).join() &&
        !opFlat.includes('B회사') && !opFlat.includes(ACCT_B), op.ok ? op.data.response.sheets.map((s) => s.rows.length) : op);

      // ── 보내기(가짜 메일) · 최종 발송 ──
      await applyCompanyScope(c, tenant(ORG_A));
      const mails = [];
      const parts = {
        prepare: async (_s, q) => {
          const b = await handoffOp(c, ORG_A, q, OPTS);
          if (!b.ok) return b;
          const x = b.data.response;
          return { ok: true, data: { recipients: x.recipients, period: x.period, fileName: x.fileName, bytes: buildXlsx(b.data.sheets) } };
        },
        people: async () => ({ sender: { name: '지어낸 보낸이', email: 'staff@example.com' }, rep: { name: '지어낸 대표', email: 'rep@example.com' } }),
        saveLast: async (s, k, l) => upsertHandoffLast(c, s.s020OrgId, k, l),
      };
      const body = { month: MONTH, tp: 'T', periodId: '2026-Q3', to: ['tax@example.com'], subject: '지어낸 제목', text: '지어낸 내용' };
      const okMail = { ready: true, send: async (m) => void mails.push(m) };
      const badMail = { ready: true, send: async () => { throw new Error('지어낸 메일 서버 오류'); } };
      const s1 = await sendHandoff(session(ORG_A), body, okMail, parts);
      const s2 = await sendHandoff(session(ORG_A), { ...body, to: ['ceo@example.com'] }, badMail, parts);
      const s3 = await sendHandoff(session(ORG_A), { ...body, to: ['someone@else.com'] }, okMail, parts);
      const xl = mails[0] ? XLSX.read(mails[0].attachments[0].content, { type: 'array' }) : null;
      check('T12', '★ 보내기 — 성공(제목 · 내용 그대로 · 첨부 아홉 시트 · 참조 대표자 · 답장 발송인) · 실패는 사유만 · 세무 설정에 없는 메일은 400 · 메일은 한 번만',
        s1.ok && s1.data.ok && s1.data.last.sentBy === '7' && s1.data.last.sentByName === '지어낸 보낸이' && s1.data.last.cc === 'rep@example.com' &&
        s2.ok && !s2.data.ok && s2.data.message === '메일을 보내지 못했습니다 — 지어낸 메일 서버 오류' &&
        !s3.ok && s3.status === 400 && mails.length === 1 && mails[0].subject === '지어낸 제목' && mails[0].text === '지어낸 내용' &&
        mails[0].cc === 'rep@example.com' && mails[0].replyTo === 'staff@example.com' && mails[0].fromName === '지어낸 보낸이' &&
        mails[0].attachments[0].filename === '세무자료_부가세_2026년3분기.xlsx' && xl?.SheetNames.length === 9,
        { s1: s1.ok ? s1.data : s1, s2: s2.ok ? s2.data : s2, s3: s3.ok ? 'ok' : s3.status, mails: mails.length });
      const again = await handoffOp(c, ORG_A, Q, OPTS);
      const l = again.ok ? again.data.response.last : null;
      check('T13', '★ 최종 발송 — 성공 한 줄(받는 사람 · 참조 · 파일 이름) · 실패는 덮어쓰지 않았다',
        l && l.recipients.join() === 'tax@example.com' && l.cc === 'rep@example.com' && l.fileName === '세무자료_부가세_2026년3분기.xlsx' &&
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(l.sentAt), l ?? again);
      const s4 = await sendHandoff(session(ORG_A), { ...body, to: ['ceo@example.com', 'tax@example.com'] }, okMail, parts);
      const n4 = (await c.query(`SELECT count(*)::int n FROM public.tb_s050_handoff_last WHERE org_id = $1`, [ORG_A])).rows[0].n;
      const q2 = await handoffOp(c, ORG_A, { ...Q, periodId: '2026-Q2' }, OPTS);
      check('T14', '★ 다시 보내면 같은 줄을 덮어쓴다(한 줄 · 받는 사람 둘) · 다른 신고 기간(2분기)은 미발송',
        s4.ok && s4.data.ok && n4 === 1 && s4.data.last.recipients.join() === 'ceo@example.com,tax@example.com' && q2.ok && q2.data.response.last === null,
        { n4, last: s4.ok ? s4.data : s4, q2: q2.ok ? q2.data.response.last : q2 });

      // ── 최종 발송 회사별 막기 ──
      await applyCompanyScope(c, tenant(ORG_B));
      await upsertHandoffLast(c, ORG_B, { tp: 'T', periodId: '2026-Q3' }, { recipients: ['b-tax@example.com'], cc: null,
        fileName: 'B회사.xlsx', sentBy: '8', sentByName: null });
      const b = await handoffOp(c, ORG_B, Q, OPTS);
      let denied = null;
      await c.query('SAVEPOINT x');
      try {
        await upsertHandoffLast(c, ORG_A, { tp: 'T', periodId: '2026-Q3' }, { recipients: ['x@example.com'], cc: null,
          fileName: 'x.xlsx', sentBy: '8', sentByName: null });
      } catch (e) {
        denied = e.code;
      }
      await c.query('ROLLBACK TO SAVEPOINT x');
      check('T15', '★ 회사 B — 자기 최종 발송만(B회사.xlsx) · 자기 줄만(매출 1 · 은행 1 · 국세 1) · B 세션으로 A 의 줄은 넣지도 덮지도 못한다(42501)',
        b.ok && b.data.response.last?.fileName === 'B회사.xlsx' && denied === '42501' &&
        b.data.response.sheets.map((s) => s.rows.length).join() === '0,1,0,1,0,0,1,0,0',
        b.ok ? { last: b.data.response.last?.fileName, denied, rows: b.data.response.sheets.map((s) => s.rows.length) } : b);
      await applyCompanyScope(c, OPERATOR);
      const opA = await handoffOp(c, ORG_A, Q, OPTS);
      check('T16', '★ 운영사 세션도 자기 단체 최종 발송만 — A 의 줄(B 의 줄 아님)',
        opA.ok && opA.data.response.last?.fileName === '세무자료_부가세_2026년3분기.xlsx' && opA.data.response.last?.recipients.length === 2,
        opA.ok ? opA.data.response.last : opA);
    } finally {
      await c.query('ROLLBACK');
    }

    // ★ 스코프(set_config … true)는 트랜잭션 안에서만 산다 — 밖에서 세면 RLS 가 0줄을 줘서 늘 통과한다
    await c.query('BEGIN');
    try {
      await applyCompanyScope(c, OPERATOR);
      const cnt = async (t) => (await c.query(`SELECT count(*)::int n FROM public.${t} WHERE org_id = ANY($1)`, [[ORG_A, ORG_B]])).rows[0].n;
      const tables = ['tb_s050_upload_files', 'tb_s050_invoices', 'tb_s050_card_txns', 'tb_s050_cash_txns', 'tb_s050_bank_txns',
        'tb_s050_tax_payments', 'tb_s050_loan_txns', 'tb_s050_settings', 'tb_s050_fin_accounts', 'tb_s050_vendors', 'tb_s050_handoff_last'];
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
