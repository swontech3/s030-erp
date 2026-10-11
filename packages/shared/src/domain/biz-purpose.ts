/**
 * 사업목적 카탈로그(s040300010) · 「사업목적 고르기」 팝업 — 문구 검사 · 본문 읽기 · 덧붙이기. 순수 함수.
 *
 * 표는 레거시 `tb_s080_biz_purpose_catalog` 를 그대로 쓴다(결정 2026-10-11 — 새 표 없음).
 *
 * =============================================================================
 * ★★ 지금은 문구만 쓴다 (결정 2026-10-11)
 * =============================================================================
 * 표에는 업종코드 · KSIC · 인허가 칸이 있지만 **화면 · API 에 내보내지 않는다.** 칸은 지우지 않는다 —
 * 나중에 법령 데이터를 적재할 때 채운다. 그래서 이 파일의 모양(`BizPurposeItem`)에도 그 칸이 없다.
 *
 * =============================================================================
 * ★ 누가 무엇을 하나 (결정 2026-10-11)
 * =============================================================================
 *   · 편집(추가 · 문구 수정 · 사용 끄기/켜기) = 운영사만. 관리 화면은 030 하나다(한 업무는 한 화면)
 *   · 읽기 · 고르기 = 모든 회사 사용자(입주사 · 일반 고객사) — **사용 중인 문구만**
 *   · 실제 삭제는 없다 — 사용 끄기만
 *   · 같은 문구(앞뒤 공백 무시)는 거절한다(409)
 *
 * ★ 고른 문구는 법인변경 목적변경의 `purposes` 텍스트에 **줄로 덧붙인다**(`appendPurposeLines`).
 *   저장 형식은 텍스트 그대로다 — 어느 카탈로그 줄에서 왔는지는 남기지 않는다.
 */
import type { ScopeRole } from '../session.ts';
import { purposeLines } from './corp-change.ts';

/** 문구 길이 상한(결정 2026-10-11). */
export const BIZ_PURPOSE_TEXT_MAX = 200;
/** 검색어 길이 상한 — 문구보다 길 이유가 없다. */
export const BIZ_PURPOSE_QUERY_MAX = BIZ_PURPOSE_TEXT_MAX;

/** 화면 · API 가 주고받는 카탈로그 한 줄. 업종코드 · KSIC · 인허가는 없다(머리말 ★★). */
export interface BizPurposeItem {
  id: string;
  text: string;
  active: boolean;
}

type Fail = { ok: false; field: string; message: string };
const fail = (field: string, message: string): Fail => ({ ok: false, field, message });
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 문구 검사 — 앞뒤 공백을 걷어낸 값을 돌려준다.
 * ★ 줄바꿈은 거절한다 — 고른 문구는 `purposes` 의 **한 줄**이 된다. 줄바꿈이 섞이면 두 목적이 된다.
 * ★ 안쪽 공백은 고치지 않는다(사람이 적은 그대로).
 */
export function checkBizPurposeText(raw: unknown): { ok: true; value: string } | Fail {
  if (typeof raw !== 'string') return fail('text', '사업목적 문구를 입력하세요');
  const text = raw.trim();
  if (text === '') return fail('text', '사업목적 문구를 입력하세요');
  if (/[\r\n]/.test(text)) return fail('text', '사업목적 문구는 한 줄로 입력하세요');
  if (text.length > BIZ_PURPOSE_TEXT_MAX) return fail('text', `사업목적 문구는 ${BIZ_PURPOSE_TEXT_MAX}자 이내로 입력하세요`);
  return { ok: true, value: text };
}

/** 같은 문구인가 — 앞뒤 공백만 무시한다(결정 2026-10-11). 중복 거절(409)이 이 기준이다. */
export function sameBizPurposeText(a: string, b: string): boolean {
  return a.trim() === b.trim();
}

/** 추가 본문 — `{ text }`. */
export function parseBizPurposeCreate(raw: unknown): { ok: true; value: { text: string } } | Fail {
  if (!isObj(raw)) return fail('body', '요청 형식이 올바르지 않습니다');
  const text = checkBizPurposeText(raw.text);
  if (!text.ok) return text;
  return { ok: true, value: { text: text.value } };
}

/** 수정 본문 — `{ text?, active? }`. 둘 다 없으면 거절한다. */
export function parseBizPurposePatch(
  raw: unknown,
): { ok: true; value: { text?: string; active?: boolean } } | Fail {
  if (!isObj(raw)) return fail('body', '요청 형식이 올바르지 않습니다');
  const value: { text?: string; active?: boolean } = {};
  if (raw.text !== undefined) {
    const text = checkBizPurposeText(raw.text);
    if (!text.ok) return text;
    value.text = text.value;
  }
  if (raw.active !== undefined) {
    if (typeof raw.active !== 'boolean') return fail('active', '사용 여부가 올바르지 않습니다');
    value.active = raw.active;
  }
  if (value.text === undefined && value.active === undefined) return fail('body', '바꿀 내용이 없습니다');
  return { ok: true, value };
}

export interface BizPurposeListFilter {
  /** 문구에 들어 있는 글자(대소문자 무시). 없으면 전체. */
  q: string | null;
  /** 사용 끈 줄도 보이는가 — **운영사만** 켤 수 있다. 회사는 언제나 사용 중인 것만. */
  includeInactive: boolean;
}

/**
 * 목록 조건 — `?q=&includeInactive=1`.
 * ★ 회사 세션이 `includeInactive` 를 보내도 **조용히 끈다**(거절하지 않는다 — 고르기 팝업이 같은
 *   주소를 부르므로). DB 쪽도 읽기 정책만 있을 뿐 사용 여부는 거르지 않으니 여기가 그 자리다.
 */
export function parseBizPurposeListQuery(
  query: Record<string, unknown>,
  role: ScopeRole,
): { ok: true; value: BizPurposeListFilter } | Fail {
  const rawQ = query.q;
  if (rawQ !== undefined && typeof rawQ !== 'string') return fail('q', '검색어가 올바르지 않습니다');
  const q = (rawQ ?? '').trim();
  if (q.length > BIZ_PURPOSE_QUERY_MAX) return fail('q', `검색어는 ${BIZ_PURPOSE_QUERY_MAX}자 이내로 입력하세요`);
  const flag = query.includeInactive === '1' || query.includeInactive === 'true';
  return { ok: true, value: { q: q === '' ? null : q, includeInactive: role === 'operator' && flag } };
}

/**
 * 고른 문구를 `purposes` 텍스트 끝에 줄로 덧붙인다.
 *   · 이미 있는 줄(앞뒤 공백 무시)은 건너뛴다(결정 2026-10-11). 고른 것끼리 겹쳐도 한 번만
 *   · 지금 텍스트는 끝의 빈 줄 · 공백만 걷고 그대로 둔다 — 번호 · 순서 · 안쪽 글자를 고치지 않는다
 *   · 「1. 소프트웨어 개발」처럼 사람이 번호를 붙여 적은 줄은 「소프트웨어 개발」과 **다른 줄**로 본다
 *     (번호 규칙을 추측하지 않는다)
 * @returns 새 텍스트 · 덧붙인 문구 · 건너뛴 문구
 */
export function appendPurposeLines(
  current: string,
  picked: readonly string[],
): { text: string; added: string[]; skipped: string[] } {
  const have = new Set(purposeLines(current));
  const added: string[] = [];
  const skipped: string[] = [];
  for (const raw of picked) {
    const line = raw.trim();
    if (line === '') continue;
    if (have.has(line)) {
      skipped.push(line);
      continue;
    }
    have.add(line);
    added.push(line);
  }
  const base = current.replace(/\s+$/, '');
  if (added.length === 0) return { text: current, added, skipped };
  return { text: base === '' ? added.join('\n') : `${base}\n${added.join('\n')}`, added, skipped };
}
