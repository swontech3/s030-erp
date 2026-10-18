/**
 * 등기 설정(`tb_s080_doc_form_settings`) — 출력이 읽기(법인변경 5단계 · 법인설립 10-5) · 090 화면이 읽고 쓰기
 * (s040900010, 2026-10-18).
 *
 * ★ 표는 레거시가 만든 그대로다(019 가 `operator_id` 로 바꿨다). RLS 없음 · `erp_app` 읽기 · 넣기 · 고치기 ·
 *   지우기 가능(2026-10-18 실측). **누가 쓰는지는 라우트가 가른다** — 쓰기는 090(운영사만)뿐이다.
 * ★ `form_template_id` · `custom_tokens` · `sort_order` 는 읽지도 쓰지도 않는다 — 출력은 양식의 법무 표시로
 *   고른다(결정 E). 저장 규칙은 shared `doc-form-setting.ts` 머리말.
 */
import { randomUUID } from 'node:crypto';
import { readAttachments, readTaxes, type DocFormSettingRow } from '@swonbiz/shared/domain/corp-change-print';
import type { DocFormDomain, DocFormSettingSave, DocFormSettingView } from '@swonbiz/shared/domain/doc-form-setting';
import { readIncorpTaxSetting } from '@swonbiz/shared/domain/incorporation-tax';
import type { ScopedClient } from './withCompanyScope.ts';

const OPERATOR_ID = 1;

/** 법인변경 설정 줄 전부(꺼진 줄 포함 — 고르는 것은 `pickDocFormSetting`). */
export function listCorpChangeSettings(client: ScopedClient): Promise<DocFormSettingRow[]> {
  return listSettings(client, 'corp-change');
}

/** 법인설립 설정 줄 전부(R_PROMOTER · R_SUBSCRIPTION — 고르는 것은 `pickDocFormSetting`). */
export function listIncorporationSettings(client: ScopedClient): Promise<DocFormSettingRow[]> {
  return listSettings(client, 'incorporation');
}

async function listSettings(client: ScopedClient, domain: 'corp-change' | 'incorporation'): Promise<DocFormSettingRow[]> {
  const { rows } = (await client.query(
    `SELECT reg_type_key, company_type, is_active, label, form_no, matter, tax_mode, taxes,
            attachments, reg_purpose, reg_reason, matter_body
       FROM public.tb_s080_doc_form_settings
      WHERE operator_id = $1 AND domain = $2`,
    [OPERATOR_ID, domain],
  )) as {
    rows: {
      reg_type_key: string;
      company_type: string | null;
      is_active: boolean;
      label: string | null;
      form_no: string | null;
      matter: string | null;
      tax_mode: string | null;
      taxes: unknown;
      attachments: unknown;
      reg_purpose: string | null;
      reg_reason: string | null;
      matter_body: string | null;
    }[];
  };
  return rows.map((r) => ({
    regTypeKey: r.reg_type_key,
    companyType: r.company_type ?? '',
    isActive: r.is_active,
    label: r.label,
    formNo: r.form_no,
    matter: r.matter,
    taxMode: r.tax_mode,
    taxes: r.taxes,
    attachments: r.attachments,
    regPurpose: r.reg_purpose,
    regReason: r.reg_reason,
    matterBody: r.matter_body,
  }));
}

// =============================================================================
// 090 화면 — 목록 · 저장 · 회사유형 줄 지우기
// =============================================================================

const VIEW_COLUMNS = `domain, reg_type_key, company_type, label, form_no, matter, matter_body, reg_purpose, reg_reason,
       is_active, taxes, attachments, to_char(updated_at, 'YYYY-MM-DD HH24:MI') AS updated_at`;

type ViewRow = {
  domain: string;
  reg_type_key: string;
  company_type: string;
  label: string;
  form_no: string | null;
  matter: string | null;
  matter_body: string | null;
  reg_purpose: string | null;
  reg_reason: string | null;
  is_active: boolean;
  taxes: unknown;
  attachments: unknown;
  updated_at: string;
};

export type DocFormSettingViewRow = DocFormSettingView & { domain: string; regTypeKey: string };

/** 저장된 줄 → 화면 모양. jsonb 는 모양을 믿지 않는다 — 구분에 맞는 세금만 읽는다. */
function toView(r: ViewRow): DocFormSettingViewRow {
  const incorporation = r.domain === 'incorporation';
  return {
    domain: r.domain,
    regTypeKey: r.reg_type_key,
    companyType: r.company_type,
    label: r.label,
    formNo: r.form_no,
    matter: r.matter,
    matterBody: r.matter_body,
    regPurpose: r.reg_purpose,
    regReason: r.reg_reason,
    isActive: r.is_active,
    taxes: incorporation ? null : readTaxes(r.taxes),
    incorpTax: incorporation ? readIncorpTaxSetting(r.taxes) : null,
    attachments: readAttachments(r.attachments) ?? [],
    updatedAt: r.updated_at,
  };
}

/** 두 구분의 줄 전부(꺼진 줄 포함). */
export async function listDocFormSettingViews(client: ScopedClient): Promise<DocFormSettingViewRow[]> {
  const { rows } = (await client.query(
    `SELECT ${VIEW_COLUMNS}
       FROM public.tb_s080_doc_form_settings
      WHERE operator_id = $1 AND domain IN ('corp-change', 'incorporation')`,
    [OPERATOR_ID],
  )) as { rows: ViewRow[] };
  return rows.map(toView);
}

/**
 * 한 줄 저장 — 고유 키 `(operator_id, domain, reg_type_key, company_type)` 로 upsert(규칙 1).
 *   · 새 줄의 `tax_mode` 는 구분으로(법인변경 fixed · 설립 computed). 있는 줄의 `tax_mode` 는 고치지 않는다
 *   · 세금 칸(`taxes`)은 구분의 모양 하나로 쓴다 — 법인변경 = 고정 세 칸, 설립 = 세율 다섯 칸
 *   · 설립 줄의 등기할 사항(`matter` · `matter_body`)은 고치지 않는다(받지 않는 칸)
 *   · `form_template_id` · `custom_tokens` · `sort_order` 는 건드리지 않는다
 */
export async function upsertDocFormSetting(
  client: ScopedClient,
  save: DocFormSettingSave,
  memberId: string,
): Promise<DocFormSettingViewRow> {
  const incorporation = save.domain === 'incorporation';
  const taxes = incorporation ? save.incorpTax : save.taxes;
  const { rows } = (await client.query(
    `INSERT INTO public.tb_s080_doc_form_settings AS t
            (id, operator_id, domain, reg_type_key, company_type, label, form_no, matter, matter_body,
             reg_purpose, reg_reason, is_active, tax_mode, taxes, attachments, created_by, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb, $16, $16, now())
     ON CONFLICT (operator_id, domain, reg_type_key, company_type) DO UPDATE
        SET label = EXCLUDED.label,
            form_no = EXCLUDED.form_no,
            matter = CASE WHEN t.domain = 'incorporation' THEN t.matter ELSE EXCLUDED.matter END,
            matter_body = CASE WHEN t.domain = 'incorporation' THEN t.matter_body ELSE EXCLUDED.matter_body END,
            reg_purpose = EXCLUDED.reg_purpose,
            reg_reason = EXCLUDED.reg_reason,
            is_active = EXCLUDED.is_active,
            taxes = EXCLUDED.taxes,
            attachments = EXCLUDED.attachments,
            updated_by = EXCLUDED.updated_by,
            updated_at = now()
     RETURNING ${VIEW_COLUMNS}`,
    [
      randomUUID(),
      OPERATOR_ID,
      save.domain,
      save.regTypeKey,
      save.companyType,
      save.label,
      save.formNo,
      save.matter,
      save.matterBody,
      save.regPurpose,
      save.regReason,
      save.isActive,
      incorporation ? 'computed' : 'fixed',
      taxes === null ? null : JSON.stringify(taxes),
      save.attachments === null ? null : JSON.stringify(save.attachments),
      memberId,
    ],
  )) as { rows: ViewRow[] };
  return toView(rows[0]!);
}

/** 회사유형 줄 하나 지우기(규칙 7 — 기본 줄은 부르는 쪽이 거절한다). 없으면 false. */
export async function deleteDocFormSettingOverride(
  client: ScopedClient,
  key: { domain: DocFormDomain; regTypeKey: string; companyType: string },
): Promise<boolean> {
  const { rows } = (await client.query(
    `DELETE FROM public.tb_s080_doc_form_settings
      WHERE operator_id = $1 AND domain = $2 AND reg_type_key = $3 AND company_type = $4 AND company_type <> ''
      RETURNING id`,
    [OPERATOR_ID, key.domain, key.regTypeKey, key.companyType],
  )) as { rows: { id: string }[] };
  return rows.length > 0;
}
