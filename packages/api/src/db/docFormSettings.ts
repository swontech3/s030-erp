/**
 * 등기 설정(`tb_s080_doc_form_settings`) 읽기 — 법인변경 서류 출력(5단계, 2026-10-11).
 *
 * ★ 표는 레거시가 만든 그대로다(019 가 `operator_id` 로 바꿨다). RLS 없음 · `erp_app` 읽기 가능
 *   (2026-10-11 실측). **쓰기는 없다** — 설정 화면은 법무 서비스 090 때 들어온다.
 * ★ `form_template_id` 는 읽지 않는다 — 출력은 양식의 법무 표시로 고른다(결정 E).
 */
import type { DocFormSettingRow } from '@swonbiz/shared/domain/corp-change-print';
import type { ScopedClient } from './withCompanyScope.ts';

const OPERATOR_ID = 1;

/** 법인변경 설정 줄 전부(꺼진 줄 포함 — 고르는 것은 `pickDocFormSetting`). */
export async function listCorpChangeSettings(client: ScopedClient): Promise<DocFormSettingRow[]> {
  const { rows } = (await client.query(
    `SELECT reg_type_key, company_type, is_active, label, form_no, matter, tax_mode, taxes,
            attachments, reg_purpose, reg_reason, matter_body
       FROM public.tb_s080_doc_form_settings
      WHERE operator_id = $1 AND domain = 'corp-change'`,
    [OPERATOR_ID],
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
