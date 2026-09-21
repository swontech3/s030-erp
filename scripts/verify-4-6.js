/**
 * 4-6 재계약 검증 — 실제 DB 에 붙어서 라우트를 왕복시킨다 (CONT-01 · CONT-02).
 *
 * ★ 왜 vitest 가 아니라 이 자리인가. 규칙 자체는 순수 함수 쪽에 있고
 *   (`packages/shared/src/domain/contract-renewal.test.ts`), 여기서 보는 것은
 *   **라우트 · 트랜잭션 · RLS 가 실제로 그렇게 도는가**다. 4-3 검증과 같은 방식이다.
 *
 * =============================================================================
 * ★★★ 이 검증의 본체 — 재계약은 **자기 이전 계약과 부딪힐 수 있다**
 * =============================================================================
 * 재계약을 만들어도 이전 계약은 자동으로 종료되지 않는다. 그래서 저장 순간 두 계약이
 * 같은 계약호실과 같은 호실을 동시에 들고 있고, 이전 계약을 「자기」로 보지 않으면
 * **저장이 막힌다.** 비상주(VR)는 한 호실에 한 회사라 특히 그렇다.
 *
 * 아래 2·3 번이 그 자리이고, 4 번이 **그 예외가 남에게까지 새지 않는지**를 본다.
 *
 * ★ 세션 훅을 우회한다. 쿠키를 만들려면 삐용 로그인이 필요한데, 여기서 보려는 것은
 *   인증이 아니라 계약 라우트다.
 *
 * ★ 넣은 것은 전부 지운다. 개발계 공용 DB 라 흔적을 남기지 않는다.
 *
 * 사용: node --experimental-strip-types scripts/verify-4-6.js
 */
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { registerContractRoutes } from '../packages/api/src/routes/contracts.ts';
import { PREVIOUS_TERMINATION_REASON } from '../packages/shared/src/domain/contract-renewal.ts';
import { dayAfter } from '../packages/shared/src/domain/day.ts';
import { pool, closePool } from '../packages/api/src/db/pool.ts';
import { withCompanyScope } from '../packages/api/src/db/withCompanyScope.ts';

/**
 * ★★ RLS 가 걸린 표는 `pool.query` 로 직접 못 읽는다 — GUC 없는 커넥션은 정책이
 *    **0행**을 준다. `contracts`·`contract_spaces`·`contract_status_history` 를 볼 때는
 *    반드시 이 헬퍼를 쓴다(4-3 검증이 이 함정으로 6항목을 잘못 실패시킨 적이 있다).
 */
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
const TAG = `verify-4-6-${Date.now()}`;

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
  return app;
}

const operatorSession = (companyId) => ({
  s020MemberId: 1,
  s020OrgId: 1,
  memberName: '검증 운영자',
  companyId,
  role: 'operator',
  screens: [],
});

const json = (res) => {
  try {
    return JSON.parse(res.body);
  } catch {
    return { __raw: res.body };
  }
};

(async () => {
  /*
   * ── 준비 ────────────────────────────────────────────────────────────────
   * ★ **비상주(VR) 호실**을 빌린다. 「아무도 없어야 고를 수 있다」는 가장 빡빡한 규칙이라
   *   자기 예외가 빠지면 여기서 먼저 터진다. 느슨한 호실로 검증하면 통과해 버린다.
   *
   * ★ 회사는 **둘** 필요하다. 하나는 재계약용, 하나는 「남의 계약은 여전히 막힌다」용.
   */
  const { rows: fkRows } = await pool.query(
    `SELECT (SELECT build_id FROM public.tb_s080_buildings LIMIT 1) build_id`,
  );
  const BUILD_ID = fkRows[0].build_id;

  const { rows: companyRows } = await pool.query(
    `SELECT company_id FROM public.tb_s080_companies ORDER BY company_id LIMIT 2`,
  );
  /*
   * ★★ **아무도 안 쓰는** 비상주 호실을 고른다. 그냥 첫 호실을 집으면 실제 계약이
   *    들어 있는 호실이 걸리고, 그러면 준비 단계부터 「이미 사용 중」으로 막혀
   *    검증이 시작조차 못 한다 — 처음에 실제로 그랬다(`VIR 01` 에 두 회사).
   *
   * ★ 「살아 있는 계약」의 정의는 라우트와 같아야 한다(`confirmed`·`draft`).
   *   여기서만 다르게 세면 비어 보이는 호실이 사실은 차 있다.
   */
  const { rows: spaceRows } = await asOperator((c) =>
    c.query(
      `SELECT s.space_id, s.room_name, s.room_type, s.standard_fee
         FROM public.tb_s080_spaces s
        WHERE s.build_id = $1 AND s.room_type = 'VR' AND s.is_active
          AND NOT EXISTS (
            SELECT 1
              FROM public.tb_s080_contract_spaces cs
              JOIN public.tb_s080_contracts k ON k.contract_id = cs.contract_id
             WHERE cs.space_id = s.space_id AND k.status IN ('confirmed', 'draft'))
        ORDER BY s.room_name
        LIMIT 3`,
      [BUILD_ID],
    ),
  );

  if (!BUILD_ID || companyRows.length < 2 || spaceRows.length < 3) {
    console.error('✘ 건물·회사 2곳·빈 비상주 호실 3실이 모자라 검증할 수 없다');
    process.exit(1);
  }

  const COMPANY_A = companyRows[0].company_id;
  const COMPANY_B = companyRows[1].company_id;
  /*
   * ★ 호실이 **둘** 필요하다. 앞부분(1~7)이 만든 재계약(계약대기)이 첫 호실과 첫
   *   계약호실을 계속 붙들고 있어서, 뒷부분(8~10)이 같은 값을 다시 쓰면 그 draft 와
   *   부딪힌다 — 재계약 규칙과 무관한 실패다.
   */
  const VR = spaceRows[0];
  const VR2 = spaceRows[1];
  /** 10번(서류 부족 롤백) 전용. 8~9번이 VR2 를 붙들고 있어 또 쓸 수 없다. */
  const VR3 = spaceRows[2];
  /** 계약호실 — 실재 번호와 겹치지 않도록 표식에서 만든다. */
  const ROOM = `V9-${String(Date.now()).slice(-5)}`;
  const ROOM2 = `${ROOM}-2`;
  /** 이전 계약이 2026-01-02 + 12개월 → 종료일 2027-01-01. 재계약은 그 **다음 날**부터다. */
  const RENEW_START = '2027-01-02';

  console.log(
    `준비 — build=${BUILD_ID} A=${COMPANY_A} B=${COMPANY_B}\n` +
      `       비상주=${VR.room_name}·${VR2.room_name}·${VR3.room_name} 계약호실=${ROOM}·${ROOM2}\n`,
  );

  const vrSpace = (space = VR) => ({
    roomType: space.room_type,
    spaceId: space.space_id,
    standardFee: space.standard_fee ?? 0,
    deposit: 0,
    monthlyFee: 30_000,
    vatYn: true,
  });

  const body = (over = {}) => ({
    buildId: BUILD_ID,
    contractRoom: ROOM,
    paymentMethod: 'M',
    periodMonths: 12,
    contractDate: '2026-01-02',
    startDate: '2026-01-02',
    memo: TAG,
    spaces: [vrSpace()],
    ...over,
  });

  const op = buildApp(operatorSession(COMPANY_A));
  const created = [];
  /** 검증 도중에 **직접** 지운 계약 수. 마지막 대조에서 뺀다. */
  let createdRemoved = 0;

  try {
    // ── 1. 이전 계약 — 계약중(confirmed) 인 비상주 계약 ──────────────────────
    console.log('1. 이전 계약 — 비상주 · 계약중');
    let res = await op.inject({
      method: 'POST',
      url: '/contracts',
      payload: body({ companyId: COMPANY_A }),
    });
    const prev = json(res);
    check('만들어진다', res.statusCode === 201, `${res.statusCode} ${res.body}`);
    if (prev.contractId) created.push(prev.contractId);

    // 확정으로 올린다 — 첨부 게이트가 걸리면 draft 로 두고 그대로 간다.
    // 「살아 있는 계약」은 confirmed·draft 둘 다라 검증의 성격은 바뀌지 않는다.
    res = await op.inject({
      method: 'POST',
      url: `/contracts/${prev.contractId}/status`,
      payload: { to: 'confirmed' },
    });
    const confirmed = res.statusCode === 200;
    console.log(
      confirmed
        ? '  · 계약중으로 올렸다'
        : `  · 계약대기로 둔다(첨부 게이트: ${json(res).message ?? res.statusCode}) — 살아 있는 계약인 것은 같다`,
    );

    /*
     * ── 2. ★★ 재계약 — 같은 호실·같은 계약호실로 저장된다 ────────────────────
     * ★ 시작일은 **이전 종료일 다음 날**이어야 한다(8번이 그 경계를 따로 본다).
     *   이전 계약이 2026-01-02 + 12개월이라 종료일은 2027-01-01 이다.
     */
    console.log('\n2. ★★ 재계약 — 이전 계약을 「자기」로 본다');
    res = await op.inject({
      method: 'POST',
      url: '/contracts',
      payload: body({
        companyId: COMPANY_A,
        startDate: RENEW_START,
        renewedFromContractId: prev.contractId,
      }),
    });
    const renewal = json(res);
    check(
      '★ 같은 비상주 호실 · 같은 계약호실로 저장된다 — 자기 이전 계약에 막히지 않는다',
      res.statusCode === 201,
      `${res.statusCode} ${res.body}`,
    );
    if (renewal.contractId) created.push(renewal.contractId);

    // ── 3. 이어받은 계약이 기록된다 ─────────────────────────────────────────
    console.log('\n3. 이어받은 계약이 기록된다 (CSCH-04)');
    res = await op.inject({ method: 'GET', url: `/contracts/${renewal.contractId}` });
    const fetched = json(res);
    check(
      '★ renewedFromContractId 에 이전 계약이 적혀 있다',
      // ★ `!!prev.contractId` 를 함께 본다 — 준비가 깨져 둘 다 undefined 일 때
      //   `undefined === undefined` 로 **통과해 버린 적이 있다.**
      !!prev.contractId && fetched.renewedFromContractId === prev.contractId,
      String(fetched.renewedFromContractId),
    );
    check('계약호실을 이어받았다', fetched.contractRoom === ROOM, String(fetched.contractRoom));
    check(
      '호실 줄을 이어받았다',
      fetched.spaces?.[0]?.spaceId === VR.space_id,
      String(fetched.spaces?.[0]?.spaceId),
    );

    // ── 4. 이전 계약은 건드리지 않는다 ──────────────────────────────────────
    console.log('\n4. 이전 계약은 그대로다 — 자동 종료가 없다');
    res = await op.inject({ method: 'GET', url: `/contracts/${prev.contractId}` });
    const prevNow = json(res);
    check(
      `★ 이전 계약의 상태가 그대로다 (${confirmed ? 'confirmed' : 'draft'})`,
      prevNow.status === (confirmed ? 'confirmed' : 'draft'),
      String(prevNow.status),
    );
    check('이전 계약의 계약호실도 그대로다', prevNow.contractRoom === ROOM, String(prevNow.contractRoom));
    check('이전 계약은 아무 계약도 이어받지 않았다', prevNow.renewedFromContractId === null);

    // ── 5. ★★ 예외가 남에게 새지 않는다 ─────────────────────────────────────
    console.log('\n5. ★★ 남의 계약은 여전히 막힌다');
    const opB = buildApp(operatorSession(COMPANY_B));
    res = await opB.inject({
      method: 'POST',
      url: '/contracts',
      payload: body({ companyId: COMPANY_B }),
    });
    const blocked = json(res);
    if (blocked.contractId) created.push(blocked.contractId);
    check(
      '★ 다른 회사가 같은 계약호실을 쓰면 409 로 막힌다',
      res.statusCode === 409,
      `${res.statusCode} ${res.body}`,
    );
    check(
      '어느 회사가 쓰고 있는지 말한다',
      typeof blocked.message === 'string' && blocked.message.includes('사용 중'),
      String(blocked.message),
    );

    // ── 6. 이어받기 자체의 검증 ─────────────────────────────────────────────
    console.log('\n6. 이어받기 검증 — 주소창 값을 믿지 않는다');
    res = await opB.inject({
      method: 'POST',
      url: '/contracts',
      payload: body({
        companyId: COMPANY_B,
        contractRoom: `${ROOM}-B`,
        renewedFromContractId: prev.contractId,
      }),
    });
    if (json(res).contractId) created.push(json(res).contractId);
    check(
      '★ 다른 입주사의 계약은 이어받을 수 없다 — 400',
      res.statusCode === 400,
      `${res.statusCode} ${res.body}`,
    );

    res = await op.inject({
      method: 'POST',
      url: '/contracts',
      payload: body({
        companyId: COMPANY_A,
        contractRoom: `${ROOM}-C`,
        renewedFromContractId: '00000000-0000-0000-0000-000000000000',
      }),
    });
    if (json(res).contractId) created.push(json(res).contractId);
    check(
      '★ 없는 계약은 이어받을 수 없다 — 400',
      res.statusCode === 400,
      `${res.statusCode} ${res.body}`,
    );
    await opB.close();

    // ── 7. 저장된 재계약을 다시 열어 그대로 저장한다 ────────────────────────
    console.log('\n7. 저장된 재계약을 열어 그대로 저장한다');
    res = await op.inject({
      method: 'PATCH',
      url: `/contracts/${renewal.contractId}`,
      payload: body({ companyId: COMPANY_A, startDate: RENEW_START }),
    });
    check(
      '★ 자기와 이전 계약을 둘 다 빼므로 막히지 않는다',
      // draft 면 200, confirmed 면 409(contract_locked) 다 — 잠금은 재계약과 무관한
      // 다른 규칙이라 그 둘만 정상으로 본다. room_taken·space_taken 이면 실패다.
      res.statusCode === 200 || json(res).error === 'contract_locked',
      `${res.statusCode} ${res.body}`,
    );

    /* ════════════════════════════════════════════════════════════════════════
       여기부터는 **두 번째 호실·두 번째 계약호실**을 쓴다.
       위에서 만든 재계약(계약대기)이 첫 호실과 ROOM 을 아직 붙들고 있어서,
       같은 값으로 또 만들면 그 draft 와 부딪힌다 — 재계약 규칙과 무관한 실패다.
       ════════════════════════════════════════════════════════════════════════ */

    // ── 8. 시작일 경계 — 종료일 당일은 막히고 다음 날은 된다 ────────────────
    console.log('\n8. ★★ 시작일 경계 — 하루도 겹치지 않는다');
    res = await op.inject({
      method: 'POST',
      url: '/contracts',
      payload: body({
        companyId: COMPANY_A,
        contractRoom: ROOM2,
        spaces: [vrSpace(VR2)],
        startDate: '2026-01-02',
        periodMonths: 12,
      }),
    });
    const prev2 = json(res);
    check('두 번째 이전 계약이 만들어진다', res.statusCode === 201, `${res.statusCode} ${res.body}`);
    if (prev2.contractId) created.push(prev2.contractId);

    res = await op.inject({ method: 'GET', url: `/contracts/${prev2.contractId}` });
    const prev2End = String(json(res).endDate).slice(0, 10);
    console.log(`  · 이전 계약 종료일 = ${prev2End}`);

    // 종료일 **당일**로 시작하는 재계약 — 하루 겹친다.
    res = await op.inject({
      method: 'POST',
      url: '/contracts',
      payload: body({
        companyId: COMPANY_A,
        contractRoom: ROOM2,
        spaces: [vrSpace(VR2)],
        startDate: prev2End,
        renewedFromContractId: prev2.contractId,
      }),
    });
    if (json(res).contractId) created.push(json(res).contractId);
    check(
      '★★ 시작일 = 이전 종료일 → 400 으로 막힌다 (하루 겹침)',
      res.statusCode === 400 && json(res).error === 'invalid_renewal',
      `${res.statusCode} ${res.body}`,
    );

    // ── 9. 재계약 확정 — 한 번에 두 계약 ────────────────────────────────────
    console.log('\n9. ★★★ 재계약 확정 — 새 계약 계약중 · 이전 계약 계약종료');
    // 이전 계약을 계약중으로 올린다. 여기서 막히면 9번 전체가 성립하지 않는다.
    res = await op.inject({
      method: 'POST',
      url: `/contracts/${prev2.contractId}/status`,
      payload: { to: 'confirmed' },
    });
    check('이전 계약을 계약중으로 올렸다', res.statusCode === 200, `${res.statusCode} ${res.body}`);

    const nextStart = dayAfter(prev2End);
    res = await op.inject({
      method: 'POST',
      url: '/contracts',
      payload: body({
        companyId: COMPANY_A,
        contractRoom: ROOM2,
        spaces: [vrSpace(VR2)],
        startDate: nextStart,
        status: 'confirmed',
        renewedFromContractId: prev2.contractId,
      }),
    });
    const renewal2 = json(res);
    if (renewal2.contractId) created.push(renewal2.contractId);
    check(
      `★ 시작일 = 이전 종료일 다음 날(${nextStart}) → 확정된다`,
      res.statusCode === 201,
      `${res.statusCode} ${res.body}`,
    );
    check(
      '★ 이전 계약을 닫았다고 응답이 말한다',
      renewal2.closedPrevious === prev2.contractId,
      String(renewal2.closedPrevious),
    );

    res = await op.inject({ method: 'GET', url: `/contracts/${renewal2.contractId}` });
    check("★ 새 계약이 'confirmed' 다", json(res).status === 'confirmed', String(json(res).status));

    res = await op.inject({ method: 'GET', url: `/contracts/${prev2.contractId}` });
    const closed = json(res);
    check("★★ 이전 계약이 'terminated' 로 닫혔다", closed.status === 'terminated', String(closed.status));
    check(
      '★ 종료일자 = 이전 계약의 **원래 종료일** (오늘이 아니다)',
      String(closed.terminatedDate).slice(0, 10) === prev2End,
      `${String(closed.terminatedDate).slice(0, 10)} ≠ ${prev2End}`,
    );
    check(
      '★ 사유가 「재계약으로 계약 종료」다',
      closed.terminationReason === PREVIOUS_TERMINATION_REASON,
      String(closed.terminationReason),
    );

    // 상태 이력 — **두 계약 모두** 남는다.
    const hist = await asOperator((c) =>
      c.query(
        `SELECT contract_id, from_status, to_status
           FROM public.tb_s080_contract_status_history
          WHERE contract_id = ANY($1::text[]) ORDER BY changed_at`,
        [[prev2.contractId, renewal2.contractId]],
      ),
    );
    check(
      '★ 이전 계약에 confirmed → terminated 이력이 남았다',
      hist.rows.some(
        (r) => r.contract_id === prev2.contractId && r.from_status === 'confirmed' && r.to_status === 'terminated',
      ),
      JSON.stringify(hist.rows),
    );
    check(
      '★ 새 계약에 최초 생성(confirmed) 이력이 남았다',
      hist.rows.some(
        (r) => r.contract_id === renewal2.contractId && r.from_status === null && r.to_status === 'confirmed',
      ),
      JSON.stringify(hist.rows),
    );

    // ── 10. ★★★ 확정이 막히면 **둘 다 그대로** ─────────────────────────────
    console.log('\n10. ★★★ 확정이 막히면 아무것도 저장되지 않는다');
    /*
     * 서류가 없는 회사를 **이 검증이 직접 만든다.** 개발계의 회사는 넷 다 서류가
     * 갖춰져 있어서 그대로는 이 길을 밟을 수 없고, 남의 서류를 지웠다 되돌리는 것은
     * 검증이 할 일이 아니다. 만든 회사는 마지막에 지운다.
     */
    const tmpCompany = randomUUID();
    await asOperator((c) =>
      c.query(
        `INSERT INTO public.tb_s080_companies
           (company_id, build_id, company_name, member_type, updated_at, created_at)
         VALUES ($1, $2, $3, 'R', now(), now())`,
        [tmpCompany, BUILD_ID, `${TAG}-서류없는회사`],
      ),
    );

    res = await op.inject({
      method: 'POST',
      url: '/contracts',
      payload: body({
        companyId: tmpCompany,
        contractRoom: `${ROOM}-D`,
        spaces: [vrSpace(VR3)],
        startDate: '2026-01-02',
        periodMonths: 12,
      }),
    });
    const bare = json(res);
    if (bare.contractId) created.push(bare.contractId);
    check('서류 없는 회사도 계약대기로는 만들어진다', res.statusCode === 201, `${res.statusCode} ${res.body}`);

    const before = await asOperator((c) =>
      c.query(`SELECT count(*)::int n FROM public.tb_s080_contracts WHERE company_id = $1`, [tmpCompany]),
    );

    res = await op.inject({
      method: 'POST',
      url: '/contracts',
      payload: body({
        companyId: tmpCompany,
        contractRoom: `${ROOM}-D`,
        spaces: [vrSpace(VR3)],
        startDate: '2027-01-02',
        status: 'confirmed',
        renewedFromContractId: bare.contractId,
      }),
    });
    if (json(res).contractId) created.push(json(res).contractId);
    check(
      '★ 서류 부족으로 확정이 막힌다 — 409',
      res.statusCode === 409 && json(res).error === 'docs_missing',
      `${res.statusCode} ${res.body}`,
    );

    const after = await asOperator((c) =>
      c.query(`SELECT count(*)::int n, min(status) s FROM public.tb_s080_contracts WHERE company_id = $1`, [
        tmpCompany,
      ]),
    );
    check(
      '★★ 새 계약이 만들어지지 않았다 — 검사가 쓰기보다 앞선다',
      after.rows[0].n === before.rows[0].n,
      `${before.rows[0].n} → ${after.rows[0].n}`,
    );
    check(
      '★★ 이전 계약이 그대로다 — 닫히지 않았다',
      after.rows[0].s === 'draft',
      String(after.rows[0].s),
    );

    await asOperator((c) =>
      c.query(`DELETE FROM public.tb_s080_contracts WHERE company_id = $1`, [tmpCompany]),
    );
    await asOperator((c) =>
      c.query(`DELETE FROM public.tb_s080_companies WHERE company_id = $1`, [tmpCompany]),
    );
    // 위에서 직접 지웠으므로 마지막 대조에서 빼 준다.
    createdRemoved += created.filter((id) => id === bare.contractId).length;
  } finally {
    await op.close();

    // ── 정리 ────────────────────────────────────────────────────────────────
    console.log('\n정리');
    /*
     * ★ **재계약을 먼저 지운다.** 자기참조 FK 가 `ON DELETE SET NULL` 이라 순서 때문에
     *   실패하지는 않지만, 한 번에 지우면 몇 건이 지워졌는지로 대조할 수 없다.
     * ★ 스코프 안에서 지운다 — GUC 없이 DELETE 하면 RLS 가 0행을 골라 **조용히
     *   아무것도 지우지 않는다.**
     */
    const del = await asOperator((c) =>
      c.query(`DELETE FROM public.tb_s080_contracts WHERE memo = $1 RETURNING contract_id`, [TAG]),
    );
    console.log(`  계약 ${del.rowCount}건 삭제 (${created.length}건 만들고 ${createdRemoved}건은 도중에 지웠다)`);
    const left = await asOperator((c) =>
      c.query(`SELECT count(*)::int n FROM public.tb_s080_contracts WHERE memo = $1`, [TAG]),
    );
    check('검증 데이터가 남지 않았다', left.rows[0].n === 0, `${left.rows[0].n}행 남음`);
    check(
      '만든 만큼 지웠다',
      del.rowCount === created.length - createdRemoved,
      `${del.rowCount} ≠ ${created.length} - ${createdRemoved}`,
    );
    await closePool();
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`검사 ${pass + fail}항목 — 통과 ${pass} · 실패 ${fail}`);
  if (fail > 0) {
    console.log('실패 항목:');
    for (const f of failures) console.log(`  · ${f}`);
    process.exit(1);
  }
  console.log('✔ 4-6 재계약 검증 전부 통과');
})().catch(async (e) => {
  console.error('✘ 검증 중 오류:', e.stack || e.message);
  try {
    await withCompanyScope({ role: 'operator', companyId: null }, (c) =>
      c.query(`DELETE FROM public.tb_s080_contracts WHERE memo = $1`, [TAG]),
    );
    await closePool();
  } catch {}
  process.exit(1);
});
