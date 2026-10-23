/**
 * 법무 비입주사 회사 정보 → 삐용 「보내기」(결정 2026-10-22).
 *
 * 운영사가 법인변경 [저장] 으로 회사 정보를 저장하면, **트랜잭션이 커밋된 뒤** 삐용 회사 수정
 * (`erp-patch-org`)을 그 운영사 본인의 삐용 토큰으로 부른다(연동규격 Q1 — 열쇠를 새로 만들지 않는다).
 *
 *   · 맞추는 칸: 본점 주소 3칸(`head_*` → zipCode · address · detailAddress) · 사업자번호 · 법인번호.
 *     회사명 · 업태 · 종목은 맞추지 않는다. 대표자 자택(`ceo_*`)은 보내지 않는다
 *   · **값이 있는 칸만** 보낸다 — 빈 문자열은 삐용 값을 지운다(`BbiyongOrgLegalPatch`)
 *   · 실패해도 저장은 그대로다. 결과는 응답에만 싣고(`LegalOrgSyncResult`) **DB 에 남기지 않는다**
 *   · ERP 입주사 표와는 주고받지 않는다 — 입주사 단체는 애초에 회사 정보를 저장하지 않는다(409)
 *
 * ★ 「받기」(삐용 → 법무, 2026-10-23)는 `legalOrgReceive.ts` 다 — 받은 값은 여기로 다시 보내지 않는다.
 */
import type { ErpSession } from '@swonbiz/shared';
import type { LegalOrgInput, LegalOrgSyncResult } from '@swonbiz/shared/domain/corp-change-detail';
import { bbiyongOrg } from '../bbiyong/index.ts';
import type { BbiyongOrg, BbiyongOrgLegalPatch } from '../bbiyong/types.ts';
import { callBbiyong } from '../session/bbiyongToken.ts';

/**
 * 번호 칸을 삐용에 보낼 모양으로 — **숫자만**(삐용 회신 2026-10-23: 주고받을 때 하이픈 없이,
 * 삐용은 형식 검사 없이 그대로 저장한다). 법무 DB 저장 모양(하이픈)은 그대로 둔다.
 */
const toBbiyongNumber = (v: string): string => v.replace(/\D/g, '');

/**
 * 법무 칸 → 삐용 수정 본문. 값이 있는 칸만 담는다. 담을 칸이 하나도 없으면 null(보내지 않는다).
 */
export function legalOrgPatchOf(orgCode: string, company: LegalOrgInput): BbiyongOrgLegalPatch | null {
  const has = (v: string | null): v is string => v !== null && v.trim() !== '';
  const patch: BbiyongOrgLegalPatch = { orgCode };
  if (has(company.headZipCode)) patch.zipCode = company.headZipCode;
  if (has(company.headAddress)) patch.address = company.headAddress;
  if (has(company.headAddressDetail)) patch.detailAddress = company.headAddressDetail;
  if (has(company.bizNumber)) patch.bizNumber = toBbiyongNumber(company.bizNumber);
  if (has(company.corpNumber)) patch.corpNumber = toBbiyongNumber(company.corpNumber);
  return Object.keys(patch).length > 1 ? patch : null;
}

/** 단체코드가 없을 때 — 삐용 수정은 단체코드로 찾는다. */
const NO_ORG_CODE = '단체코드가 없어 삐용에 보내지 못했습니다';
/** 예기치 못한 실패(연결 · 토큰 등) — 원인은 로그에만 둔다. */
const UNREACHABLE = '삐용 회사 수정이 끝나지 않았습니다. 잠시 후 다시 저장해 주세요';

/**
 * 저장된 회사 정보를 삐용에 보낸다. **던지지 않는다** — 저장은 이미 커밋됐고, 여기서 던지면 응답이
 * 500 이 되어 운영자가 저장이 안 된 줄 안다(`companies/registerOrg.ts` 의 `callOrFail` 과 같은 이유).
 *
 * @param orgCode 건의 단체코드(표시용 칸 — 운영사가 팝업에서 고른 값). 없으면 보내지 못한다
 * @param via 시험용 — 삐용 어댑터와 토큰 문(기본은 `bbiyongOrg` · `callBbiyong`)
 * @returns null = 보낼 값이 없어 부르지 않았다
 */
export async function pushLegalOrg(
  session: ErpSession,
  orgCode: string | null,
  company: LegalOrgInput,
  via: {
    org: BbiyongOrg;
    call: <T>(erpSid: string, fn: (accessToken: string) => Promise<T>) => Promise<T>;
  } = { org: bbiyongOrg, call: callBbiyong },
): Promise<LegalOrgSyncResult | null> {
  if (orgCode === null) {
    // 보낼 값이 없으면 단체코드가 없어도 알릴 것이 없다.
    return legalOrgPatchOf('', company) ? { kind: 'failed', reason: NO_ORG_CODE } : null;
  }
  const patch = legalOrgPatchOf(orgCode, company);
  if (!patch) return null;
  try {
    const out = await via.call(session.erpSid, (token) => via.org.patchOrgLegal(patch, token));
    return out.kind === 'ok' ? { kind: 'ok' } : { kind: 'failed', reason: out.message };
  } catch (err) {
    console.error(`[bbiyong] 법무 회사 수정 중 예기치 못한 실패 orgCode=${orgCode}: ${(err as Error).message}`);
    return { kind: 'failed', reason: UNREACHABLE };
  }
}
