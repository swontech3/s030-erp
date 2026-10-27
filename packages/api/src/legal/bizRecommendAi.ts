/**
 * 사업목적 [AI 추천] — AI 를 부르고 서버 검사를 거친다(2026-10-27).
 *
 *   · AI 는 `AiPick` 한 자리다. 지금은 Claude(Messages API, 새 라이브러리 없이 fetch), 나중에 로컬 LLM 을
 *     같은 자리에 바꿔 끼운다 — 받는 것(지시 · 내용 · 설정)과 돌려주는 것(답 글)만 맞추면 된다
 *   · 검사 · 지시 글은 shared `biz-purpose-recommend-ai` 다(순수 함수)
 *
 * =============================================================================
 * ★★★ **절대 던지지 않는다** (`ntsStatus` 와 같은 이유)
 * =============================================================================
 * Claude 는 우리가 통제하지 못하는 바깥이다. 키가 없거나, 느리거나, 깨진 답을 주면
 * 일반 추천을 그대로 두고 안내만 단다 — `ai: { ok: false, message }`.
 *
 * ★ 공통 코드 `AI_SETTING` 의 `ENABLED` 가 `Y` 가 아니면 부르지 않는다 — 일반 추천만(2026-10-27, 이번 이행은 꺼 둔다).
 * ★ DB 트랜잭션 밖에서 부른다 — 후보 · 설정 · 문구를 먼저 읽고 닫은 뒤에 부른다(접속을 잡아 두지 않는다).
 * ★ 키 값은 로그에 남기지 않는다.
 */
import {
  AI_FAIL_MESSAGE,
  aiSystemPrompt,
  aiUserPrompt,
  checkAiPicks,
  type AiCandidate,
  type AiSettings,
  type BizRecommendAiResult,
} from '@swonbiz/shared/domain/biz-purpose-recommend-ai';
import type { BizRecommendCandidate } from '@swonbiz/shared/domain/biz-purpose-recommend';

/** 바꿔 끼우는 자리 — 지시(system) · 내용(user) · 설정 → AI 의 답 글. 실패는 던진다(부른 쪽이 접는다). */
export type AiPick = (req: { system: string; user: string; settings: AiSettings }) => Promise<string>;

/** 읽어 둔 것 — 일반 추천 · 켜짐 여부 · AI 에게 보낼 후보(서버 문구 포함) · 설정(없으면 null). */
export interface AiPrep {
  items: BizRecommendCandidate[];
  truncated: boolean;
  /** 공통 코드 `AI_SETTING` 의 `ENABLED` 가 `Y` — 아니면 후보 · 설정을 읽지 않는다(빈 값) */
  enabled: boolean;
  candidates: AiCandidate[];
  settings: AiSettings | null;
}

interface AiLog {
  warn: (obj: object, msg: string) => void;
}

const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * ★ 상한을 둔다. Claude 가 느릴 때 Fastify 워커가 거기 잡혀 있으면, 다른 요청까지 같이 느려진다.
 *   화면 홉(`/api/legal/biz-purposes/recommend/ai`)의 상한은 이보다 길다.
 */
export const AI_TIMEOUT_MS = 20_000;

/** Claude Messages API. 답의 글 조각을 이어 돌려준다. */
export function claudePick(apiKey: string, fetchFn: typeof fetch = fetch): AiPick {
  return async ({ system, user, settings }) => {
    const res = await fetchFn(MESSAGES_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: settings.model,
        max_tokens: settings.maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Claude 응답 ${res.status}`);
    const body = (await res.json()) as { content?: unknown };
    // ★ 모양을 믿지 않는다. 바깥 응답이다.
    if (!Array.isArray(body?.content)) throw new Error('content 가 배열이 아니다');
    return body.content
      .filter((c): c is { type: 'text'; text: string } => c?.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('');
  };
}

/**
 * AI 추천 — 일반 추천은 늘 그대로 돌려주고, AI 결과는 `ai` 에 담는다.
 * @param aiPick null 이면 키가 없는 것이다(부르지 않는다)
 */
export async function runAiPick(prep: AiPrep, q: string, aiPick: AiPick | null, log: AiLog): Promise<BizRecommendAiResult> {
  const general = { items: prep.items, truncated: prep.truncated };
  const fail = (message: string): BizRecommendAiResult => ({ ...general, ai: { ok: false, message } });

  // ★ 꺼져 있으면 키가 있어도 부르지 않는다(2026-10-27)
  if (!prep.enabled) return fail(AI_FAIL_MESSAGE.disabled);
  if (prep.candidates.length === 0) return fail(AI_FAIL_MESSAGE.noCandidates);
  if (!prep.settings) {
    log.warn({}, 'AI 추천을 건너뛴다 — 공통 코드 AI_SETTING 이 없거나 모양이 틀렸다');
    return fail(AI_FAIL_MESSAGE.noSettings);
  }
  if (!aiPick) {
    log.warn({}, 'AI 추천을 건너뛴다 — ANTHROPIC_API_KEY 가 없다');
    return fail(AI_FAIL_MESSAGE.noKey);
  }

  let raw: string;
  try {
    raw = await aiPick({
      system: aiSystemPrompt(prep.settings),
      user: aiUserPrompt(q, prep.candidates),
      settings: prep.settings,
    });
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'AI 추천 호출 실패 — 일반 추천으로');
    return fail(AI_FAIL_MESSAGE.failed);
  }

  const byCode = new Map(prep.candidates.map((c) => [c.bizCode, c]));
  const kept = checkAiPicks(raw, new Set(byCode.keys()), prep.settings);
  if (kept.length === 0) {
    log.warn({}, 'AI 추천 — 검사에서 남은 줄이 없다(깨진 답 · 후보 밖 · 빈 목록)');
    return fail(AI_FAIL_MESSAGE.empty);
  }
  // ③ 문구는 서버 문구
  return { ...general, ai: { ok: true, picks: kept.map((k) => ({ ...k, purpose: byCode.get(k.bizCode)!.purpose })) } };
}
