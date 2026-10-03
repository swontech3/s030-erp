/**
 * 4-3 계약 CRUD API 검증 — 실제 DB 에 붙어서 라우트를 왕복시킨다.
 *
 * ★ 왜 vitest 가 아니라 이 자리인가. 이 프로젝트의 DB 검증 관례가 `scripts/verify-*.js`
 *   다(001-003 · 2-8 · 010). 단위 시험은 순수 함수 쪽에 있고(`packages/shared`),
 *   여기서 보는 것은 **라우트 · 트랜잭션 · RLS 가 실제로 그렇게 도는가**다.
 *
 * ★ 세션 훅을 우회한다. 쿠키를 만들려면 삐용 로그인이 필요한데, 여기서 보려는 것은
 *   인증이 아니라 계약 라우트다. Fastify 인스턴스를 따로 세우고 `req.session` 을
 *   직접 넣는다 — **운영 코드를 고치지 않고** 라우트만 갈아 끼운다.
 *
 * ★ 넣은 것은 전부 지운다. 개발계 공용 DB 라 흔적을 남기지 않는다.
 *
 * 사용: node --experimental-strip-types scripts/verify-4-3.js
 */
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { registerContractRoutes } from '../packages/api/src/routes/contracts.ts';
import { pool, closePool } from '../packages/api/src/db/pool.ts';
import { withCompanyScope } from '../packages/api/src/db/withCompanyScope.ts';
import { syncAllSpaceStatuses } from '../packages/api/src/db/spaceStatus.ts';

/**
 * ★★ RLS 가 걸린 표는 `pool.query` 로 직접 못 읽는다.
 *
 * GUC(`app.current_role`)가 없는 커넥션은 정책이 **0행**을 준다 — fail-closed 라
 * 그게 정상 동작이다. 이 스크립트가 처음에 그걸로 6항목을 잘못 실패시켰다:
 * 이력이 실제로 쌓였는데 0행으로 보였고, 정리 DELETE 도 0건이 지워졌다.
 *
 * RLS 대상(`contracts` · `contract_spaces` · `contract_status_history`)을 볼 때는
 * **반드시 이 헬퍼를 쓴다.** `buildings` · `companies` · `spaces` 는 RLS 가 없어
 * `pool.query` 로 읽어도 된다(003 의 정책 목록에 없다).
 */
const asOperator = (fn) => withCompanyScope({ role: 'operator', companyId: null }, fn);

const { itemCountGate } = require('./verify-count.js');

/**
 * 기대 항목 수 — 모자라면 **실패**다. 항목이 조용히 사라지는 것을 막는 유일한 장치이고,
 * 경위는 `verify-count.js` 머리말에 있다. 항목을 늘리면 끝에서 이 수를 고치라고 알려 준다.
 */
const EXPECTED_ITEMS = 35;
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
const TAG = `verify-4-3-${Date.now()}`;

/** 세션을 주입한 Fastify 인스턴스. role 을 바꿔 가며 같은 라우트를 부른다. */
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

const tenantSession = (companyId) => ({
  s020MemberId: 2,
  s020OrgId: 9001,
  memberName: '검증 입주사',
  companyId,
  role: 'tenant',
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
  // ── 준비 — FK 를 만족시킬 실제 값을 빌린다 ────────────────────────────────
  const { rows: fkRows } = await pool.query(
    `SELECT (SELECT build_id   FROM public.tb_s080_buildings LIMIT 1) build_id,
            (SELECT company_id FROM public.tb_s080_companies LIMIT 1) company_id`,
  );
  const BUILD_ID = fkRows[0].build_id;
  const COMPANY_ID = fkRows[0].company_id;

  /*
   * ★★ **비어 있는 호실만 빌린다**(2026-10-03). 호실마다 「입주 가능 회사 수」가
   *    있고 기본이 1곳이라, 아무 호실이나 집으면 이미 계약이 든 방(예: Room 1)에
   *    걸려 준비 단계에서 409 가 난다. 다른 검증들(`verify-3-2`·`3-5`·`4-6`·
   *    `billing`·`print`)이 쓰는 것과 **같은 조건**이다.
   */
  const { rows: spaceRows } = await pool.query(
    `SELECT s.space_id, s.room_type, s.standard_fee
       FROM public.tb_s080_spaces s
      WHERE s.build_id = $1 AND s.is_active
        AND NOT EXISTS (
          SELECT 1 FROM public.tb_s080_contract_spaces cs
            JOIN public.tb_s080_contracts k ON k.contract_id = cs.contract_id
           WHERE cs.space_id = s.space_id AND k.status IN ('confirmed', 'draft'))
      ORDER BY s.room_name LIMIT 3`,
    [BUILD_ID],
  );
  if (!BUILD_ID || !COMPANY_ID || spaceRows.length < 2) {
    console.error('✘ 건물·회사·빈 호실이 모자라 검증할 수 없다');
    process.exit(1);
  }
  console.log(`준비 — build=${BUILD_ID} company=${COMPANY_ID} 호실 ${spaceRows.length}개\n`);

  const space = (i, over = {}) => ({
    roomType: spaceRows[i].room_type,
    spaceId: spaceRows[i].space_id,
    standardFee: spaceRows[i].standard_fee ?? 0,
    deposit: 900_000,
    monthlyFee: 400_000,
    vatYn: true,
    ...over,
  });

  const baseBody = (over = {}) => ({
    companyId: COMPANY_ID,
    buildId: BUILD_ID,
    paymentMethod: 'M',
    periodMonths: 12,
    startDate: '2026-03-01',
    memo: TAG,
    spaces: [space(0)],
    ...over,
  });

  const op = buildApp(operatorSession(COMPANY_ID));
  const created = [];

  try {
    // ── 1. 계약 등록 (draft) ────────────────────────────────────────────────
    console.log('1. 계약 등록 — draft');
    let res = await op.inject({ method: 'POST', url: '/contracts', payload: baseBody() });
    const draft = json(res);
    check('201 로 만들어진다', res.statusCode === 201, `${res.statusCode} ${res.body}`);
    check('계약 ID 가 돌아온다', typeof draft.contractId === 'string' && draft.contractId.length > 0);
    check("상태가 'draft' 다", draft.status === 'draft');
    if (draft.contractId) created.push(draft.contractId);

    // ── 2. 조회 ─────────────────────────────────────────────────────────────
    console.log('\n2. 조회');
    res = await op.inject({ method: 'GET', url: `/contracts/${draft.contractId}` });
    const fetched = json(res);
    check('200 으로 읽힌다', res.statusCode === 200, `${res.statusCode} ${res.body}`);
    check('호실 줄이 함께 온다', Array.isArray(fetched.spaces) && fetched.spaces.length === 1);
    check('No(seq)가 1부터 매겨져 있다', fetched.spaces?.[0]?.seq === 1);
    check(
      '★ 종료일을 서버가 계산했다 — 2026-03-01 + 12개월 = 2027-02-28',
      String(fetched.endDate).slice(0, 10) === '2027-02-28',
      String(fetched.endDate),
    );
    check(
      '★ 첫달납부액을 서버가 계산했다 — 440,000 + 900,000',
      fetched.firstPayment === 1_340_000,
      String(fetched.firstPayment),
    );
    check('★ 부가세를 서버가 계산했다 — 40,000', fetched.spaces?.[0]?.vatAmount === 40_000);

    // ── 3. 화면이 틀린 파생값을 보내도 서버 값이 저장된다 (CONT-10) ─────────
    console.log('\n3. 화면 값을 믿지 않는다 (CONT-10)');
    res = await op.inject({
      method: 'POST',
      url: '/contracts',
      payload: baseBody({
        spaces: [space(0, { monthlyFee: 99_999, vatAmount: 10_000, paymentAmount: 109_999 })],
      }),
    });
    const rounded = json(res);
    if (rounded.contractId) created.push(rounded.contractId);
    check('만들어진다', res.statusCode === 201, `${res.statusCode} ${res.body}`);
    check('★ 어긋난 칸이 경고로 돌아온다', Array.isArray(rounded.warnings) && rounded.warnings.length === 2);
    res = await op.inject({ method: 'GET', url: `/contracts/${rounded.contractId}` });
    check(
      '★ 저장된 것은 서버 값(버림 9,999)이다',
      json(res).spaces?.[0]?.vatAmount === 9_999,
      String(json(res).spaces?.[0]?.vatAmount),
    );

    // ── 4. 상태 이력 (CONT-11) ──────────────────────────────────────────────
    console.log('\n4. 상태 이력 (CONT-11)');
    let hist = await asOperator((c) =>
      c.query(
        `SELECT from_status, to_status FROM public.tb_s080_contract_status_history
          WHERE contract_id = $1 ORDER BY changed_at`,
        [draft.contractId],
      ),
    );
    check('최초 생성이 1행 남았다', hist.rows.length === 1, `${hist.rows.length}행`);
    check('from_status 가 NULL 이다 — 이전 상태가 없다', hist.rows[0]?.from_status === null);
    check("to_status 가 'draft' 다", hist.rows[0]?.to_status === 'draft');

    // ── 5. 섹션2 수정 — draft 는 된다 ───────────────────────────────────────
    console.log('\n5. 섹션2 수정');
    res = await op.inject({
      method: 'PATCH',
      url: `/contracts/${draft.contractId}`,
      payload: baseBody({ periodMonths: 6, spaces: [space(0), space(1)] }),
    });
    check('draft 는 수정된다', res.statusCode === 200, `${res.statusCode} ${res.body}`);
    res = await op.inject({ method: 'GET', url: `/contracts/${draft.contractId}` });
    check('호실 줄이 2개로 바뀌었다', json(res).spaces?.length === 2, String(json(res).spaces?.length));
    check('기간이 6개월로 바뀌었다', json(res).periodMonths === 6);

    // ── 6. 상태 전이 ────────────────────────────────────────────────────────
    console.log('\n6. 상태 전이 (CONT-07 / CONT-08)');
    res = await op.inject({
      method: 'POST',
      url: `/contracts/${draft.contractId}/status`,
      payload: { to: 'confirmed' },
    });
    check('draft → confirmed 가 된다', res.statusCode === 200, `${res.statusCode} ${res.body}`);

    res = await op.inject({
      method: 'POST',
      url: `/contracts/${draft.contractId}/status`,
      payload: { to: 'draft' },
    });
    check('★ confirmed → draft 는 400 으로 거부된다 — 되돌리는 전이가 없다', res.statusCode === 400, String(res.statusCode));

    res = await op.inject({
      method: 'POST',
      url: `/contracts/${draft.contractId}/status`,
      payload: { to: 'cancelled' },
    });
    check('★ confirmed → cancelled 도 거부된다 — 확정된 계약은 종료다', res.statusCode === 400, String(res.statusCode));

    res = await op.inject({
      method: 'POST',
      url: `/contracts/${draft.contractId}/status`,
      payload: { to: 'DELETED' },
    });
    check('★ 모르는 상태값은 거부된다', res.statusCode === 400, String(res.statusCode));

    hist = await asOperator((c) =>
      c.query(
        `SELECT from_status, to_status FROM public.tb_s080_contract_status_history
          WHERE contract_id = $1 ORDER BY changed_at`,
        [draft.contractId],
      ),
    );
    check('전이가 이력에 쌓였다 (생성 + 확정 = 2행)', hist.rows.length === 2, `${hist.rows.length}행`);
    check('★ 거부된 전이는 이력에 남지 않았다', hist.rows.length === 2);
    check(
      "두 번째 행이 draft → confirmed 다",
      hist.rows[1]?.from_status === 'draft' && hist.rows[1]?.to_status === 'confirmed',
    );

    // ── 7. confirmed 이후 섹션2 잠금 (CONT-09) ──────────────────────────────
    console.log('\n7. confirmed 이후 섹션2 잠금 (CONT-09)');
    res = await op.inject({
      method: 'PATCH',
      url: `/contracts/${draft.contractId}`,
      payload: baseBody({ periodMonths: 24 }),
    });
    check(
      '★ 확정된 계약의 섹션2 수정은 409 로 거부된다 — 버튼을 숨기는 것이 아니라 API 가 막는다',
      res.statusCode === 409,
      `${res.statusCode} ${res.body}`,
    );
    res = await op.inject({ method: 'GET', url: `/contracts/${draft.contractId}` });
    check('거부됐으니 값이 그대로다 (6개월)', json(res).periodMonths === 6, String(json(res).periodMonths));

    // ── 8. 검증 거부 ────────────────────────────────────────────────────────
    console.log('\n8. 입력 거부');
    res = await op.inject({
      method: 'POST',
      url: '/contracts',
      payload: baseBody({ spaces: Array.from({ length: 11 }, () => space(0)) }),
    });
    check('★ 호실 11행은 400 으로 거부된다 (CONT-04)', res.statusCode === 400, String(res.statusCode));

    res = await op.inject({ method: 'POST', url: '/contracts', payload: baseBody({ spaces: [] }) });
    check('호실 0행도 거부된다', res.statusCode === 400, String(res.statusCode));

    res = await op.inject({ method: 'POST', url: '/contracts', payload: baseBody({ paymentMethod: '월납' }) });
    check('납부방법이 코드값이 아니면 거부된다', res.statusCode === 400, String(res.statusCode));

    // ── 9. 입주사 세션 ──────────────────────────────────────────────────────
    console.log('\n9. 입주사 세션');
    const tenantOther = buildApp(tenantSession('SOMEONE-ELSE'));
    res = await tenantOther.inject({ method: 'GET', url: `/contracts/${draft.contractId}` });
    check('★ 남의 계약은 404 다 — RLS 가 0행을 주고 라우트가 없다고 답한다', res.statusCode === 404, String(res.statusCode));
    await tenantOther.close();

    const tenantOwn = buildApp(tenantSession(COMPANY_ID));
    res = await tenantOwn.inject({ method: 'GET', url: `/contracts/${draft.contractId}` });
    check('자기 계약은 읽힌다', res.statusCode === 200, `${res.statusCode} ${res.body}`);

    res = await tenantOwn.inject({ method: 'POST', url: '/contracts', payload: baseBody() });
    check('★ 입주사는 계약을 만들지 못한다 (CONT-18) — 403', res.statusCode === 403, String(res.statusCode));
    await tenantOwn.close();
  } finally {
    await op.close();

    // ── 정리 — 넣은 것은 전부 지운다 ────────────────────────────────────────
    console.log('\n정리');
    // ★ 스코프 안에서 지운다. GUC 없이 DELETE 하면 RLS 가 0행을 골라 **조용히 아무것도
    //   지우지 않는다** — 실제로 한 번 그렇게 나서 시험 계약 2건이 DB 에 남았다.
    /*
     * ★★ **청구 기록을 먼저 지운다.** 021 이 청구서·수납·정산·예치금 장부를 만들면서
     *    계약을 참조하는 FK 가 늘었고, 그것들은 **CASCADE 가 아니다**(일부러 그렇다 —
     *    계약을 지운다고 청구 기록이 조용히 사라지면 안 된다). 순서를 안 지키면
     *    정리 단계에서 FK 위반으로 **스크립트가 죽고**, 요약도 못 찍고 시험 데이터가
     *    DB 에 남는다 — 2026-09-27 에 실제로 그 상태였다(순서는 `verify-billing` 과 같다).
     */
    const ids = created;
    if (ids.length > 0) {
      await asOperator(async (c) => {
        await c.query(`DELETE FROM public.tb_s080_payments p USING public.tb_s080_invoices i
                        WHERE i.invoice_id = p.invoice_id AND i.contract_id = ANY($1::text[])`, [ids]);
        await c.query(`DELETE FROM public.tb_s080_invoices WHERE contract_id = ANY($1::text[])`, [ids]);
        await c.query(`DELETE FROM public.tb_s080_settlements WHERE contract_id = ANY($1::text[])`, [ids]);
        await c.query(`DELETE FROM public.tb_s080_deposit_ledger WHERE contract_id = ANY($1::text[])`, [ids]);
      });
    }
    const del = await asOperator((c) =>
      c.query(`DELETE FROM public.tb_s080_contracts WHERE memo = $1 RETURNING contract_id`, [TAG]),
    );
    console.log(`  계약 ${del.rowCount}건 삭제 (${created.length}건 만들었다)`);
    const left = await asOperator((c) =>
      c.query(`SELECT count(*)::int n FROM public.tb_s080_contracts WHERE memo = $1`, [TAG]),
    );
    check('검증 데이터가 남지 않았다', left.rows[0].n === 0, `${left.rows[0].n}행 남음`);
    check('만든 만큼 지웠다', del.rowCount === created.length, `${del.rowCount} ≠ ${created.length}`);
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

  console.log(`\n${'='.repeat(50)}`);
  console.log(`검사 ${pass + fail}항목 — 통과 ${pass} · 실패 ${fail}`);
  // ★ 항목이 사라졌는지 본다 — 통과·실패만 세면 **덜 돈 것**을 알 수 없다.
  const short = itemCountGate({ expected: EXPECTED_ITEMS, actual: pass + fail, script: 'verify-4-3.js' });
  if (fail > 0) {
    console.log('실패 항목:');
    for (const f of failures) console.log(`  · ${f}`);
  }
  if (fail > 0 || short) process.exit(1);
  console.log('✔ 4-3 검증 전부 통과');
})().catch(async (e) => {
  console.error('✘ 검증 중 오류:', e.stack || e.message);
  try {
    // 여기서도 스코프 안에서 지운다 — 위와 같은 이유다.
    await withCompanyScope({ role: 'operator', companyId: null }, (c) =>
      c.query(`DELETE FROM public.tb_s080_contracts WHERE memo = $1`, [TAG]),
    );
    await closePool();
  } catch {}
  process.exit(1);
});
