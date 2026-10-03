/**
 * 청구·납부 1단계 검증 — 실제 DB 에 붙어 라우트를 왕복시킨다.
 *
 * ★ 왜 vitest 가 아닌가. 장수·납부일·일할 **규칙 자체**는 순수 함수 쪽에 시험이 있다
 *   (`invoice-plan.test.ts` · `invoice-termination.test.ts` · `invoice-prorate.test.ts`).
 *   여기서 보는 것은 **라우트 · 트랜잭션 · RLS · 제약이 실제로 그렇게 도는가**다.
 *   4-3 · 4-6 검증과 같은 방식이다.
 *
 * ★ 세션 훅을 우회한다. 쿠키를 만들려면 삐용 로그인이 필요한데 여기서 보려는 것은
 *   인증이 아니다.
 *
 * ★ **넣은 것은 전부 지운다.** 개발계 공용 DB 라 흔적을 남기지 않는다.
 *   청구서·수납·정산은 계약에서 CASCADE 되지 않으므로 순서대로 지운다.
 *
 * 사용: node --experimental-strip-types scripts/verify-billing.js
 */
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { registerContractRoutes } from '../packages/api/src/routes/contracts.ts';
import { registerBillingRoutes } from '../packages/api/src/routes/billing.ts';
import { pool, closePool } from '../packages/api/src/db/pool.ts';
import { withCompanyScope } from '../packages/api/src/db/withCompanyScope.ts';
import { syncAllSpaceStatuses } from '../packages/api/src/db/spaceStatus.ts';

/** ★ RLS 가 걸린 표는 `pool.query` 로 못 읽는다 — GUC 없는 커넥션은 0행을 본다. */
const asOperator = (fn) => withCompanyScope({ role: 'operator', companyId: null }, fn);

const { itemCountGate } = require('./verify-count.js');

/**
 * 기대 항목 수 — 모자라면 **실패**다. 항목이 조용히 사라지는 것을 막는 유일한 장치이고,
 * 경위는 `verify-count.js` 머리말에 있다. 항목을 늘리면 끝에서 이 수를 고치라고 알려 준다.
 */
const EXPECTED_ITEMS = 122;
let pass = 0;
let fail = 0;
const failures = [];

function check(label, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  ✔ ${label}`);
  } else {
    fail++;
    failures.push(label);
    console.log(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/** 이 검증이 만든 계약만 골라 지우기 위한 표식. `memo` 에 심는다. */
const TAG = `verify-billing-${Date.now()}`;
/** 서류 없이 만든 임시 회사 — 8번 전용. 끝나면 지운다. */
const TEMP_COMPANY = `VB-${String(Date.now()).slice(-10)}`;

const operatorSession = (companyId) => ({
  s020MemberId: 1,
  s020OrgId: 1,
  memberName: '검증 운영자',
  companyId,
  role: 'operator',
  screens: [],
});

function buildApp(session) {
  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (req) => {
    req.session = session;
  });
  app.setErrorHandler((err, _req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) return reply.code(500).send({ error: 'internal_error', message: err.message });
    return reply.code(status).send({ error: 'bad_request', message: err.message });
  });
  registerContractRoutes(app);
  registerBillingRoutes(app);
  return app;
}

const json = (res) => {
  try {
    return JSON.parse(res.body);
  } catch {
    return { __raw: res.body };
  }
};

(async () => {
  const { rows: buildRows } = await pool.query(
    `SELECT build_id FROM public.tb_s080_buildings LIMIT 1`,
  );
  const BUILD_ID = buildRows[0]?.build_id;

  // ★ 서류가 있는 회사여야 확정이 통과한다. 없는 회사는 8번이 따로 만든다.
  const { rows: companyRows } = await asOperator((c) =>
    c.query(
      `SELECT c.company_id
         FROM public.tb_s080_companies c
        WHERE (SELECT count(*) FROM public.tb_cm_file f WHERE f.target_id = c.company_id) >= 2
        ORDER BY c.company_id LIMIT 1`,
    ),
  );
  const COMPANY = companyRows[0]?.company_id;

  /* ★ **아무도 안 쓰는** 비상주 호실을 고른다. 비상주는 한 호실에 한 회사라
     가장 빡빡하고, 그래서 겹침이 있으면 준비 단계부터 막힌다. */
  const { rows: spaceRows } = await asOperator((c) =>
    c.query(
      `SELECT s.space_id, s.room_name, s.room_type, s.standard_fee
         FROM public.tb_s080_spaces s
        WHERE s.build_id = $1 AND s.room_type = 'VR' AND s.is_active
          AND NOT EXISTS (
            SELECT 1 FROM public.tb_s080_contract_spaces cs
              JOIN public.tb_s080_contracts k ON k.contract_id = cs.contract_id
             WHERE cs.space_id = s.space_id AND k.status IN ('confirmed', 'draft'))
        ORDER BY s.room_name LIMIT 40`,
      [BUILD_ID],
    ),
  );

  if (!BUILD_ID || !COMPANY || spaceRows.length < 34) {
    console.error(
      `✘ 준비 부족 — build=${BUILD_ID} company=${COMPANY} 빈비상주=${spaceRows.length}(34 필요)`,
    );
    process.exit(1);
  }
  console.log(`준비 — build=${BUILD_ID} company=${COMPANY} 빈 비상주 ${spaceRows.length}실\n`);

  let spaceCursor = 0;
  const nextSpace = () => spaceRows[spaceCursor++];
  let roomCursor = 0;
  const nextRoom = () => `VB${String(Date.now()).slice(-6)}-${roomCursor++}`;

  const spaceOf = (space, over = {}) => ({
    roomType: space.room_type,
    spaceId: space.space_id,
    standardFee: space.standard_fee ?? 0,
    deposit: 100_000,
    monthlyFee: 500_000,
    vatYn: true,
    ...over,
  });

  const op = buildApp(operatorSession(null));
  const created = [];

  /** 계약을 하나 만들어 확정하고 응답을 돌려준다. */
  async function createContract(over = {}, companyId = COMPANY) {
    const res = await op.inject({
      method: 'POST',
      url: '/contracts',
      payload: {
        companyId,
        buildId: BUILD_ID,
        contractRoom: nextRoom(),
        paymentMethod: 'M',
        periodMonths: 12,
        freeMonths: 0,
        contractDate: '2026-02-25',
        startDate: '2026-03-15',
        status: 'confirmed',
        memo: TAG,
        spaces: [spaceOf(nextSpace())],
        ...over,
      },
    });
    const body = json(res);
    if (body.contractId) created.push(body.contractId);
    return { res, body };
  }

  const invoicesOf = async (contractId) =>
    json(await op.inject({ method: 'GET', url: `/contracts/${contractId}/invoices` }));

  try {
    /* ═══ 1. 12개월 월납 확정 → 12장, 첫 장 납부완료 + 수납 1건 ═══════════ */
    console.log('1. 12개월 월납 확정');
    {
      const { res, body } = await createContract();
      check('확정 저장이 201 이다', res.statusCode === 201, `${res.statusCode} ${res.body}`);
      check('응답의 청구서 장수가 12 다', body.invoiceCount === 12, String(body.invoiceCount));

      const invs = await invoicesOf(body.contractId);
      check('청구서가 12장 만들어졌다', invs.length === 12, `${invs.length}장`);
      check(
        '첫 장이 납부완료(E)다',
        invs[0]?.status === 'E',
        `${invs[0]?.status}`,
      );
      check(
        '첫 장은 수납액 = 청구액이다',
        invs[0]?.paidAmount === invs[0]?.totalAmount && invs[0]?.totalAmount === 550_000,
        `${invs[0]?.paidAmount}/${invs[0]?.totalAmount}`,
      );
      check(
        '나머지 11장은 납부대기(P)이고 수납액이 0 이다',
        invs.slice(1).every((i) => i.status === 'P' && i.paidAmount === 0),
        JSON.stringify(invs.slice(1).map((i) => [i.yearMonth, i.status, i.paidAmount])),
      );

      const first = json(await op.inject({ method: 'GET', url: `/invoices/${invs[0].invoiceId}` }));
      check('첫 장에 수납이 1건 붙어 있다', first.payments?.length === 1, JSON.stringify(first.payments));
      check(
        '★ 그 수납의 입금일이 계약일자(2026-02-25)다',
        first.payments?.[0]?.paidOn === '2026-02-25',
        String(first.payments?.[0]?.paidOn),
      );
      check(
        '그 수납 금액이 첫 장 청구 합계다',
        first.payments?.[0]?.amount === 550_000,
        String(first.payments?.[0]?.amount),
      );
      check(
        '★ 예치금(100,000)은 청구서에 들어가지 않았다',
        first.totalAmount === 550_000,
        String(first.totalAmount),
      );
    }

    /* ═══ 2. ★ 10월 1일 시작 12개월 → 12장 (11장 아님) ═══════════════════ */
    console.log('\n2. ★ 10월 1일 시작 12개월 (레거시가 한 장 잃던 자리)');
    {
      const { body } = await createContract({ startDate: '2026-10-01', periodMonths: 12 });
      const invs = await invoicesOf(body.contractId);
      check('12장이다 (11장이 아니다)', invs.length === 12, `${invs.length}장`);
      check('첫 장이 2026-10 이다', invs[0]?.yearMonth === '2026-10', String(invs[0]?.yearMonth));
      check('마지막 장이 2027-09 다', invs[11]?.yearMonth === '2027-09', String(invs[11]?.yearMonth));
    }

    /* ═══ 3. ★ 31일 시작 → 2월 납부일이 말일 ════════════════════════════ */
    console.log('\n3. ★ 31일 시작 — 없는 날은 말일');
    {
      const { body } = await createContract({ startDate: '2026-01-31', periodMonths: 4 });
      const invs = await invoicesOf(body.contractId);
      const dues = invs.map((i) => i.dueDate);
      check(
        '납부일이 1/31 · 2/28 · 3/31 · 4/30 이다',
        JSON.stringify(dues) === JSON.stringify(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']),
        JSON.stringify(dues),
      );
    }

    /* ═══ 4. 호실 2개 계약 → 한 장에 두 줄 ══════════════════════════════ */
    console.log('\n4. 호실 2개 → 한 장에 두 줄');
    {
      const a = nextSpace();
      const b = nextSpace();
      const { body } = await createContract({
        periodMonths: 2,
        spaces: [spaceOf(a), spaceOf(b, { monthlyFee: 300_000, vatYn: false })],
      });
      const invs = await invoicesOf(body.contractId);
      const first = json(await op.inject({ method: 'GET', url: `/invoices/${invs[0].invoiceId}` }));
      check('한 장에 줄이 둘이다', first.lines?.length === 2, `${first.lines?.length}줄`);
      check(
        '합계가 두 줄의 합이다 (550,000 + 300,000)',
        first.totalAmount === 850_000 && first.supplyAmount === 800_000 && first.vatAmount === 50_000,
        `${first.supplyAmount}+${first.vatAmount}=${first.totalAmount}`,
      );
      check(
        '★ 줄마다 어느 계약 항목에서 왔는지가 남아 있다',
        first.lines?.every((l) => l.contractSpaceId && l.payItem === 'M'),
        JSON.stringify(first.lines?.map((l) => [l.payItem, l.contractSpaceId])),
      );
    }

    /* ═══ 5. 일시불 → 1장 ═══════════════════════════════════════════════ */
    console.log('\n5. 일시불 → 1장');
    {
      const { body } = await createContract({ paymentMethod: 'C', periodMonths: 12 });
      const invs = await invoicesOf(body.contractId);
      check('1장이다', invs.length === 1, `${invs.length}장`);
      check('그 1장이 납부완료다', invs[0]?.status === 'E', String(invs[0]?.status));
      check(
        '금액이 월액 × 12 다',
        invs[0]?.totalAmount === 550_000 * 12,
        String(invs[0]?.totalAmount),
      );
      const only = json(await op.inject({ method: 'GET', url: `/invoices/${invs[0].invoiceId}` }));
      check('줄의 수량이 12(개월)다', only.lines?.[0]?.quantity === 12, String(only.lines?.[0]?.quantity));
      check('단가는 월 이용료 그대로다', only.lines?.[0]?.unitPrice === 500_000, String(only.lines?.[0]?.unitPrice));
    }

    /* ═══ 6. 중도해지 → 남은 달 취소, 해지 달 일할, 정산 1줄 ═══════════ */
    console.log('\n6. 중도해지');
    let terminatedContractId;
    {
      const { body } = await createContract({ startDate: '2026-03-01', periodMonths: 12 });
      terminatedContractId = body.contractId;

      const res = await op.inject({
        method: 'POST',
        url: `/contracts/${body.contractId}/status`,
        payload: { to: 'terminated', terminatedDate: '2026-06-15', terminationReason: '검증 중도해지' },
      });
      check('종료가 200 이다', res.statusCode === 200, `${res.statusCode} ${res.body}`);
      check('청구 처리 결과가 settled 다', json(res).billing === 'settled', String(json(res).billing));

      const invs = await invoicesOf(body.contractId);
      const byMonth = Object.fromEntries(invs.map((i) => [i.yearMonth, i]));

      check(
        '★ 해지 달 다음부터 8장이 취소(C)됐다 — 삭제가 아니다',
        invs.filter((i) => i.status === 'C').length === 8 && invs.length === 12,
        `취소 ${invs.filter((i) => i.status === 'C').length}장 / 전체 ${invs.length}장`,
      );
      check(
        '해지 달(6월)이 일할로 낮아졌다 — 550,000 × 15/30 = 275,000',
        byMonth['2026-06']?.totalAmount === 275_000,
        String(byMonth['2026-06']?.totalAmount),
      );
      check(
        '★ 해지 달의 줄도 함께 낮아졌다 (줄 합계 = 머리)',
        await (async () => {
          const one = json(
            await op.inject({ method: 'GET', url: `/invoices/${byMonth['2026-06'].invoiceId}` }),
          );
          const sum = one.lines.reduce((s, l) => s + l.totalAmount, 0);
          return sum === one.totalAmount && sum === 275_000;
        })(),
        '줄 합계가 머리와 다르다',
      );
      check(
        '★ 해지 달보다 앞선 3·4·5월은 그대로다',
        ['2026-03', '2026-04', '2026-05'].every(
          (m) => byMonth[m]?.status !== 'C' && byMonth[m]?.totalAmount === 550_000,
        ),
        JSON.stringify(['2026-03', '2026-04', '2026-05'].map((m) => [m, byMonth[m]?.status, byMonth[m]?.totalAmount])),
      );

      const st = await asOperator((c) =>
        c.query(
          `SELECT deposit_return, usage_charge, net_amount, settle_type
             FROM public.tb_s080_settlements WHERE contract_id = $1`,
          [body.contractId],
        ),
      );
      check('정산이 한 줄 남았다', st.rowCount === 1, `${st.rowCount}줄`);
      check(
        '예치금 반환이 전액(100,000)이다',
        st.rows[0]?.deposit_return === 100_000,
        String(st.rows[0]?.deposit_return),
      );
      check(
        '실이용료 = 3개월 만액 + 6월 일할 = 1,925,000',
        st.rows[0]?.usage_charge === 1_925_000,
        String(st.rows[0]?.usage_charge),
      );
      check(
        '순정산금 = 예치금 + (수납 550,000 − 실이용료) = −1,275,000 → 추가청구',
        st.rows[0]?.net_amount === -1_275_000 && st.rows[0]?.settle_type === 'charge',
        `${st.rows[0]?.net_amount} ${st.rows[0]?.settle_type}`,
      );
      check(
        '★ 환불 수납을 자동으로 만들지 않았다 — 원장이 말하고 사람이 넣는다',
        await (async () => {
          const p = await asOperator((c) =>
            c.query(
              `SELECT count(*)::int n FROM public.tb_s080_payments p
                 JOIN public.tb_s080_invoices i ON i.invoice_id = p.invoice_id
                WHERE i.contract_id = $1 AND p.amount < 0`,
              [body.contractId],
            ),
          );
          return p.rows[0].n === 0;
        })(),
        '음수 수납이 생겼다',
      );
    }

    /* ═══ 7. 종료일자가 원래 종료일과 같으면 손대지 않는다 ══════════════ */
    console.log('\n7. 종료일자 = 원래 종료일 (기간 만료·재계약이 이 길이다)');
    {
      const { body } = await createContract({ startDate: '2026-03-01', periodMonths: 12 });
      const before = await invoicesOf(body.contractId);
      const res = await op.inject({
        method: 'POST',
        url: `/contracts/${body.contractId}/status`,
        // 2026-03-01 + 12개월 − 1일 = 2027-02-28
        payload: { to: 'terminated', terminatedDate: '2027-02-28', terminationReason: '기간 만료' },
      });
      check('청구 처리 결과가 untouched 다', json(res).billing === 'untouched', String(json(res).billing));
      const after = await invoicesOf(body.contractId);
      check(
        '청구서가 하나도 안 바뀌었다',
        JSON.stringify(before) === JSON.stringify(after),
        '바뀐 청구서가 있다',
      );
      const st = await asOperator((c) =>
        c.query(`SELECT count(*)::int n FROM public.tb_s080_settlements WHERE contract_id = $1`, [body.contractId]),
      );
      check('정산도 남기지 않았다', st.rows[0].n === 0, `${st.rows[0].n}줄`);
    }

    /* ═══ 8. ★ 종료일자가 원래 종료일보다 뒤면 멈춘다 ═══════════════════ */
    console.log('\n8. ★ 종료일자가 원래 종료일보다 뒤 — 규칙이 없어 멈춘다');
    {
      const { body } = await createContract({ startDate: '2026-03-01', periodMonths: 12 });
      const before = await invoicesOf(body.contractId);
      const res = await op.inject({
        method: 'POST',
        url: `/contracts/${body.contractId}/status`,
        payload: { to: 'terminated', terminatedDate: '2027-03-01', terminationReason: '기간 밖' },
      });
      check('400 으로 막힌다', res.statusCode === 400, `${res.statusCode} ${res.body}`);
      const after = await invoicesOf(body.contractId);
      check('★ 청구서도 그대로다 (트랜잭션이 통째로 되돌아갔다)', JSON.stringify(before) === JSON.stringify(after));
      const k = await asOperator((c) =>
        c.query(`SELECT status FROM public.tb_s080_contracts WHERE contract_id = $1`, [body.contractId]),
      );
      check('★ 계약 상태도 그대로 confirmed 다', k.rows[0]?.status === 'confirmed', String(k.rows[0]?.status));
    }

    /* ═══ 9. 재계약 확정 → 이전 계약 청구서는 그대로 ════════════════════ */
    console.log('\n9. 재계약 확정 — 이전 계약 청구서는 그대로');
    {
      const prev = await createContract({ startDate: '2026-03-01', periodMonths: 12 });
      const prevBefore = await invoicesOf(prev.body.contractId);

      const renew = await op.inject({
        method: 'POST',
        url: '/contracts',
        payload: {
          companyId: COMPANY,
          buildId: BUILD_ID,
          contractRoom: nextRoom(),
          paymentMethod: 'M',
          periodMonths: 6,
          contractDate: '2027-02-20',
          // 이전 계약 종료일(2027-02-28)의 다음 날
          startDate: '2027-03-01',
          status: 'confirmed',
          memo: TAG,
          spaces: [spaceOf(nextSpace())],
          renewedFromContractId: prev.body.contractId,
        },
      });
      const renewBody = json(renew);
      if (renewBody.contractId) created.push(renewBody.contractId);

      check('재계약 확정이 201 이다', renew.statusCode === 201, `${renew.statusCode} ${renew.body}`);
      check('이전 계약이 닫혔다', renewBody.closedPrevious === prev.body.contractId, String(renewBody.closedPrevious));
      check('재계약의 청구서는 6장이다', renewBody.invoiceCount === 6, String(renewBody.invoiceCount));

      const prevAfter = await invoicesOf(prev.body.contractId);
      check(
        '★ 이전 계약의 청구서 12장이 하나도 안 바뀌었다',
        JSON.stringify(prevBefore) === JSON.stringify(prevAfter),
        '이전 계약 청구서가 바뀌었다',
      );
      const st = await asOperator((c) =>
        c.query(`SELECT count(*)::int n FROM public.tb_s080_settlements WHERE contract_id = $1`, [prev.body.contractId]),
      );
      check('이전 계약에 정산 줄도 안 생겼다', st.rows[0].n === 0, `${st.rows[0].n}줄`);
    }

    /* ═══ 10. ★ 확정이 막히면 청구서도 안 생긴다 (서류 부족) ════════════ */
    console.log('\n10. ★ 서류 부족으로 확정이 막히면 청구서도 안 생긴다');
    {
      await asOperator((c) =>
        c.query(
          `INSERT INTO public.tb_s080_companies (company_id, build_id, company_name, updated_at)
           VALUES ($1, $2, $3, now())`,
          [TEMP_COMPANY, BUILD_ID, `검증용 무서류 회사 ${TAG}`],
        ),
      );
      const { res } = await createContract({}, TEMP_COMPANY);
      check('확정이 409(서류 부족)로 막힌다', res.statusCode === 409, `${res.statusCode} ${res.body}`);

      const left = await asOperator((c) =>
        c.query(`SELECT count(*)::int n FROM public.tb_s080_invoices WHERE company_id = $1`, [TEMP_COMPANY]),
      );
      check('★ 청구서가 한 장도 안 생겼다', left.rows[0].n === 0, `${left.rows[0].n}장`);
      const k = await asOperator((c) =>
        c.query(`SELECT count(*)::int n FROM public.tb_s080_contracts WHERE company_id = $1`, [TEMP_COMPANY]),
      );
      check('계약도 안 생겼다 — 쓰기 전에 돌려보냈다', k.rows[0].n === 0, `${k.rows[0].n}건`);
    }

    /* ═══ 11. 수납 — 넣고 · 고치고 · 지운다 ═════════════════════════════ */
    console.log('\n11. 수납 왕복');
    {
      const { body } = await createContract({ periodMonths: 3 });
      const invs = await invoicesOf(body.contractId);
      const second = invs[1]; // 납부대기 장

      let res = await op.inject({
        method: 'POST',
        url: `/invoices/${second.invoiceId}/payments`,
        payload: { paidOn: '2026-04-15', amount: 200_000, payMethod: 'B', memo: '일부 입금' },
      });
      check('수납 입력이 201 이다', res.statusCode === 201, `${res.statusCode} ${res.body}`);
      const paymentId = json(res).paymentId;

      let one = json(await op.inject({ method: 'GET', url: `/invoices/${second.invoiceId}` }));
      check('부분 납부면 상태가 그대로 P 다', one.status === 'P', String(one.status));
      check('수납 합계가 반영됐다', one.paidAmount === 200_000, String(one.paidAmount));

      res = await op.inject({
        method: 'PATCH',
        url: `/payments/${paymentId}`,
        payload: { paidOn: '2026-04-15', amount: 550_000, payMethod: 'B' },
      });
      check('수납 수정이 200 이다', res.statusCode === 200, `${res.statusCode} ${res.body}`);
      one = json(await op.inject({ method: 'GET', url: `/invoices/${second.invoiceId}` }));
      check('완납이 되면 상태가 E 로 바뀐다', one.status === 'E', String(one.status));

      res = await op.inject({ method: 'DELETE', url: `/payments/${paymentId}` });
      check('수납 삭제가 200 이다', res.statusCode === 200, `${res.statusCode} ${res.body}`);
      one = json(await op.inject({ method: 'GET', url: `/invoices/${second.invoiceId}` }));
      check(
        '★ 지우면 상태가 P 로 되돌아간다 (다시 세지 않으면 완납으로 남는다)',
        one.status === 'P' && one.paidAmount === 0,
        `${one.status}/${one.paidAmount}`,
      );

      // 환불 — 음수 수납
      res = await op.inject({
        method: 'POST',
        url: `/invoices/${second.invoiceId}/payments`,
        payload: { paidOn: '2026-04-20', amount: -50_000, memo: '환불' },
      });
      check('★ 환불(음수 수납)이 들어간다', res.statusCode === 201, `${res.statusCode} ${res.body}`);

      res = await op.inject({
        method: 'POST',
        url: `/invoices/${second.invoiceId}/payments`,
        payload: { paidOn: '2026-04-20', amount: 0 },
      });
      check('0원 수납은 400 으로 막힌다', res.statusCode === 400, `${res.statusCode} ${res.body}`);

      res = await op.inject({
        method: 'POST',
        url: `/invoices/${second.invoiceId}/payments`,
        payload: { paidOn: '2026-04-99', amount: 1000 },
      });
      check('없는 날짜는 400 으로 막힌다', res.statusCode === 400, `${res.statusCode} ${res.body}`);
    }

    /* ═══ 12. 취소된 청구서에는 수납할 수 없다 ══════════════════════════ */
    console.log('\n12. 취소된 청구서');
    {
      const invs = await invoicesOf(terminatedContractId);
      const cancelled = invs.find((i) => i.status === 'C');
      const res = await op.inject({
        method: 'POST',
        url: `/invoices/${cancelled.invoiceId}/payments`,
        payload: { paidOn: '2026-08-01', amount: 100_000 },
      });
      check('409 로 막힌다', res.statusCode === 409, `${res.statusCode} ${res.body}`);
    }

    /* ═══ 13. 입주사 세션은 수납을 못 넣는다 ════════════════════════════ */
    console.log('\n13. 권한');
    {
      const tenant = buildApp({ ...operatorSession(COMPANY), role: 'tenant' });
      try {
        const invs = await invoicesOf(created[0]);
        const res = await tenant.inject({
          method: 'POST',
          url: `/invoices/${invs[0].invoiceId}/payments`,
          payload: { paidOn: '2026-04-01', amount: 1000 },
        });
        check('입주사 세션의 수납 입력은 403 이다', res.statusCode === 403, `${res.statusCode} ${res.body}`);
      } finally {
        await tenant.close();
      }
    }

    /* ═══ 14. ★ 무상 1개월 · 12개월 월납 ═══════════════════════════════════ */
    console.log('\n14. ★ 무상 1개월 · 12개월 월납');
    {
      const { body } = await createContract({ freeMonths: 1, periodMonths: 12 });
      const invs = await invoicesOf(body.contractId);

      check('장수는 그대로 12장이다', invs.length === 12, `${invs.length}장`);
      check(
        '★ 첫 장이 0원 납부완료(E)다',
        invs[0]?.totalAmount === 0 && invs[0]?.status === 'E',
        `${invs[0]?.totalAmount}원 / ${invs[0]?.status}`,
      );
      check(
        '★ 둘째 장(첫 유료 달)은 납부대기(P)이고 만액이다',
        invs[1]?.status === 'P' && invs[1]?.totalAmount === 550_000,
        `${invs[1]?.status} / ${invs[1]?.totalAmount}`,
      );

      const first = json(await op.inject({ method: 'GET', url: `/invoices/${invs[0].invoiceId}` }));
      check('★ 수납이 한 건도 안 생겼다', first.payments?.length === 0, JSON.stringify(first.payments));
      check(
        '★ 무상 줄이 남아 있고 단가는 그대로다 — 얼마짜리를 무상으로 줬는지가 남는다',
        first.lines?.[0]?.isFree === true &&
          first.lines?.[0]?.unitPrice === 500_000 &&
          first.lines?.[0]?.totalAmount === 0,
        JSON.stringify(first.lines?.[0]),
      );

      const second = json(await op.inject({ method: 'GET', url: `/invoices/${invs[1].invoiceId}` }));
      check(
        '유료 달의 줄에는 무상 표시가 없다',
        second.lines?.[0]?.isFree === false,
        String(second.lines?.[0]?.isFree),
      );

      const k = await asOperator((c) =>
        c.query(
          `SELECT free_months, first_payment FROM public.tb_s080_contracts WHERE contract_id = $1`,
          [body.contractId],
        ),
      );
      check('무상 개월수가 계약에 저장됐다', k.rows[0]?.free_months === 1, String(k.rows[0]?.free_months));
      check(
        '★ 첫달납부액이 예치금(100,000)만으로 바뀌었다',
        k.rows[0]?.first_payment === 100_000,
        String(k.rows[0]?.first_payment),
      );
    }

    /* ═══ 15. 무상 0 이면 지금 그대로 ═════════════════════════════════════ */
    console.log('\n15. 무상 0 — 예전 그대로');
    {
      const { body } = await createContract({ freeMonths: 0, periodMonths: 3 });
      const invs = await invoicesOf(body.contractId);
      const first = json(await op.inject({ method: 'GET', url: `/invoices/${invs[0].invoiceId}` }));
      check(
        '첫 장 납부완료 + 수납 1건',
        invs[0]?.status === 'E' && first.payments?.length === 1,
        `${invs[0]?.status} / 수납 ${first.payments?.length}건`,
      );
      const k = await asOperator((c) =>
        c.query(`SELECT first_payment FROM public.tb_s080_contracts WHERE contract_id = $1`, [
          body.contractId,
        ]),
      );
      check(
        '첫달납부액 = 예치금 + 월납부액 = 650,000',
        k.rows[0]?.first_payment === 650_000,
        String(k.rows[0]?.first_payment),
      );
    }

    /* ═══ 16. 일시불 + 무상 ═══════════════════════════════════════════════ */
    console.log('\n16. 일시불 + 무상 1개월');
    {
      const { body } = await createContract({ paymentMethod: 'C', periodMonths: 12, freeMonths: 1 });
      const invs = await invoicesOf(body.contractId);
      check('1장이다', invs.length === 1, `${invs.length}장`);
      check('★ (12 − 1) × 월액이다', invs[0]?.totalAmount === 550_000 * 11, String(invs[0]?.totalAmount));
      const only = json(await op.inject({ method: 'GET', url: `/invoices/${invs[0].invoiceId}` }));
      check(
        '줄의 수량이 11(청구하는 개월수)이다',
        only.lines?.[0]?.quantity === 11,
        String(only.lines?.[0]?.quantity),
      );
      check('그 1장은 납부완료이고 수납이 붙는다', invs[0]?.status === 'E' && only.payments?.length === 1);
    }

    /* ═══ 17. ★★ 중도 해지 환수 — 지시서의 실제 사례 ═════════════════════ */
    console.log('\n17. ★★ 중도 해지 환수 (기준가 300,000 · 계약가 270,000 · 무상 1 · 3개월)');
    {
      const space = nextSpace();
      const res = await op.inject({
        method: 'POST',
        url: '/contracts',
        payload: {
          companyId: COMPANY,
          buildId: BUILD_ID,
          contractRoom: nextRoom(),
          paymentMethod: 'M',
          periodMonths: 3,
          freeMonths: 1,
          contractDate: '2026-02-25',
          startDate: '2026-03-01',
          status: 'confirmed',
          memo: TAG,
          spaces: [
            {
              roomType: space.room_type,
              spaceId: space.space_id,
              standardFee: 300_000,
              deposit: 0,
              monthlyFee: 270_000,
              vatYn: true,
            },
          ],
        },
      });
      const body = json(res);
      if (body.contractId) created.push(body.contractId);
      check('확정이 201 이다', res.statusCode === 201, `${res.statusCode} ${res.body}`);

      const before = await invoicesOf(body.contractId);
      check(
        '청구서 3장 — 3월 0원 · 4·5월 297,000',
        JSON.stringify(before.map((i) => i.totalAmount)) === JSON.stringify([0, 297_000, 297_000]),
        JSON.stringify(before.map((i) => i.totalAmount)),
      );

      const term = await op.inject({
        method: 'POST',
        url: `/contracts/${body.contractId}/status`,
        payload: { to: 'terminated', terminatedDate: '2026-05-15', terminationReason: '검증 중도해지' },
      });
      check('종료가 200 이다', term.statusCode === 200, `${term.statusCode} ${term.body}`);

      const st = await asOperator((c) =>
        c.query(
          `SELECT discount_clawback, free_clawback, usage_charge, net_amount, settle_type
             FROM public.tb_s080_settlements WHERE contract_id = $1`,
          [body.contractId],
        ),
      );
      check(
        '★ 할인 환수 81,967 — round(30,000 × 2.4839) = 74,516 + 부가세 7,451',
        st.rows[0]?.discount_clawback === 81_967,
        String(st.rows[0]?.discount_clawback),
      );
      check(
        '★ 무상 환수 297,000 — 계약가 270,000 + 부가세 27,000',
        st.rows[0]?.free_clawback === 297_000,
        String(st.rows[0]?.free_clawback),
      );
      check(
        '★ 실이용료에 무상 달이 안 들어갔다 — 유료 1달 297,000 + 5월 일할 143,710',
        st.rows[0]?.usage_charge === 440_710,
        String(st.rows[0]?.usage_charge),
      );
      check(
        // ★ −819,677 에서 10원 미만을 버린다(2026-09-26). 고객이 더 내는 쪽(−819,680)으로 버리지 않는다.
        '★ 순정산금 = −실이용료 − 환수 합계 = −819,677 → 절사 −819,670 (추가청구)',
        st.rows[0]?.net_amount === -819_670 && st.rows[0]?.settle_type === 'charge',
        `${st.rows[0]?.net_amount} ${st.rows[0]?.settle_type}`,
      );

      const after = await invoicesOf(body.contractId);
      check(
        '★ 환수는 청구서를 건드리지 않는다 — 3·4월 그대로, 5월만 일할',
        after[0]?.totalAmount === 0 &&
          after[1]?.totalAmount === 297_000 &&
          after[2]?.totalAmount === 143_710,
        JSON.stringify(after.map((i) => i.totalAmount)),
      );
    }

    /* ═══ 17-2. ★★★ 불변식 — 무상 달만 쓰고 나가면 환수 합계가 기준가다 ═══ */
    console.log('\n17-2. ★★★ 불변식 — 무상 달만 쓰고 나가면 환수 합계 = 기준가');
    {
      /*
       * 무상 1개월 계약을 **그 달 말일**에 끝낸다. 사용 기간이 정확히 1개월이라
       *   할인 환수 = (300,000 − 270,000) × 1 = 30,000
       *   무상 환수 = 270,000 × 1           = 270,000
       * 둘을 합치면 **기준가 300,000**(+부가세 30,000)이다. 중도 해지하면 「깎아 준
       * 것도 공짜로 준 것도 없던 일」이 된다는 규칙이 이 한 줄로 드러난다.
       * 한쪽만 틀리면 바로 깨진다.
       */
      const space = nextSpace();
      const res = await op.inject({
        method: 'POST',
        url: '/contracts',
        payload: {
          companyId: COMPANY,
          buildId: BUILD_ID,
          contractRoom: nextRoom(),
          paymentMethod: 'M',
          periodMonths: 3,
          freeMonths: 1,
          contractDate: '2026-02-25',
          startDate: '2026-03-01',
          status: 'confirmed',
          memo: TAG,
          spaces: [
            {
              roomType: space.room_type,
              spaceId: space.space_id,
              standardFee: 300_000,
              deposit: 0,
              monthlyFee: 270_000,
              vatYn: true,
            },
          ],
        },
      });
      const body = json(res);
      if (body.contractId) created.push(body.contractId);

      await op.inject({
        method: 'POST',
        url: `/contracts/${body.contractId}/status`,
        payload: { to: 'terminated', terminatedDate: '2026-03-31', terminationReason: '무상 달 해지' },
      });

      const st = await asOperator((c) =>
        c.query(
          `SELECT discount_clawback, free_clawback, usage_charge
             FROM public.tb_s080_settlements WHERE contract_id = $1`,
          [body.contractId],
        ),
      );
      check(
        '할인 환수 33,000 (30,000 + 부가세 3,000)',
        st.rows[0]?.discount_clawback === 33_000,
        String(st.rows[0]?.discount_clawback),
      );
      check(
        '무상 환수 297,000 (270,000 + 부가세 27,000)',
        st.rows[0]?.free_clawback === 297_000,
        String(st.rows[0]?.free_clawback),
      );
      check(
        '★★★ 합치면 기준가 + 부가세 = 330,000',
        st.rows[0]?.discount_clawback + st.rows[0]?.free_clawback === 300_000 + 30_000,
        `${st.rows[0]?.discount_clawback} + ${st.rows[0]?.free_clawback}`,
      );
      check(
        '★ 그 달은 무상이라 실이용료가 0 이다 — 환수로만 받는다(이중 아님)',
        st.rows[0]?.usage_charge === 0,
        String(st.rows[0]?.usage_charge),
      );
    }

    /* ═══ 18. ★ 기간 만료로 끝내면 환수가 없다 ═══════════════════════════ */
    console.log('\n18. ★ 기간 만료 종료 — 환수 0');
    {
      const { body } = await createContract({ periodMonths: 3, freeMonths: 1, startDate: '2026-03-01' });
      const res = await op.inject({
        method: 'POST',
        url: `/contracts/${body.contractId}/status`,
        // 2026-03-01 + 3개월 − 1일 = 2026-05-31
        payload: { to: 'terminated', terminatedDate: '2026-05-31', terminationReason: '기간 만료' },
      });
      check('청구 처리 결과가 untouched 다', json(res).billing === 'untouched', String(json(res).billing));
      const st = await asOperator((c) =>
        c.query(`SELECT count(*)::int n FROM public.tb_s080_settlements WHERE contract_id = $1`, [
          body.contractId,
        ]),
      );
      check('★ 정산도 환수도 기록하지 않았다', st.rows[0].n === 0, `${st.rows[0].n}줄`);
    }

    /* ═══ 19. ★ 무상이 기간 이상이면 막힌다 ══════════════════════════════ */
    console.log('\n19. ★ 무상 >= 기간');
    {
      const { res } = await createContract({ periodMonths: 3, freeMonths: 3 });
      check('400 으로 막힌다', res.statusCode === 400, `${res.statusCode} ${res.body}`);
      const left = await asOperator((c) =>
        c.query(
          `SELECT count(*)::int n FROM public.tb_s080_contracts WHERE memo = $1 AND free_months >= 3`,
          [TAG],
        ),
      );
      check('계약이 안 만들어졌다', left.rows[0].n === 0, `${left.rows[0].n}건`);
    }

    /* ═══ 20. 예치금 — 신규 확정은 「받음」 1건 (024) ═══════════════════════ */
    console.log('\n20. 예치금 — 신규 확정 → 받음');
    const depositsOf = (contractId) =>
      asOperator((c) =>
        c.query(
          `SELECT entry_kind, amount, to_char(entry_on, 'YYYY-MM-DD') AS day, related_contract_id
             FROM public.tb_s080_deposit_ledger WHERE contract_id = $1 ORDER BY entry_on, created_at`,
          [contractId],
        ),
      ).then((r) => r.rows);
    const kinds = (rows) => rows.map((r) => `${r.entry_kind}:${r.amount}`).join(',');
    {
      const { body } = await createContract({ periodMonths: 3 });
      check('확정 응답이 예치금 recorded', body.deposit === 'recorded', String(body.deposit));
      const rows = await depositsOf(body.contractId);
      check(
        '★ 받음 1건 · 100,000 · 날짜 = 계약일자(2026-02-25)',
        kinds(rows) === 'receive:100000' && rows[0].day === '2026-02-25',
        JSON.stringify(rows),
      );
    }

    /* ═══ 21. 예치금 — 재계약 확정은 「이월」, 받음 없음 ══════════════════ */
    console.log('\n21. 예치금 — 재계약 확정 → 이월');
    const renewOf = async (prevId, deposit) => {
      const res = await op.inject({
        method: 'POST',
        url: '/contracts',
        payload: {
          companyId: COMPANY, buildId: BUILD_ID, contractRoom: nextRoom(), paymentMethod: 'M',
          periodMonths: 3, contractDate: '2026-12-20', startDate: '2027-01-01', status: 'confirmed', memo: TAG,
          spaces: [spaceOf(nextSpace(), { deposit })], renewedFromContractId: prevId,
        },
      });
      const b = json(res);
      if (b.contractId) created.push(b.contractId);
      return { res, body: b };
    };
    {
      const prev = await createContract({ startDate: '2026-10-01', periodMonths: 3 });
      const renew = await renewOf(prev.body.contractId, 100_000);
      check('재계약 확정 201', renew.res.statusCode === 201, renew.res.body);
      const mine = await depositsOf(renew.body.contractId);
      check(
        '★ 새 계약 — 이월 100,000 한 건 · 받음 없음',
        kinds(mine) === 'carry_in:100000' && mine[0].related_contract_id === prev.body.contractId,
        JSON.stringify(mine),
      );
      const theirs = await depositsOf(prev.body.contractId);
      check('이전 계약 — 받음 뒤에 이월(넘김) → 보유 0', kinds(theirs) === 'receive:100000,carry_out:100000', JSON.stringify(theirs));

      const prev2 = await createContract({ startDate: '2026-10-01', periodMonths: 3 });
      const bigger = await renewOf(prev2.body.contractId, 150_000);
      const rows = await depositsOf(bigger.body.contractId);
      check('예치금이 늘면 차액만 받음 — 이월 100,000 + 받음 50,000', kinds(rows) === 'carry_in:100000,receive:50000', JSON.stringify(rows));

      // 장부가 생기기 전에 확정된 계약을 흉내 낸다 — 이전 계약의 기록을 지운다
      const prev3 = await createContract({ startDate: '2026-10-01', periodMonths: 3 });
      await asOperator((c) =>
        c.query('DELETE FROM public.tb_s080_deposit_ledger WHERE contract_id = $1', [prev3.body.contractId]),
      );
      const blind = await renewOf(prev3.body.contractId, 100_000);
      check(
        '★ 이전 계약에 장부가 없으면 아무것도 안 남기고 알린다',
        blind.body.deposit === 'previous_unrecorded' && (await depositsOf(blind.body.contractId)).length === 0,
        String(blind.body.deposit),
      );
    }

    /* ═══ 22. 기간 만료 종료 → 「예치금 반환 대기」 → 반환 ═══════════════ */
    console.log('\n22. 기간 만료 — 예치금 반환 대기');
    const queue = async () => json(await op.inject({ method: 'GET', url: '/billing/settlements' }));
    {
      const { body } = await createContract({ startDate: '2026-03-01', periodMonths: 3 });
      await op.inject({
        method: 'POST', url: `/contracts/${body.contractId}/status`,
        payload: { to: 'terminated', terminatedDate: '2026-05-31', terminationReason: '기간 만료' },
      });
      let q = await queue();
      const waiting = q.pending.find((p) => p.contractId === body.contractId);
      check('★ 정산 탭에 「예치금 반환 대기」 100,000', waiting?.kind === 'deposit' && waiting.amount === 100_000, JSON.stringify(waiting));

      const noAccount = await op.inject({
        method: 'POST', url: `/contracts/${body.contractId}/deposit/return`,
        payload: { paidOn: '2026-06-03', payMethod: 'B' },
      });
      check('반환 계좌 없이는 400', noAccount.statusCode === 400, noAccount.body);

      const ok = await op.inject({
        method: 'POST', url: `/contracts/${body.contractId}/deposit/return`,
        payload: { paidOn: '2026-06-03', payMethod: 'B', refundBank: '국민은행', refundAccount: '123-45-678901', refundHolder: '검증' },
      });
      check('반환 200', ok.statusCode === 200 && json(ok).amount === 100_000, ok.body);
      check('장부 — 받음 뒤 반환 100,000', kinds(await depositsOf(body.contractId)) === 'receive:100000,return:100000');
      q = await queue();
      const done = q.done.find((p) => p.contractId === body.contractId);
      check(
        '정산 탭 — 대기에서 빠지고 처리 완료',
        !q.pending.some((p) => p.contractId === body.contractId) && done?.kind === 'deposit',
        JSON.stringify(done),
      );
      check('★ 목록의 계좌번호는 가린다', done?.account === '***-**-**8901', String(done?.account));
    }

    /* ═══ 23. 첫 달 중간 해지 — 미수금 0 · 과납 · 정산 처리 ═══════════════ */
    console.log('\n23. 첫 달 중간 해지 — 과납 · 정산 대기');
    {
      const { summarizeInvoices } = await import('../packages/shared/src/domain/invoice-summary.ts');
      const { displayInvoiceStatus } = await import('../packages/shared/src/domain/invoice-status.ts');
      const { body } = await createContract({ startDate: '2026-09-01', periodMonths: 3 });
      await op.inject({
        method: 'POST', url: `/contracts/${body.contractId}/status`,
        payload: { to: 'terminated', terminatedDate: '2026-09-10', terminationReason: '중도 해지' },
      });
      const sep = (await invoicesOf(body.contractId)).find((i) => i.yearMonth === '2026-09');
      const asOf = new Date(2026, 8, 26);
      const st = displayInvoiceStatus({
        status: sep.status, paidAmount: sep.paidAmount, totalAmount: sep.totalAmount, dueDate: null, asOf,
      });
      check(`★ 해지 달 — 청구 ${sep.totalAmount} · 수납 ${sep.paidAmount} → 과납(overpaid)`, st === 'overpaid', st);
      const s = summarizeInvoices([sep], asOf);
      check('★ 미수금 0 · 과납 366,667', s.outstanding === 0 && s.overpaid === 366_667, JSON.stringify(s));

      const q = await queue();
      const waiting = q.pending.find((p) => p.contractId === body.contractId);
      /*
       * ★★ 환불 466,667 → **466,660**. 10원 미만을 버린다(2026-09-26).
       *    원장의 `net_amount` 가 이미 버린 값이고 정산 탭·정산서·정산 카드·정산 처리
       *    기본값이 전부 그것을 읽는다 — 네 곳이 같은 값이어야 한다.
       * ★ 시작일도 같이 내려온다(목록의 「시작일」 열).
       */
      check(
        '정산 탭 — 중도해지 정산 대기 · 환불 466,660 (466,667 에서 10원 미만 버림)',
        waiting?.kind === 'settlement' && waiting.amount === 466_660,
        JSON.stringify(waiting),
      );
      check('정산 탭 — 목록에 계약 시작일이 있다', waiting?.startDate === '2026-09-01', String(waiting?.startDate));

      const url = `/contracts/${body.contractId}/settlement/process`;
      const noAccount = await op.inject({ method: 'POST', url, payload: { paidOn: '2026-09-26', amount: 466_660, payMethod: 'B' } });
      check('★ 환불인데 계좌가 없으면 400', noAccount.statusCode === 400 && json(noAccount).error === 'refund_account_required', noAccount.body);
      const ok = await op.inject({
        method: 'POST', url,
        payload: { paidOn: '2026-09-26', amount: 466_660, payMethod: 'B', refundBank: '신한은행', refundAccount: '110-123-456789', refundHolder: '검증' },
      });
      check('정산 처리 200', ok.statusCode === 200, ok.body);
      const after = (await invoicesOf(body.contractId)).find((i) => i.yearMonth === '2026-09');
      check('★ 과납 장이 납부완료 — 수납 = 청구', after.paidAmount === after.totalAmount && after.status === 'E', JSON.stringify(after));
      check('★ 예치금 — 받음 뒤 반환 100,000 (차감 없음)', kinds(await depositsOf(body.contractId)) === 'receive:100000,return:100000');
      const q2 = await queue();
      const done = q2.done.find((p) => p.contractId === body.contractId);
      check(
        '정산 탭에서 빠지고 처리 완료',
        !q2.pending.some((p) => p.contractId === body.contractId) && done?.kind === 'settlement',
        JSON.stringify(done),
      );
      const company = json(await op.inject({ method: 'GET', url: `/companies/${COMPANY}/billing` }));
      const card = company.settlements.find((x) => x.contractId === body.contractId);
      check('정산 카드는 전체 계좌번호', card?.refund?.account === '110-123-456789', JSON.stringify(card?.refund));

      /*
       * ★★★ 절사는 **한 값**이어야 한다 — 원장(DB) · 정산 카드·정산서(API) · 정산 탭 ·
       *    정산 처리 기록. 한 곳만 안 버리면 「정산서는 466,667 인데 보낸 돈은 466,660」이 된다.
       */
      const ledger = await asOperator((c) =>
        c.query(
          `SELECT net_amount, processed_amount, deposit_return, total_paid, usage_charge,
                  discount_clawback, free_clawback
             FROM public.tb_s080_settlements WHERE contract_id = $1`,
          [body.contractId],
        ),
      );
      const L = ledger.rows[0] ?? {};
      check(
        '★★ 원장 net_amount 이 절사된 값 466,660 이고, 절사 전은 466,667 이다',
        L.net_amount === 466_660 &&
          L.deposit_return + (L.total_paid - L.usage_charge) - L.discount_clawback - L.free_clawback === 466_667,
        JSON.stringify(L),
      );
      check(
        '★★ 정산 카드·정산서가 같은 값 — netAmount 466,660 · netTrim 7',
        card?.netAmount === 466_660 && card?.netTrim === 7,
        JSON.stringify({ net: card?.netAmount, trim: card?.netTrim }),
      );
      check(
        '★★ 정산 탭 처리 완료 금액과 원장 처리 금액이 그 값이다',
        done?.amount === 466_660 && L.processed_amount === 466_660,
        JSON.stringify({ queue: done?.amount, ledger: L.processed_amount }),
      );
      /* ★ 이용료 차액은 **버리지 않는다** — 버리면 청구서 수납 합계가 어긋난다(mismatch 409). */
      check(
        '★★ 이용료 차액은 절사하지 않는다 — 366,667 그대로',
        card?.rentNet === 366_667,
        String(card?.rentNet),
      );
    }

    /* ═══ 24. 추가청구 — 예치금은 차감 ════════════════════════════════════ */
    console.log('\n24. 추가청구 — 예치금 차감');
    {
      const res = await op.inject({
        method: 'POST', url: '/contracts',
        payload: {
          companyId: COMPANY, buildId: BUILD_ID, contractRoom: nextRoom(), paymentMethod: 'M', periodMonths: 3,
          freeMonths: 1, contractDate: '2026-05-25', startDate: '2026-06-01', status: 'confirmed', memo: TAG,
          spaces: [spaceOf(nextSpace(), { standardFee: 300_000, monthlyFee: 270_000 })],
        },
      });
      const b = json(res);
      if (b.contractId) created.push(b.contractId);
      await op.inject({
        method: 'POST', url: `/contracts/${b.contractId}/status`,
        payload: { to: 'terminated', terminatedDate: '2026-08-15', terminationReason: '중도 해지' },
      });
      const ok = await op.inject({
        method: 'POST', url: `/contracts/${b.contractId}/settlement/process`,
        payload: { paidOn: '2026-09-26', amount: -719_677, payMethod: 'B' },
      });
      check('추가청구 정산은 계좌 없이 처리된다', ok.statusCode === 200, ok.body);
      check('★ 예치금 — 받음 뒤 차감 100,000 · 반환 없음', kinds(await depositsOf(b.contractId)) === 'receive:100000,deduct:100000');
    }

    /* ═══ 25. 월별 청구 목록의 계약 값 셋 — 예치금 · 이용 시작일 · 이용 종료일 ═══
       ★ 청구서가 아니라 **그 계약의 값**이다. 한 입주사가 계약을 여러 건 들고 있으면
         줄마다 다르다 — 그래서 청구서 줄에 붙여 내려보낸다.
       ★ 예치금은 **장부 잔액**이다(사용자 결정) — 반환하면 0 이 된다. */
    console.log('\n25. 월별 청구 목록 — 예치금 · 이용 시작일 · 이용 종료일');
    {
      const { body: b } = await createContract({
        paymentMethod: 'M', periodMonths: 3, freeMonths: 0,
        contractDate: '2026-09-25', startDate: '2026-10-01',
        spaces: [spaceOf(nextSpace(), { deposit: 500_000, monthlyFee: 400_000 })],
      });

      const listOf = async (ym) => {
        const res = json(await op.inject({ method: 'GET', url: `/billing/invoices?yearMonth=${ym}` }));
        return (res.invoices ?? []).find((i) => i.contractId === b.contractId);
      };

      const oct = await listOf('2026-10');
      check(
        '★ 예치금은 장부 잔액 500,000 · 이용 2026-10-01 ~ 2026-12-31 · 해지 아님',
        oct?.deposit === 500_000 && oct?.usageStart === '2026-10-01' && oct?.usageEnd === '2026-12-31' &&
          oct?.terminated === false,
        JSON.stringify(oct && { d: oct.deposit, s: oct.usageStart, e: oct.usageEnd, t: oct.terminated }),
      );

      await op.inject({
        method: 'POST', url: `/contracts/${b.contractId}/status`,
        payload: { to: 'terminated', terminatedDate: '2026-11-15', terminationReason: '검증 중도해지' },
      });
      const oct2 = await listOf('2026-10');
      check(
        '★★ 중도해지하면 이용 종료일이 **종료일자**가 된다 — 2026-11-15 · 해지 표시',
        oct2?.usageEnd === '2026-11-15' && oct2?.terminated === true,
        JSON.stringify(oct2 && { e: oct2.usageEnd, t: oct2.terminated }),
      );
      check(
        '★ 정산 처리 전이라 예치금은 아직 500,000 이다',
        oct2?.deposit === 500_000,
        String(oct2?.deposit),
      );
    }
  } finally {
    await op.close();

    /* ── 정리 ──────────────────────────────────────────────────────────────
       ★ 청구서·수납·정산은 계약에서 CASCADE 되지 않는다(일부러 그렇다 — 계약을
         지운다고 청구 기록이 조용히 사라지면 안 된다). 순서대로 지운다. */
    console.log('\n정리');
    const cleanup = await asOperator(async (c) => {
      const ids = await c.query(
        `SELECT contract_id FROM public.tb_s080_contracts WHERE memo = $1`,
        [TAG],
      );
      const list = ids.rows.map((r) => r.contract_id);
      if (list.length === 0) return { payments: 0, invoices: 0, settlements: 0, deposits: 0, contracts: 0 };

      const payments = await c.query(
        `DELETE FROM public.tb_s080_payments p
          USING public.tb_s080_invoices i
          WHERE i.invoice_id = p.invoice_id AND i.contract_id = ANY($1::text[])`,
        [list],
      );
      // 줄은 청구서에서 CASCADE 된다.
      const invoices = await c.query(
        `DELETE FROM public.tb_s080_invoices WHERE contract_id = ANY($1::text[])`,
        [list],
      );
      const settlements = await c.query(
        `DELETE FROM public.tb_s080_settlements WHERE contract_id = ANY($1::text[])`,
        [list],
      );
      // ★ 예치금 장부(024)도 계약을 참조한다 — 계약보다 먼저 지운다.
      const deposits = await c.query(
        `DELETE FROM public.tb_s080_deposit_ledger WHERE contract_id = ANY($1::text[])`,
        [list],
      );
      // 계약 항목은 계약에서 CASCADE 된다.
      const contracts = await c.query(
        `DELETE FROM public.tb_s080_contracts WHERE memo = $1`,
        [TAG],
      );
      await c.query(`DELETE FROM public.tb_s080_companies WHERE company_id = $1`, [TEMP_COMPANY]);
      return {
        payments: payments.rowCount,
        invoices: invoices.rowCount,
        settlements: settlements.rowCount,
        deposits: deposits.rowCount,
        contracts: contracts.rowCount,
      };
    });
    console.log(
      `  수납 ${cleanup.payments} · 청구서 ${cleanup.invoices} · 정산 ${cleanup.settlements} · 예치금 ${cleanup.deposits} · 계약 ${cleanup.contracts} 삭제`,
    );

    /*
     * ★ **이 검증이 만든 계약의 것만** 센다. 예전에는 표 전체를 셌는데, 개발계 DB 에
     *   사람이 화면으로 만든 청구서가 생기자(2026-09-26) 남의 데이터 때문에 실패했다.
     *   표 전체가 비어 있어야 한다는 가정은 공용 DB 에서 틀린다.
     */
    const mine = created;
    const left = await asOperator(async (c) => ({
      contracts: (await c.query(`SELECT count(*)::int n FROM public.tb_s080_contracts WHERE memo = $1`, [TAG])).rows[0].n,
      invoices: (await c.query(`SELECT count(*)::int n FROM public.tb_s080_invoices WHERE contract_id = ANY($1::text[])`, [mine])).rows[0].n,
      payments: (await c.query(`SELECT count(*)::int n FROM public.tb_s080_payments p JOIN public.tb_s080_invoices i ON i.invoice_id = p.invoice_id WHERE i.contract_id = ANY($1::text[])`, [mine])).rows[0].n,
      settlements: (await c.query(`SELECT count(*)::int n FROM public.tb_s080_settlements WHERE contract_id = ANY($1::text[])`, [mine])).rows[0].n,
      deposits: (await c.query(`SELECT count(*)::int n FROM public.tb_s080_deposit_ledger WHERE contract_id = ANY($1::text[])`, [mine])).rows[0].n,
      lines: (await c.query(`SELECT count(*)::int n FROM public.tb_s080_invoice_lines l JOIN public.tb_s080_invoices i ON i.invoice_id = l.invoice_id WHERE i.contract_id = ANY($1::text[])`, [mine])).rows[0].n,
      company: (await c.query(`SELECT count(*)::int n FROM public.tb_s080_companies WHERE company_id = $1`, [TEMP_COMPANY])).rows[0].n,
    }));
    check(
      '★ 검증 데이터가 하나도 안 남았다',
      left.contracts === 0 && left.invoices === 0 && left.payments === 0 &&
        left.settlements === 0 && left.deposits === 0 && left.lines === 0 && left.company === 0,
      JSON.stringify(left),
    );
    /*
     * ★★ 호실상태를 되맞춘다 — **계약을 SQL 로 지웠기 때문이다.**
     *
     * 호실상태는 계약이 정한다(`packages/api/src/db/spaceStatus.ts`). 업무 경로는 계약을
     * 지우지 않고 종료·취소로 닫으므로 앱이 알아서 맞춘다. 뒷정리는 그 길을 건너뛰고
     * 행을 지우므로, 여기서 한 번 다시 세지 않으면 **개발계 DB 에 「입주중」이 남는다**
     * (실측 2026-10-03: 검증을 몇 번 돌리자 72실 중 18실이 어긋났다).
     */
    const restored = await withCompanyScope({ role: 'operator', companyId: null }, (c) =>
      syncAllSpaceStatuses(c, 'verify-cleanup'),
    );
    if (restored > 0) console.log(`  호실상태 ${restored}실 되맞춤`);

    await closePool();
  }

  console.log(`\n${'='.repeat(56)}`);
  console.log(`검사 ${pass + fail}항목 — 통과 ${pass} · 실패 ${fail}`);
  // ★ 항목이 사라졌는지 본다 — 통과·실패만 세면 **덜 돈 것**을 알 수 없다.
  const short = itemCountGate({ expected: EXPECTED_ITEMS, actual: pass + fail, script: 'verify-billing.js' });
  if (fail > 0) {
    console.log('실패 항목:');
    for (const f of failures) console.log(`  · ${f}`);
  }
  if (fail > 0 || short) process.exit(1);
  console.log('✔ 청구·납부 1단계 검증 전부 통과');
})().catch(async (e) => {
  console.error('✘ 검증 중 오류:', e.stack || e.message);
  try {
    await withCompanyScope({ role: 'operator', companyId: null }, async (c) => {
      const ids = await c.query(`SELECT contract_id FROM public.tb_s080_contracts WHERE memo = $1`, [TAG]);
      const list = ids.rows.map((r) => r.contract_id);
      if (list.length > 0) {
        await c.query(
          `DELETE FROM public.tb_s080_payments p USING public.tb_s080_invoices i
            WHERE i.invoice_id = p.invoice_id AND i.contract_id = ANY($1::text[])`, [list]);
        await c.query(`DELETE FROM public.tb_s080_invoices WHERE contract_id = ANY($1::text[])`, [list]);
        await c.query(`DELETE FROM public.tb_s080_settlements WHERE contract_id = ANY($1::text[])`, [list]);
        await c.query(`DELETE FROM public.tb_s080_deposit_ledger WHERE contract_id = ANY($1::text[])`, [list]);
      }
      await c.query(`DELETE FROM public.tb_s080_contracts WHERE memo = $1`, [TAG]);
      await c.query(`DELETE FROM public.tb_s080_companies WHERE company_id = $1`, [TEMP_COMPANY]);
    });
    await closePool();
  } catch (cleanupErr) {
    console.error('✘ 정리도 실패했다 — 손으로 확인해야 한다:', cleanupErr.message);
  }
  process.exit(1);
});
