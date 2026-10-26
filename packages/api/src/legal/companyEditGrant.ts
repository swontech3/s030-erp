/**
 * 비입주사 법무 회사 정보를 **고칠 수 있는 사람**(2026-10-25 — 회사 사용자 중 수정 권한 있는 사람에게 연다).
 *
 *   · 운영사 — 늘 연다(삐용을 묻지 않는다)
 *   · 회사 사용자 — 삐용 「내 메뉴」(`my-menus`)에서 「내 단체 정보」 화면에 수정 키가 있을 때만
 *
 * 화면코드 · 키는 공통 코드 `BBIYONG_EDIT_GRANT`(파티션 000)의 `ORG_SELF` 줄 이름(`화면코드:키`,
 * 예 `S021100021:F002`)에서 읽는다 — 바꿀 때는 코드 관리(s030100030)에서 이름을 고친다.
 * 「그 회사」는 세션의 단체다 — 건은 RLS(037)가 자기 단체 것만 보여 주고, 새 건의 남의 단체는
 * `parseCreateBody` 가 403 이다.
 *
 * ★ 닫힌 쪽 — 코드 줄이 없거나 모양이 틀리거나, 삐용이 거절하거나 삐용에 붙지 못하면 열지 않는다.
 *   화면 칸 잠금과 저장 판정(`checkCompanyWrite`)이 이 값 하나를 같이 쓴다.
 */
import type { ErpSession } from '@swonbiz/shared';
import { BbiyongUnavailableError, type MyMenusOutcome } from '../bbiyong/types.ts';
import { bbiyongAuth } from '../bbiyong/index.ts';
import { listCodes } from '../db/lookups.ts';
import { scopeOfSession, withCompanyScope } from '../db/withCompanyScope.ts';
import { callBbiyong } from '../session/bbiyongToken.ts';

export const EDIT_GRANT_CATEGORY = 'BBIYONG_EDIT_GRANT';
export const EDIT_GRANT_USE_TP = '000';
/** 자기 단체 정보를 고치는 권한 — 법무 회사 정보 수정을 연다. */
export const ORG_SELF_GRANT = 'ORG_SELF';
/** 자기 회사 직원 정보를 고치는 권한 — 직원 받기에서 직원이 ERP 에 없을 때 본문 `orgId` 를 대상으로 본다(삐용 통합 시험 C1). */
export const MEMBER_SELF_GRANT = 'MEMBER_SELF';

export interface EditGrant {
  screen: string;
  key: string;
}

/**
 * 받기(삐용 → ERP — 세션이 없다)에서 `BBIYONG_EDIT_GRANT` 줄 이름. 운영사 스코프로 읽는다. 없으면 null.
 * 받기 셋이 같은 판정(`parseEditGrant` · `hasEditGrant`)을 쓴다(삐용 통합 시험 C3, 2026-10-25).
 */
export async function receiveGrantName(code: string): Promise<string | null> {
  const rows = await withCompanyScope({ role: 'operator', companyId: null }, (client) =>
    listCodes(client, [{ category: EDIT_GRANT_CATEGORY, useTp: EDIT_GRANT_USE_TP }]),
  );
  return rows.find((r) => r.code === code)?.name ?? null;
}

/** 코드 줄 이름 `화면코드:키` → 둘. 모양이 틀리면 null(아무에게도 열지 않는다). */
export function parseEditGrant(name: string | null | undefined): EditGrant | null {
  const m = /^\s*([A-Za-z0-9]+)\s*:\s*([A-Za-z0-9]+)\s*$/.exec(name ?? '');
  return m ? { screen: m[1]!, key: m[2]! } : null;
}

/** 내 메뉴에 그 화면이 있고 그 화면의 키에 그 키가 있는가. */
export function hasEditGrant(menus: MyMenusOutcome, grant: EditGrant): boolean {
  return menus.kind === 'ok' && menus.screens.includes(grant.screen) && (menus.keys?.[grant.screen] ?? []).includes(grant.key);
}

export interface CompanyEditorDeps {
  /** `ORG_SELF` 줄의 이름. 없으면 null. */
  grantName(session: ErpSession): Promise<string | null>;
  /** 이 세션의 삐용 토큰으로 내 메뉴. */
  myMenus(session: ErpSession): Promise<MyMenusOutcome>;
}

const defaultDeps: CompanyEditorDeps = {
  grantName: async (session) => {
    const rows = await withCompanyScope(scopeOfSession(session), (client) =>
      listCodes(client, [{ category: EDIT_GRANT_CATEGORY, useTp: EDIT_GRANT_USE_TP }]),
    );
    return rows.find((r) => r.code === ORG_SELF_GRANT)?.name ?? null;
  },
  myMenus: (session) => callBbiyong(session.erpSid, (token) => bbiyongAuth.myMenus(token)),
};

/**
 * 이 세션이 비입주사 법무 회사 정보를 고칠 수 있는가. ★ DB 트랜잭션 **밖에서** 부른다(삐용 호출).
 * 삐용에 붙지 못하면 false(닫힌 쪽 — 사용자 결정 2026-10-25). 재로그인이 필요하면 그대로 던진다(401).
 */
export async function canEditLegalCompany(session: ErpSession, deps: CompanyEditorDeps = defaultDeps): Promise<boolean> {
  if (session.role === 'operator') return true;
  const grant = parseEditGrant(await deps.grantName(session));
  if (!grant) return false;
  try {
    return hasEditGrant(await deps.myMenus(session), grant);
  } catch (err) {
    if (!(err instanceof BbiyongUnavailableError)) throw err;
    console.error(`[bbiyong] 법무 회사 정보 수정 권한 확인 실패: ${err.message}`);
    return false;
  }
}
