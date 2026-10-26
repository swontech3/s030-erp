/**
 * 법인변경(s040200010 · s040200011) — 목록 + 선택지(2단계) · 새 건 · 상세 · 변경 내용 · 임원 ·
 * 비입주사 법무 회사 정보(3단계) · 상태 전이 · 삭제 · 작성완료 스냅샷(4단계, 2026-10-10).
 *
 * 서류 출력(5-2, 2026-10-11) — 판정은 `legal/corpChangePrint.ts`. ★ 응답에 주민번호 평문이 있다 —
 * 성공 · 거절 모두 `Cache-Control: no-store` 다.
 *
 *   GET    /legal/corp-changes                       목록
 *   POST   /legal/corp-changes                       첫 저장 = 새 건 { changeType, orgId?, orgCode?, payload, officers[], company? }
 *   GET    /legal/corp-changes/draft                 임시 모드 기본정보 ?changeType=&orgId=&orgCode= (건을 읽지 않는다)
 *   GET    /legal/corp-changes/:id                   상세 + 임원 + 기본정보
 *   PATCH  /legal/corp-changes/:id                   [저장] { payload, company? } — P 만 · 새 상세를 돌려준다
 *   DELETE /legal/corp-changes/:id?from=             삭제 — 운영사 · P/X 만, 임원도 함께
 *   POST   /legal/corp-changes/:id/transition        상태 전이 { from, to, cancelReason? }
 *   POST   /legal/corp-changes/:id/officers          임원 추가 — P · 임원변경만
 *   PATCH  /legal/corp-changes/:id/officers/:oid     임원 수정
 *   DELETE /legal/corp-changes/:id/officers/:oid     임원 삭제
 *   GET    /legal/corp-changes/:id/print             서류 출력 ?applyDate=&writeDate= — E · C 만, no-store(5-2)
 *   POST   /legal/corp-changes/:id/prints            출력 이력 한 줄 { formId, sheet, applyDate?, writeDate? } (040)
 *   GET    /legal/corp-changes/:id/prints            출력 이력 목록
 *
 * ★★ 건은 첫 저장 때 생긴다(결정 2026-10-10) — [새 건] 대화상자는 아무것도 쓰지 않고 임시 모드로
 *    보낸다. 빈 건을 만드는 경로는 없다.
 * ★ 경로가 겹치지 않는다 — `draft` 는 고정 경로라 find-my-way 가 `:id` 보다 먼저 고른다(등록 순서와
 *   무관). 그래도 읽는 사람을 위해 `:id` 앞에 등록한다. 시험이 확인한다.
 *
 * =============================================================================
 * ★★ 비입주사 회사 정보는 [저장] 하나로 (결정 2026-10-10)
 * =============================================================================
 * 회사 정보는 첫 저장(POST) · PATCH 본문의 `company` 로만 저장한다 — 건 · 변경 내용과 같은
 * 트랜잭션이다. 단체 기준 경로(`PUT /legal/corp-changes/company-info`)는 지웠다.
 * ★★ 회사 정보는 **운영사 또는 수정 권한이 있는 그 회사 사용자**만 저장한다(결정 2026-10-22 → 넓힘 2026-10-25,
 *    `legal/companyEditGrant.ts`). 권한은 요청마다 트랜잭션 **밖에서** 한 번 정해(`companyEditor`) 저장 판정과
 *    응답의 `canEditCompany`(화면 칸 잠금)에 같이 쓴다. 저장이 커밋되면 삐용에 본점 주소 · 사업자번호 ·
 *    법인번호를 그 사용자의 토큰으로 보내고(`legal/legalOrgSync.ts`), 그 결과를 저장 응답의 `companySync` 에
 *    싣는다 — 실패해도 저장은 그대로이고 DB 에 남기지 않는다(화면 배너만).
 * 비입주사 회사 정보의 빈 칸은 삐용 값으로 **채워 보여 주기만** 한다(`applyCompanyDefaults`) —
 * 삐용 호출은 DB 트랜잭션 **밖에서** 한다(`withCompanyDefaults`). 입주사는 부르지 않는다.
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
import {
  applyCompanyDefaults,
  parseCompanyPart,
  parseCreateBody,
  parseFirstSave,
  type BbiyongCompanyDefaults,
  type CorpChangeDraftResponse,
  type LegalOrgInput,
  type LegalOrgSyncResult,
  type Parsed,
} from '@swonbiz/shared/domain/corp-change-detail';
import { pushLegalOrg } from '../legal/legalOrgSync.ts';
import { canEditLegalCompany } from '../legal/companyEditGrant.ts';
import { callBbiyong } from '../session/bbiyongToken.ts';
import { bbiyongAuth, bbiyongOrg } from '../bbiyong/index.ts';
import {
  addOfficer,
  createCorpChange,
  deleteCorpChangeOp,
  editOfficer,
  readCorpChangeDetail,
  transitionCorpChange,
  readCorpChangeDraft,
  removeOfficer,
  saveCorpChangePayload,
  type OpResult,
} from '../legal/corpChangeOps.ts';
import { listCorpChangePrints, readCorpChangePrint, recordCorpChangePrint } from '../legal/corpChangePrint.ts';

/** 바꿔 끼울 수 있는 바깥 — 시험이 DB 없이 필터 · 선택지 · 스코프를 본다. */
export interface CorpChangeDeps {
  list(session: ErpSession, filter: CorpChangeListFilter): Promise<CorpChangeListItem[]>;
  /** 코드표의 두 분류(코드표 순서). */
  codes(session: ErpSession): Promise<{ types: CodeOption[]; statuses: CodeOption[] }>;
  /** 이 세션의 스코프(`scopeOfSession`)로 트랜잭션 하나를 연다 — 3단계 처리가 모두 이 안에서 돈다. */
  run<T>(session: ErpSession, fn: (client: ScopedClient) => Promise<T>): Promise<T>;
  /**
   * 비입주사 회사 정보의 기본값(삐용) — 실패하면 null(칸을 비워 둔다). 입주사에는 부르지 않는다.
   * ★ `orgId` 는 RLS 를 통과한 건의 것이거나 `parseOrgTarget` 을 거친 것이다(회사 세션은 자기 단체).
   */
  companyDefaults(session: ErpSession, orgId: number): Promise<BbiyongCompanyDefaults | null>;
  /**
   * 저장된 비입주사 회사 정보를 삐용에 보낸다(`legal/legalOrgSync.ts`) — **커밋 뒤에** 부른다. 던지지 않는다.
   * null = 보낼 값이 없어 부르지 않았다.
   */
  pushCompany(session: ErpSession, orgCode: string | null, company: LegalOrgInput): Promise<LegalOrgSyncResult | null>;
  /**
   * 이 세션이 비입주사 회사 정보를 고칠 수 있는가(`canEditLegalCompany`) — 트랜잭션 **밖에서** 부른다(삐용 호출).
   */
  companyEditor(session: ErpSession): Promise<boolean>;
}

/**
 * 삐용 기본값 읽기.
 *   · 운영사 — 단체 단건 조회(`getOrg`)의 회사명 · 대표자명. 실연동은 삐용 규격이 아직 없어
 *     `unsupported` 다(`HttpBbiyongOrg`) → null
 *   · 회사 사용자 — 단체 조회 권한이 없다. 로그인 프로필(`/auth/me` 와 같은 `getProfile`)의
 *     회사명만 쓴다. ★ 다음 단계: 삐용이 로그인 응답에 대표자명을 더하면 `repName` 으로 붙인다
 * ★ 조회 실패는 화면을 깨뜨리지 않는다 — null 이면 칸을 비워 두고 회사명은 단체코드로 보인다.
 */
async function readCompanyDefaults(session: ErpSession, orgId: number): Promise<BbiyongCompanyDefaults | null> {
  try {
    if (session.role === 'operator') {
      const out = await callBbiyong(session.erpSid, (token) => bbiyongOrg.getOrg({ orgId }, token));
      return out.kind === 'ok' && out.value ? { orgName: out.value.orgName, repName: out.value.repName } : null;
    }
    const profile = await bbiyongAuth.getProfile(session.s020MemberId);
    return profile ? { orgName: profile.orgName } : null;
  } catch {
    return null;
  }
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
  companyDefaults: readCompanyDefaults,
  pushCompany: (session, orgCode, company) => pushLegalOrg(session, orgCode, company),
  companyEditor: (session) => canEditLegalCompany(session),
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
   * 기본정보를 내려보내는 응답(임시 모드 · 상세 · 저장 · 전이)에 삐용 기본값을 채운다 — 트랜잭션이
   * 끝난 뒤에 부른다(삐용 호출을 DB 잠금 안에 두지 않는다). 입주사 · 실패 응답은 그대로.
   */
  const withCompanyDefaults = async <T extends CorpChangeDraftResponse>(
    session: ErpSession,
    result: OpResult<T>,
  ): Promise<OpResult<T>> => {
    if (!result.ok || result.value.company.isTenant) return result;
    const source = await deps.companyDefaults(session, result.value.orgId);
    return { ok: true, value: { ...result.value, company: applyCompanyDefaults(result.value.company, source, result.value, result.value.memberTypes) } };
  };

  /**
   * 첫 [저장] = 새 건 — 건 + 변경 내용 + 임원 전부(+ 비입주사 회사 정보 `company`)를 한 요청 · 한
   * 트랜잭션으로(결정 2026-10-10). 회사 정보가 틀리면 건도 만들지 않는다.
   *
   * ★ 본문을 **DB 에 닿기 전에** 다 읽는다(`parseFirstSave`). 하나라도 틀리면 400 이고 아무것도
   *   만들지 않는다. 회사 세션이 남의 단체 ID 를 적으면 403 — RLS 의 `WITH CHECK` 가 한 번 더 막는다.
   */
  app.post<{ Body: unknown }>('/legal/corp-changes', async (req, reply) => {
    const session = requireSession(req);
    const parsed = parseFirstSave(req.body, session);
    if (!parsed.ok) return refuse(reply, parsed);
    const editor = parsed.value.company ? await deps.companyEditor(session) : false;
    const result = await deps.run(session, (client) => createCorpChange(client, session, parsed.value, editor));
    // ★ 커밋 뒤 — 회사 정보를 실었고 저장됐으면 삐용에 보낸다(권한 있는 사람만 여기까지 온다 · `checkCompanyWrite`).
    if (!result.ok || !parsed.value.company) return send(reply, result, 201);
    const companySync = await deps.pushCompany(session, parsed.value.orgCode, parsed.value.company);
    return send(reply, { ok: true, value: { ...result.value, companySync } }, 201);
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
    const editor = await deps.companyEditor(session);
    const result = await deps.run(session, (client) => readCorpChangeDraft(client, session, parsed.value, editor));
    return send(reply, await withCompanyDefaults(session, result));
  });

  app.get<{ Params: { id: string } }>('/legal/corp-changes/:id', async (req, reply) => {
    const session = requireSession(req);
    const editor = await deps.companyEditor(session);
    const result = await deps.run(session, (client) => readCorpChangeDetail(client, session, req.params.id, editor));
    return send(reply, await withCompanyDefaults(session, result));
  });

  /**
   * 상태 전이 `{ from, to, cancelReason? }` — 성공하면 새 상세(버튼까지)를 돌려준다.
   * 400 검증 실패(칸별 오류) · 403 역할 · 404 안 보이는 건 · 409 표에 없음 · 복원 대상 · 본 상태가 바뀜.
   */
  app.post<{ Params: { id: string }; Body: unknown }>('/legal/corp-changes/:id/transition', async (req, reply) => {
    const session = requireSession(req);
    const editor = await deps.companyEditor(session);
    const result = await deps.run(session, (client) => transitionCorpChange(client, session, req.params.id, req.body, editor));
    return send(reply, await withCompanyDefaults(session, result));
  });

  /**
   * 삭제 `?from=` — 운영사만, P · X 만(`checkDelete`). 임원도 함께 지운다. 성공은 204.
   * ★ 본 상태는 쿼리로 받는다 — 웹 중계(`forwardDelete`)는 본문을 싣지 않는다.
   */
  app.delete<{ Params: { id: string }; Querystring: { from?: unknown } }>('/legal/corp-changes/:id', async (req, reply) => {
    const session = requireSession(req);
    const result = await deps.run(session, (client) => deleteCorpChangeOp(client, session, req.params.id, req.query?.from));
    return result.ok ? reply.code(204).send() : send(reply, result);
  });

  app.patch<{ Params: { id: string }; Body: unknown }>('/legal/corp-changes/:id', async (req, reply) => {
    const session = requireSession(req);
    const editor = await deps.companyEditor(session);
    const result = await deps.run(session, (client) => saveCorpChangePayload(client, session, req.params.id, req.body, editor));
    // ★ 커밋 뒤 삐용에 보낸다. 저장된 값은 처리 함수가 읽은 것과 같은 함수(`parseCompanyPart`)로 다시 읽는다 —
    //   저장이 성공했다면 이 읽기도 성공한 것이다. 단체코드는 건의 것(운영사가 팝업에서 고른 값).
    const body = typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, unknown>) : {};
    const company = parseCompanyPart(body.company);
    const companySync =
      result.ok && company.ok && company.value ? await deps.pushCompany(session, result.value.orgCode, company.value) : null;
    const withDefaults = await withCompanyDefaults(session, result);
    return send(reply, withDefaults.ok ? { ok: true, value: { ...withDefaults.value, companySync } } : withDefaults);
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

  /**
   * 서류 출력 — 이 건에 뜨는 양식(법무 표시)과 장마다의 값. 작성완료(E) · 완료(C)만.
   * ★★ 주민번호 평문이 실린다(Q4) — 캐시 금지. 거절 응답에도 같은 머리를 단다(경로가 하나가 되게).
   */
  app.get<{ Params: { id: string }; Querystring: Record<string, unknown> }>('/legal/corp-changes/:id/print', async (req, reply) => {
    const session = requireSession(req);
    reply.header('Cache-Control', 'no-store');
    const result = await deps.run(session, (client) => readCorpChangePrint(client, session, req.params.id, req.query ?? {}));
    return send(reply, result);
  });

  /**
   * 출력 이력 한 줄 — [인쇄] 를 누를 때. 성공 201(본문 없음).
   * ★ 화면은 결과를 기다리지 않는다(기록이 실패해도 인쇄는 한다, 결정 2026-10-11). 그래서 **실패는 여기서
   *   서버 로그에 남긴다** — 사람이 볼 곳은 로그뿐이다. 본문은 로그에 싣지 않는다.
   */
  app.post<{ Params: { id: string }; Body: unknown }>('/legal/corp-changes/:id/prints', async (req, reply) => {
    const session = requireSession(req);
    try {
      const result = await deps.run(session, (client) => recordCorpChangePrint(client, session, req.params.id, req.body));
      if (!result.ok) {
        req.log.warn({ id: req.params.id, status: result.status, error: result.error }, '[corp-change-prints] 기록 거절');
        return send(reply, result);
      }
      return reply.code(201).send();
    } catch (err) {
      req.log.error({ id: req.params.id, err: (err as Error).message }, '[corp-change-prints] 기록 실패');
      return reply.code(500).send({ error: 'record_failed', message: '출력 이력을 남기지 못했습니다' });
    }
  });

  app.get<{ Params: { id: string } }>('/legal/corp-changes/:id/prints', async (req, reply) => {
    const session = requireSession(req);
    const result = await deps.run(session, (client) => listCorpChangePrints(client, req.params.id));
    return send(reply, result);
  });

  app.delete<{ Params: { id: string; oid: string } }>('/legal/corp-changes/:id/officers/:oid', async (req, reply) => {
    const session = requireSession(req);
    const result = await deps.run(session, (client) => removeOfficer(client, session, req.params.id, req.params.oid));
    return result.ok ? reply.code(204).send() : send(reply, result);
  });
}
