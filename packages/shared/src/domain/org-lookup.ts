/**
 * 공용 회사 조회 — 삐용 단체를 찾아 고르는 팝업과 그 서버 경로(`GET /org-lookup`)의 규칙.
 *
 * 법무 서비스(S04)가 처음 쓰지만 법무 것이 아니다. 세무 등 「회사를 삐용 단체로 지목하는」
 * 업무가 같이 쓴다(결정 2026-10-09).
 *
 * =============================================================================
 * ★★★ 팝업이 돌려주는 것은 셋뿐이다 — 단체 ID · 단체코드 · 회사명
 * =============================================================================
 * 대표자명·상태·입주사 딱지는 **고를 때 보는 정보**이고, 고른 뒤의 처리(건 만들기 등)는
 * 부르는 화면이 한다. 그 화면이 ERP 입주사 정보나 법무 회사 정보를 다시 읽는다 —
 * 팝업이 실어 나른 값을 저장하면 그게 곧 복사본이 된다.
 *
 * =============================================================================
 * ★★ 입주사 여부는 저장하지 않는다 — 읽을 때 판정한다
 * =============================================================================
 * `tb_s080_companies.link_s020_org_id` 에 그 단체가 있으면 입주사다. **퇴실한 입주사도
 * 입주사로 본다**(행이 남아 있으므로). 서버가 그 번호 목록을 읽어 `markTenants` 에 넣는다.
 *
 * ★ 순수 함수다 — DB 도 삐용도 모른다.
 */

/** 검색어 상한. 회사명 일부로 찾는 것이라 이보다 길 이유가 없다. */
export const ORG_QUERY_MAX = 50;

/** 삐용 단체 한 곳(서버 어댑터의 `BbiyongOrgInfo` 와 같은 모양). */
export interface OrgInfo {
  orgId: number;
  orgCode: string;
  orgName: string;
  repName: string | null;
  status: string | null;
}

/** 팝업 목록 한 줄 — 단체 + 입주사 딱지. */
export interface OrgLookupItem extends OrgInfo {
  /** ERP 입주사인가(`tb_s080_companies.link_s020_org_id` 에 있다). 퇴실해도 true. */
  isTenant: boolean;
}

/** 팝업이 부르는 화면에 돌려주는 것 — **이 셋뿐이다**(머리말). */
export interface OrgPick {
  orgId: number;
  orgCode: string;
  orgName: string;
}

/** 단건 조회 키 — 단체 ID 또는 단체코드. */
export type OrgKey = { orgId: number } | { orgCode: string };

/**
 * 입주사 딱지를 붙인다.
 * @param linkedOrgIds ERP 입주사에 연결된 단체 ID 들(`link_s020_org_id`).
 */
export function markTenants(orgs: readonly OrgInfo[], linkedOrgIds: Iterable<number>): OrgLookupItem[] {
  const linked = new Set(linkedOrgIds);
  return orgs.map((o) => ({ ...o, isTenant: linked.has(o.orgId) }));
}

/** 딱지 글자. */
export function tenantLabel(isTenant: boolean): '입주사' | '비입주사' {
  return isTenant ? '입주사' : '비입주사';
}

/** 목록 한 줄 → 돌려줄 셋. 다른 칸을 실어 보내지 않는다(머리말). */
export function toOrgPick(item: OrgInfo): OrgPick {
  return { orgId: item.orgId, orgCode: item.orgCode, orgName: item.orgName };
}

/** 검색어 정리 — 앞뒤 공백을 떼고 상한으로 자른다. 글자가 아니면 빈 검색어. */
export function normalizeOrgQuery(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().slice(0, ORG_QUERY_MAX);
}

/**
 * 단건 조회 키를 읽는다. 둘 중 **하나만** 와야 한다 — 둘 다 오거나 둘 다 틀리면 null.
 *
 * ★ 단체 ID 는 양의 정수만. 단체코드는 삐용 규격대로 영문·숫자 3자리(대문자로 맞춘다).
 *   Z 대역만 받지는 않는다 — 단건은 「이 건의 회사가 누구인가」를 다시 읽는 데도 쓴다.
 */
export function parseOrgKey(query: { orgId?: unknown; orgCode?: unknown }): OrgKey | null {
  const hasId = query.orgId !== undefined && query.orgId !== '';
  const hasCode = query.orgCode !== undefined && query.orgCode !== '';
  if (hasId === hasCode) return null;

  if (hasId) {
    const text = String(query.orgId).trim();
    if (!/^[1-9][0-9]{0,9}$/.test(text)) return null;
    const orgId = Number(text);
    return Number.isSafeInteger(orgId) && orgId <= 2_147_483_647 ? { orgId } : null;
  }

  const code = String(query.orgCode).trim().toUpperCase();
  return /^[A-Z0-9]{3}$/.test(code) ? { orgCode: code } : null;
}
