/**
 * 법인설립(s040100010 · s040100020) — 목록 · 임시 모드 · 첫 저장 · 상세 · 설립 정보 · 사람 · 상태 전이 · 삭제
 * (10-3, 2026-10-11). 서류 출력 · 출력 이력(043)은 10-5 에서 붙는다.
 *
 * ★ 법인변경(`routes/corpChanges.ts`)과 같은 모양이다 — 운영사 · 회사가 함께 쓰고, 누가 무엇을 보는지는
 *   RLS(042)가 단체 ID 로 가른다. 역할로 403 을 내지 않는다(취소 · 복원 · 삭제 · 완료 취소는 판정이 막는다).
 * ★ 이 파일은 본문 읽기와 응답만 한다 — 판정은 `legal/incorporationOps.ts`.
 * ★ 회사 세션이 남의 단체를 적으면 403(`parseIncorpOrgTarget`), RLS `WITH CHECK` 가 한 번 더 막는다.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ErpSession } from '@swonbiz/shared';
import type { Parsed } from '@swonbiz/shared/domain/corp-change-detail';
import { parseIncorpFirstSave, parseIncorpOrgTarget, parseIncorporationListQuery } from '@swonbiz/shared/domain/incorporation-detail';
import { requireSession } from '../session/hook.ts';
import { scopeOfSession, withCompanyScope, type ScopedClient } from '../db/withCompanyScope.ts';
import type { OpResult } from '../legal/corpChangeOps.ts';
import {
  addIncorpPerson,
  createIncorporation,
  deleteIncorporationOp,
  editIncorpPerson,
  listIncorporationItems,
  readIncorporationDetail,
  readIncorporationDraft,
  removeIncorpPerson,
  saveIncorporationInfo,
  transitionIncorporation,
} from '../legal/incorporationOps.ts';

/** 바꿔 끼울 수 있는 바깥 — 시험이 DB 없이 스코프 · 본문 읽기를 본다. */
export interface IncorporationDeps {
  run<T>(session: ErpSession, fn: (client: ScopedClient) => Promise<T>): Promise<T>;
}

const defaultDeps: IncorporationDeps = {
  run: (session, fn) => withCompanyScope(scopeOfSession(session), fn),
};

const send = <T>(reply: FastifyReply, result: OpResult<T>, okStatus = 200) =>
  result.ok
    ? reply.code(okStatus).send(result.value ?? undefined)
    : reply
        .code(result.status)
        .send({ error: result.error, message: result.message, ...(result.errors ? { errors: result.errors } : {}) });

const refuse = <T>(reply: FastifyReply, parsed: Extract<Parsed<T>, { ok: false }>) =>
  reply.code(parsed.status).send({
    error: parsed.status === 403 ? 'forbidden' : 'invalid_request',
    message: parsed.message,
    ...(parsed.errors ? { errors: parsed.errors } : {}),
  });

export function registerIncorporationRoutes(app: FastifyInstance, deps: IncorporationDeps = defaultDeps): void {
  /** 목록 `?status=P|E|C&includeCancelled=1` — 새 건이 위. 취소(X)는 기본 제외. */
  app.get<{ Querystring: Record<string, unknown> }>('/legal/incorporations', async (req, reply) => {
    const session = requireSession(req);
    const parsed = parseIncorporationListQuery(req.query ?? {});
    if (!parsed.ok) return refuse(reply, parsed);
    const items = await deps.run(session, (client) => listIncorporationItems(client, parsed.value));
    return reply.send({ items });
  });

  /** 첫 [저장] = 새 건 `{ orgId?, orgCode?, info, persons[] }` — 하나라도 틀리면 아무것도 만들지 않는다. 201 `{ id }`. */
  app.post<{ Body: unknown }>('/legal/incorporations', async (req, reply) => {
    const session = requireSession(req);
    const parsed = parseIncorpFirstSave(req.body, session);
    if (!parsed.ok) return refuse(reply, parsed);
    const result = await deps.run(session, (client) => createIncorporation(client, session, parsed.value));
    return send(reply, result, 201);
  });

  /** 임시 모드 `?orgId=&orgCode=` — 건을 읽지 않는다. 회사 세션이 남의 단체를 적으면 403. */
  app.get<{ Querystring: Record<string, unknown> }>('/legal/incorporations/draft', async (req, reply) => {
    const session = requireSession(req);
    const q = req.query ?? {};
    const parsed = parseIncorpOrgTarget(q.orgId, q.orgCode, session);
    if (!parsed.ok) return refuse(reply, parsed);
    const result = await deps.run(session, (client) => readIncorporationDraft(client, session, parsed.value));
    return send(reply, result);
  });

  app.get<{ Params: { id: string } }>('/legal/incorporations/:id', async (req, reply) => {
    const session = requireSession(req);
    const result = await deps.run(session, (client) => readIncorporationDetail(client, session, req.params.id));
    return send(reply, result);
  });

  /** 설립 정보 저장 `{ info }` — P 만, 내용 검증 없음(임시 저장). 성공하면 새 상세. */
  app.patch<{ Params: { id: string }; Body: unknown }>('/legal/incorporations/:id', async (req, reply) => {
    const session = requireSession(req);
    const result = await deps.run(session, (client) => saveIncorporationInfo(client, session, req.params.id, req.body));
    return send(reply, result);
  });

  /** 상태 전이 `{ from, to, cancelReason? }` — 법인변경과 같은 응답 규칙. */
  app.post<{ Params: { id: string }; Body: unknown }>('/legal/incorporations/:id/transition', async (req, reply) => {
    const session = requireSession(req);
    const result = await deps.run(session, (client) => transitionIncorporation(client, session, req.params.id, req.body));
    return send(reply, result);
  });

  /** 삭제 `?from=` — 운영사만, P · X 만. 성공 204. */
  app.delete<{ Params: { id: string }; Querystring: { from?: unknown } }>('/legal/incorporations/:id', async (req, reply) => {
    const session = requireSession(req);
    const result = await deps.run(session, (client) => deleteIncorporationOp(client, session, req.params.id, req.query?.from));
    return result.ok ? reply.code(204).send() : send(reply, result);
  });

  app.post<{ Params: { id: string }; Body: unknown }>('/legal/incorporations/:id/persons', async (req, reply) => {
    const session = requireSession(req);
    const result = await deps.run(session, (client) => addIncorpPerson(client, session, req.params.id, req.body));
    return send(reply, result, 201);
  });

  app.patch<{ Params: { id: string; pid: string }; Body: unknown }>('/legal/incorporations/:id/persons/:pid', async (req, reply) => {
    const session = requireSession(req);
    const result = await deps.run(session, (client) => editIncorpPerson(client, session, req.params.id, req.params.pid, req.body));
    return send(reply, result);
  });

  app.delete<{ Params: { id: string; pid: string } }>('/legal/incorporations/:id/persons/:pid', async (req, reply) => {
    const session = requireSession(req);
    const result = await deps.run(session, (client) => removeIncorpPerson(client, session, req.params.id, req.params.pid));
    return result.ok ? reply.code(204).send() : send(reply, result);
  });
}
