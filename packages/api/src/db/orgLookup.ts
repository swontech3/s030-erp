/**
 * 공용 회사 조회(`GET /org-lookup`)의 DB 쪽 — **입주사 딱지 판정에 필요한 것 하나뿐이다.**
 *
 * ★ 회사 정보를 여기서 읽지 않는다. 팝업은 삐용 단체(ID·코드·이름)만 돌려주고, 고른 뒤
 *   ERP 입주사 정보가 필요하면 부르는 화면이 따로 읽는다(`domain/org-lookup.ts` 머리말).
 */
import type { ScopedClient } from './withCompanyScope.ts';

interface Rows<T> {
  rows: T[];
  rowCount: number | null;
}
const q = <T>(client: ScopedClient, sql: string, params?: unknown[]): Promise<Rows<T>> =>
  client.query(sql, params) as Promise<Rows<T>>;

/**
 * 주어진 단체 ID 중 **ERP 입주사에 연결된 것**만 돌려준다.
 *
 * ★★ 입주사 여부는 저장하지 않는다 — 이 연결이 곧 판정이다. 퇴실한 입주사도 행이 남아
 *    있으므로 입주사로 나온다(결정 2026-10-09).
 * ★ `tb_s080_companies` 의 읽기 정책은 `USING (true)` 라 DB 가 거르지 않는다. 이 함수를
 *   부르는 라우트는 **운영사 전용**이다(`routes/orgLookup.ts`).
 */
export async function listLinkedOrgIds(client: ScopedClient, orgIds: readonly number[]): Promise<number[]> {
  if (orgIds.length === 0) return [];
  const { rows } = await q<{ link_s020_org_id: number }>(
    client,
    `SELECT link_s020_org_id
       FROM public.tb_s080_companies
      WHERE link_s020_org_id = ANY($1::int[])`,
    [orgIds],
  );
  return rows.map((r) => r.link_s020_org_id);
}
