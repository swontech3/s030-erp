/**
 * 「사업목적 고르기」 팝업의 「추천」 탭 — 사업 설명으로 업종 후보를 찾고, 고른 업종의 사업목적 문구를 정한다.
 * 순수 함수(AI 없음, 2026-10-22).
 *
 * 자료: 업종 사전(047) · 인허가 기준표(049, 「검토됨」만) · 법령 원문(048) · 카탈로그(030) ·
 *       「바꿔 부르는 말」(공통 코드 분류 `BIZ_ALIAS`). 이 탭은 **읽기만** 한다 — 바꿔 부르는 말은
 *       코드 관리, 카탈로그는 030 화면에서 고친다(한 업무는 한 화면).
 *
 * =============================================================================
 * ★★ 검색 규칙 (결정 2026-10-22)
 * =============================================================================
 *   ① 입력을 공백 · 쉼표로 낱말로 나누고, 낱말 끝 조사 하나를 뗀다(뗀 뒤 2글자 이상일 때만).
 *      2글자 미만 낱말은 버린다
 *   ② 바꿔 부르는 말 — 그 말이 입력 글자 안에 들어 있으면(공백 무시) 그 줄의 업종코드가 후보
 *   ③ 이름 맞추기 — 낱말이 종목 · KSIC 이름 · 업태에 들어 있으면 후보(공백 무시)
 *   ④ 점수 = 바꿔 부르는 말 10 · 종목 2 · KSIC 2 · 업태 1(종류마다 한 번). 점수 높은 순, 같으면 업종코드 순.
 *      바꿔 부르는 말이 맞은 업종은 이름만 맞은 업종(최대 5)보다 언제나 앞이다(2026-10-22 3 → 10)
 *      20개에서 자른다
 *
 * ★ 사업목적 문구(결정 2026-10-22) — 카탈로그에 그 업종코드 문구(사용 중)가 있으면 그것, 없으면 종목 이름.
 * ★ 읽기는 운영사 · 회사 모두(고르기 팝업을 둘 다 연다).
 */

/** 바꿔 부르는 말의 공통 코드 분류 — 코드값 = 업종코드 6자리, 이름 = 말을 「, 」로 이은 것. */
export const BIZ_ALIAS_CATEGORY = 'BIZ_ALIAS';
/** 바꿔 부르는 말의 파티션. */
export const BIZ_ALIAS_USE_TP = '000';
/** 사업 설명 길이 상한. */
export const BIZ_RECOMMEND_QUERY_MAX = 200;
/** 후보 최대 수. */
export const BIZ_RECOMMEND_LIMIT = 20;

/** 점수(검색 규칙 ④). */
export const BIZ_MATCH_SCORE = { alias: 10, item: 2, ksic: 2, type: 1 } as const;
export type BizMatchKind = keyof typeof BIZ_MATCH_SCORE;

/** 낱말 끝에서 떼는 조사 — 긴 것부터 본다. */
const PARTICLES = ['에서', '으로', '로', '를', '을', '이', '가', '은', '는', '와', '과', '의', '에', '도'];

/** 업종 사전 한 줄(+ KSIC 이름들). */
export interface BizDictEntry {
  bizCode: string;
  bizType: string;
  itemName: string;
  ksic: { code: string; name: string }[];
}

/** 바꿔 부르는 말 한 줄 — 공통 코드 값 그대로. */
export interface BizAliasRow {
  bizCode: string;
  /** 「, 」로 이은 말 */
  names: string;
}

/** 업종 후보 — `GET /legal/biz-purposes/recommend`. */
export interface BizRecommendCandidate {
  bizCode: string;
  bizType: string;
  itemName: string;
  ksic: { code: string; name: string }[];
  /** 무엇으로 맞았나 — 종류 순(바꿔 부르는 말 · 종목 · KSIC · 업태). 바꿔 부르는 말은 맞은 말도 */
  matchedBy: { kind: BizMatchKind; word?: string }[];
}

/** 인허가 근거 조문 하나. */
export interface BizRecommendBasis {
  lawName: string;
  /** 예: 「제12조 제1항」 · 「제26조의2 제1항제1호」 */
  article: string;
  /** 조문 첫 줄(제목 줄 「제N조(…)」을 뗀 글자) */
  firstLine: string;
}

/** 「검토됨」 인허가 하나. */
export interface BizRecommendLicense {
  kind: string;
  name: string | null;
  note: string | null;
  basis: BizRecommendBasis[];
}

/** 고른 업종 — `GET /legal/biz-purposes/recommend/:bizCode`. */
export interface BizRecommendDetail {
  bizCode: string;
  bizType: string;
  itemName: string;
  ksic: { code: string; name: string }[];
  /** 「검토됨」만. 없으면 빈 배열 */
  licenses: BizRecommendLicense[];
  /** 제안 사업목적 문구 — 카탈로그 문구 또는 종목 이름 */
  purpose: { text: string; source: 'catalog' | 'item' };
}

type Fail = { ok: false; field: string; message: string };
const fail = (field: string, message: string): Fail => ({ ok: false, field, message });

/** 비교용 — 공백을 모두 걷고 소문자로. */
export const squash = (s: string): string => s.replace(/\s+/g, '').toLowerCase();

/** 검색 규칙 ① — 낱말 나누기 · 조사 떼기 · 2글자 미만 버리기. 같은 낱말은 한 번만. */
export function splitBizWords(input: string): string[] {
  const out: string[] = [];
  for (const raw of input.split(/[\s,，、·]+/)) {
    let w = raw.trim();
    if (w === '') continue;
    for (const p of PARTICLES) {
      if (w.endsWith(p) && w.length - p.length >= 2) {
        w = w.slice(0, -p.length);
        break;
      }
    }
    if (w.length < 2) continue;
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

/** 바꿔 부르는 말 이름 → 말 목록(「, 」 · 「,」로 나눈다, 빈 말은 버린다). */
export function aliasWords(names: string): string[] {
  return names.split(',').map((s) => s.trim()).filter((s) => s !== '');
}

/**
 * 업종 후보(검색 규칙 ②~④).
 * @returns 후보(최대 `limit`) · 잘렸는가
 */
export function rankBizCandidates(
  input: string,
  dict: readonly BizDictEntry[],
  aliases: readonly BizAliasRow[],
  limit = BIZ_RECOMMEND_LIMIT,
): { items: BizRecommendCandidate[]; truncated: boolean } {
  const whole = squash(input);
  const words = splitBizWords(input).map(squash);
  if (whole === '') return { items: [], truncated: false };

  // ② 바꿔 부르는 말 — 업종코드마다 맞은 말들
  const aliasHit = new Map<string, string[]>();
  for (const a of aliases) {
    for (const w of aliasWords(a.names)) {
      const sw = squash(w);
      if (sw === '' || !whole.includes(sw)) continue;
      const got = aliasHit.get(a.bizCode) ?? [];
      if (!got.includes(w)) got.push(w);
      aliasHit.set(a.bizCode, got);
    }
  }

  const hit = (text: string) => {
    const t = squash(text);
    return words.some((w) => t.includes(w));
  };

  const scored: { c: BizRecommendCandidate; score: number }[] = [];
  for (const d of dict) {
    const matchedBy: BizRecommendCandidate['matchedBy'] = [];
    for (const word of aliasHit.get(d.bizCode) ?? []) matchedBy.push({ kind: 'alias', word });
    if (hit(d.itemName)) matchedBy.push({ kind: 'item' });
    if (d.ksic.some((k) => hit(k.name))) matchedBy.push({ kind: 'ksic' });
    if (hit(d.bizType)) matchedBy.push({ kind: 'type' });
    if (matchedBy.length === 0) continue;
    const kinds = new Set(matchedBy.map((m) => m.kind));
    const score = [...kinds].reduce((s, k) => s + BIZ_MATCH_SCORE[k], 0);
    scored.push({ c: { bizCode: d.bizCode, bizType: d.bizType, itemName: d.itemName, ksic: d.ksic, matchedBy }, score });
  }
  scored.sort((a, b) => b.score - a.score || (a.c.bizCode < b.c.bizCode ? -1 : a.c.bizCode > b.c.bizCode ? 1 : 0));
  return { items: scored.slice(0, limit).map((s) => s.c), truncated: scored.length > limit };
}

/**
 * 사업목적 문구(결정 2026-10-22) — 카탈로그에 그 업종코드 문구가 있으면 그것, 없으면 종목 이름.
 * 같은 업종코드 줄이 여럿이면(041 은 UNIQUE 라 없어야 한다) 문구 순 첫 줄.
 * @param catalog 사용 중인 카탈로그 줄(업종코드 · 문구)
 */
export function purposeTextFor(
  bizCode: string,
  itemName: string,
  catalog: readonly { bizCode: string | null; text: string }[],
): BizRecommendDetail['purpose'] {
  const first = catalog.filter((c) => c.bizCode === bizCode && c.text.trim() !== '').map((c) => c.text.trim()).sort()[0];
  return first !== undefined ? { text: first, source: 'catalog' } : { text: itemName.trim(), source: 'item' };
}

/** 조문 표기 — 「제12조 제1항」 · 「제26조의2 제1항제1호」 · 「제4조」. */
export function articleLabel(articleNo: number, branchNo: number, part: string | null): string {
  return `제${articleNo}조${branchNo ? `의${branchNo}` : ''}${part ? ` ${part}` : ''}`;
}

/** 조문 첫 줄 — 본문 첫 줄의 「제N조(제목)」을 떼고, 남는 글자가 없으면 다음 줄. */
export function articleFirstLine(body: string): string {
  const lines = body.split('\n');
  const head = (lines[0] ?? '').replace(/^제\d+조(의\d+)?(\([^)]*\))?\s*/, '').trim();
  return head !== '' ? head : (lines[1] ?? '').trim();
}

/** 추천 목록 조건 — `?q=`. 빈 설명은 거절한다(무엇을 찾을지 모른다). */
export function parseBizRecommendQuery(
  query: Record<string, unknown>,
): { ok: true; value: { q: string } } | Fail {
  const raw = query.q;
  if (raw !== undefined && typeof raw !== 'string') return fail('q', '사업 설명이 올바르지 않습니다');
  const q = (raw ?? '').trim();
  if (q === '') return fail('q', '사업 설명을 입력하세요');
  if (q.length > BIZ_RECOMMEND_QUERY_MAX) return fail('q', `사업 설명은 ${BIZ_RECOMMEND_QUERY_MAX}자 이내로 입력하세요`);
  return { ok: true, value: { q } };
}

/** 업종코드 모양(6자리 숫자). */
export function parseBizCodeParam(raw: unknown): { ok: true; value: string } | Fail {
  return typeof raw === 'string' && /^[0-9]{6}$/.test(raw) ? { ok: true, value: raw } : fail('bizCode', '업종코드가 올바르지 않습니다');
}
