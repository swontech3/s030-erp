/**
 * 표양식(s030100020) — 양식 정의의 모양 · 검사 · 자리표시.
 *
 * 레거시 `S-WonERP/src/lib/form-template-schema.ts` · `form-tokens.ts` ·
 * `form-template-kind.ts` 를 옮겼다. 저장된 JSON 모양(`definition`, version 2)은
 * **바꾸지 않았다** — `tb_s080_form_templates` 의 기존 2건을 그대로 쓰기 때문이다
 * (결정 2026-10-07).
 *
 * =============================================================================
 * ★★★ 값은 **손으로만** 채운다 — 자동 채움은 아직 없다 (결정 2026-10-07)
 * =============================================================================
 * 양식은 빈 칸(`{{이름}}`·`{{회사명}}` 같은 자리표시)만 정의하고, 뽑을 때 화면에서
 * 그 칸을 사람이 채운다. 운영사 직원 · 입주사 구성원 · 외부 회사가 전부 이 양식을
 * 쓰므로, 표 하나(`tb_s080_employees` 나 `tb_s080_members`)에 묶으면 나머지가 못 쓴다.
 *
 *   · 운영사 직원 자동 채움 — 운영사 직원 표·화면이 생길 때 붙인다
 *   · 법무(법인설립·변경) 자동 채움 — **법무 서비스(s04) 화면을 만들 때** 붙인다. 지금 법무 표에
 *     묶으면 법무 이관 때 되돌아와 고쳐야 한다
 *
 * 레거시의 `dataSource`(「법인 변경등기」 등)는 **읽기만 하고 쓰지 않는다.** 기존 2건이
 * `dataSource: 'corp-change'` 를 갖고 있어 칸을 남겨 두었다(지우면 레거시 자료가 바뀐다).
 * 자동 채움을 붙일 때 그 칸을 다시 쓸지는 그때 정한다.
 *
 * =============================================================================
 * ★★ 자리표시가 곧 입력칸이다 (결정 2026-10-07)
 * =============================================================================
 * 뽑을 때 뜨는 입력칸은 **양식 안의 `{{…}}` 전부**다(`inputFieldsOf`). 이름표는 양식에
 * 적어 둔 이름(`manualFields` 의 `label`)이고, 없으면 자리표시 글자 그대로다.
 * 레거시는 반대로 「수기 변수」 목록에 적은 것만 입력칸으로 띄웠다 — 그 방식이면 목록이
 * 0개인 기존 2건은 아무것도 채울 수 없다.
 *
 * ★ `manualFields` 는 이제 **이름표 사전**이다. 칸에서 지운 자리표시의 이름표가 남아
 *   있어도 입력칸은 생기지 않는다(입력칸은 칸의 글자에서만 나온다).
 */

import { parseLegalMark, type LegalFormMark } from './legal-form-mark.ts';

export type CellAlign = 'left' | 'center' | 'right';
export type CellValign = 'top' | 'middle' | 'bottom';

/** 칸 테두리 — 각 변을 따로 끈다. **생략 = 실선**이다. */
export interface CellBorder {
  top?: boolean;
  right?: boolean;
  bottom?: boolean;
  left?: boolean;
}

/**
 * 칸 하나. **병합의 왼쪽 위(앵커)에만 행이 있다** — 병합에 덮인 자리는 칸이 없다.
 * 아무 속성도 없는 빈 칸도 행이 없다(`form-grid.ts` 의 `updateCell` 이 지운다).
 */
export interface Cell {
  row: number;
  col: number;
  /** 기본 1. */
  colSpan?: number;
  /** 기본 1. */
  rowSpan?: number;
  text?: string;
  /**
   * @deprecated version 1 의 「무테」. `migrateDefinition` 이 `border` 로 옮기고 지운다.
   *   ★ 레거시 도구 막대의 [전체테두리]·[무테] 는 이 칸을 **version 2 정의에 계속 썼다** —
   *   렌더러는 이 칸을 보지 않으므로 그 두 버튼은 아무 효과가 없었다. 새 화면은 `border`
   *   만 쓴다.
   */
  bordered?: boolean;
  border?: CellBorder;
  /** 기본 left. */
  align?: CellAlign;
  /** 기본 middle. */
  valign?: CellValign;
  /** pt. 없으면 양식 글꼴 크기. */
  fontSize?: number;
  bold?: boolean;
}

/** 한 장 — A4 세로 한 장에 표 하나다. 치수는 전부 **cm** 다. */
export interface Page {
  colWidths: number[];
  rowHeights: number[];
  /** 위 여백(cm). 기본 1.2. */
  marginTop?: number;
  cells: Cell[];
}

/** 입력칸 이름표 하나 — 자리표시 `{{name}}` 의 사람 이름. */
export interface FieldLabel {
  name: string;
  label: string;
}

export interface FormDefinition {
  version: 2;
  font: { family: string; size: number };
  /**
   * 레거시 자동 채움 원천. ★ 새 화면은 쓰지 않는다 — 머리말 참조.
   * ★ 읽는 곳은 하나다 — `isLegalForm`(법무 양식이면 표양식 화면에서 인쇄를 막는다, 2026-10-09).
   */
  dataSource?: string;
  /** 자리표시의 이름표. ★ 입력칸 목록이 아니다 — 머리말 참조. */
  manualFields?: FieldLabel[];
  /**
   * 법무 표시 — 붙어 있으면 법인변경 [서류 출력]에 뜨는 양식이다(`legal-form-mark.ts`, 2026-10-11).
   * 표양식 화면에서 [인쇄] 를 막고, 떼야 지울 수 있다.
   */
  legal?: LegalFormMark;
  pages: Page[];
}

/** 위 여백 기본값(cm). 렌더러와 편집기가 같은 값을 쓴다. */
export const DEFAULT_MARGIN_TOP = 1.2;

/**
 * 양식 종류의 코드 분류 — 코드 관리의 `LAW_DOC_TP`(T 표 · N 일반서류).
 * ★ 이름은 코드에서 읽는다. 여기 박지 않는다.
 * ★ 두 종류는 **모양이 같다** — 분류용이다(레거시에서도 그랬다).
 */
export const FORM_KIND_CATEGORY = 'LAW_DOC_TP';
export const FORM_KIND_USE_TP = '000';

/**
 * 새 양식의 종류. DB 기본값(`kind DEFAULT 'T'`)과 같다.
 * ★ 앱이 박아 둔 코드값이라 코드 관리의 `PINNED_CODES` 에 올라 있다 — `T` 를 바꾸면
 *   새 양식이 없는 종류로 만들어진다.
 */
export const DEFAULT_FORM_KIND = 'T';

// =============================================================================
// 법무 양식 — 표양식 화면에서 뽑지 않는다 (결정 2026-10-09)
// =============================================================================

/**
 * 법무 업무의 자동 채움 원천 — 레거시 `doc-form-catalog` 의 두 도메인(법인변경 · 법인설립).
 * 기존 법무 양식 2건(법인변경등록1 · 사내이사 중임승낙서)이 `corp-change` 를 갖고 있다.
 */
export const LEGAL_DATA_SOURCES: readonly string[] = ['corp-change', 'incorporation'];

/**
 * 법무 양식인가 — 그렇다면 **표양식 화면에서 [인쇄] 를 막는다.** 법무 서류는 회사가 직접
 * 로그인해 법무 서비스(S04)에서 뽑는다. 표양식 화면은 운영사 전용이라 회사가 못 들어온다.
 *
 * 판정 근거는 둘이다(2026-10-11):
 *   · 법무 표시(`legal`) — 표양식 편집기에서 붙인다. 이것이 정본이다
 *   · 레거시 `dataSource` — 기존 2건이 갖고 있다. 표시를 붙이기 전에 두 양식이 표양식 화면에서
 *     뽑히는 틈이 생기지 않게 남겨 둔다
 */
export function isLegalForm(def: Pick<FormDefinition, 'dataSource' | 'legal'>): boolean {
  if (def.legal !== undefined) return true;
  return def.dataSource !== undefined && LEGAL_DATA_SOURCES.includes(def.dataSource);
}

// =============================================================================
// 빈 정의
// =============================================================================

export function createEmptyPage(): Page {
  return { colWidths: [3, 3, 3], rowHeights: [1, 1, 1], marginTop: DEFAULT_MARGIN_TOP, cells: [] };
}

export function createEmptyDefinition(): FormDefinition {
  return { version: 2, font: { family: '굴림', size: 9 }, pages: [createEmptyPage()] };
}

// =============================================================================
// 검사 — 서버가 저장 전에, 화면이 읽은 뒤에 부른다
// =============================================================================

/** 정의가 틀렸다. `message` 는 어느 자리가 왜 틀렸는지다(사람이 읽는다). */
export class FormDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormDefinitionError';
  }
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const fail = (where: string, why: string): never => {
  throw new FormDefinitionError(`${where}: ${why}`);
};

const isPosNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const isIntAtLeast = (v: unknown, min: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min;

const ALIGNS: readonly string[] = ['left', 'center', 'right'];
const VALIGNS: readonly string[] = ['top', 'middle', 'bottom'];
const EDGES = ['top', 'right', 'bottom', 'left'] as const;

/** 아는 칸만 골라 새 객체를 만든다 — 모르는 키를 DB 에 실어 보내지 않는다. */
function parseCell(v: unknown, where: string): Cell {
  if (!isObj(v)) return fail(where, '칸이 객체가 아닙니다');
  if (!isIntAtLeast(v.row, 0)) fail(where, 'row 는 0 이상 정수여야 합니다');
  if (!isIntAtLeast(v.col, 0)) fail(where, 'col 은 0 이상 정수여야 합니다');
  const cell: Cell = { row: v.row as number, col: v.col as number };

  if (v.colSpan !== undefined) {
    if (!isIntAtLeast(v.colSpan, 1)) fail(where, 'colSpan 은 1 이상 정수여야 합니다');
    cell.colSpan = v.colSpan as number;
  }
  if (v.rowSpan !== undefined) {
    if (!isIntAtLeast(v.rowSpan, 1)) fail(where, 'rowSpan 은 1 이상 정수여야 합니다');
    cell.rowSpan = v.rowSpan as number;
  }
  if (v.text !== undefined) {
    if (typeof v.text !== 'string') fail(where, 'text 는 글자여야 합니다');
    cell.text = v.text as string;
  }
  if (v.bordered !== undefined) {
    if (typeof v.bordered !== 'boolean') fail(where, 'bordered 는 참/거짓이어야 합니다');
    cell.bordered = v.bordered as boolean;
  }
  if (v.border !== undefined) {
    if (!isObj(v.border)) fail(where, 'border 가 객체가 아닙니다');
    const b = v.border as Record<string, unknown>;
    const border: CellBorder = {};
    for (const e of EDGES) {
      if (b[e] === undefined) continue;
      if (typeof b[e] !== 'boolean') fail(where, `border.${e} 는 참/거짓이어야 합니다`);
      border[e] = b[e] as boolean;
    }
    cell.border = border;
  }
  if (v.align !== undefined) {
    if (typeof v.align !== 'string' || !ALIGNS.includes(v.align)) fail(where, 'align 은 left·center·right 중 하나입니다');
    cell.align = v.align as CellAlign;
  }
  if (v.valign !== undefined) {
    if (typeof v.valign !== 'string' || !VALIGNS.includes(v.valign)) fail(where, 'valign 은 top·middle·bottom 중 하나입니다');
    cell.valign = v.valign as CellValign;
  }
  if (v.fontSize !== undefined) {
    if (!isPosNum(v.fontSize)) fail(where, 'fontSize 는 0 보다 커야 합니다');
    cell.fontSize = v.fontSize as number;
  }
  if (v.bold !== undefined) {
    if (typeof v.bold !== 'boolean') fail(where, 'bold 는 참/거짓이어야 합니다');
    cell.bold = v.bold as boolean;
  }
  return cell;
}

function parsePage(v: unknown, where: string): Page {
  if (!isObj(v)) return fail(where, '장이 객체가 아닙니다');
  const { colWidths, rowHeights, marginTop, cells } = v;
  if (!Array.isArray(colWidths) || colWidths.length === 0 || !colWidths.every(isPosNum)) {
    fail(where, '열 폭(colWidths)은 0 보다 큰 수가 하나 이상이어야 합니다');
  }
  if (!Array.isArray(rowHeights) || rowHeights.length === 0 || !rowHeights.every(isPosNum)) {
    fail(where, '행 높이(rowHeights)는 0 보다 큰 수가 하나 이상이어야 합니다');
  }
  if (!Array.isArray(cells)) fail(where, 'cells 가 목록이 아닙니다');
  const page: Page = {
    colWidths: [...(colWidths as number[])],
    rowHeights: [...(rowHeights as number[])],
    cells: (cells as unknown[]).map((c, i) => parseCell(c, `${where} 칸 ${i + 1}`)),
  };
  if (marginTop !== undefined) {
    if (typeof marginTop !== 'number' || !Number.isFinite(marginTop) || marginTop < 0) {
      fail(where, '위 여백(marginTop)은 0 이상이어야 합니다');
    }
    page.marginTop = marginTop as number;
  }
  return page;
}

/**
 * 정의를 검사하고 **아는 칸만 담은 새 정의**를 돌려준다. 틀리면 `FormDefinitionError`.
 *
 * ★ 레거시는 zod 였다. 새 ERP 에는 zod 가 없어서 손으로 쓴다 — 받는 모양은 레거시와 같다
 *   (`version: 2` · `font` · `pages` 필수, `dataSource`·`manualFields` 선택).
 */
export function parseDefinition(value: unknown): FormDefinition {
  if (!isObj(value)) return fail('양식', '정의가 객체가 아닙니다');
  if (value.version !== 2) fail('양식', 'version 은 2 여야 합니다');
  const font = value.font;
  if (!isObj(font) || typeof font.family !== 'string' || font.family.trim() === '' || !isPosNum(font.size)) {
    fail('양식', '글꼴(font)은 이름과 0 보다 큰 크기가 있어야 합니다');
  }
  const { family, size } = font as { family: string; size: number };
  if (!Array.isArray(value.pages) || value.pages.length === 0) fail('양식', '장(pages)이 하나 이상 있어야 합니다');

  const def: FormDefinition = {
    version: 2,
    font: { family, size },
    pages: (value.pages as unknown[]).map((p, i) => parsePage(p, `${i + 1}장`)),
  };
  if (value.dataSource !== undefined) {
    if (typeof value.dataSource !== 'string') fail('양식', 'dataSource 는 글자여야 합니다');
    def.dataSource = value.dataSource as string;
  }
  if (value.manualFields !== undefined) {
    if (!Array.isArray(value.manualFields)) fail('양식', 'manualFields 가 목록이 아닙니다');
    def.manualFields = (value.manualFields as unknown[]).map((m, i) => {
      if (!isObj(m) || typeof m.name !== 'string' || m.name.trim() === '' || typeof m.label !== 'string') {
        return fail('양식', `이름표 ${i + 1} 은 name·label 이 있어야 합니다`);
      }
      return { name: m.name, label: m.label };
    });
  }
  if (value.legal !== undefined) {
    const mark = parseLegalMark(value.legal);
    if (!mark.ok) fail('양식', mark.message);
    else def.legal = mark.value;
  }
  return def;
}

/**
 * 저장된 정의를 읽는다 — version 1 이면 2 로 옮긴다(멱등).
 *
 * ★ version 1 의 `bordered: false`(무테)는 `border` 4변 false 가 된다. 그 밖의 `bordered`
 *   는 지운다(생략 = 실선). 개발 DB 의 2건은 이미 version 2 다(2026-10-07 실측).
 */
export function migrateDefinition(input: unknown): FormDefinition {
  if (!isObj(input)) return fail('양식', '정의가 객체가 아닙니다');
  const pages = Array.isArray(input.pages) ? (input.pages as unknown[]) : [];
  const migrated = {
    version: 2,
    font: input.font,
    dataSource: input.dataSource,
    manualFields: input.manualFields,
    legal: input.legal,
    pages: pages.map((p) => {
      if (!isObj(p)) return p;
      const cells = Array.isArray(p.cells) ? (p.cells as unknown[]) : [];
      return {
        ...p,
        cells: cells.map((c) => {
          if (!isObj(c)) return c;
          const { bordered, ...rest } = c;
          if (input.version !== 2 && bordered === false) {
            return { ...rest, border: { top: false, right: false, bottom: false, left: false } };
          }
          return rest;
        }),
      };
    }),
  };
  return parseDefinition(migrated);
}

// =============================================================================
// 자리표시 — `{{이름}}`
// =============================================================================

/**
 * ★ 이름에는 `}` 말고 무엇이든 온다 — 한글도 된다(`{{회사명}}`). 레거시와 같은 식이다.
 *   앞뒤 공백은 떼고 읽는다(`{{ ceo }}` = `{{ceo}}`).
 */
const TOKEN_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

/** 글자 안의 자리표시 이름들 — 나온 순서대로, 중복 없이. */
export function extractTokens(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const name = (m[1] ?? '').trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * 자리표시를 값으로 바꾼다. **값이 없으면 빈칸**이다.
 *
 * ★ 「미상」·「-」 같은 글자를 지어 넣지 않는다 — 사람이 적은 값처럼 보인다
 *   (계약서 출력과 같은 규칙, `ContractDocumentModal`).
 */
export function resolveTokens(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(TOKEN_RE, (_, raw: string) => values[String(raw).trim()] ?? '');
}

/** 글자 조각 — 그냥 글자이거나 자리표시다. */
export type TextPiece = { kind: 'text'; text: string } | { kind: 'token'; name: string };

/**
 * 글자를 조각으로 나눈다 — 화면이 **비어 있는 자리표시**를 따로 그리려고 쓴다
 * (미리보기에서는 이름표를 흐리게 보이고, 종이에는 빈칸으로 나간다).
 * ★ 조각을 이어 붙이면 `resolveTokens` 와 같은 결과가 나와야 한다(시험이 지킨다).
 */
export function splitTokens(text: string): TextPiece[] {
  const out: TextPiece[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: 'text', text: text.slice(last, at) });
    out.push({ kind: 'token', name: (m[1] ?? '').trim() });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

/**
 * 셀을 읽는 순서 — 장 → 행 → 열. 입력칸이 **종이에 나오는 순서**로 뜨게 한다.
 * ★ `cells` 배열 순서는 편집한 순서라 종이 순서와 다르다(기존 2건에서 실측).
 */
function cellsInReadingOrder(page: Page): Cell[] {
  return [...page.cells].sort((a, b) => a.row - b.row || a.col - b.col);
}

/** 정의 전체의 자리표시 — 종이 순서대로, 중복 없이. */
export function definitionTokens(def: FormDefinition): string[] {
  const out: string[] = [];
  for (const p of def.pages) {
    for (const c of cellsInReadingOrder(p)) {
      if (!c.text) continue;
      for (const t of extractTokens(c.text)) if (!out.includes(t)) out.push(t);
    }
  }
  return out;
}

/** 뽑을 때 뜨는 입력칸 하나. */
export interface InputField {
  /** 자리표시 이름 — `{{name}}`. 값의 키다. */
  name: string;
  /** 화면에 보이는 이름표. 양식에 적은 이름, 없으면 `name` 그대로. */
  label: string;
}

/**
 * ★★ 뽑을 때 뜨는 입력칸 = 양식 안의 자리표시 전부(결정 2026-10-07). 머리말 참조.
 */
export function inputFieldsOf(def: FormDefinition): InputField[] {
  const labels = new Map((def.manualFields ?? []).map((m) => [m.name, m.label.trim()]));
  return definitionTokens(def).map((name) => ({ name, label: labels.get(name) || name }));
}

/**
 * 이름표를 고친다. 빈 이름표는 **지운다**(그러면 자리표시 글자가 이름표가 된다).
 * ★ 칸에서 쓰지 않는 이름의 이름표는 함께 걸러 낸다 — 사전이 쓰레기로 불어나지 않게.
 */
export function withFieldLabel(def: FormDefinition, name: string, label: string): FormDefinition {
  const used = new Set(definitionTokens(def));
  const rest = (def.manualFields ?? []).filter((m) => m.name !== name && used.has(m.name));
  const trimmed = label.trim();
  const next = trimmed && trimmed !== name && used.has(name) ? [...rest, { name, label: trimmed }] : rest;
  const out: FormDefinition = { ...def };
  if (next.length > 0) out.manualFields = next;
  else delete out.manualFields;
  return out;
}
