/**
 * 내 청구서(`GET /my/invoices` · s030200090) 회사 거르기 실증 — 앱 1단계 7-나 (2026-11-08).
 *
 * ★ **읽기만 한다.** SELECT 뿐이고 데이터를 쓰지 않는다. 라우트가 쓰는 조회
 *   (`listCompanyInvoicesInRange`)를 입주사 스코프로 불러, RLS 가 실제로 자기 회사로 좁히는지 본다.
 *
 *   1. 삐용 단체에 연결된 입주사마다 — 입주사 스코프로 자기 회사 청구서 수 = 운영사 스코프로 센 그 회사 수
 *      · 모든 줄의 company_id 가 자기 회사
 *   2. 입주사 A 스코프로 **다른 회사 B 의 번호**를 넣어 불러도 0줄 (RLS 가 막는다 — SQL 조건만으로는 아니다)
 *   3. 회사 연결 없는 입주사(companyId null) 스코프 → 0줄
 *   4. 날짜 기간이 양 끝을 포함한다 — 한 달짜리 기간으로 부른 수 = 그 달 줄 수
 *
 * 사용: node_modules/.bin/tsx packages/api/scripts/verify-my-invoices.mts   (erp_app 접속 · 읽기 전용)
 */
import { pool, closePool } from '../src/db/pool.ts';
import { withCompanyScope } from '../src/db/withCompanyScope.ts';
import { listCompanyInvoicesInRange } from '../src/db/invoices.ts';

const WIDE = ['1900-01', '2999-12'] as const;

const fails: string[] = [];
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) fails.push(label);
};

// 연결된 입주사 — 운영사 스코프로 읽는다(erp_app 은 BYPASSRLS 가 없다)
const linked = await withCompanyScope({ role: 'operator', companyId: null }, async (c) =>
  ((await c.query(
    `SELECT company_id, link_s020_org_id AS org_id,
            (SELECT count(*)::int FROM public.tb_s080_invoices i WHERE i.company_id = co.company_id) AS n
       FROM public.tb_s080_companies co
      WHERE link_s020_org_id IS NOT NULL
      ORDER BY link_s020_org_id`,
  )) as { rows: { company_id: string; org_id: number; n: number }[] }).rows,
);
console.log(`연결된 입주사 ${linked.length}곳 :`, linked.map((r) => `${r.org_id}(${r.n}장)`).join(' · '));
check(linked.some((r) => r.n > 0), '청구서가 있는 연결 입주사가 한 곳 이상 있다(시험할 데이터)');

for (const co of linked) {
  const rows = await withCompanyScope({ role: 'tenant', companyId: co.company_id }, (c) =>
    listCompanyInvoicesInRange(c, co.company_id, WIDE[0], WIDE[1]),
  );
  check(rows.length === co.n, `${co.org_id} — 입주사 스코프 ${rows.length}장 = 운영사가 센 ${co.n}장`);
  check(rows.every((r) => r.company_id === co.company_id), `${co.org_id} — 모든 줄이 자기 회사`);

  // 4. 양 끝 포함 — 첫 줄의 달로 한 달 기간
  if (rows.length > 0) {
    const ym = rows[0]!.year_month;
    const one = await withCompanyScope({ role: 'tenant', companyId: co.company_id }, (c) =>
      listCompanyInvoicesInRange(c, co.company_id, ym, ym),
    );
    check(one.length === rows.filter((r) => r.year_month === ym).length && one.length > 0, `${co.org_id} — ${ym} 한 달 기간 = 그 달 ${one.length}장`);
  }
}

// 2. A 스코프로 B 번호 — RLS 가 막는다
const withRows = linked.filter((r) => r.n > 0);
if (linked.length >= 2 && withRows.length >= 1) {
  const b = withRows[0]!;
  const a = linked.find((r) => r.company_id !== b.company_id)!;
  const leak = await withCompanyScope({ role: 'tenant', companyId: a.company_id }, (c) =>
    listCompanyInvoicesInRange(c, b.company_id, WIDE[0], WIDE[1]),
  );
  check(leak.length === 0, `${a.org_id} 스코프로 ${b.org_id} 번호를 넣어도 0장 (RLS) — ${leak.length}장`);
} else {
  check(false, '다른 회사 막힘을 볼 연결 입주사가 둘 이상 없다');
}

// 3. 회사 연결 없음
if (withRows.length >= 1) {
  const none = await withCompanyScope({ role: 'tenant', companyId: null }, (c) =>
    listCompanyInvoicesInRange(c, withRows[0]!.company_id, WIDE[0], WIDE[1]),
  );
  check(none.length === 0, `회사 연결 없는 입주사 스코프 → 0장 — ${none.length}장`);
}

console.log(fails.length === 0 ? '전체 통과' : `실패 ${fails.length}건`);
await closePool();
process.exit(fails.length === 0 ? 0 : 1);
