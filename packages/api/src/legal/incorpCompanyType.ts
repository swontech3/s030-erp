/**
 * 법인설립 완료 → 회사 정보의 회사유형(결정 2026-11-05).
 *
 * 설립 건이 「완료」(C)로 바뀌는 **같은 트랜잭션** 안에서, 그 단체의 회사유형을 설립 형태(R · A)로 적는다.
 *   · 비입주사 → 법무 회사 정보(`tb_s080_legal_orgs.member_type`) — 줄이 없으면 새 줄(회사유형만, 나머지 칸 비움)
 *   · 입주사   → ERP 회사 정보(`tb_s080_companies.member_type`)
 *   · 비어 있으면 채움 · 같으면 그대로 · 다르면 바꾸지 않고 안내 한 줄(완료는 그대로)
 * ★ 회사유형 말고 다른 칸은 건드리지 않는다 — 기존 저장 함수(`upsertLegalOrg` · `updateCompany`)가 줄을 통째로
 *   쓰므로, 지금 줄을 읽어 회사유형만 바꾼 값을 그대로 넘긴다.
 * ★ 입주사 회사 정보는 운영자만 쓴다(RLS `erp_companies_write`). 회사 사용자가 완료하면 적지 않고 안내 한 줄
 *   (결정 2026-11-05). 비입주사 법무 회사 정보는 회사 사용자도 자기 단체 줄을 쓴다(037) — 그대로 적는다.
 * ★ 이미 완료인 건은 일회용 `scripts/oneoff/2026-11-05-incorporation-company-type.mjs` 가 같은 함수로 맞춘다.
 */
import {
  LEGAL_MEMBER_TYPE_CATEGORY,
  LEGAL_MEMBER_TYPE_USE_TP,
  TENANT_MEMBER_TYPE_USE_TP,
} from '@swonbiz/shared/domain/corp-change-detail';
import {
  companyTypeDifferNotice,
  companyTypeOnComplete,
  companyTypeOperatorOnlyNotice,
  type CompanyTypeOnComplete,
  type IncorpEntityType,
} from '@swonbiz/shared/domain/incorporation';
import type { ScopedClient } from '../db/withCompanyScope.ts';
import { readCompanySource, upsertLegalOrg, type CompanySourceRow } from '../db/corpChanges.ts';
import { findCompany, updateCompany } from '../db/companies.ts';
import { listCodes } from '../db/lookups.ts';

export interface CompanyTypePlan {
  orgId: number;
  entityType: IncorpEntityType;
  /** 지금 회사 정보(입주사 = ERP · 비입주사 = 법무, 줄이 없으면 칸이 모두 null). */
  source: CompanySourceRow;
  decision: CompanyTypeOnComplete;
}

/** 읽기만 한다 — 무엇을 할지. */
export async function planCompanyTypeOnComplete(
  client: ScopedClient,
  orgId: number,
  entityType: IncorpEntityType,
): Promise<CompanyTypePlan> {
  const source = await readCompanySource(client, orgId);
  return { orgId, entityType, source, decision: companyTypeOnComplete(source.memberType, entityType) };
}

/** `fill` 인 계획을 쓴다(다른 결정이면 아무것도 하지 않는다). 입주사는 운영자 스코프에서만 부른다. */
export async function writeCompanyTypeOnComplete(client: ScopedClient, plan: CompanyTypePlan, actor: string): Promise<void> {
  if (plan.decision !== 'fill') return;
  const s = plan.source;
  if (s.isTenant) {
    const row = s.tenantCompanyId ? await findCompany(client, s.tenantCompanyId) : null;
    if (!row) throw new Error(`입주사 회사 줄을 읽지 못했다(단체 ${plan.orgId})`);
    await updateCompany(client, {
      companyId: row.company_id,
      patch: {
        companyName: row.company_name,
        bizNumber: row.biz_number,
        corpNumber: row.corp_number,
        ceoName: row.ceo_name,
        businessType: row.business_type,
        businessItem: row.business_item,
        memberType: plan.entityType,
        tel: row.tel,
        email: row.email,
        ceoZipCode: row.ceo_zip_code,
        ceoAddress: row.ceo_address,
        ceoAddressDetail: row.ceo_address_detail,
        memo: row.memo,
      },
      actor,
    });
    return;
  }
  await upsertLegalOrg(client, {
    orgId: plan.orgId,
    input: {
      legalName: s.legalName,
      corpNumber: s.corpNumber,
      bizNumber: s.bizNumber,
      ceoName: s.ceoName,
      tel: s.tel,
      headZipCode: s.headZipCode,
      headAddress: s.headAddress,
      headAddressDetail: s.headAddressDetail,
      ceoZipCode: s.ceoZipCode,
      ceoAddress: s.ceoAddress,
      ceoAddressDetail: s.ceoAddressDetail,
      memberType: plan.entityType,
    },
    actor,
  });
}

/** 코드표 이름(없으면 코드값) — 입주사 값은 000, 법무 값 · 설립 형태는 002(R · A 이름이 같다). */
async function typeNames(client: ScopedClient, isTenant: boolean): Promise<(code: string) => string> {
  const legal = await listCodes(client, [{ category: LEGAL_MEMBER_TYPE_CATEGORY, useTp: LEGAL_MEMBER_TYPE_USE_TP }]);
  const tenant = isTenant
    ? await listCodes(client, [{ category: LEGAL_MEMBER_TYPE_CATEGORY, useTp: TENANT_MEMBER_TYPE_USE_TP }])
    : legal;
  return (code) => tenant.find((c) => c.code === code)?.name ?? legal.find((c) => c.code === code)?.name ?? code;
}

/**
 * 완료 처리 안에서 부른다 — 화면에 보일 안내 한 줄(없으면 null).
 * ★ 같은 트랜잭션이다 — 쓰다 예외가 나면 완료도 함께 되돌아간다.
 */
export async function applyCompanyTypeOnComplete(
  client: ScopedClient,
  session: { role: string; s020MemberId: number },
  orgId: number,
  entityType: IncorpEntityType,
): Promise<string | null> {
  const plan = await planCompanyTypeOnComplete(client, orgId, entityType);
  if (plan.decision === 'same') return null;
  const nameOf = await typeNames(client, plan.source.isTenant);
  if (plan.decision === 'differ') return companyTypeDifferNotice(nameOf(plan.source.memberType ?? ''), nameOf(entityType));
  if (plan.source.isTenant && session.role !== 'operator') return companyTypeOperatorOnlyNotice(nameOf(entityType));
  await writeCompanyTypeOnComplete(client, plan, String(session.s020MemberId));
  return null;
}
