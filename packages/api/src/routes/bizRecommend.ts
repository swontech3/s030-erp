/**
 * 「사업목적 고르기」 팝업의 「추천」 탭 — 읽기 전용 주소들(2026-10-22 · AI 2026-10-27).
 *
 *   `GET /legal/biz-purposes/recommend?q=사업설명`   업종 후보(최대 20) — 검색 규칙은 shared `rankBizCandidates`
 *   `GET /legal/biz-purposes/recommend/:bizCode`    고른 업종 — 업태 · 종목 · KSIC · 「검토됨」 인허가와 근거 조문 ·
 *                                                   사업목적 문구(카탈로그 문구 → 없으면 종목 이름)
 *
 *   `POST /legal/biz-purposes/recommend/ai`         { q } — 위 후보 + AI 가 후보 안에서 고른 업종 · 이유(2026-10-27).
 *                                                   문구는 서버 문구. AI 가 안 되면 일반 추천 그대로 + 안내(`legal/bizRecommendAi.ts`)
 *
 * ★ 누가 — 로그인한 모든 사용자(운영사 · 회사). 고르기 팝업을 둘 다 연다(`GET /legal/biz-purposes` 와 같다).
 * ★ 쓰기는 없다. 바꿔 부르는 말은 코드 관리, 카탈로그는 030 화면에서 고친다(한 업무는 한 화면).
 * ★ 인허가는 참고용이다 — 「검토됨」만 내보낸다. 안내 문구는 화면이 항상 띄운다.
 */
import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from 'fastify';
import type { ErpSession } from '@swonbiz/shared';
import {
  parseBizCodeParam,
  parseBizRecommendQuery,
  purposeTextFor,
  rankBizCandidates,
  type BizRecommendCandidate,
  type BizRecommendDetail,
} from '@swonbiz/shared/domain/biz-purpose-recommend';
import {
  AI_SETTING_CATEGORY,
  AI_SETTING_USE_TP,
  parseAiSettings,
  type AiCandidate,
  type BizRecommendAiResult,
} from '@swonbiz/shared/domain/biz-purpose-recommend-ai';
import { env } from '../env.ts';
import { requireSession } from '../session/hook.ts';
import { scopeOfSession, withCompanyScope, type ScopedClient } from '../db/withCompanyScope.ts';
import { loadBizAliases, loadBizDict, loadBizEntry, loadCatalogTexts, loadReviewedLicenses } from '../db/bizRecommend.ts';
import { listCodes } from '../db/lookups.ts';
import { claudePick, runAiPick, type AiPrep } from '../legal/bizRecommendAi.ts';

/** 후보 찾기 — 사전 · 바꿔 부르는 말을 읽어 shared 규칙으로 고른다. */
export async function recommendBizOp(
  client: ScopedClient,
  q: string,
): Promise<{ items: BizRecommendCandidate[]; truncated: boolean }> {
  const dict = await loadBizDict(client);
  const aliases = await loadBizAliases(client);
  return rankBizCandidates(q, dict, aliases);
}

/** 고른 업종 — 없는(사용 안 함) 업종코드는 null. */
export async function bizDetailOp(client: ScopedClient, bizCode: string): Promise<BizRecommendDetail | null> {
  const entry = await loadBizEntry(client, bizCode);
  if (!entry) return null;
  const licenses = await loadReviewedLicenses(client, bizCode);
  const catalog = await loadCatalogTexts(client, bizCode);
  return { ...entry, licenses, purpose: purposeTextFor(bizCode, entry.itemName, catalog) };
}

/** AI 추천에 앞서 읽는 것 — 일반 추천 · 후보마다 서버 문구 · 설정(공통 코드 `AI_SETTING`). 쓰기는 없다. */
export async function prepareAiOp(client: ScopedClient, q: string): Promise<AiPrep> {
  const page = await recommendBizOp(client, q);
  const candidates: AiCandidate[] = [];
  for (const c of page.items) {
    const catalog = await loadCatalogTexts(client, c.bizCode);
    candidates.push({
      bizCode: c.bizCode,
      bizType: c.bizType,
      itemName: c.itemName,
      ksic: c.ksic,
      purpose: purposeTextFor(c.bizCode, c.itemName, catalog),
    });
  }
  const settings = parseAiSettings(await listCodes(client, [{ category: AI_SETTING_CATEGORY, useTp: AI_SETTING_USE_TP }]));
  return { ...page, candidates, settings };
}

/** 바꿔 끼울 수 있는 바깥 — 시험이 DB 없이 본다. */
export interface BizRecommendDeps {
  recommend(session: ErpSession, q: string): Promise<{ items: BizRecommendCandidate[]; truncated: boolean }>;
  detail(session: ErpSession, bizCode: string): Promise<BizRecommendDetail | null>;
  /** AI 추천 — 던지지 않는다. AI 가 안 되면 `ai.ok = false` 와 일반 추천 */
  ai(session: ErpSession, q: string, log: FastifyBaseLogger): Promise<BizRecommendAiResult>;
}

const run = <T>(session: ErpSession, fn: (client: ScopedClient) => Promise<T>) =>
  withCompanyScope(scopeOfSession(session), fn);

const defaultDeps: BizRecommendDeps = {
  recommend: (session, q) => run(session, (client) => recommendBizOp(client, q)),
  detail: (session, bizCode) => run(session, (client) => bizDetailOp(client, bizCode)),
  // ★ 읽기를 먼저 끝내고(트랜잭션 닫힘) 그 뒤에 AI 를 부른다
  ai: async (session, q, log) =>
    runAiPick(
      await run(session, (client) => prepareAiOp(client, q)),
      q,
      env.anthropicApiKey ? claudePick(env.anthropicApiKey) : null,
      log,
    ),
};

const invalid = (reply: FastifyReply, p: { field: string; message: string }) =>
  reply.code(400).send({ error: 'invalid_request', message: p.message, errors: [{ field: p.field, message: p.message }] });

export function registerBizRecommendRoutes(app: FastifyInstance, deps: BizRecommendDeps = defaultDeps): void {
  app.get<{ Querystring: Record<string, unknown> }>('/legal/biz-purposes/recommend', async (req, reply) => {
    const session = requireSession(req);
    const parsed = parseBizRecommendQuery(req.query ?? {});
    if (!parsed.ok) return invalid(reply, parsed);
    return reply.send(await deps.recommend(session, parsed.value.q));
  });

  app.get<{ Params: { bizCode: string } }>('/legal/biz-purposes/recommend/:bizCode', async (req, reply) => {
    const session = requireSession(req);
    const parsed = parseBizCodeParam(req.params.bizCode);
    if (!parsed.ok) return invalid(reply, parsed);
    const detail = await deps.detail(session, parsed.value);
    if (!detail) return reply.code(404).send({ error: 'not_found', message: '업종을 찾을 수 없습니다' });
    return reply.send({ item: detail });
  });

  app.post<{ Body: unknown }>('/legal/biz-purposes/recommend/ai', async (req, reply) => {
    const session = requireSession(req);
    const body = typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, unknown>) : {};
    const parsed = parseBizRecommendQuery({ q: body.q });
    if (!parsed.ok) return invalid(reply, parsed);
    return reply.send(await deps.ai(session, parsed.value.q, req.log));
  });
}
