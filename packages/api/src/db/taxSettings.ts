/**
 * 세무(S05) 세무 설정(s050100010)의 DB 쪽 — `tb_s050_settings` · `tb_s050_fin_accounts`(201).
 *
 * ★★★ 모든 함수가 `orgId` 를 받아 **`WHERE org_id = $1` 을 직접 건다.** 운영사 세션은 RLS 로는 모든
 *     단체가 보인다(`withCompanyScope` 가 운영사에게 단체 ID 를 싣지 않는다) — 그래서 운영사도 자기 단체만
 *     다루게 하는 것은 이 조건이다. RLS(erp_org_scope)는 두 번째 겹이다.
 *     `orgId` 는 라우트가 **세션의 단체 ID**(`s020OrgId`)로만 넣는다. 화면이 준 값을 넣지 않는다.
 * ★ 코드값 설명은 여기서 읽는다(`listCodeDescriptions`) — 기존 `listCodes` 는 설명을 읽지 않고, 고치지 않는다.
 */
import { randomUUID } from 'node:crypto';
import type { TaxEmail, TaxFinAccountSave, TaxFinAccountView, TaxFinKind, TaxSettingsSave } from '@swonbiz/shared/domain/tax-settings';
import type { ScopedClient } from './withCompanyScope.ts';

interface Rows<T> {
  rows: T[];
  rowCount: number | null;
}
const q = <T>(client: ScopedClient, sql: string, params?: unknown[]): Promise<Rows<T>> =>
  client.query(sql, params) as Promise<Rows<T>>;

/** 코드값 설명 — 켜진 코드만, 그 분류 · 파티션에서. 이름은 `listCodes` 가 읽는다. */
export async function listCodeDescriptions(
  client: ScopedClient,
  categories: readonly string[],
  useTp: string,
): Promise<{ category: string; code: string; description: string | null }[]> {
  const { rows } = await q<{ category: string; code: string; description: string | null }>(
    client,
    `SELECT category, code, description
       FROM public.tb_s080_codes_line
      WHERE category = ANY($1::text[]) AND use_tp = $2 AND is_active = true`,
    [categories, useTp],
  );
  return rows;
}

export interface TaxSettingsRow {
  bizType: string;
  withholdingCycle: string;
  taxEmails: TaxEmail[];
  unusedKinds: string[];
}

/** 설정 줄 — 없으면 null(아직 설정 안 함). */
export async function readTaxSettingsRow(client: ScopedClient, orgId: number): Promise<TaxSettingsRow | null> {
  const { rows } = await q<{ biz_type: string; withholding_cycle: string; tax_emails: TaxEmail[]; unused_kinds: string[] }>(
    client,
    `SELECT biz_type, withholding_cycle, tax_emails, unused_kinds
       FROM public.tb_s050_settings
      WHERE org_id = $1`,
    [orgId],
  );
  const r = rows[0];
  return r ? { bizType: r.biz_type, withholdingCycle: r.withholding_cycle, taxEmails: r.tax_emails, unusedKinds: r.unused_kinds } : null;
}

/** 설정 줄을 만들거나 고친다 — 회사당 1줄(PK org_id). */
export async function upsertTaxSettings(client: ScopedClient, orgId: number, save: TaxSettingsSave, actor: string): Promise<void> {
  await q(
    client,
    `INSERT INTO public.tb_s050_settings
       (org_id, biz_type, withholding_cycle, tax_emails, unused_kinds, created_by, updated_by)
     VALUES ($1, $2, $3, $4::jsonb, $5::text[], $6, $6)
     ON CONFLICT (org_id) DO UPDATE
       SET biz_type = EXCLUDED.biz_type,
           withholding_cycle = EXCLUDED.withholding_cycle,
           tax_emails = EXCLUDED.tax_emails,
           unused_kinds = EXCLUDED.unused_kinds,
           updated_at = CURRENT_TIMESTAMP,
           updated_by = EXCLUDED.updated_by`,
    [orgId, save.bizType, save.withholdingCycle, JSON.stringify(save.taxEmails), save.unusedKinds, actor],
  );
}

/** 계좌 · 카드 — 구분 · 순서대로. */
export async function listFinAccounts(client: ScopedClient, orgId: number): Promise<TaxFinAccountView[]> {
  const { rows } = await q<{
    id: string;
    kind: TaxFinKind;
    bank_code: string | null;
    card_co_code: string | null;
    number: string;
    alias: string | null;
    is_active: boolean;
    sort_order: number;
  }>(
    client,
    `SELECT id, kind, bank_code, card_co_code, number, alias, is_active, sort_order
       FROM public.tb_s050_fin_accounts
      WHERE org_id = $1
      ORDER BY kind, sort_order, created_at, id`,
    [orgId],
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    bankCode: r.bank_code,
    cardCoCode: r.card_co_code,
    number: r.number,
    alias: r.alias,
    isActive: r.is_active,
    sortOrder: r.sort_order,
  }));
}

/** 이 단체의 계좌 · 카드 id — 저장이 끝날 때까지 잠근다(같은 줄을 두 저장이 동시에 고치지 않게). */
export async function lockFinAccountIds(client: ScopedClient, orgId: number): Promise<string[]> {
  const { rows } = await q<{ id: string }>(
    client,
    `SELECT id FROM public.tb_s050_fin_accounts WHERE org_id = $1 FOR UPDATE`,
    [orgId],
  );
  return rows.map((r) => r.id);
}

/** 보낸 목록에 없는 줄을 지운다. */
export async function deleteFinAccountsExcept(client: ScopedClient, orgId: number, keepIds: readonly string[]): Promise<number> {
  const { rowCount } = await q(
    client,
    `DELETE FROM public.tb_s050_fin_accounts WHERE org_id = $1 AND NOT (id = ANY($2::text[]))`,
    [orgId, keepIds],
  );
  return rowCount ?? 0;
}

/** 있는 줄 고치기 — id 는 그대로. 고친 줄 수(0 또는 1). */
export async function updateFinAccount(
  client: ScopedClient,
  orgId: number,
  row: TaxFinAccountSave & { id: string },
  sortOrder: number,
  actor: string,
): Promise<number> {
  const { rowCount } = await q(
    client,
    `UPDATE public.tb_s050_fin_accounts
        SET kind = $3, bank_code = $4, card_co_code = $5, number = $6, alias = $7, is_active = $8,
            sort_order = $9, updated_at = CURRENT_TIMESTAMP, updated_by = $10
      WHERE org_id = $1 AND id = $2`,
    [orgId, row.id, row.kind, row.bankCode, row.cardCoCode, row.number, row.alias, row.isActive, sortOrder, actor],
  );
  return rowCount ?? 0;
}

/** 새 줄 — id 는 여기서 만든다. */
export async function insertFinAccount(
  client: ScopedClient,
  orgId: number,
  row: TaxFinAccountSave,
  sortOrder: number,
  actor: string,
): Promise<string> {
  const id = randomUUID();
  await q(
    client,
    `INSERT INTO public.tb_s050_fin_accounts
       (id, org_id, kind, bank_code, card_co_code, number, alias, is_active, sort_order, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
    [id, orgId, row.kind, row.bankCode, row.cardCoCode, row.number, row.alias, row.isActive, sortOrder, actor],
  );
  return id;
}
