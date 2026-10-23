/**
 * 입주사 회사 정보 → 삐용 「보내기」(결정 2026-10-23) — 법무 보내기(`legal/legalOrgSync.ts`)와 같은 모양.
 *
 * 운영사가 계약 폼 섹션 1 을 [저장] 하면(`PATCH /companies/:id`), **트랜잭션이 커밋된 뒤** 삐용 회사 수정
 * (`erp-patch-org`)을 그 운영사 본인의 삐용 토큰으로 부른다(연동규격 Q1 — 열쇠를 새로 만들지 않는다).
 *
 *   · 맞추는 칸: 회사명 · 사업자번호 · 법인번호 · 업태 · 종목. **주소는 보내지 않는다** — 계약 폼의 주소는
 *     대표자 자택이다(`tenant-registration.ts` 주소 3칸 주석)
 *   · **저장마다 값이 있는 칸을 모두** 보낸다 — 「바뀐 칸만」이 아니다(결정 2026-10-23). 빈 칸은 보내지
 *     않는다(빈 문자열은 삐용 값을 지운다, `BbiyongOrgPatch`)
 *   · 번호는 **숫자만** 보낸다(삐용 회신 2026-10-23). ERP DB 저장 모양(하이픈)은 그대로다
 *   · 실패해도 저장은 그대로다. 결과는 응답에만 싣고(`CompanyOrgSyncResult`) **DB 에 남기지 않는다** —
 *     「연동 대기」(`link_status`)를 건드리지 않는다. 다시 보내는 길은 다시 [저장] 이다.
 *     [다시 시도]는 등록 · 퇴실 · 재입주 전용이다(`registerOrg.retryBbiyongForCompany`)
 *   · 삐용에 연결되지 않은 입주사(단체코드 없음)는 보내지 않는다(null)
 */
import type { ErpSession } from '@swonbiz/shared';
import { bbiyongOrg } from '../bbiyong/index.ts';
import type { BbiyongOrg, BbiyongOrgPatch } from '../bbiyong/types.ts';
import { callBbiyong } from '../session/bbiyongToken.ts';

/** 보내는 칸 — ERP 회사 표(`tb_s080_companies`)의 값 그대로(번호는 저장 모양). */
export interface CompanyOrgValues {
  companyName: string | null;
  bizNumber: string | null;
  corpNumber: string | null;
  businessType: string | null;
  businessItem: string | null;
}

/**
 * 저장 뒤 삐용 반영 결과 — 저장 응답(`PATCH /companies/:id`)에만 싣는다. ★ DB 에 남기지 않는다.
 * null = 보내지 않았다(연결되지 않은 입주사 · 보낼 값이 하나도 없다).
 */
export type CompanyOrgSyncResult = { kind: 'ok' } | { kind: 'failed'; reason: string };

/** 번호 칸을 삐용에 보낼 모양으로 — 숫자만(삐용 회신 2026-10-23). */
const toBbiyongNumber = (v: string): string => v.replace(/\D/g, '');

/**
 * ERP 칸 → 삐용 수정 본문. 값이 있는 칸만 담는다. 담을 칸이 하나도 없으면 null(보내지 않는다).
 */
export function companyOrgPatchOf(orgCode: string, company: CompanyOrgValues): BbiyongOrgPatch | null {
  const has = (v: string | null): v is string => v !== null && v.trim() !== '';
  const patch: BbiyongOrgPatch = { orgCode };
  if (has(company.companyName)) patch.orgName = company.companyName.trim();
  if (has(company.bizNumber) && toBbiyongNumber(company.bizNumber) !== '') patch.bizNumber = toBbiyongNumber(company.bizNumber);
  if (has(company.corpNumber) && toBbiyongNumber(company.corpNumber) !== '') patch.corpNumber = toBbiyongNumber(company.corpNumber);
  if (has(company.businessType)) patch.businessType = company.businessType.trim();
  if (has(company.businessItem)) patch.businessItem = company.businessItem.trim();
  return Object.keys(patch).length > 1 ? patch : null;
}

/** 예기치 못한 실패(연결 · 토큰 등) — 원인은 로그에만 둔다. */
const UNREACHABLE = '삐용 회사 수정이 끝나지 않았습니다. 잠시 후 다시 저장해 주세요';

/**
 * 저장된 회사 정보를 삐용에 보낸다. **던지지 않는다** — 저장은 이미 커밋됐고, 여기서 던지면 응답이
 * 500 이 되어 운영자가 저장이 안 된 줄 안다(`legalOrgSync.pushLegalOrg` 와 같은 이유).
 *
 * @param orgCode 그 입주사의 단체코드(`link_org_code`). 없으면 연결되지 않은 입주사라 보내지 않는다
 * @param via 시험용 — 삐용 어댑터와 토큰 문(기본은 `bbiyongOrg` · `callBbiyong`)
 * @returns null = 보내지 않았다
 */
export async function pushCompanyOrg(
  session: ErpSession,
  orgCode: string | null,
  company: CompanyOrgValues,
  via: {
    org: BbiyongOrg;
    call: <T>(erpSid: string, fn: (accessToken: string) => Promise<T>) => Promise<T>;
  } = { org: bbiyongOrg, call: callBbiyong },
): Promise<CompanyOrgSyncResult | null> {
  if (orgCode === null || orgCode.trim() === '') return null;
  const patch = companyOrgPatchOf(orgCode, company);
  if (!patch) return null;
  try {
    const out = await via.call(session.erpSid, (token) => via.org.patchOrg(patch, token));
    return out.kind === 'ok' ? { kind: 'ok' } : { kind: 'failed', reason: out.message };
  } catch (err) {
    console.error(`[bbiyong] 입주사 회사 수정 중 예기치 못한 실패 orgCode=${orgCode}: ${(err as Error).message}`);
    return { kind: 'failed', reason: UNREACHABLE };
  }
}
