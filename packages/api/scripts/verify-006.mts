/**
 * 006_review_hardening.sql 동작 확인 — 권한 표가 아니라 **실제 시도**로 검증한다.
 * erp_app 으로 접속해(= Fastify 와 같은 역할) 막혀야 하는 것이 정말 막히는지 본다.
 *
 *   ① shadow 로그: SELECT·INSERT 는 되고 UPDATE·DELETE 는 42501 로 거부
 *   ② tb_s080_companies: 읽기는 되고, 입주사 스코프의 쓰기는 0행(RLS 가 걸러냄),
 *      운영사 스코프의 쓰기는 통과 — 스코프의 뿌리(link_s020_org_id)를 입주사가 못 만진다
 *   ③ 위 시도 뒤에도 mock 연결(org 9001)이 그대로인지
 *
 * 사용: node_modules/.bin/tsx packages/api/scripts/verify-006.mts   (쓰기 시도는 전부 되돌린다)
 */
import { pool, closePool } from '../src/db/pool.ts';
import { withCompanyScope, type ScopedClient } from '../src/db/withCompanyScope.ts';
// ★ 항목 수 문지기는 저장소에 한 벌이다 — 다른 verify 스크립트와 같은 규칙·같은 문구.
import { itemCountGate } from '../../../scripts/verify-count.js';

/** 기대 항목 수 — 모자라면 **실패**다(`scripts/verify-count.js` 머리말). */
const EXPECTED_ITEMS = 8;

type Attempt = { ok: boolean; n?: number; code?: string };
const attempt = async (sql: string): Promise<Attempt> => {
  try {
    const r = await pool.query(sql);
    return { ok: true, n: r.rowCount ?? 0 };
  } catch (e) {
    return { ok: false, code: (e as { code?: string }).code };
  }
};
const rows = async (c: ScopedClient, sql: string) =>
  (await c.query(sql)) as { rows: Record<string, unknown>[]; rowCount: number | null };

let failed = 0;
/** ★ 몇 항목이 **돌았는가** — 이것이 없으면 항목이 사라진 것을 알 수 없다. */
let ran = 0;
const check = (cond: boolean, id: string, name: string, detail: string) => {
  ran++;
  if (cond) console.log(`OK  ${id} ${name} — ${detail}`);
  else { failed++; console.error(`X   ${id} ${name} — ${detail}`); }
};

const who = (await pool.query<{ current_user: string }>('SELECT current_user')).rows[0]!.current_user;
check(who === 'erp_app', 'B0', '접속 역할', who);

// ── ① shadow 로그 append-only
const upd = await attempt(`UPDATE tb_s080_acl_shadow_log SET verdict = 'X' WHERE log_id = (SELECT min(log_id) FROM tb_s080_acl_shadow_log)`);
const del = await attempt(`DELETE FROM tb_s080_acl_shadow_log WHERE log_id = (SELECT min(log_id) FROM tb_s080_acl_shadow_log)`);
const sel = await attempt(`SELECT count(*) FROM tb_s080_acl_shadow_log`);
check(!upd.ok && upd.code === '42501', 'B1a', 'shadow UPDATE 거부', `code=${upd.code ?? '성공해버림'}`);
check(!del.ok && del.code === '42501', 'B1b', 'shadow DELETE 거부', `code=${del.code ?? '성공해버림'}`);
check(sel.ok, 'B1c', 'shadow SELECT·INSERT 는 유지(기록은 계속 남는다)', 'SELECT 통과');

// ── ② companies — 입주사는 못 쓰고, 운영사는 쓴다
const linked = (await pool.query<{ company_id: string }>(
  'SELECT company_id FROM tb_s080_companies WHERE link_s020_org_id = 9001',
)).rows[0]?.company_id ?? null;

const tenant = await withCompanyScope({ role: 'tenant', companyId: linked }, async (c) => {
  const visible = await rows(c, 'SELECT count(*)::int AS n FROM tb_s080_companies');
  const hijack = await rows(c, 'UPDATE tb_s080_companies SET link_s020_org_id = 7777 WHERE link_s020_org_id = 9001');
  return { visible: Number(visible.rows[0]!.n), changed: hijack.rowCount ?? 0 };
});
check(tenant.visible > 0, 'B2a', '입주사 세션도 companies 읽기는 된다(스코프 해석에 필요)', `${tenant.visible}행`);
check(tenant.changed === 0, 'B2b', '입주사 세션의 연결 변경 시도 → 0행 (RLS 가 막음)', `${tenant.changed}행 변경`);

const operator = await withCompanyScope({ role: 'operator', companyId: null }, async (c) => {
  const r = await rows(c, `UPDATE tb_s080_companies SET link_linked_by = link_linked_by WHERE link_s020_org_id = 9001`);
  return r.rowCount ?? 0;
});
check(operator === 1, 'B2c', '운영사 세션은 연결을 관리할 수 있다', `${operator}행`);

// ── ③ 시도 뒤에도 연결이 그대로인가
const after = (await pool.query<{ company_id: string }>(
  'SELECT company_id FROM tb_s080_companies WHERE link_s020_org_id = 9001',
)).rows[0]?.company_id ?? null;
check(after !== null && after === linked, 'B3', 'mock 연결(org 9001) 무결', String(after));

await closePool();
console.log(failed === 0 ? `\n통과 ${ran}항목` : `\n실패 ${failed}건 / ${ran}항목`);
// ★ 항목이 사라졌는지 본다 — 통과·실패만 세면 **덜 돈 것**을 알 수 없다.
const short = itemCountGate({ expected: EXPECTED_ITEMS, actual: ran, script: 'verify-006.mts' });
process.exit(failed === 0 && !short ? 0 : 1);
