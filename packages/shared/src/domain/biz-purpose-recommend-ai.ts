/**
 * 「추천」 탭의 [AI 추천] — 순수 함수(2026-10-27).
 *
 * 흐름: 사업 설명 → 일반 추천의 업종 후보(`rankBizCandidates`) → AI 가 **후보 안에서** 업종을 고르고 이유를 단다
 *       → 서버 검사(`checkAiPicks`) → 고른 업종 · 이유 · 사업목적 문구(서버 문구).
 *
 * =============================================================================
 * ★★ 결정 (2026-10-26 · 10-27)
 * =============================================================================
 *   · AI 는 「후보 안에서 고르기」만 한다. 후보 밖 업종코드는 버린다
 *   · 사업목적 문구는 **서버 문구로 고정** — AI 에게 문구를 받지 않는다(업종코드 · 이유만)
 *   · 인허가는 지금처럼 고른 업종의 상세(`GET /recommend/:bizCode`)가 「검토됨」만 준다 — AI 에게 묻지 않는다
 *   · 설정값은 공통 코드 `AI_SETTING`(파티션 000): MODEL · MAX_PICKS · REASON_MAX · MAX_TOKENS
 *   · 실패(키 없음 · 호출 실패 · 시간 초과 · 검사에서 남는 줄 없음)는 일반 추천 그대로 + 안내
 *
 * ★ 서버 검사 — 하나라도 어기면 그 줄을 버린다. 남는 줄이 없으면 실패다.
 *   ① JSON 으로 읽히고 `{ picks: [{ bizCode, reason }] }` 모양인가(앞뒤 ``` 울타리 하나는 걷는다)
 *   ② 업종코드가 이번에 보낸 후보 안에 있는가
 *   ③ 문구 — AI 에게 받지 않는다. 서버 문구를 붙인다(라우트)
 *   ④ 이유가 비지 않고 `REASON_MAX` 자 이하인가
 *   ⑤ 같은 업종코드는 첫 줄만, `MAX_PICKS` 개에서 자른다
 */
import type { BizRecommendCandidate, BizRecommendDetail } from './biz-purpose-recommend.ts';

/** AI 설정의 공통 코드 분류 — 코드값 = 설정 이름, 이름 = 값. */
export const AI_SETTING_CATEGORY = 'AI_SETTING';
/** AI 설정의 파티션. */
export const AI_SETTING_USE_TP = '000';

/** AI 설정(공통 코드 `AI_SETTING`). */
export interface AiSettings {
  model: string;
  maxPicks: number;
  reasonMax: number;
  maxTokens: number;
}

/** AI 에게 보내는 후보 하나 — 업종과 서버 문구. */
export interface AiCandidate {
  bizCode: string;
  bizType: string;
  itemName: string;
  ksic: { code: string; name: string }[];
  purpose: BizRecommendDetail['purpose'];
}

/** 검사를 거친 AI 추천 하나. */
export interface AiPickItem {
  bizCode: string;
  reason: string;
  /** 서버 문구(카탈로그 문구 → 없으면 종목 이름) — AI 가 쓰지 않는다 */
  purpose: BizRecommendDetail['purpose'];
}

/** `POST /legal/biz-purposes/recommend/ai` 응답 — 일반 추천은 늘 같이 온다. */
export interface BizRecommendAiResult {
  items: BizRecommendCandidate[];
  truncated: boolean;
  ai: { ok: true; picks: AiPickItem[] } | { ok: false; message: string };
}

/** 실패 안내 — 화면은 일반 추천을 그대로 두고 이 글을 띄운다. */
export const AI_FAIL_MESSAGE = {
  noCandidates: '업종 후보가 없어 AI 추천을 하지 않았습니다',
  noSettings: 'AI 설정(공통 코드 AI_SETTING)이 없어 AI 추천을 하지 못했습니다 — 일반 추천만 보입니다',
  noKey: 'AI 추천을 쓸 수 없습니다(키 없음) — 일반 추천만 보입니다',
  failed: 'AI 추천을 하지 못했습니다 — 일반 추천만 보입니다',
  /** 검사에서 남는 줄이 없다 — 깨진 답 · 후보 밖 · 빈 목록 */
  empty: 'AI 추천에서 쓸 만한 업종이 나오지 않았습니다 — 일반 추천만 보입니다',
} as const;

const posInt = (s: string | undefined): number | null => {
  const t = (s ?? '').trim();
  return /^[0-9]+$/.test(t) && Number(t) > 0 ? Number(t) : null;
};

/** 공통 코드 줄(코드값 · 이름) → 설정. 넷 중 하나라도 없거나 모양이 틀리면 null. */
export function parseAiSettings(rows: readonly { code: string; name: string }[]): AiSettings | null {
  const by = new Map(rows.map((r) => [r.code, r.name]));
  const model = (by.get('MODEL') ?? '').trim();
  const maxPicks = posInt(by.get('MAX_PICKS'));
  const reasonMax = posInt(by.get('REASON_MAX'));
  const maxTokens = posInt(by.get('MAX_TOKENS'));
  if (model === '' || maxPicks === null || reasonMax === null || maxTokens === null) return null;
  return { model, maxPicks, reasonMax, maxTokens };
}

/** AI 에게 주는 지시(system). */
export function aiSystemPrompt(s: AiSettings): string {
  return [
    '너는 한국 법인 등기의 사업목적을 정하는 것을 돕는다.',
    '사용자의 사업 설명과 업종 후보 목록을 받는다. 후보 목록 안에서만 맞는 업종을 고른다.',
    `최대 ${s.maxPicks}개, 잘 맞는 순서로 고른다. 맞는 것이 없으면 빈 목록을 준다.`,
    `이유는 한국어 한 문장, ${s.reasonMax}자 이내로 쓴다.`,
    '답은 JSON 하나만 쓴다. 다른 글은 쓰지 않는다. 모양: {"picks":[{"bizCode":"업종코드 6자리","reason":"이유"}]}',
  ].join('\n');
}

/** AI 에게 주는 내용(user) — 사업 설명과 후보. */
export function aiUserPrompt(q: string, candidates: readonly AiCandidate[]): string {
  return JSON.stringify({
    사업설명: q,
    후보: candidates.map((c) => ({
      업종코드: c.bizCode,
      업태: c.bizType,
      종목: c.itemName,
      KSIC: c.ksic.map((k) => k.name),
      사업목적문구: c.purpose.text,
    })),
  });
}

/** 앞뒤 ``` 울타리 하나를 걷는다(```json 도). */
const unfence = (raw: string): string => {
  const m = /^\s*```[a-zA-Z]*\s*\n([\s\S]*?)\n?\s*```\s*$/.exec(raw);
  return m ? m[1]! : raw;
};

/**
 * 서버 검사 ①②④⑤ — AI 가 돌려준 글 → 남는 줄(업종코드 · 이유). ③ 문구는 부른 쪽이 서버 문구로 붙인다.
 * @param allowed 이번에 보낸 후보의 업종코드
 */
export function checkAiPicks(
  raw: string,
  allowed: ReadonlySet<string>,
  s: Pick<AiSettings, 'maxPicks' | 'reasonMax'>,
): { bizCode: string; reason: string }[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfence(raw));
  } catch {
    return [];
  }
  const picks = (parsed as { picks?: unknown } | null)?.picks;
  if (!Array.isArray(picks)) return [];
  const out: { bizCode: string; reason: string }[] = [];
  for (const p of picks) {
    if (typeof p !== 'object' || p === null) continue;
    const { bizCode, reason } = p as { bizCode?: unknown; reason?: unknown };
    if (typeof bizCode !== 'string' || typeof reason !== 'string') continue;
    const code = bizCode.trim();
    const why = reason.trim();
    if (!allowed.has(code)) continue;
    if (why === '' || why.length > s.reasonMax) continue;
    if (out.some((o) => o.bizCode === code)) continue;
    out.push({ bizCode: code, reason: why });
    if (out.length >= s.maxPicks) break;
  }
  return out;
}
