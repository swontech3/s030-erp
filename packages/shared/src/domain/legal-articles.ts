/**
 * 법무 정관 최종본(설계 `doc/법무_정관_최종본_설계.md` §8, 결정 2026-11-07 · 11-08) — 순수 함수.
 *
 * 1단계(2026-11-08)는 **우리 시스템으로 설립한 회사**(완료된 법인설립 건이 있는 단체)만이다.
 *   · 최종본은 첫 정관 변경 때 설립 건 자료(정관 양식 + 설립 출력값)로 만들어 바로 확정한다(확인 화면 없음)
 *   · 다른 곳 설립 회사(docx · txt 나누기 · 확인 화면)는 2단계 — 그런 회사의 정관 변경 건은 지금처럼 안내만
 *
 * =============================================================================
 * ★★★ 정관이 바뀌는 구분은 공통 코드다 — `LAW_CNG_AR`(§1-3 · §8-10)
 * =============================================================================
 * 코드값 = 변경 구분, 이름 = 구분 이름, **설명** = 바꾸는 조항 역할(쉼표). 줄이 없거나 설명이 비면 정관이
 * 바뀌지 않는 구분이다. 역할 어휘(`ARTICLE_ROLES`)는 역할마다 문구를 바꾸는 방법이 코드라 여기 둔다.
 *
 * =============================================================================
 * ★★ 조항은 번호가 아니라 「역할」로 찾는다(§2-3)
 * =============================================================================
 * 우리 양식에서 만들 때 제목으로 역할을 붙인다(상호 · 목적 · 본점 · 공고방법). 한 최종본에 역할마다 0 또는 1.
 *
 * ★ 「변경된 정관」은 표양식 원칙의 예외다(§8-1) — 조항 목록으로 표양식 정의(`FormDefinition`)를 **코드가** 만든다
 *   (`amendedArticlesDefinition`). 그리기 · 인쇄는 기존 표양식 렌더러(미리보기 · 종이 같은 컴포넌트) 그대로다.
 * ★ 주민번호는 최종본에 넣지 않는다 — 정관 말미(발기인 · 사원 서명란)는 만들 때 버린다(§8-2).
 */
import { purposeLines } from './corp-change.ts';
import { corpChangeDocName, formatKoreanDate } from './corp-change-print.ts';
import { splitTokens, type Cell, type FormDefinition, type Page } from './form-template.ts';
import { ARTICLES_INCIDENTAL_PURPOSE, englishNameClause } from './incorporation-print.ts';
import { SIDO_FULL_NAMES, sidoOf } from './korea-sido.ts';

// =============================================================================
// 공통 코드 — 정관이 바뀌는 구분(S1)
// =============================================================================

/** 공통 코드 `LAW_CNG_AR` / `000` — 정관이 바뀌는 변경 구분과 바꾸는 조항 역할(§1-3). */
export const ARTICLES_RULE_CATEGORY = 'LAW_CNG_AR';
export const ARTICLES_RULE_USE_TP = '000';

/** 조항 역할 — 상호 · 목적 · 본점의 소재지 · 공고방법(§2-3). ★ 앱이 박아 둔 값이다. */
export const ARTICLE_ROLES = ['TRADE_NAME', 'PURPOSE', 'HQ', 'NOTICE'] as const;
export type ArticleRole = (typeof ARTICLE_ROLES)[number];

export const ARTICLE_ROLE_LABEL: Readonly<Record<ArticleRole, string>> = {
  TRADE_NAME: '상호',
  PURPOSE: '목적',
  HQ: '본점의 소재지',
  NOTICE: '공고방법',
};

export function isArticleRole(v: unknown): v is ArticleRole {
  return typeof v === 'string' && (ARTICLE_ROLES as readonly string[]).includes(v);
}

/** 변경 구분 → 바꾸는 조항 역할. 줄이 없거나 설명이 비면 키가 없다(정관이 바뀌지 않는 구분). */
export type ArticlesRules = Readonly<Record<string, readonly ArticleRole[]>>;

/** 코드 줄(`LAW_CNG_AR`) → 규칙. 설명을 쉼표로 나누고, 모르는 역할 · 빈 칸 · 겹침은 버린다(순서는 `ARTICLE_ROLES`). */
export function parseArticlesRules(rows: readonly { code: string; description: string | null }[]): ArticlesRules {
  const out: Record<string, readonly ArticleRole[]> = {};
  for (const r of rows) {
    const named = new Set((r.description ?? '').split(',').map((s) => s.trim()));
    const roles = ARTICLE_ROLES.filter((role) => named.has(role));
    if (roles.length > 0) out[r.code] = roles;
  }
  return out;
}

/** 이 구분이 바꾸는 조항 역할 — 정관이 바뀌지 않는 구분이면 빈 목록. */
export function articlesRolesFor(changeType: string, rules: ArticlesRules): readonly ArticleRole[] {
  return rules[changeType] ?? [];
}

// =============================================================================
// 조항
// =============================================================================

export type ArticleItemKind = 'CHAPTER' | 'ARTICLE' | 'TEXT';
export type ArticleSection = 'MAIN' | 'SUPPLEMENT';

/** 최종본의 한 덩어리(`tb_s080_legal_article_items` 한 줄). */
export interface ArticleItem {
  kind: ArticleItemKind;
  /** 조 번호 글자 — 「1」 · 「2의2」. 조가 아니면 null. */
  articleNo: string | null;
  /** 조 제목 · 장 제목(장은 줄 글 전체). 글(TEXT)은 null. */
  title: string | null;
  /** 본문 — 항 · 호는 줄로. 장은 ''. */
  body: string;
  role: ArticleRole | null;
  section: ArticleSection;
  /** 이 줄을 덧붙인 법인변경 건(개정 부칙, §8-3). 처음 만든 줄은 null. */
  changeId: string | null;
}

const CHAPTER_RE = /^제\s*\d+\s*장/;
const ARTICLE_RE = /^제\s*(\d+)\s*조(?:\s*의\s*(\d+))?\s*[(（]\s*(.+?)\s*[)）]\s*(.*)$/;

/** 조 제목 → 역할(§2-3). 「소집통지 및 공고」처럼 다른 낱말이 붙은 공고 제목은 뺀다. */
export function guessArticleRole(title: string): ArticleRole | null {
  const t = title.replace(/\s+/g, '');
  if (t === '상호') return 'TRADE_NAME';
  if (t === '목적') return 'PURPOSE';
  if (t.includes('본점')) return 'HQ';
  if (t === '공고방법' || t === '공고') return 'NOTICE';
  return null;
}

/** 조 머리 글 — 「제1조 (상호)」 · 「제2조의2 (…)」. */
export function articleHeading(item: Pick<ArticleItem, 'articleNo' | 'title'>): string {
  const [no, branch] = (item.articleNo ?? '').split('의');
  return `제${no}조${branch ? `의${branch}` : ''} (${item.title ?? ''})`;
}

/** 칸 글의 자리표시를 값으로 — 값이 없으면 빈칸. */
function fill(text: string, values: Readonly<Record<string, string>>): string {
  return splitTokens(text)
    .map((p) => (p.kind === 'text' ? p.text : (values[p.name] ?? '')))
    .join('');
}

interface FormLine {
  text: string;
  bold: boolean;
}

/** 한 장의 줄들 — 행마다 칸(왼쪽부터)의 글을 잇는다. 빈 줄은 버린다. */
function pageLines(page: Page, values: Readonly<Record<string, string>>): FormLine[] {
  const byRow = new Map<number, Cell[]>();
  for (const c of page.cells) {
    if (!c.text) continue;
    byRow.set(c.row, [...(byRow.get(c.row) ?? []), c]);
  }
  return [...byRow.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, cells]) => {
      const sorted = cells.sort((a, b) => a.col - b.col);
      const text = sorted
        .map((c) => fill(c.text ?? '', values))
        .join('')
        .split('\n')
        .map((l) => l.trimEnd())
        .join('\n')
        .trim();
      return { text, bold: sorted.some((c) => c.bold === true) };
    })
    .filter((l) => l.text !== '');
}

/**
 * 설립 정관 양식 + 설립 출력값 → 최종본 조항(S4, §5-1).
 *   · 첫 장 · 조 앞의 줄(표지 「定　款」 · 상호)은 버린다
 *   · 「제n장 …」 줄은 장, 「제n조 (제목) …」 줄은 조 — 같은 줄 뒷글은 본문 첫 줄
 *   · 조 뒤의 굵지 않은 줄은 바로 앞 덩어리의 본문(목적 목록 · 사원별 출자좌수 포함)
 *   · 조가 시작된 뒤 **굵은 줄**(장 · 조가 아닌 것)은 말미(「발기인」 · 「사원」 서명란) — 거기서 멈춘다(§8-2, 주민번호 없음)
 */
export function articleItemsFromForm(def: FormDefinition, values: Readonly<Record<string, string>>): ArticleItem[] {
  const items: ArticleItem[] = [];
  const roles = new Set<ArticleRole>();
  let started = false;
  for (const page of def.pages) {
    for (const line of pageLines(page, values)) {
      const first = line.text.split('\n')[0] ?? '';
      if (CHAPTER_RE.test(first)) {
        items.push({ kind: 'CHAPTER', articleNo: null, title: line.text.replace(/\n/g, ' '), body: '', role: null, section: 'MAIN', changeId: null });
        started = true;
        continue;
      }
      const m = ARTICLE_RE.exec(first);
      if (m) {
        const title = m[3]!;
        const guessed = guessArticleRole(title);
        const role = guessed && !roles.has(guessed) ? guessed : null;
        if (role) roles.add(role);
        const rest = [m[4]!.trim(), ...line.text.split('\n').slice(1)].filter((l) => l !== '').join('\n');
        items.push({
          kind: 'ARTICLE',
          articleNo: m[2] ? `${m[1]}의${m[2]}` : m[1]!,
          title,
          body: rest,
          role,
          section: 'MAIN',
          changeId: null,
        });
        started = true;
        continue;
      }
      if (!started) continue;
      if (line.bold) return items; // 말미
      const last = items[items.length - 1]!;
      last.body = last.body === '' ? line.text : `${last.body}\n${line.text}`;
    }
  }
  return items;
}

// =============================================================================
// 건의 바뀐 조항(S6, §3-1)
// =============================================================================

/** 미리 채울 때 쓰는 건 값 — 작성완료 전에는 저장된 값, 작성완료 때는 같은 값. */
export interface ArticleChangeContext {
  changeType: string;
  payload: Readonly<Record<string, unknown>>;
  /** 지금 회사 정보 — 상호(등기상) · 회사유형 · 본점 기본주소. */
  company: { name: string | null; memberType: string | null; headAddress: string | null };
  /** 완료된 설립 건의 상호 낱말 위치(F · B). */
  namePosition: string | null;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const ENGLISH_CLAUSE_RE = /영문으로는\s.+?라\s*표기한다\./;
/** 우리 정관 양식의 상호 문장 — 「본 회사는 ○○ (이)라 한다.」 */
const TRADE_NAME_CLAUSE_RE = /회사는\s+(.+?)\s*\(이\)라\s*한다/;

/**
 * 역할 하나의 자동 문구(§3-1). `found` 가 false 면 지금 조항에서 바꿀 자리를 찾지 못했다 — 사람이 고친다.
 *   · 상호 — 지금 상호(회사 형태 낱말을 붙인 것, 없으면 그대로)를 신규 상호로. 신규 영문상호가 있으면 영문 문장도
 *   · 목적 — 첫 줄은 두고 건의 목적으로 번호를 다시 매긴다(끝 줄 「위 각 호에 부대되는 일체의 사업」)
 *   · 본점 · 공고 — 조항에 적힌 시·도 정식 이름(`sidoInClause`)을 새 본점 시·도로(§8-7 — 구 · 시까지 적힌 정관은 사람이 고친다)
 */
export function autoArticleBody(role: ArticleRole, current: string, ctx: ArticleChangeContext): { body: string; found: boolean } {
  const p = ctx.payload;
  switch (role) {
    case 'TRADE_NAME': {
      const oldRaw = (ctx.company.name ?? '').trim();
      const newRaw = str(p.newName).trim();
      if (oldRaw === '' || newRaw === '') return { body: current, found: false };
      const oldDoc = corpChangeDocName(oldRaw, ctx.company.memberType, ctx.namePosition);
      const newDoc = corpChangeDocName(newRaw, ctx.company.memberType, ctx.namePosition);
      let body: string;
      if (current.includes(oldDoc)) body = current.split(oldDoc).join(newDoc);
      else if (current.includes(oldRaw)) body = current.split(oldRaw).join(newRaw);
      else {
        // 회사 정보의 상호가 조항에 없다 — 앞선 상호변경이 정관에만 반영됐을 때. 조항에 적힌 상호를 바꾼다(우리 양식 문장)
        const inClause = TRADE_NAME_CLAUSE_RE.exec(current)?.[1];
        if (!inClause) return { body: current, found: false };
        body = current.split(inClause).join(newDoc);
      }
      const en = englishNameClause(str(p.newNameEn));
      if (en) {
        if (ENGLISH_CLAUSE_RE.test(body)) body = body.replace(ENGLISH_CLAUSE_RE, en);
        else {
          const [head, ...tail] = body.split('\n');
          body = [`${head!.trimEnd()} ${en}`, ...tail].join('\n');
        }
      }
      return { body, found: true };
    }
    case 'PURPOSE': {
      const purposes = purposeLines(str(p.purposes));
      if (purposes.length === 0) return { body: current, found: false };
      const intro = current.split('\n')[0] ?? '';
      const list = [...purposes, ARTICLES_INCIDENTAL_PURPOSE].map((l, i) => `${i + 1}. ${l}`);
      return { body: [intro, ...list].filter((l) => l !== '').join('\n'), found: true };
    }
    case 'HQ':
    case 'NOTICE': {
      const newHq = p.newHqAddress;
      const to = sidoOf(typeof newHq === 'object' && newHq !== null ? str((newHq as Record<string, unknown>).address) : '');
      const from = sidoInClause(current, sidoOf(ctx.company.headAddress));
      if (from === null || to === '') return { body: current, found: false };
      return { body: current.split(from).join(to), found: true };
    }
  }
}

/**
 * 조항에 적힌 시·도 정식 이름 — 지금 본점(회사 정보)의 시·도가 조항에 있으면 그것, 없으면 조항에 처음 나오는 시·도
 * 정식 이름(17개). 정관은 회사 정보보다 늦거나 이를 수 있다(우리 밖에서 본점을 옮긴 회사) — 바꿀 것은 **정관에 적힌**
 * 시·도다. 하나도 없으면 null.
 */
function sidoInClause(body: string, hint: string): string | null {
  if (hint !== '' && body.includes(hint)) return hint;
  let best: { at: number; name: string } | null = null;
  for (const name of Object.values(SIDO_FULL_NAMES)) {
    const at = body.indexOf(name);
    if (at >= 0 && (best === null || at < best.at)) best = { at, name };
  }
  return best?.name ?? null;
}

/** 건의 바뀐 조항 하나 — 작성완료 스냅샷 · 출력 · 완료 반영이 쓴다. */
export interface ArticleChange {
  role: ArticleRole;
  articleNo: string | null;
  title: string | null;
  before: string;
  after: string;
}

/** 이 건의 정관 변경 계획 — 화면(미리 채움) · 작성완료(검증 · 스냅샷)가 같이 쓴다. */
export interface ArticleChangePlan {
  /** 최종본에 있는 역할마다 하나 — 바뀌지 않는 것도 들어 있다(`before === after`). */
  items: ArticleChange[];
  /** 자동으로 바꾸지 못했고 사람이 고치지도 않은 역할 — 작성완료를 막는다. */
  errors: { role: ArticleRole; message: string }[];
}

/** 사람이 고친 문구(payload `articlesItems`)를 읽는다 — 역할 → 글. 빈 글 · 모르는 역할은 없는 것. */
export function readArticleOverrides(payload: Readonly<Record<string, unknown>>): Partial<Record<ArticleRole, string>> {
  const raw = payload.articlesItems;
  const out: Partial<Record<ArticleRole, string>> = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isArticleRole(k) && typeof v === 'string' && v.trim() !== '') out[k] = v;
  }
  return out;
}

/** 공고 조항은 바꿀 자리가 없어도 막지 않는다(본점 시·도가 없는 공고 조항이 있다) — 그대로 둔다. */
const SOFT_ROLES: readonly ArticleRole[] = ['NOTICE'];

export function planArticleChanges(
  items: readonly ArticleItem[],
  roles: readonly ArticleRole[],
  ctx: ArticleChangeContext,
): ArticleChangePlan {
  const overrides = readArticleOverrides(ctx.payload);
  const plan: ArticleChangePlan = { items: [], errors: [] };
  for (const role of roles) {
    const item = items.find((i) => i.role === role);
    if (!item) continue; // 그 역할의 조항이 없으면 건너뛴다(유한회사 정관에는 공고 조항이 없다, §1-3)
    const auto = autoArticleBody(role, item.body, ctx);
    const override = overrides[role];
    if (override === undefined && !auto.found && !SOFT_ROLES.includes(role)) {
      plan.errors.push({
        role,
        message: `${articleHeading(item)} 조항에서 바꿀 자리를 찾지 못했습니다 — 「변경된 정관 조항」에서 직접 고치세요`,
      });
    }
    plan.items.push({ role, articleNo: item.articleNo, title: item.title, before: item.body, after: override ?? auto.body });
  }
  return plan;
}

/** 실제로 바뀐 조항만(§3-2). 비면 이 건은 정관 변경이 아니다. */
export function changedArticles(changes: readonly ArticleChange[]): ArticleChange[] {
  return changes.filter((c) => c.after !== c.before);
}

/** 개정 부칙 두 줄(§8-3) — 「부　칙 (2026. 11. 7.)」 · 「이 정관은 2026년 11월 7일부터 시행한다.」 날짜 = 결의일. */
export function supplementItems(resolutionDate: string, changeId: string | null): ArticleItem[] {
  const [y, m, d] = resolutionDate.slice(0, 10).split('-');
  return [
    { kind: 'TEXT', articleNo: null, title: null, body: `부　칙 (${y}. ${Number(m)}. ${Number(d)}.)`, role: null, section: 'SUPPLEMENT', changeId },
    { kind: 'TEXT', articleNo: null, title: null, body: `이 정관은 ${formatKoreanDate(resolutionDate)}부터 시행한다.`, role: null, section: 'SUPPLEMENT', changeId },
  ];
}

/**
 * 최종본 + 건의 바뀐 조항 → 새 조항 목록(완료 반영 · 출력 미리보기가 같이 쓴다, §3-4 · §8-3).
 * 역할이 같은 조항의 본문을 바꾸고 개정 부칙을 끝에 덧붙인다. 이미 이 건의 부칙이 있으면(완료 뒤 다시 출력) 덧붙이지 않는다.
 */
export function applyArticleChanges(
  items: readonly ArticleItem[],
  changes: readonly ArticleChange[],
  args: { changeId: string; resolutionDate: string | null },
): ArticleItem[] {
  if (items.some((i) => i.changeId === args.changeId)) return items.map((i) => ({ ...i }));
  const next = items.map((i) => {
    const c = i.role ? changes.find((x) => x.role === i.role) : undefined;
    return c ? { ...i, body: c.after } : { ...i };
  });
  return args.resolutionDate ? [...next, ...supplementItems(args.resolutionDate, args.changeId)] : next;
}

// =============================================================================
// 「변경된 정관」 그리기 — 조항 목록 → 표양식 정의(S7, §8-1)
// =============================================================================

/** 「변경된 정관」 서류 — 출력 목록 · 출력 이력(040)의 양식 자리. 표양식 양식이 아니다. */
export const AMENDED_ARTICLES_FORM_ID = 'ARTICLES_AMENDED';
export const AMENDED_ARTICLES_NAME = '변경된 정관';

/** 완료 건 다시 출력 안내(§8-4) — 대화상자에만, 종이에는 나가지 않는다. */
export const AMENDED_ARTICLES_REPRINT_NOTICE = '완료된 건입니다 — 변경된 정관은 지금 최종본 기준으로 나옵니다';
/** 정관이 바뀐 완료 건의 완료 취소 · 취소 거절(결정 2026-11-08). */
export const ARTICLES_APPLIED_LOCK_MESSAGE = '정관이 바뀐 건은 되돌릴 수 없습니다 — 새 변경 건으로 바로잡으세요';
/** 같은 조항을 바꾸는 작성완료 건이 이미 있을 때(§8-5). */
export const ARTICLES_BUSY_MESSAGE = '같은 정관 조항을 바꾸는 작성완료 건이 이미 있습니다 — 그 건이 완료 · 취소된 뒤 작성완료하세요';
/** 완료 때 최종본이 그 사이 바뀌었을 때(§3-4). */
export const ARTICLES_STALE_MESSAGE = '정관 최종본이 바뀌었습니다 — [서류수정] 뒤 다시 작성완료하세요';

/** 종이 치수 — 정관 양식(표양식 「정관」)과 같다. 본문 폭 17cm · 위 여백 0.8cm · 글꼴 바탕. */
const WIDTH_CM = 17;
const MARGIN_TOP = 0.8;
/** 한 장에 쓸 수 있는 높이 — 297mm − 위아래 12mm − 위 여백 0.8cm = 26.5cm. 어림이 모자랄 때를 위해 1cm 남긴다. */
const PAGE_BUDGET_CM = 25.5;
const PT_CM = 2.54 / 72;
const NO_BORDER = { top: false, right: false, bottom: false, left: false } as const;

/**
 * 줄 수 어림 — 넉넉하게(실제보다 많게) 센다. 칸은 글자 단위로 줄을 바꾼다(`word-break: break-all`).
 * 한글 · 전각은 1em, 그 밖(영문 · 숫자 · 공백 · 문장부호)은 0.6em. 한 줄 = 칸 폭 − 4px 에서 5% 덜어 낸 em.
 */
export function estimateLines(text: string, fontPt: number, widthCm = WIDTH_CM): number {
  const perLine = ((widthCm - 0.11) / (fontPt * PT_CM)) * 0.95;
  return text.split('\n').reduce((sum, line) => {
    let em = 0;
    for (const ch of line) em += ch.charCodeAt(0) < 0x2000 ? 0.6 : 1;
    return sum + Math.max(1, Math.ceil(em / perLine));
  }, 0);
}

const rowHeight = (text: string, fontPt: number) => estimateLines(text, fontPt) * fontPt * PT_CM * 1.5 + 0.02;

interface Block {
  /** 같은 장에 함께 둘 줄들. */
  rows: { text: string; fontPt: number; bold?: boolean; align?: 'center'; underline?: boolean; spacerCm?: number }[];
}

/** 표지 — 표양식 「정관」 첫 장과 같은 모양(定　款 상자 · 상호). */
function coverPage(companyName: string): Page {
  return {
    colWidths: [4.5, 8, 4.5],
    rowHeights: [7, 2.4, 12.5, 1.6],
    marginTop: MARGIN_TOP,
    cells: [
      { row: 1, col: 1, text: '定　款', bold: true, align: 'center', fontSize: 36 },
      { row: 3, col: 0, colSpan: 3, text: companyName, bold: true, align: 'center', fontSize: 22.5, border: NO_BORDER },
      ...[
        [0, 0],
        [0, 1],
        [0, 2],
        [1, 0],
        [1, 2],
        [2, 0],
        [2, 1],
        [2, 2],
      ].map(([row, col]) => ({ row: row!, col: col!, border: NO_BORDER })),
    ],
  };
}

/**
 * 조항 목록 → 「변경된 정관」 정의(§8-1 · §8-2 · §8-3).
 *   · 첫 장 표지(상호) → 장 · 조를 차례로 이어 쓴다. 조 머리는 첫 본문 줄과 같은 장에 둔다
 *   · 장 높이는 어림(`estimateLines`, 넉넉하게)으로 채운다 — 줄 행은 「내용에 맞춤」이라 실제 높이는 어림 이하다
 *   · 끝 — 개정일 · 상호 · 「대표이사 ○○○」(서명란 대신, §8-2)
 * ★ 글은 값이 아니라 칸 글로 들어간다 — 자리표시가 없다.
 */
export function amendedArticlesDefinition(args: {
  items: readonly ArticleItem[];
  companyName: string;
  ceoName: string;
  /** 개정일 `YYYY-MM-DD` — 그 건의 결의일. */
  amendedOn: string | null;
}): FormDefinition {
  const blocks: Block[] = [];
  for (const it of args.items) {
    if (it.kind === 'CHAPTER') {
      blocks.push({ rows: [{ text: '', fontPt: 12, spacerCm: 0.5 }, { text: it.title ?? '', fontPt: 14, bold: true, align: 'center', underline: true }, { text: '', fontPt: 12, spacerCm: 0.3 }] });
      continue;
    }
    const lines = it.body === '' ? [] : it.body.split('\n');
    if (it.kind === 'ARTICLE') {
      blocks.push({ rows: [{ text: articleHeading(it), fontPt: 12, bold: true }, ...(lines[0] !== undefined ? [{ text: lines[0], fontPt: 12 }] : [])] });
    } else {
      const head = it.section === 'SUPPLEMENT' && /^부\s*칙/.test(lines[0] ?? '');
      if (head) blocks.push({ rows: [{ text: '', fontPt: 12, spacerCm: 0.5 }, { text: lines[0]!, fontPt: 12, bold: true, align: 'center' }] });
      else if (lines[0] !== undefined) blocks.push({ rows: [{ text: lines[0], fontPt: 12 }] });
    }
    for (const l of lines.slice(1)) blocks.push({ rows: [{ text: l, fontPt: 12 }] });
  }
  // 끝 — 개정일 · 상호 · 대표이사(한 장에 함께)
  blocks.push({
    rows: [
      { text: '', fontPt: 12, spacerCm: 1.2 },
      { text: formatKoreanDate(args.amendedOn), fontPt: 12, align: 'center' },
      { text: '', fontPt: 12, spacerCm: 0.6 },
      { text: args.companyName, fontPt: 12, bold: true, align: 'center' },
      { text: `대표이사　${args.ceoName}`, fontPt: 12, align: 'center' },
    ],
  });

  const pages: Page[] = [coverPage(args.companyName)];
  let page: Page | null = null;
  let used = 0;
  const heightOf = (b: Block) => b.rows.reduce((s, r) => s + (r.spacerCm ?? rowHeight(r.text, r.fontPt)), 0);
  for (const b of blocks) {
    const h = heightOf(b);
    if (!page || (used + h > PAGE_BUDGET_CM && used > 0)) {
      page = { colWidths: [WIDTH_CM], rowHeights: [], marginTop: MARGIN_TOP, cells: [] };
      pages.push(page);
      used = 0;
    }
    // 장 맨 위의 빈 줄(사이 띄우기)은 버린다
    const rows = used === 0 ? b.rows.filter((r, i) => !(i === 0 && r.spacerCm !== undefined)) : b.rows;
    for (const r of rows) {
      const row = page.rowHeights.length;
      if (r.spacerCm !== undefined) {
        page.rowHeights.push(r.spacerCm);
        used += r.spacerCm;
        continue;
      }
      const height = rowHeight(r.text, r.fontPt);
      page.rowHeights.push(Math.round(height * 100) / 100);
      used += height;
      page.cells.push({
        row,
        col: 0,
        text: r.text,
        fontSize: r.fontPt,
        valign: 'top',
        fitHeight: true,
        border: { ...NO_BORDER, bottom: r.underline === true },
        ...(r.bold ? { bold: true } : {}),
        ...(r.align ? { align: r.align } : {}),
      });
    }
  }
  return { version: 2, font: { family: '바탕', size: 9 }, pages };
}

/** 「변경된 정관」의 상호 — 상호변경 건은 신규 상호, 그 밖은 지금 상호. 회사 형태 낱말은 출력과 같은 규칙. */
export function amendedArticlesCompanyName(ctx: ArticleChangeContext): string {
  const name = ctx.changeType === 'NAME' && str(ctx.payload.newName).trim() !== '' ? str(ctx.payload.newName) : (ctx.company.name ?? '');
  return corpChangeDocName(name, ctx.company.memberType, ctx.namePosition);
}
