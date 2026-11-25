/**
 * 법무 목록 · 상세 한 화면(2026-11-16 대표 지시) — 왼쪽 목록 · 오른쪽 상세의 「고른 건」을 주소에 싣는 규칙.
 *
 *   ?sel={건 ID}                 저장된 건
 *   ?sel=new&draft={조건}        새 건(임시 모드) — `draft` 는 옛 `/new?` 뒤의 조건 그대로(changeType · orgId · orgCode · memberType)
 *   (법인설립만) &print=articles  정관 보기 바로가기 — [서류 출력]을 열고 정관을 골라 둔다
 *
 * ★ 목록 조건(from · to · changeType · status · …)과 이름이 겹치지 않게 `sel` · `draft` 를 쓴다.
 * ★ 옛 상세 주소(`/legal/corp-changes/{id}` · `/legal/incorporations/{id}` · `…/new?…`)는 여기 주소로 넘긴다(각 `[id]/page.tsx`).
 */

export const SEL = 'sel';
export const DRAFT = 'draft';
export const PRINT = 'print';
/** 새 건을 가리키는 값. 실제 건 ID 는 UUID 라 겹치지 않는다. */
export const NEW_SEL = 'new';

/** 고른 건 — 저장된 건 · 새 건(임시 모드) */
export type LegalSel = { kind: 'saved'; id: string; print: string | null } | { kind: 'new'; draft: string };

/** 주소 → 고른 건. 없으면 null. */
export function readSel(params: URLSearchParams): LegalSel | null {
  const sel = params.get(SEL);
  if (!sel) return null;
  if (sel === NEW_SEL) return { kind: 'new', draft: params.get(DRAFT) ?? '' };
  return { kind: 'saved', id: sel, print: params.get(PRINT) };
}

/** 고른 건 → 주소 조건(목록 조건 뒤에 붙인다). */
export function writeSel(qs: URLSearchParams, sel: LegalSel | null): URLSearchParams {
  qs.delete(SEL);
  qs.delete(DRAFT);
  qs.delete(PRINT);
  if (sel?.kind === 'saved') {
    qs.set(SEL, sel.id);
    if (sel.print) qs.set(PRINT, sel.print);
  } else if (sel?.kind === 'new') {
    qs.set(SEL, NEW_SEL);
    if (sel.draft) qs.set(DRAFT, sel.draft);
  }
  return qs;
}

/** 목록 화면 주소 + 고른 건 */
export function selHref(listPath: string, sel: LegalSel, base?: URLSearchParams): string {
  const qs = writeSel(new URLSearchParams(base ?? ''), sel).toString();
  return `${listPath}${qs ? `?${qs}` : ''}`;
}

/** 같은 건인가(다시 받지 않으려고) */
export const selKey = (sel: LegalSel | null): string =>
  sel === null ? '' : sel.kind === 'saved' ? `saved:${sel.id}` : `new:${sel.draft}`;
