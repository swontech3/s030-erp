/**
 * 법인변경(s040200010 · s040200011) — 목록 + 선택지(2단계) · 새 건 · 상세 · 변경 내용 · 임원 ·
 * 비입주사 법무 회사 정보(3단계, 2026-10-10).
 *
 * 상태 전이 · 삭제 · 서류 출력 · 제출 스냅샷은 4단계 이후다.
 *
 *   GET    /legal/corp-changes                       목록
 *   POST   /legal/corp-changes                       첫 저장 = 새 건 { changeType, orgId?, orgCode?, payload, officers[] }
 *   GET    /legal/corp-changes/draft                 임시 모드 기본정보 ?changeType=&orgId=&orgCode= (건을 읽지 않는다)
 *   PUT    /legal/corp-changes/company-info          비입주사 법무 회사 정보 { orgId?, … } — 단체 기준, 건과 무관
 *   GET    /legal/corp-changes/:id                   상세 + 임원 + 기본정보
 *   PATCH  /legal/corp-changes/:id                   변경 내용 { payload } — P 만
 *   POST   /legal/corp-changes/:id/officers          임원 추가 — P · 임원변경만
 *   PATCH  /legal/corp-changes/:id/officers/:oid     임원 수정
 *   DELETE /legal/corp-changes/:id/officers/:oid     임원 삭제
 *
 * ★★ 건은 첫 저장 때 생긴다(결정 2026-10-10) — [새 건] 대화상자는 아무것도 쓰지 않고 임시 모드로
 *    보낸다. 빈 건을 만드는 경로는 없다.
 * ★ 경로가 겹치지 않는다 — `draft` · `company-info` 는 고정 경로라 find-my-way 가 `:id` 보다 먼저
 *   고른다(등록 순서와 무관). 그래도 읽는 사람을 위해 `:id` 앞에 등록한다. 시험이 확인한다.
 *
 * 틀린 입력은 400(칸별 오류 `errors[]`), 남의 단체는 403, 안 보이는 건은 404, 상태가 안 맞으면 409.
 * 판정은 `legal/corpChangeOps.ts` 가 한다 — 이 파일은 본문을 넘기고 응답을 돌려줄 뿐이다.
 *
 * =============================================================================
 * ★★★ 운영사 · 회사 모두 부른다 — 무엇이 보이는지는 RLS 가 가른다
 * =============================================================================
 * 법무 서비스는 회사가 직접 로그인해 쓴다(결정 2026-10-09). 그래서 역할로 403 을 내지 않고,
 * `scopeOfSession` 이 실은 단체 ID 로 037 의 RLS 가 가른다 — 운영사는 전체, 회사는 자기
 * 단체 건만. ★ `scopeOf`(단체 ID 없음)로 바꾸면 회사 세션은 0건이 된다(닫힌 쪽).
 *
 * ★ 선택지(구분 5종 · 상태 4종 + 이름 다섯)를 목록과 **같은 응답에** 싣는다 — 화면이 코드표를
 *   따로 부르지 않는다. `/codes` 는 운영사 전용이라 회사 화면이 부를 수 없기도 하다.
 *   거르는 기준은 shared 의 `CORP_CHANGE_TYPES` · `CORP_CHANGE_STATUSES` 한 곳이다.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ErpSession } from '@swonbiz/shared';
import {
  CORP_CHANGE_CODE_USE_TP,
  CORP_CHANGE_STATUS_CATEGORY,
  CORP_CHANGE_TYPE_CATEGORY,
} from '@swonbiz/shared/domain/corp-change';
import {
  parseCorpChangeListQuery,
  pickCorpChangeOptions,
  type CodeOption,
  type CorpChangeListFilter,
  type CorpChangeListItem,
} from '@swonbiz/shared/domain/corp-change-list';
import { requireSession } from '../session/hook.ts';
import { scopeOfSession, withCompanyScope } from '../db/withCompanyScope.ts';
import { listCorpChanges } from '../db/corpChanges.ts';
import { listCodes } from '../db/lookups.ts';
import type { ScopedClient } from '../db/withCompanyScope.ts';
import { parseCreateBody, parseFirstSave, parseOrgTarget, type Parsed } from '@swonbiz/shared/domain/corp-change-detail';
import {
  addOfficer,
  createCorpChange,
  editOfficer,
  readCorpChangeDetail,
  readCorpChangeDraft,
  removeOfficer,
  saveCompanyInfo,
  saveCorpChangePayload,
  type OpResult,
} from '../legal/corpChangeOps.ts';

/** 바꿔 끼울 수 있는 바깥 — 시험이 DB 없이 필터 · 선택지 · 스코프를 본다. */
export interface CorpChangeDeps {
  list(session: ErpSession, filter: CorpChangeListFilter): Promise<CorpChangeListItem[]>;
  /** 코드표의 두 분류(코드표 순서). */
  codes(session: ErpSession): Promise<{ types: CodeOption[]; statuses: CodeOption[] }>;
  /** 이 세션의 스코프(`scopeOfSession`)로 트랜잭션 하나를 연다 — 3단계 처리가 모두 이 안에서 돈다. */
  run<T>(session: ErpSession, fn: (client: ScopedClient) => Promise<T>): Promise<T>;
}

const defaultDeps: CorpChangeDeps = {
  list: (session, filter) => withCompanyScope(scopeOfSession(session), (client) => listCorpChanges(client, filter)),
  codes: async (session) => {
    const rows = await withCompanyScope(scopeOfSession(session), (client) =>
      listCodes(client, [
        { category: CORP_CHANGE_TYPE_CATEGORY, useTp: CORP_CHANGE_CODE_USE_TP },
        { category: CORP_CHANGE_STATUS_CATEGORY, useTp: CORP_CHANGE_CODE_USE_TP },
      ]),
    );
    const pick = (category: string) =>
      rows.filter((r) => r.category === category).map((r) => ({ code: r.code, name: r.name }));
    return { types: pick(CORP_CHANGE_TYPE_CATEGORY), statuses: pick(CORP_CHANGE_STATUS_CATEGORY) };
  },
  run: (session, fn) => withCompanyScope(scopeOfSession(session), fn),
};

export function registerCorpChangeRoutes(app: FastifyInstance, deps: CorpChangeDeps = defaultDeps): void {
  app.get<{ Querystring: Record<string, unknown> }>('/legal/corp-changes', async (req, reply) => {
    const session = requireSession(req);

    const parsed = parseCorpChangeListQuery(req.query ?? {});
    if (!parsed.ok) return reply.code(400).send({ error: 'bad_filter', message: parsed.message });

    const [items, codes] = await Promise.all([deps.list(session, parsed.filter), deps.codes(session)]);
    return reply.send({ items, ...pickCorpChangeOptions(codes.types, codes.statuses) });
  });

  /** 처리 결과를 응답으로. 실패는 `{ error, message, errors? }` — message 는 화면이 그대로 보여 준다. */
  const send = <T>(reply: FastifyReply, result: OpResult<T>, okStatus = 200) =>
    result.ok
      ? reply.code(okStatus).send(result.value ?? undefined)
      : reply
          .code(result.status)
          .send({ error: result.error, message: result.message, ...(result.errors ? { errors: result.errors } : {}) });

  /** 본문 읽기 실패(DB 에 닿기 전) — 403 은 남의 단체, 400 은 칸별 오류. */
  const refuse = <T>(reply: FastifyReply, parsed: Extract<Parsed<T>, { ok: false }>) =>
    reply.code(parsed.status).send({
      error: parsed.status === 403 ? 'forbidden' : 'invalid_request',
      message: parsed.message,
      ...(parsed.errors ? { errors: parsed.errors } : {}),
    });

  /**
   * 첫 [저장] = 새 건 — 건 + 변경 내용 + 임원 전부를 한 요청 · 한 트랜잭션으로(결정 2026-10-10).
   *
   * ★ 본문을 **DB 에 닿기 전에** 다 읽는다(`parseFirstSave`). 하나라도 틀리면 400 이고 아무것도
   *   만들지 않는다. 회사 세션이 남의 단체 ID 를 적으면 403 — RLS 의 `WITH CHECK` 가 한 번 더 막는다.
   */
  app.post<{ Body: unknown }>('/legal/corp-changes', async (req, reply) => {
    const session = requireSession(req);
    const parsed = parseFirstSave(req.body, session);
    if (!parsed.ok) return refuse(reply, parsed);
    const result = await deps.run(session, (client) => createCorpChange(client, session, parsed.value));
    return send(reply, result, 201);
  });

  /**
   * 임시 모드의 기본정보 — 건을 읽지 않는다. 주소의 조건을 새 건과 같은 규칙으로 읽는다
   * (`parseCreateBody`) — 회사 세션이 남의 단체를 적으면 403. 화면은 주소의 단체를 믿지 않는다.
   */
  app.get<{ Querystring: Record<string, unknown> }>('/legal/corp-changes/draft', async (req, reply) => {
    const session = requireSession(req);
    const q = req.query ?? {};
    const parsed = parseCreateBody({ changeType: q.changeType, orgId: q.orgId, orgCode: q.orgCode }, session);
    if (!parsed.ok) return refuse(reply, parsed);
    const result = await deps.run(session, (client) => readCorpChangeDraft(client, session, parsed.value));
    return send(reply, result);
  });

  /**
   * 비입주사 법무 회사 정보 — **단체 기준**, 건과 무관(회사 단위, 결정 2026-10-10). 임시 모드에서도 바로 저장된다.
   * ★ 회사 세션은 자기 단체뿐(다르면 403), 운영사는 `orgId` 필수. 입주사 단체면 409.
   * ★ 200 이다(204 가 아니다) — 웹 중계(`forwardJson`)는 본문 없는 응답을 못 싣는다.
   */
  app.put<{ Body: unknown }>('/legal/corp-changes/company-info', async (req, reply) => {
    const session = requireSession(req);
    const body = typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, unknown>) : {};
    const target = parseOrgTarget(body.orgId, undefined, session);
    if (!target.ok) return refuse(reply, target);
    // `orgId` 는 단체를 고르는 칸이라 회사 칸 읽기에서는 뺀다.
    const { orgId: _orgId, ...fields } = body;
    const result = await deps.run(session, (client) => saveCompanyInfo(client, session, target.value, fields));
    return result.ok ? reply.send({ saved: true }) : send(reply, result);
  });

  app.get<{ Params: { id: string } }>('/legal/corp-changes/:id', async (req, reply) => {
    const session = requireSession(req);
    const result = await deps.run(session, (client) => readCorpChangeDetail(client, req.params.id));
    return send(reply, result);
  });

  app.patch<{ Params: { id: string }; Body: unknown }>('/legal/corp-changes/:id', async (req, reply) => {
    const session = requireSession(req);
    const result = await deps.run(session, (client) => saveCorpChangePayload(client, session, req.params.id, req.body));
    return send(reply, result);
  });

  app.post<{ Params: { id: string }; Body: unknown }>('/legal/corp-changes/:id/officers', async (req, reply) => {
    const session = requireSession(req);
    const result = await deps.run(session, (client) => addOfficer(client, session, req.params.id, req.body));
    return send(reply, result, 201);
  });

  app.patch<{ Params: { id: string; oid: string }; Body: unknown }>(
    '/legal/corp-changes/:id/officers/:oid',
    async (req, reply) => {
      const session = requireSession(req);
      const result = await deps.run(session, (client) =>
        editOfficer(client, session, req.params.id, req.params.oid, req.body),
      );
      return send(reply, result);
    },
  );

  app.delete<{ Params: { id: string; oid: string } }>('/legal/corp-changes/:id/officers/:oid', async (req, reply) => {
    const session = requireSession(req);
    const result = await deps.run(session, (client) => removeOfficer(client, session, req.params.id, req.params.oid));
    return result.ok ? reply.code(204).send() : send(reply, result);
  });
}
