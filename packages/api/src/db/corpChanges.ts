/**
 * 법인변경(s040200010) 저장소 — 2단계는 **목록 조회만** 있다(2026-10-10).
 *
 * ★★★ 누가 무엇을 보는지는 **RLS 가 가른다**(037 `erp_org_scope`). 이 파일은 단체 조건을
 *    적지 않는다 — 운영사 세션은 전부, 회사 세션은 자기 단체 건만 돌아온다. 그래서 반드시
 *    `scopeOfSession` 으로 만든 스코프 안에서 불러야 한다. 단체 ID 를 빠뜨린 스코프(옛
 *    `scopeOf`)로 부르면 회사 세션은 **0건**이다(닫힌 쪽).
 *
 * ★★ 입주사 정보는 **읽기만** 한다 — 회사명 · 대표자를 건에 복사하지 않는다.
 *    ⚠ `tb_s080_companies` 의 읽기 정책은 `USING (true)` 다 — DB 가 회사 세션의 입주사
 *    읽기를 막아 주지 않는다. 여기서는 **RLS 를 통과한 건의 단체로만** 붙이므로(조인)
 *    회사 세션이 남의 입주사 줄을 받을 길이 없다. 입주사 표를 따로 읽는 쿼리를 더할 때
 *    이 점을 다시 본다.
 *
 * ★ 입주 여부는 저장하지 않는다 — `link_s020_org_id` 에 있으면 입주사(퇴실해도). 그 칸은
 *   UNIQUE(001)라 한 단체에 입주사 줄은 많아야 하나다.
 */
import type { CorpChangeListFilter, CorpChangeListItem } from '@swonbiz/shared/domain/corp-change-list';
import type { ScopedClient } from './withCompanyScope.ts';

interface Rows<T> {
  rows: T[];
}
const q = <T>(client: ScopedClient, sql: string, params?: unknown[]): Promise<Rows<T>> =>
  client.query(sql, params) as Promise<Rows<T>>;

interface ListRow {
  id: string;
  org_id: number;
  org_code: string | null;
  company_name: string | null;
  is_tenant: boolean;
  change_type: string;
  status: string;
  ceo_name: string | null;
  created_on: string;
}

/**
 * 목록 — 새 건이 위.
 *
 * ★ 작업일자는 `created_at`(시간대 없는 시각, DB 시간대 Asia/Seoul)으로 거른다.
 *   끝 날짜는 「그다음 날 0시 미만」이다 — `<= 'to 23:59:59'` 는 밀리초를 놓친다.
 * ★ 대표자: 입주사면 ERP 입주사 정보, 아니면 법무 회사 정보. 입주사인데 ERP 에 대표자가
 *   비어 있어도 법무 회사 정보로 메우지 않는다 — 입주사 정보의 정본은 ERP 다.
 */
export async function listCorpChanges(client: ScopedClient, f: CorpChangeListFilter): Promise<CorpChangeListItem[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };

  if (f.from) add('c.created_at >= ?::date', f.from);
  if (f.to) add(`c.created_at < (?::date + 1)`, f.to);
  if (f.changeType) add('c.change_type = ?', f.changeType);
  if (f.status) add('c.status = ?', f.status);
  if (f.tenancy) add('(co.company_id IS NOT NULL) = ?', f.tenancy === 'tenant');
  if (!f.includeCancelled) where.push(`c.status <> 'X'`);

  const { rows } = await q<ListRow>(
    client,
    `SELECT c.id, c.org_id, c.org_code, c.change_type, c.status,
            to_char(c.created_at, 'YYYY-MM-DD') AS created_on,
            co.company_name,
            (co.company_id IS NOT NULL) AS is_tenant,
            CASE WHEN co.company_id IS NOT NULL THEN co.ceo_name ELSE lo.ceo_name END AS ceo_name
       FROM public.tb_s080_corp_changes c
       LEFT JOIN public.tb_s080_companies co ON co.link_s020_org_id = c.org_id
       LEFT JOIN public.tb_s080_legal_orgs lo ON lo.org_id = c.org_id
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY c.created_at DESC, c.id`,
    params,
  );

  return rows.map((r) => ({
    id: r.id,
    orgId: r.org_id,
    orgCode: r.org_code,
    companyName: r.company_name,
    isTenant: r.is_tenant,
    changeType: r.change_type,
    status: r.status,
    ceoName: r.ceo_name,
    createdOn: r.created_on,
  }));
}
