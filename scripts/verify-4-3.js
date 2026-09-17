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

  const { rows: spaceRows } = await pool.query(
    `SELECT space_id, room_type, standard_fee FROM public.tb_s080_spaces
      WHERE build_id = $1 ORDER BY room_name LIMIT 3`,
    [BUILD_ID],
  );
  if (!BUILD_ID || !COMPANY_ID || spaceRows.length < 2) {
    console.error('✘ 건물·회사·호실이 모자라 검증할 수 없다');
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
    const del = await asOperator((c) =>
      c.query(`DELETE FROM public.tb_s080_contracts WHERE memo = $1 RETURNING contract_id`, [TAG]),
    );
    console.log(`  계약 ${del.rowCount}건 삭제 (${created.length}건 만들었다)`);
    const left = await asOperator((c) =>
      c.query(`SELECT count(*)::int n FROM public.tb_s080_contracts WHERE memo = $1`, [TAG]),
    );
    check('검증 데이터가 남지 않았다', left.rows[0].n === 0, `${left.rows[0].n}행 남음`);
    check('만든 만큼 지웠다', del.rowCount === created.length, `${del.rowCount} ≠ ${created.length}`);
    await closePool();
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`검사 ${pass + fail}항목 — 통과 ${pass} · 실패 ${fail}`);
  if (fail > 0) {
    console.log('실패 항목:');
    for (const f of failures) console.log(`  · ${f}`);
    process.exit(1);
  }
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
