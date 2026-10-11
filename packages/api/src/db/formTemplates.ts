/**
 * 표양식(s030100020) 저장소 — `tb_s080_form_templates`.
 *
 * ★ 표는 레거시(S-WonERP 「양식관리」)가 만든 그대로 쓴다 — 마이그레이션 없음.
 *   019 가 `tenant_id`(text) → `operator_id`(int, FK `tb_s080_tenant010`)로 바꿨다.
 *   RLS 는 없고(`relrowsecurity = false`, 2026-10-07 실측) `erp_app` 에 CRUD 가 있다.
 *   그래도 다른 저장소와 같이 `ScopedClient` 로 받는다 — 경로가 둘이 되지 않게.
 *
 * =============================================================================
 * ★★★ 등기 설정이 가리키는 양식은 못 지운다 — **FK 가 없어서 여기서 센다**
 * =============================================================================
 * 레거시 「등기 양식 토큰」(`tb_s080_doc_form_settings.form_template_id`)이 양식을
 * 가리킨다. 그 칸에 FK 가 **없다**(019 도 걸지 않았다). 지우면 등기 설정이 없는 양식을
 * 가리키게 되고 아무도 모른다. 그래서 지우기 전에 센다(`listLinks`) — 센터 관리·코드
 * 관리와 같은 이유다(결정 2026-10-07).
 * 2026-10-07 실측: 「법인변경등록1」을 등기 설정 2줄(대표이사 주소 변경 · 이사·감사 변경)이
 * 쓰고 있다. 「사내이사 중임승낙서」를 쓰는 곳은 없다.
 * ★ 등기 설정 화면은 **법무 서비스(s04) 090 설정**으로 들어온다. 그 전까지 연결을 바꿀 길은 없다.
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
  /** 이 양식을 가리키는 등기 설정 수. */
  link_count: number;
}

export interface FormTemplateRow extends FormTemplateListRow {
  /** 저장된 JSON 그대로. ★ 읽는 쪽이 `migrateDefinition` 을 거친다. */
  definition: unknown;
}

const SELECT_COLUMNS = `
  t.id, t.name, t.description, t.kind,
  to_char(t.updated_at, 'YYYY-MM-DD') AS updated_on,
  (SELECT count(*)::int FROM public.tb_s080_doc_form_settings s
    WHERE s.form_template_id = t.id) AS link_count`;

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

/** 이 양식을 가리키는 등기 설정 — 409 문구에 이름을 담으려고 표시명까지 읽는다. */
export async function listLinks(client: ScopedClient, id: string): Promise<string[]> {
  const { rows } = await q<{ label: string }>(
    client,
    `SELECT label FROM public.tb_s080_doc_form_settings
      WHERE form_template_id = $1
      ORDER BY domain, sort_order, label`,
    [id],
  );
  return rows.map((r) => r.label);
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

export async function deleteFormTemplate(client: ScopedClient, id: string): Promise<boolean> {
  const { rowCount } = await q(
    client,
    `DELETE FROM public.tb_s080_form_templates WHERE id = $1 AND operator_id = $2`,
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
