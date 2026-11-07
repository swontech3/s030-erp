/**
 * 법무 회사별 정관 파일(결정 2026-11-07) — DB 만 만진다. 첨부 행 자체는 기존 `db/files.ts`
 * (`findFileByPurpose` · `replaceFile`)를 그대로 쓴다 — 대상만 `LEGAL_ORG` 다.
 *
 * ★ 회사 세션은 050 정책으로 자기 단체의 `LEGAL_ORG` 행만 보이고 쓸 수 있다. 운영사는 전부.
 */
import { ARTICLES_FILE_PURPOSE, LEGAL_ORG_FILE_TARGET } from '@swonbiz/shared/domain/legal-articles-file';
import type { ScopedClient } from './withCompanyScope.ts';
import { findFileByPurpose, operatorIdForCompany, type FileRow, type FileTarget } from './files.ts';

interface Rows<T> {
  rows: T[];
  rowCount: number | null;
}
const q = <T>(client: ScopedClient, sql: string, params?: unknown[]): Promise<Rows<T>> =>
  client.query(sql, params) as Promise<Rows<T>>;

/** 단체의 첨부 대상 — `target_id` 는 글자다(`tb_cm_file.target_id` text). */
export const legalOrgTarget = (orgId: number): FileTarget => ({ type: LEGAL_ORG_FILE_TARGET, id: String(orgId) });

/** 그 단체의 정관 파일(없으면 null). */
export function findArticlesFile(client: ScopedClient, orgId: number): Promise<FileRow | null> {
  return findFileByPurpose(client, legalOrgTarget(orgId), ARTICLES_FILE_PURPOSE);
}

/**
 * 첨부 행의 운영사 번호(`tb_cm_file.operator_id` NOT NULL · FK, 결정 2026-11-07 「가」).
 *   · 입주사 — 기존과 같이 회사 → 건물 → 운영사(`operatorIdForCompany`)
 *   · 비입주사 — 건물이 없다. 운영사 표에 운영사가 **정확히 하나**일 때만 그 번호. 둘 이상이면 null —
 *     아무 번호나 고르지 않는다(호출한 쪽이 올리기를 거절한다)
 */
export async function operatorIdForLegalOrg(
  client: ScopedClient,
  source: { isTenant: boolean; tenantCompanyId: string | null },
): Promise<number | null> {
  if (source.isTenant) return source.tenantCompanyId ? operatorIdForCompany(client, source.tenantCompanyId) : null;
  const { rows } = await q<{ operator_id: number }>(client, `SELECT operator_id FROM public.tb_s080_tenant010 LIMIT 2`);
  return rows.length === 1 ? (rows[0]?.operator_id ?? null) : null;
}

/** 그 단체의 완료된 법인설립 건 — 가장 최근 완료 하나. 없으면 null. RLS(042)로 회사 세션은 자기 단체만. */
export async function completedIncorporationIdOf(client: ScopedClient, orgId: number): Promise<string | null> {
  const { rows } = await q<{ id: string }>(
    client,
    `SELECT id FROM public.tb_s080_incorporations
      WHERE org_id = $1 AND status = 'C'
      ORDER BY completed_at DESC NULLS LAST, created_at DESC
      LIMIT 1`,
    [orgId],
  );
  return rows[0]?.id ?? null;
}
