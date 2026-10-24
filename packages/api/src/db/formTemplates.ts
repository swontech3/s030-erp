/**
 * 표양식(s030100020) 저장소 — `tb_s080_form_templates`.
 *
 * ★ 표는 레거시(S-WonERP 「양식관리」)가 만든 그대로 쓴다 — 마이그레이션 없음.
 *   019 가 `tenant_id`(text) → `operator_id`(int, FK `tb_s080_tenant010`)로 바꿨다.
 *   RLS 는 없고(`relrowsecurity = false`, 2026-10-07 실측) `erp_app` 에 CRUD 가 있다.
 *   그래도 다른 저장소와 같이 `ScopedClient` 로 받는다 — 경로가 둘이 되지 않게.
 *
 * =============================================================================
 * ★★★ 법무 표시가 붙은 양식은 못 지운다 — 표시를 떼야 지운다 (결정 E, 2026-10-11)
 * =============================================================================
 * 법인변경 [서류 출력]은 양식의 법무 표시(`definition.legal`)로 서류를 고른다. 표시가 붙은
 * 양식을 지우면 그 서류가 말없이 사라진다 — 그래서 표시를 먼저 떼게 한다(`legal` 칸).
 *
 * ★ 2026-10-07 의 「등기 설정(`form_template_id`)이 가리키는 양식은 못 지운다」는 **뺐다**
 *   (결정 2026-10-11). 출력이 그 칸을 쓰지 않는다. 지운 양식의 id 는 설정 줄에 남는다 —
 *   정리는 법무 서비스 090 설정 화면 때.
 *
 * ★ `updated_at` 은 레거시 행과 새 행의 기준이 다르다 — 레거시 Prisma 는 UTC 값을,
 *   여기서 쓰는 `now()` 는 DB 세션 시간대 값을 `timestamp without time zone` 에 넣는다.
 *   그래서 화면에는 **날짜만** 보인다(`to_char`, 시각을 보이면 9시간 어긋나 보인다).
 */
import { randomUUID } from 'node:crypto';
import type { ScopedClient } from './withCompanyScope.ts';

interface Rows<T> {
  rows: T[];
  rowCount: number | null;
}
const q = <T>(client: ScopedClient, sql: string, params?: unknown[]): Promise<Rows<T>> =>
  client.query(sql, params) as Promise<Rows<T>>;

/**
 * ★ `operator_id` 는 1 로 고정한다 — 개발계·가동계 모두 운영사가 하나다
 *   (`db/facility.ts` 의 `insertBuilding` 과 같다). 운영사가 늘면 세션에서 받아야 한다.
 */
const OPERATOR_ID = 1;

export interface FormTemplateListRow {
  id: string;
  name: string;
  description: string | null;
  kind: string;
  /** `YYYY-MM-DD`. 머리말 ★ 참조. */
  updated_on: string;
  /** 법무 표시(`definition.legal`)가 붙어 있는가. ★ 붙어 있으면 삭제가 막힌다. */
  legal: boolean;
}

export interface FormTemplateRow extends FormTemplateListRow {
  /** 저장된 JSON 그대로. ★ 읽는 쪽이 `migrateDefinition` 을 거친다. */
  definition: unknown;
}

const SELECT_COLUMNS = `
  t.id, t.name, t.description, t.kind,
  to_char(t.updated_at, 'YYYY-MM-DD') AS updated_on,
  (t.definition ? 'legal') AS legal`;

export async function listFormTemplates(client: ScopedClient): Promise<FormTemplateListRow[]> {
  const { rows } = await q<FormTemplateListRow>(
    client,
    `SELECT ${SELECT_COLUMNS}
       FROM public.tb_s080_form_templates t
      WHERE t.operator_id = $1
      ORDER BY t.updated_at DESC, t.name`,
    [OPERATOR_ID],
  );
  return rows;
}

export async function findFormTemplate(client: ScopedClient, id: string): Promise<FormTemplateRow | null> {
  const { rows } = await q<FormTemplateRow>(
    client,
    `SELECT ${SELECT_COLUMNS}, t.definition
       FROM public.tb_s080_form_templates t
      WHERE t.id = $1 AND t.operator_id = $2`,
    [id, OPERATOR_ID],
  );
  return rows[0] ?? null;
}

export interface FormTemplatePatch {
  name: string;
  description: string | null;
  kind: string;
  /** ★ 검사를 마친 정의(`parseDefinition` 의 결과)만 넘긴다. */
  definition: unknown;
}

export async function insertFormTemplate(
  client: ScopedClient,
  args: { patch: FormTemplatePatch; actor: string },
): Promise<string> {
  const id = randomUUID();
  const p = args.patch;
  await q(
    client,
    `INSERT INTO public.tb_s080_form_templates
       (id, operator_id, name, description, kind, definition, created_at, updated_at, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, now(), now(), $7, $7)`,
    [id, OPERATOR_ID, p.name, p.description, p.kind, JSON.stringify(p.definition), args.actor],
  );
  return id;
}

/** 고쳤으면 true, 그 양식이 없으면 false. */
export async function updateFormTemplate(
  client: ScopedClient,
  args: { id: string; patch: FormTemplatePatch; actor: string },
): Promise<boolean> {
  const p = args.patch;
  const { rowCount } = await q(
    client,
    `UPDATE public.tb_s080_form_templates
        SET name = $3, description = $4, kind = $5, definition = $6::jsonb,
            updated_at = now(), updated_by = $7
      WHERE id = $1 AND operator_id = $2`,
    [args.id, OPERATOR_ID, p.name, p.description, p.kind, JSON.stringify(p.definition), args.actor],
  );
  return (rowCount ?? 0) > 0;
}

/** ★ 법무 표시가 붙은 양식은 지우지 않는다 — 라우트가 먼저 409 를 내지만, 그 사이 표시가 붙어도 지워지지 않게 문장에도 건다. */
export async function deleteFormTemplate(client: ScopedClient, id: string): Promise<boolean> {
  const { rowCount } = await q(
    client,
    `DELETE FROM public.tb_s080_form_templates WHERE id = $1 AND operator_id = $2 AND NOT (definition ? 'legal')`,
    [id, OPERATOR_ID],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * 법무 표시(`definition.legal`)가 붙은 양식 — 법인변경 [서류 출력]이 읽는다(5단계, 2026-10-11).
 * ★ 표시 없이 레거시 `dataSource` 만 있는 양식은 고르지 않는다 — 표시가 정본이다.
 * ★ 회사 세션도 부른다(출력). 이 표는 RLS 가 없다 — 고르는 양식은 표시로만 정한다.
 */
export async function listMarkedFormTemplates(
  client: ScopedClient,
): Promise<{ id: string; name: string; definition: unknown }[]> {
  const { rows } = await q<{ id: string; name: string; definition: unknown }>(
    client,
    `SELECT id, name, definition
       FROM public.tb_s080_form_templates
      WHERE operator_id = $1 AND definition ? 'legal'
      ORDER BY name, id`,
    [OPERATOR_ID],
  );
  return rows;
}
