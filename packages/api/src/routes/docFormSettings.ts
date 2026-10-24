/**
 * 등기 설정(s040900010, 법무 090) — `GET · PUT /legal/doc-form-settings`,
 * `DELETE /legal/doc-form-settings/:domain/:regTypeKey/:companyType` (2026-10-18).
 *
 * ★★ **운영사만**(결정 2026-10-18 — 운영사 전용 화면). 회사 세션은 읽기도 403 이다. 출력은 이 API 를
 *    부르지 않고 저장소(`db/docFormSettings.ts`)를 직접 읽는다.
 *    표에 RLS 가 없다(레거시 그대로) — 쓰기를 막는 것은 이 라우트 하나다.
 * ★ 저장 규칙은 shared `doc-form-setting.ts` 머리말 1~8. 여기서 더 세는 것은 「그 구분이 그 분류의
 *   살아 있는 코드인가」(규칙 2)뿐이다 — 코드는 읽기만 한다(코드 관리 s030100030 이 고친다).
 * ★ 지우기는 회사유형 줄만(결정 2) — 기본 줄은 400(「사용 끔으로」).
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ErpSession } from '@swonbiz/shared';
import {
  DOC_FORM_COMPANY_TYPE_CODES,
  DOC_FORM_DOMAINS,
  buildDocFormItems,
  parseDocFormSettingDeleteKey,
  parseDocFormSettingSave,
  type DocFormDomain,
  type DocFormSettingSave,
  type DocFormSettingView,
  type DocFormSettingsResponse,
} from '@swonbiz/shared/domain/doc-form-setting';
import { requireSession } from '../session/hook.ts';
import { scopeOfSession, withCompanyScope, type ScopedClient } from '../db/withCompanyScope.ts';
import { listCodes } from '../db/lookups.ts';
import { deleteDocFormSettingOverride, listDocFormSettingViews, upsertDocFormSetting } from '../db/docFormSettings.ts';

type Fail = { ok: false; status: 400 | 404; error: string; message: string; field?: string };
export type DocFormSaveResult = { ok: true; item: DocFormSettingView } | Fail;

const domainDef = (domain: DocFormDomain) => DOC_FORM_DOMAINS.find((d) => d.domain === domain)!;

/** 목록 — 두 구분의 코드(순서 그대로) + 설정 줄 + 회사유형 탭 이름. */
export async function readDocFormSettingsOp(client: ScopedClient): Promise<DocFormSettingsResponse> {
  // ★ 차례로 읽는다 — 한 트랜잭션의 클라이언트 하나에 동시에 보내지 않는다
  const codes = await listCodes(client, [
    ...DOC_FORM_DOMAINS.map((d) => ({ category: d.category, useTp: d.useTp })),
    DOC_FORM_COMPANY_TYPE_CODES,
  ]);
  const rows = await listDocFormSettingViews(client);
  return {
    groups: DOC_FORM_DOMAINS.map((d) => ({
      domain: d.domain,
      name: d.name,
      items: buildDocFormItems(
        d.domain,
        codes.filter((c) => c.category === d.category),
        rows.filter((r) => r.domain === d.domain),
      ),
    })),
    companyTypes: codes
      .filter((c) => c.category === DOC_FORM_COMPANY_TYPE_CODES.category)
      .map((c) => ({ code: c.code, name: c.name })),
  };
}

/** 저장 — 그 분류의 살아 있는 코드가 아니면 400(규칙 2). */
export async function saveDocFormSettingOp(client: ScopedClient, save: DocFormSettingSave, memberId: string): Promise<DocFormSaveResult> {
  const def = domainDef(save.domain);
  const codes = await listCodes(client, [{ category: def.category, useTp: def.useTp }]);
  if (!codes.some((c) => c.code === save.regTypeKey)) {
    return { ok: false, status: 400, error: 'invalid_request', message: '없거나 사용하지 않는 등기 종류입니다', field: 'regTypeKey' };
  }
  const { domain: _d, regTypeKey: _k, ...item } = await upsertDocFormSetting(client, save, memberId);
  return { ok: true, item };
}

/** 바꿔 끼울 수 있는 바깥 — 시험이 DB 없이 역할 · 본문을 본다. */
export interface DocFormSettingDeps {
  read(session: ErpSession): Promise<DocFormSettingsResponse>;
  save(session: ErpSession, save: DocFormSettingSave): Promise<DocFormSaveResult>;
  remove(session: ErpSession, key: { domain: DocFormDomain; regTypeKey: string; companyType: string }): Promise<boolean>;
}

const run = <T>(session: ErpSession, fn: (client: ScopedClient) => Promise<T>) =>
  withCompanyScope(scopeOfSession(session), fn);

const defaultDeps: DocFormSettingDeps = {
  read: (session) => run(session, readDocFormSettingsOp),
  save: (session, save) => run(session, (client) => saveDocFormSettingOp(client, save, String(session.s020MemberId))),
  remove: (session, key) => run(session, (client) => deleteDocFormSettingOverride(client, key)),
};

const forbidden = (reply: FastifyReply) =>
  reply.code(403).send({ error: 'forbidden', message: '등기 설정은 운영사만 볼 수 있습니다' });

const invalid = (reply: FastifyReply, p: { field: string; message: string }) =>
  reply.code(400).send({ error: 'invalid_request', message: p.message, errors: [{ field: p.field, message: p.message }] });

export function registerDocFormSettingRoutes(app: FastifyInstance, deps: DocFormSettingDeps = defaultDeps): void {
  app.get('/legal/doc-form-settings', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== 'operator') return forbidden(reply);
    reply.header('Cache-Control', 'no-store');
    return reply.send(await deps.read(session));
  });

  app.put<{ Body: unknown }>('/legal/doc-form-settings', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== 'operator') return forbidden(reply);
    const parsed = parseDocFormSettingSave(req.body);
    if (!parsed.ok) return invalid(reply, parsed);
    const r = await deps.save(session, parsed.value);
    if (!r.ok) return invalid(reply, { field: r.field ?? 'body', message: r.message });
    return reply.send({ item: r.item });
  });

  app.delete<{ Params: { domain: string; regTypeKey: string; companyType: string } }>(
    '/legal/doc-form-settings/:domain/:regTypeKey/:companyType',
    async (req, reply) => {
      const session = requireSession(req);
      if (session.role !== 'operator') return forbidden(reply);
      const parsed = parseDocFormSettingDeleteKey(req.params);
      if (!parsed.ok) return invalid(reply, parsed);
      if (!(await deps.remove(session, parsed.value))) {
        return reply.code(404).send({ error: 'not_found', message: '지울 회사유형 줄이 없습니다' });
      }
      return reply.send({ ok: true });
    },
  );
}
