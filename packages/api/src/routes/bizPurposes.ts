/**
 * 사업목적 카탈로그(s040300010) · 「사업목적 고르기」 팝업 — `GET · POST /legal/biz-purposes`,
 * `PATCH /legal/biz-purposes/:id` (30-3, 2026-10-11).
 *
 * =============================================================================
 * ★★ 누가 무엇을 하나 (결정 2026-10-11)
 * =============================================================================
 *   · 목록(GET) — **로그인한 모든 사용자**(운영사 · 입주사 · 일반 고객사). 고르기 팝업이 이 주소를
 *     부른다. 회사 세션은 사용 중인 줄만 받는다(`parseBizPurposeListQuery` + 041 RLS 두 겹)
 *   · 추가(POST) · 고치기(PATCH: 문구 · 사용 끄기/켜기) — **운영사만**. 회사 세션은 403
 *     (041 RLS 가 한 번 더 막는다 — 넣기 42501, 고치기 0줄)
 *   · 지우기는 없다 — 라우트도 DB 권한도 없다
 *
 * 같은 문구(앞뒤 공백 무시)는 409 — 사용 끈 줄과 같아도 409 다(「다시 켜세요」).
 * 응답의 줄 모양은 `{ id, text, active }` 뿐이다 — 업종코드 · KSIC · 인허가는 내보내지 않는다.
 *
 * ★ 화면 코드 판정은 web 의 `requireScreen` 몫이다. 이 API 는 법인변경 상세의 팝업도 부르므로
 *   030 화면 권한으로 막지 않는다(역할로만 가른다 — 편집은 운영사).
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ErpSession } from '@swonbiz/shared';
import {
  parseBizPurposeCreate,
  parseBizPurposeListQuery,
  parseBizPurposePatch,
  type BizPurposeItem,
  type BizPurposeListFilter,
} from '@swonbiz/shared/domain/biz-purpose';
import { requireSession } from '../session/hook.ts';
import { scopeOfSession, withCompanyScope, type ScopedClient } from '../db/withCompanyScope.ts';
import { findSameText, insertBizPurpose, listBizPurposes, updateBizPurpose } from '../db/bizPurposes.ts';

type Fail = { ok: false; status: 404 | 409; error: string; message: string };
export type BizPurposeResult = { ok: true; item: BizPurposeItem } | Fail;

const duplicate = (same: BizPurposeItem): Fail => ({
  ok: false,
  status: 409,
  error: 'duplicate',
  message: same.active ? '같은 문구가 이미 있습니다' : '같은 문구가 사용 끔 상태로 있습니다 — 그 줄을 다시 켜세요',
});

/** 추가 — 같은 문구가 있으면 409. */
export async function createBizPurposeOp(client: ScopedClient, text: string): Promise<BizPurposeResult> {
  const same = await findSameText(client, text);
  if (same) return duplicate(same);
  return { ok: true, item: await insertBizPurpose(client, text) };
}

/** 고치기 — 문구를 바꾸면 다른 줄과 같은지 센다(자기 줄은 뺀다). 없는 줄은 404. */
export async function updateBizPurposeOp(
  client: ScopedClient,
  id: string,
  patch: { text?: string; active?: boolean },
): Promise<BizPurposeResult> {
  if (patch.text !== undefined) {
    const same = await findSameText(client, patch.text, id);
    if (same) return duplicate(same);
  }
  const item = await updateBizPurpose(client, id, patch);
  return item ? { ok: true, item } : { ok: false, status: 404, error: 'not_found', message: '사업목적을 찾을 수 없습니다' };
}

/** 바꿔 끼울 수 있는 바깥 — 시험이 DB 없이 역할 · 본문 · 조건을 본다. */
export interface BizPurposeDeps {
  list(session: ErpSession, filter: BizPurposeListFilter): Promise<{ items: BizPurposeItem[]; truncated: boolean }>;
  create(session: ErpSession, text: string): Promise<BizPurposeResult>;
  update(session: ErpSession, id: string, patch: { text?: string; active?: boolean }): Promise<BizPurposeResult>;
}

const run = <T>(session: ErpSession, fn: (client: ScopedClient) => Promise<T>) =>
  withCompanyScope(scopeOfSession(session), fn);

const defaultDeps: BizPurposeDeps = {
  list: (session, filter) => run(session, (client) => listBizPurposes(client, filter)),
  create: (session, text) => run(session, (client) => createBizPurposeOp(client, text)),
  update: (session, id, patch) => run(session, (client) => updateBizPurposeOp(client, id, patch)),
};

const forbidden = (reply: FastifyReply) =>
  reply.code(403).send({ error: 'forbidden', message: '사업목적 카탈로그는 운영사만 고칠 수 있습니다' });

const invalid = (reply: FastifyReply, p: { field: string; message: string }) =>
  reply.code(400).send({ error: 'invalid_request', message: p.message, errors: [{ field: p.field, message: p.message }] });

const sendResult = (reply: FastifyReply, r: BizPurposeResult, okStatus = 200) =>
  r.ok ? reply.code(okStatus).send({ item: r.item }) : reply.code(r.status).send({ error: r.error, message: r.message });

export function registerBizPurposeRoutes(app: FastifyInstance, deps: BizPurposeDeps = defaultDeps): void {
  app.get<{ Querystring: Record<string, unknown> }>('/legal/biz-purposes', async (req, reply) => {
    const session = requireSession(req);
    const parsed = parseBizPurposeListQuery(req.query ?? {}, session.role);
    if (!parsed.ok) return invalid(reply, parsed);
    return reply.send(await deps.list(session, parsed.value));
  });

  app.post<{ Body: unknown }>('/legal/biz-purposes', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== 'operator') return forbidden(reply);
    const parsed = parseBizPurposeCreate(req.body);
    if (!parsed.ok) return invalid(reply, parsed);
    return sendResult(reply, await deps.create(session, parsed.value.text), 201);
  });

  app.patch<{ Params: { id: string }; Body: unknown }>('/legal/biz-purposes/:id', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== 'operator') return forbidden(reply);
    const parsed = parseBizPurposePatch(req.body);
    if (!parsed.ok) return invalid(reply, parsed);
    return sendResult(reply, await deps.update(session, req.params.id, parsed.value));
  });
}
