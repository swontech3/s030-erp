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

/** ★ RLS 가 걸린 표는 `pool.query` 로 못 읽는다 — GUC 없는 커넥션은 0행을 본다. */
const asOperator = (fn) => withCompanyScope({ role: 'operator', companyId: null }, fn);

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
        ORDER BY s.room_name LIMIT 26`,
      [BUILD_ID],
    ),
  );

  if (!BUILD_ID || !COMPANY || spaceRows.length < 24) {
    console.error(
      `✘ 준비 부족 — build=${BUILD_ID} company=${COMPANY} 빈비상주=${spaceRows.length}(24 필요)`,
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
      if (list.length === 0) return { payments: 0, invoices: 0, settlements: 0, contracts: 0 };

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
        contracts: contracts.rowCount,
      };
    });
    console.log(
      `  수납 ${cleanup.payments} · 청구서 ${cleanup.invoices} · 정산 ${cleanup.settlements} · 계약 ${cleanup.contracts} 삭제`,
    );

    const left = await asOperator(async (c) => ({
      contracts: (await c.query(`SELECT count(*)::int n FROM public.tb_s080_contracts WHERE memo = $1`, [TAG])).rows[0].n,
      invoices: (await c.query(`SELECT count(*)::int n FROM public.tb_s080_invoices`)).rows[0].n,
      payments: (await c.query(`SELECT count(*)::int n FROM public.tb_s080_payments`)).rows[0].n,
      settlements: (await c.query(`SELECT count(*)::int n FROM public.tb_s080_settlements`)).rows[0].n,
      lines: (await c.query(`SELECT count(*)::int n FROM public.tb_s080_invoice_lines`)).rows[0].n,
      company: (await c.query(`SELECT count(*)::int n FROM public.tb_s080_companies WHERE company_id = $1`, [TEMP_COMPANY])).rows[0].n,
    }));
    check(
      '★ 검증 데이터가 하나도 안 남았다',
      left.contracts === 0 && left.invoices === 0 && left.payments === 0 &&
        left.settlements === 0 && left.lines === 0 && left.company === 0,
      JSON.stringify(left),
    );
    await closePool();
  }

  console.log(`\n${'='.repeat(56)}`);
  console.log(`검사 ${pass + fail}항목 — 통과 ${pass} · 실패 ${fail}`);
  if (fail > 0) {
    console.log('실패 항목:');
    for (const f of failures) console.log(`  · ${f}`);
    process.exit(1);
  }
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
