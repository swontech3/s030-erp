/**
 * 4-4 계약 폼 검증 보조 — DB 쪽만 본다.
 *
 * 화면 왕복(브라우저 → Next route handler → Fastify)은 dev 서버를 띄워 curl 로 돌리고,
 * 그 결과가 **DB 에 실제로 어떤 모양으로 들어갔는지**를 이 스크립트가 확인한다.
 *
 * ★★ RLS 가 걸린 표(`contracts`·`contract_spaces`·`contract_status_history`)는
 *    `pool.query` 로 직접 읽으면 **0행**이 온다. 오류가 아니라 정책이 거른 것이라
 *    조용히 「없다」로 보인다 — 4-3 검증이 이 함정을 밟아 6항목을 잘못 실패시켰다.
 *    반드시 `withCompanyScope()` 안에서 본다.
 *
 * 사용:
 *   node --experimental-strip-types scripts/verify-4-4.js pick      호실·회사 표본 출력
 *   node --experimental-strip-types scripts/verify-4-4.js show <계약ID>
 *   node --experimental-strip-types scripts/verify-4-4.js drop <계약ID>
 */
import { pool, closePool } from '../packages/api/src/db/pool.ts';
import { withCompanyScope } from '../packages/api/src/db/withCompanyScope.ts';

const asOperator = (fn) => withCompanyScope({ role: 'operator', companyId: null }, fn);
const [cmd, arg] = process.argv.slice(2);

// ★ 최상위 await 를 쓰지 않는다 — 루트 package.json 에 type:module 이 없어
//   tsx 가 이 파일을 CJS 로 변환하고, 그 형식은 최상위 await 를 지원하지 않는다.
async function main() {
if (cmd === 'pick') {
  // companies·spaces 는 RLS 가 없거나 읽기 정책이 true 라 그대로 읽힌다.
  const { rows } = await pool.query(`
    SELECT (SELECT company_id FROM public.tb_s080_companies ORDER BY company_id LIMIT 1) company_id,
           (SELECT build_id   FROM public.tb_s080_buildings ORDER BY build_id   LIMIT 1) build_id`);
  const spaces = await pool.query(`
    SELECT space_id, room_name, room_type, standard_fee
      FROM public.tb_s080_spaces
     WHERE is_active AND room_type = 'VR'
     ORDER BY room_name LIMIT 2`);
  console.log(JSON.stringify({ ...rows[0], spaces: spaces.rows }));
} else if (cmd === 'pick-many') {
  // 상한 확인용 — 비상주 호실을 N개 뽑는다.
  const { rows } = await pool.query(
    `SELECT space_id FROM public.tb_s080_spaces
      WHERE is_active AND room_type = 'VR' ORDER BY room_name LIMIT $1`,
    [Number(arg) || 11],
  );
  console.log(JSON.stringify(rows.map((r) => r.space_id)));
} else if (cmd === 'show') {
  const out = await asOperator(async (c) => {
    const contract = await c.query(
      `SELECT contract_id, company_id, build_id, status, payment_method, access_route,
              contract_date, period_months, start_date, end_date, first_payment, contract_room, memo
         FROM public.tb_s080_contracts WHERE contract_id = $1`,
      [arg],
    );
    // ★ 호실 줄이 실제 호실을 가리키는지 — FK 대상 테이블과 JOIN 해서 이름이 나오는지 본다.
    const spaces = await c.query(
      `SELECT cs.seq, cs.room_type, cs.space_id, s.room_name, s.room_type AS space_room_type,
              cs.standard_fee, cs.deposit, cs.monthly_fee, cs.vat_yn, cs.vat_amount, cs.payment_amount
         FROM public.tb_s080_contract_spaces cs
         LEFT JOIN public.tb_s080_spaces s ON s.space_id = cs.space_id
        WHERE cs.contract_id = $1 ORDER BY cs.seq`,
      [arg],
    );
    const history = await c.query(
      `SELECT from_status, to_status FROM public.tb_s080_contract_status_history
        WHERE contract_id = $1 ORDER BY changed_at, history_id`,
      [arg],
    );
    return { contract: contract.rows[0] ?? null, spaces: spaces.rows, history: history.rows };
  });
  console.log(JSON.stringify(out, null, 2));
} else if (cmd === 'drop') {
  // ★ 계약 행만 지운다. 호실 줄과 상태 이력은 FK 가 딸려 사라진다.
  //   이력 테이블에는 **DELETE 권한이 없다**(010: 「감사 이력은 지우는 것이 아니다」) —
  //   직접 지우려 하면 42501 로 막힌다. 4-3 검증도 계약 행만 지운다.
  const n = await asOperator(async (c) => {
    const r = await c.query(`DELETE FROM public.tb_s080_contracts WHERE contract_id = $1`, [arg]);
    return r.rowCount;
  });
  console.log(`삭제 ${n}건`);
} else {
  console.error('pick | show <id> | drop <id>');
  process.exitCode = 2;
}

  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
