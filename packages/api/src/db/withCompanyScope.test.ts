/**
 * applyCompanyScope — 법무 표(037)를 가르는 단체 ID GUC 가 제대로 들어가는가.
 *
 * ★ DB 에 붙지 않는다. 가짜 클라이언트가 받은 쿼리만 본다. 실제 RLS 판정은
 *   `scripts/verify-037.js` 가 erp_app 으로 접속해서 잰다.
 */
import { describe, expect, it } from 'vitest';
import { applyCompanyScope, scopeOfSession, type ScopedClient } from './withCompanyScope.ts';

function recorder(): ScopedClient & { calls: { sql: string; params: unknown[] }[] } {
  const calls: { sql: string; params: unknown[] }[] = [];
  return {
    calls,
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };
}

/** 받은 쿼리를 「GUC 이름 → 값」으로. */
const gucs = (calls: { sql: string; params: unknown[] }[]) =>
  Object.fromEntries(
    calls.map((c) => [/set_config\('([^']+)'/.exec(c.sql)?.[1] ?? c.sql, c.params[0]]),
  );

describe('applyCompanyScope — 단체 ID', () => {
  it('★ 회사 세션은 단체 ID 를 app.current_org_id 로 넣는다', async () => {
    const c = recorder();
    await applyCompanyScope(c, { role: 'tenant', companyId: 'C1', orgId: 9003 });
    expect(gucs(c.calls)).toEqual({
      'app.current_role': 'tenant',
      'app.current_company_id': 'C1',
      'app.current_org_id': '9003',
    });
  });

  it('★★ 단체 ID 를 빼먹으면 빈 문자열 — 법무 표에서 아무것도 안 보인다(fail-closed)', async () => {
    const c = recorder();
    await applyCompanyScope(c, { role: 'tenant', companyId: null });
    expect(gucs(c.calls)['app.current_org_id']).toBe('');
  });

  it('정수가 아닌 값은 넣지 않는다 — 빈 스코프로 떨어진다', async () => {
    for (const bad of [Number.NaN, 1.5, Number.POSITIVE_INFINITY]) {
      const c = recorder();
      await applyCompanyScope(c, { role: 'tenant', companyId: null, orgId: bad });
      expect(gucs(c.calls)['app.current_org_id']).toBe('');
    }
  });

  it('운영사는 회사·단체 스코프를 넣지 않는다 — 역할만', async () => {
    const c = recorder();
    await applyCompanyScope(c, { role: 'operator', companyId: null, orgId: 1 });
    expect(gucs(c.calls)).toEqual({ 'app.current_role': 'operator' });
  });

  it('★ 세 GUC 모두 트랜잭션 범위(세 번째 인자 true)다', async () => {
    const c = recorder();
    await applyCompanyScope(c, { role: 'tenant', companyId: 'C1', orgId: 7 });
    expect(c.calls.every((q) => /set_config\('[^']+', \$1, true\)/.test(q.sql))).toBe(true);
  });
});

describe('scopeOfSession', () => {
  it('세션의 s020OrgId 를 orgId 로 싣는다', () => {
    expect(scopeOfSession({ role: 'tenant', companyId: null, s020OrgId: 9003 })).toEqual({
      role: 'tenant',
      companyId: null,
      orgId: 9003,
    });
  });
});
