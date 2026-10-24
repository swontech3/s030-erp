/**
 * 표양식 관리(s030100020) 라우트 — 양식 목록 · 읽기 · 등록 · 수정 · 복사 · 삭제.
 *
 * 레거시 `S-WonERP/src/app/api/form-templates/**` 3파일을 옮겼다. 레거시의 데이터 원천
 * 라우트(`/api/form-data-sources/**`)와 등기 양식 토큰(`/api/admin/doc-form-settings/**`)은
 * **옮기지 않았다**(결정 2026-10-07):
 *   · 값은 손으로만 채운다 — 자동 채움은 법무 서비스(s04)·운영사 직원 화면이 생길 때 붙인다
 *     (`domain/form-template.ts` 머리말)
 *   · 등기 양식 토큰(서식번호·세금·첨부서류)은 법무 영역이다 — 법무 서비스(s04)에서 다룬다
 *
 * =============================================================================
 * ★★ 운영사 전용이다
 * =============================================================================
 * 모든 핸들러가 첫 줄에서 `session.role !== 'operator'` 를 403 으로 막는다(코드 관리와
 * 같다). 화면의 `requireScreen` 과 두 겹이다.
 *
 * =============================================================================
 * ★★★ 법무 표시가 붙은 양식은 못 지운다 — 표시를 떼야 지운다, 409 (결정 E, 2026-10-11)
 * =============================================================================
 * 법인변경 [서류 출력]이 법무 표시로 서류를 고른다 — 근거는 `db/formTemplates.ts` 머리말.
 * 옛 「등기 설정이 가리키는 양식은 못 지운다」(2026-10-07)는 뺐다. **수정·복사는 막지 않는다**
 * — 고친 모양이 그대로 서류에 쓰이는 것이 맞다(레거시도 그랬다).
 * ★ **복사본에는 법무 표시가 없다**(결정 2026-10-11) — 복사하는 순간 같은 서류가 [서류 출력]에 두 번
 *   뜨지 않게. 쓰려면 복사본 편집에서 표시를 붙인다.
 *
 * ★ 편집기의 법무 표시 선택지(변경 구분 · 회사유형) 이름은 코드에서 읽어 함께 내려준다
 *   (`legalOptions`) — 고를 수 있는 값 자체는 shared 의 `CORP_CHANGE_TYPES` ·
 *   `LEGAL_FORM_COMPANY_TYPES` 다. 임원 구분(취임 · 사임 · 중임) 이름은 코드가 아니다
 *   (`OFFICER_CHANGE_KIND_LABEL`).
 *
 * ★ 정의(JSON)는 **서버가 검사한다**(`parseDefinition`). 화면을 믿지 않는다 — 깨진
 *   정의가 저장되면 그 양식은 화면에서 열리지 않고 고칠 길도 없다.
 * ★ 양식 종류(`kind`)는 코드 관리의 `LAW_DOC_TP`(000) 에 **있는 코드값만** 받는다.
 *   레거시는 아무 글자나 받았다(`normalizeKind`). 이름은 코드에서 읽어 함께 내려준다.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireSession } from '../session/hook.ts';
import { withCompanyScope, type CompanyScope, type ScopedClient } from '../db/withCompanyScope.ts';
import { listCodes } from '../db/lookups.ts';
import {
  deleteFormTemplate,
  findFormTemplate,
  insertFormTemplate,
  listFormTemplates,
  updateFormTemplate,
  type FormTemplateListRow,
  type FormTemplatePatch,
} from '../db/formTemplates.ts';
import {
  FORM_KIND_CATEGORY,
  FORM_KIND_USE_TP,
  FormDefinitionError,
  migrateDefinition,
  parseDefinition,
} from '@swonbiz/shared/domain/form-template';
import {
  CORP_CHANGE_CODE_USE_TP,
  CORP_CHANGE_TYPES,
  CORP_CHANGE_TYPE_CATEGORY,
} from '@swonbiz/shared/domain/corp-change';
import { LEGAL_MEMBER_TYPE_CATEGORY, LEGAL_MEMBER_TYPE_USE_TP } from '@swonbiz/shared/domain/corp-change-detail';
import { LEGAL_FORM_COMPANY_TYPES } from '@swonbiz/shared/domain/legal-form-mark';

const OPERATOR = 'operator';
const OPERATOR_SCOPE: CompanyScope = { role: 'operator', companyId: null };

/** 양식 이름 최대 길이. 컬럼은 `text` 라 DB 는 막지 않는다 — 목록 한 줄에 들어갈 만큼. */
const NAME_MAX = 100;
const DESCRIPTION_MAX = 300;

const forbidden = (reply: FastifyReply) =>
  reply.code(403).send({ error: 'forbidden', message: '표양식 관리는 운영사만 다룰 수 있습니다' });

const notFound = (reply: FastifyReply) =>
  reply.code(404).send({ error: 'not_found', message: '양식을 찾을 수 없습니다' });

const badRequest = (reply: FastifyReply, message: string) =>
  reply.code(400).send({ error: 'invalid_request', message });

/** 지울 수 없다(법무 표시). ★ `message` 는 화면이 **안내**로 그대로 보여 준다. */
const inUse = (reply: FastifyReply, message: string) =>
  reply.code(409).send({ error: 'in_use', message });

function actorOf(session: { s020MemberId: number }): string {
  return String(session.s020MemberId);
}

/** 빈 문자열은 `null` 로. */
function text(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

interface KindOption {
  code: string;
  name: string;
}

/** 양식 종류 선택지 — 코드 관리에서 읽는다. ★ 이름을 여기 박지 않는다. */
async function loadKinds(client: ScopedClient): Promise<KindOption[]> {
  const rows = await listCodes(client, [{ category: FORM_KIND_CATEGORY, useTp: FORM_KIND_USE_TP }]);
  return rows.map((r) => ({ code: r.code, name: r.name }));
}

/**
 * 법무 표시 선택지의 이름 — 코드표 순서. 코드표에 없는(꺼진) 값은 빠진다 — 화면은 코드값을 그대로
 * 보인다(저장된 표시가 지워지지 않게).
 */
async function loadLegalOptions(client: ScopedClient): Promise<{ changeTypes: KindOption[]; companyTypes: KindOption[] }> {
  const rows = await listCodes(client, [
    { category: CORP_CHANGE_TYPE_CATEGORY, useTp: CORP_CHANGE_CODE_USE_TP },
    { category: LEGAL_MEMBER_TYPE_CATEGORY, useTp: LEGAL_MEMBER_TYPE_USE_TP },
  ]);
  const pick = (category: string, allowed: readonly string[]) =>
    rows.filter((r) => r.category === category && allowed.includes(r.code)).map((r) => ({ code: r.code, name: r.name }));
  return {
    changeTypes: pick(CORP_CHANGE_TYPE_CATEGORY, CORP_CHANGE_TYPES),
    companyTypes: pick(LEGAL_MEMBER_TYPE_CATEGORY, LEGAL_FORM_COMPANY_TYPES),
  };
}

const toListItem = (t: FormTemplateListRow) => ({
  id: t.id,
  name: t.name,
  description: t.description,
  kind: t.kind,
  updatedOn: t.updated_on,
  /** 법무 표시가 붙어 있는가. ★ 붙어 있으면 삭제가 막힌다. */
  legal: t.legal,
});

type BodyResult = { ok: true; patch: FormTemplatePatch } | { ok: false; message: string };

/**
 * 등록·수정 본문을 읽는다. ★ 정의는 `parseDefinition` 을 통과한 **새 객체**만 저장한다 —
 * 모르는 키가 DB 에 실리지 않는다.
 */
function readBody(body: unknown, kinds: readonly KindOption[]): BodyResult {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = text(b.name);
  if (!name) return { ok: false, message: '양식 이름을 입력해 주세요' };
  if (name.length > NAME_MAX) return { ok: false, message: `양식 이름은 ${NAME_MAX}자까지입니다` };

  const description = text(b.description);
  if (description && description.length > DESCRIPTION_MAX) {
    return { ok: false, message: `설명은 ${DESCRIPTION_MAX}자까지입니다` };
  }

  const kind = text(b.kind);
  if (!kind || !kinds.some((k) => k.code === kind)) {
    return { ok: false, message: '양식 종류를 골라 주세요' };
  }

  let definition;
  try {
    definition = parseDefinition(b.definition);
  } catch (err) {
    if (err instanceof FormDefinitionError) return { ok: false, message: `양식 모양이 올바르지 않습니다 — ${err.message}` };
    throw err;
  }
  return { ok: true, patch: { name, description, kind, definition } };
}

export function registerFormTemplateRoutes(app: FastifyInstance): void {
  /** 목록 + 종류 선택지. ★ 정의(JSON)는 싣지 않는다 — 고른 양식만 따로 받는다. */
  app.get('/form-templates', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== OPERATOR) return forbidden(reply);

    const data = await withCompanyScope(OPERATOR_SCOPE, async (client) => ({
      templates: await listFormTemplates(client),
      kinds: await loadKinds(client),
      legalOptions: await loadLegalOptions(client),
    }));
    return reply.send({ templates: data.templates.map(toListItem), kinds: data.kinds, legalOptions: data.legalOptions });
  });

  /**
   * 양식 하나 — 정의까지.
   * ★ version 1 로 저장된 정의는 읽을 때 2 로 옮겨서 준다(`migrateDefinition`). 저장은
   *   하지 않는다 — 사람이 [저장] 할 때 2 로 써진다.
   */
  app.get<{ Params: { id: string } }>('/form-templates/:id', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== OPERATOR) return forbidden(reply);

    const data = await withCompanyScope(OPERATOR_SCOPE, async (client) => ({
      row: await findFormTemplate(client, req.params.id),
      kinds: await loadKinds(client),
      legalOptions: await loadLegalOptions(client),
    }));
    if (!data.row) return notFound(reply);

    let definition;
    try {
      definition = migrateDefinition(data.row.definition);
    } catch (err) {
      req.log.error({ id: req.params.id, err: (err as Error).message }, '[form-templates] 정의 읽기 실패');
      return reply
        .code(500)
        .send({ error: 'broken_definition', message: '이 양식의 모양을 읽지 못했습니다. 관리자에게 알려 주세요' });
    }
    return reply.send({ template: { ...toListItem(data.row), definition }, kinds: data.kinds, legalOptions: data.legalOptions });
  });

  app.post('/form-templates', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== OPERATOR) return forbidden(reply);

    const result = await withCompanyScope(OPERATOR_SCOPE, async (client) => {
      const read = readBody(req.body, await loadKinds(client));
      if (!read.ok) return read;
      const id = await insertFormTemplate(client, { patch: read.patch, actor: actorOf(session) });
      return { ok: true as const, id };
    });
    if (!result.ok) return badRequest(reply, result.message);
    return reply.code(201).send({ id: result.id });
  });

  app.patch<{ Params: { id: string } }>('/form-templates/:id', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== OPERATOR) return forbidden(reply);

    const result = await withCompanyScope(OPERATOR_SCOPE, async (client) => {
      const read = readBody(req.body, await loadKinds(client));
      if (!read.ok) return read;
      const found = await updateFormTemplate(client, {
        id: req.params.id,
        patch: read.patch,
        actor: actorOf(session),
      });
      return { ok: true as const, found };
    });
    if (!result.ok) return badRequest(reply, result.message);
    if (!result.found) return notFound(reply);
    return reply.send({ id: req.params.id });
  });

  /**
   * 복사 — 이름 뒤에 「(복사본)」을 붙인다(레거시와 같다).
   * ★ 법무 표시는 **떼고** 복사한다(결정 2026-10-11) — 머리말 참조. 레거시 `dataSource` 는 그대로 간다.
   * ★ 정의는 **옮긴 뒤** 복사한다. version 1 이 그대로 복제되지 않게.
   */
  app.post<{ Params: { id: string } }>('/form-templates/:id/duplicate', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== OPERATOR) return forbidden(reply);

    const result = await withCompanyScope(OPERATOR_SCOPE, async (client) => {
      const src = await findFormTemplate(client, req.params.id);
      if (!src) return null;
      const name = `${src.name} (복사본)`.slice(0, NAME_MAX);
      const { legal: _mark, ...definition } = migrateDefinition(src.definition);
      return insertFormTemplate(client, {
        patch: {
          name,
          description: src.description,
          kind: src.kind,
          definition,
        },
        actor: actorOf(session),
      });
    });
    if (result === null) return notFound(reply);
    return reply.code(201).send({ id: result });
  });

  app.delete<{ Params: { id: string } }>('/form-templates/:id', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== OPERATOR) return forbidden(reply);

    const result = await withCompanyScope(OPERATOR_SCOPE, async (client) => {
      const row = await findFormTemplate(client, req.params.id);
      if (!row) return { kind: 'not_found' as const };
      if (row.legal) return { kind: 'legal' as const };
      const found = await deleteFormTemplate(client, req.params.id);
      return { kind: found ? ('deleted' as const) : ('not_found' as const) };
    });

    if (result.kind === 'legal') {
      return inUse(reply, '법무 표시가 붙은 양식이라 지울 수 없습니다 — 양식 편집에서 법무 표시를 뗀 뒤 지워 주세요');
    }
    if (result.kind === 'not_found') return notFound(reply);
    return reply.send({ id: req.params.id });
  });
}
