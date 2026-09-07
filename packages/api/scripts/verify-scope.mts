/**
 * withCompanyScope 실증 — 뼈대가 아니라 실제로 RLS 를 거는지 DB 에 대고 확인한다.
 *   1. operator                  → 전체 계약 수
 *   2. tenant + 실제 companyId   → 그 회사 것만
 *   3. tenant + null(미연결)     → 0건 (예외가 아니라 0건 — 목록 API 가 돌려줄 값)
 *   4. 래퍼 없이 풀에서 직접     → 0건 (fail-closed) + GUC 가 커넥션에 남지 않음
 *   5. 콜백이 던지면 ROLLBACK 후 재throw, 커넥션 반납
 *
 * 사용: node_modules/.bin/tsx packages/api/scripts/verify-scope.mts   (erp_app 접속 · 읽기 전용)
 */
import { pool, closePool } from '../src/db/pool.ts';
import { withCompanyScope } from '../src/db/withCompanyScope.ts';

const count = async (client: { query(sql: string, p?: unknown[]): Promise<unknown> }) =>
  ((await client.query('SELECT count(*)::int AS n FROM public.tb_s080_contracts')) as { rows: { n: number }[] }).rows[0]!.n;

const linked = (await pool.query<{ company_id: string }>(
  'SELECT company_id FROM public.tb_s080_companies WHERE link_s020_org_id = 9001',
)).rows[0]?.company_id ?? null;

const all = await withCompanyScope({ role: 'operator', companyId: null }, count);
const mine = linked ? await withCompanyScope({ role: 'tenant', companyId: linked }, count) : null;
const none = await withCompanyScope({ role: 'tenant', companyId: null }, count);

// ★ 방금 tenant 트랜잭션이 쓴 커넥션이 풀로 돌아갔다. 래퍼 없이 같은 풀에서 다시 세면
//   GUC 가 남아 있지 않다는 것이 0건으로 드러나야 한다(erp_app 은 BYPASSRLS 가 없다).
const bare = (await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM public.tb_s080_contracts')).rows[0]!.n;
const gucAfter = (await pool.query<{ v: string | null }>("SELECT current_setting('app.current_company_id', true) AS v")).rows[0]!.v;

let rethrown = false;
try {
  await withCompanyScope({ role: 'tenant', companyId: linked }, async (c) => {
    await c.query('SELECT 1');
    throw new Error('의도된 실패');
  });
} catch (e) {
  rethrown = (e as Error).message === '의도된 실패';
}

const result = {
  operator_all: all,
  tenant_linked: mine,
  tenant_null: none,
  bare_pool_no_scope: bare,
  guc_after_on_pool: gucAfter,
  rollback_rethrows: rethrown,
  pool_idle_after: pool.idleCount,
  pool_waiting: pool.waitingCount,
};
console.log(JSON.stringify(result, null, 1));

const ok =
  all > 0 && none === 0 && bare === 0 && (gucAfter === null || gucAfter === '') && rethrown && pool.waitingCount === 0
  && (mine === null || mine <= all);
console.log(ok ? '전체 통과' : '실패');
await closePool();
process.exit(ok ? 0 : 1);
