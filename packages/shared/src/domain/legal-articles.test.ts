import { describe, expect, it } from 'vitest';
import type { FormDefinition } from './form-template.ts';
import {
  amendedArticlesCompanyName,
  amendedArticlesDefinition,
  applyArticleChanges,
  articleHeading,
  articleItemsFromForm,
  articlesRolesFor,
  autoArticleBody,
  changedArticles,
  estimateLines,
  guessArticleRole,
  parseArticlesRules,
  planArticleChanges,
  readArticleOverrides,
  supplementItems,
  type ArticleChangeContext,
  type ArticleItem,
} from './legal-articles.ts';

const NB = { top: false, right: false, bottom: false, left: false };

/** 표양식 「정관」을 줄인 모양 — 표지 · 장 · 조 · 목적 목록 칸 · 말미. */
const FORM: FormDefinition = {
  version: 2,
  font: { family: '바탕', size: 9 },
  pages: [
    {
      colWidths: [4.5, 8, 4.5],
      rowHeights: [7, 2.4, 12.5, 1.6],
      cells: [
        { row: 1, col: 1, text: '定　款', bold: true },
        { row: 3, col: 0, colSpan: 3, text: '{{companyName}}', bold: true },
      ],
    },
    {
      colWidths: [0.53, 16.47],
      rowHeights: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      cells: [
        { row: 0, col: 0, colSpan: 2, text: '제 1 장　총　칙', bold: true },
        { row: 2, col: 0, colSpan: 2, text: '제1조 (상호)', bold: true },
        { row: 3, col: 0, colSpan: 2, text: '본 회사는 {{companyName}} (이)라 한다. {{companyNameEnClause}}' },
        { row: 4, col: 0, colSpan: 2, text: '제2조 (목적)', bold: true },
        { row: 5, col: 0, colSpan: 2, text: '본 회사는 다음의 사업을 영위함을 목적으로 한다.' },
        { row: 6, col: 0, text: '', border: NB },
        { row: 6, col: 1, text: '{{articlesPurposeList}}', fitHeight: true },
        { row: 7, col: 0, colSpan: 2, text: '제3조 (본점의 소재지)', bold: true },
        { row: 8, col: 0, colSpan: 2, text: '① 본 회사의 본점은 {{hqSido}}에 둔다.\n② 지점을 둘 수 있다.' },
        { row: 9, col: 0, colSpan: 2, text: '제4조 (공고방법)', bold: true },
        { row: 10, col: 0, colSpan: 2, text: '① 공고는 {{publicNoticeMethod}}에 게재한다.\n② 그 밖에는 {{hqSido}}에서 발간되는 일간신문에 게재한다.' },
      ],
    },
    {
      colWidths: [0.53, 16.47],
      rowHeights: [1, 1, 1, 1, 1, 1],
      cells: [
        { row: 0, col: 0, colSpan: 2, text: '제8장 부칙', bold: true },
        { row: 1, col: 0, colSpan: 2, text: '제53조 (시행)', bold: true },
        { row: 2, col: 0, colSpan: 2, text: '이 정관은 회사 설립등기일로부터 시행한다.' },
        { row: 3, col: 0, colSpan: 2, text: '발기인', bold: true },
        { row: 4, col: 0, colSpan: 2, text: '{{plannedDate}}' },
        { row: 5, col: 0, colSpan: 2, text: '{{articlesFounderList}}' },
      ],
    },
  ],
};

const VALUES = {
  companyName: '주식회사 가나',
  companyNameEnClause: '',
  articlesPurposeList: '1. 소프트웨어 개발업\n2. 위 각 호에 부대되는 일체의 사업',
  hqSido: '서울특별시',
  publicNoticeMethod: '회사의 인터넷 홈페이지',
  plannedDate: '2026년 1월 2일',
  articlesFounderList: '발기인　성명 : 홍길동 (900101-1234567)　(인)',
};

const items = () => articleItemsFromForm(FORM, VALUES);

const ctx = (over: Partial<ArticleChangeContext> = {}): ArticleChangeContext => ({
  changeType: 'NAME',
  payload: {},
  company: { name: '가나', memberType: 'R', headAddress: '서울 강남구 테헤란로 1' },
  namePosition: null,
  ...over,
});

describe('공통 코드 LAW_CNG_AR → 규칙(S1)', () => {
  it('설명의 역할을 쉼표로 · 모르는 역할 · 빈 설명은 버린다', () => {
    const rules = parseArticlesRules([
      { code: 'NAME', description: 'TRADE_NAME' },
      { code: 'HQ', description: ' NOTICE , HQ ,X' },
      { code: 'OFFICER', description: '' },
      { code: 'CEO_ADDR', description: null },
    ]);
    expect(rules).toEqual({ NAME: ['TRADE_NAME'], HQ: ['HQ', 'NOTICE'] });
    expect(articlesRolesFor('OFFICER', rules)).toEqual([]);
    expect(articlesRolesFor('PURPOSE', rules)).toEqual([]);
  });
  it('제목으로 역할 — 다른 낱말이 붙은 공고 제목은 뺀다', () => {
    expect(guessArticleRole('상호')).toBe('TRADE_NAME');
    expect(guessArticleRole('목적')).toBe('PURPOSE');
    expect(guessArticleRole('본점의 소재지')).toBe('HQ');
    expect(guessArticleRole('공고방법')).toBe('NOTICE');
    expect(guessArticleRole('소집통지 및 공고')).toBeNull();
  });
});

describe('설립 정관 양식 → 조항(S4)', () => {
  it('표지는 버리고 장 · 조 · 본문(목록 칸 포함)으로 나눈다 · 말미(굵은 「발기인」)에서 멈춘다', () => {
    const got = items();
    expect(got.map((i) => [i.kind, i.articleNo, i.title, i.role])).toEqual([
      ['CHAPTER', null, '제 1 장　총　칙', null],
      ['ARTICLE', '1', '상호', 'TRADE_NAME'],
      ['ARTICLE', '2', '목적', 'PURPOSE'],
      ['ARTICLE', '3', '본점의 소재지', 'HQ'],
      ['ARTICLE', '4', '공고방법', 'NOTICE'],
      ['CHAPTER', null, '제8장 부칙', null],
      ['ARTICLE', '53', '시행', null],
    ]);
    expect(got[1]!.body).toBe('본 회사는 주식회사 가나 (이)라 한다.');
    expect(got[2]!.body).toBe('본 회사는 다음의 사업을 영위함을 목적으로 한다.\n1. 소프트웨어 개발업\n2. 위 각 호에 부대되는 일체의 사업');
    expect(got[3]!.body).toBe('① 본 회사의 본점은 서울특별시에 둔다.\n② 지점을 둘 수 있다.');
    // ★ 주민번호가 든 말미는 들어가지 않는다
    expect(JSON.stringify(got)).not.toContain('900101');
    expect(got.every((i) => i.section === 'MAIN' && i.changeId === null)).toBe(true);
  });
  it('조 머리 글', () => {
    expect(articleHeading({ articleNo: '1', title: '상호' })).toBe('제1조 (상호)');
    expect(articleHeading({ articleNo: '2의2', title: '전자등록' })).toBe('제2조의2 (전자등록)');
  });
});

describe('건의 바뀐 조항(S6)', () => {
  const body = (role: ArticleItem['role']) => items().find((i) => i.role === role)!.body;

  it('상호 — 회사 형태 낱말을 붙인 지금 상호를 신규 상호로 · 영문상호 문장을 붙인다', () => {
    const r = autoArticleBody('TRADE_NAME', body('TRADE_NAME'), ctx({ payload: { newName: '다라', newNameEn: 'Dara' } }));
    expect(r).toEqual({ body: '본 회사는 주식회사 다라 (이)라 한다. 영문으로는 Dara Co., Ltd.라 표기한다.', found: true });
  });
  it('상호 — 회사 정보의 상호가 조항에 없으면 조항에 적힌 상호를 바꾼다(앞선 상호변경이 정관에만 반영됨)', () => {
    const r = autoArticleBody('TRADE_NAME', '본 회사는 주식회사 다라 (이)라 한다.', ctx({ payload: { newName: '마바' } }));
    expect(r).toEqual({ body: '본 회사는 주식회사 마바 (이)라 한다.', found: true });
  });
  it('상호 — 지금 상호를 찾지 못하면 그대로 · found=false', () => {
    expect(autoArticleBody('TRADE_NAME', '본 회사는 무엇이라 한다.', ctx({ payload: { newName: '다라' } })).found).toBe(false);
  });
  it('목적 — 첫 줄은 두고 번호를 다시 매긴다(부대사업 끝 줄)', () => {
    const r = autoArticleBody('PURPOSE', body('PURPOSE'), ctx({ changeType: 'PURPOSE', payload: { purposes: '음식점업\n\n도소매업' } }));
    expect(r.body).toBe('본 회사는 다음의 사업을 영위함을 목적으로 한다.\n1. 음식점업\n2. 도소매업\n3. 위 각 호에 부대되는 일체의 사업');
  });
  it('본점 · 공고 — 시·도 정식 이름을 바꾼다 · 같은 시·도면 그대로', () => {
    const c = ctx({ changeType: 'HQ_OUT', payload: { newHqAddress: { zipCode: '1', address: '경기 성남시 분당구 1', addressDetail: null } } });
    expect(autoArticleBody('HQ', body('HQ'), c).body).toBe('① 본 회사의 본점은 경기도에 둔다.\n② 지점을 둘 수 있다.');
    expect(autoArticleBody('NOTICE', body('NOTICE'), c).body).toContain('경기도에서 발간되는');
    const same = ctx({ changeType: 'HQ', payload: { newHqAddress: { address: '서울특별시 마포구 1' } } });
    expect(autoArticleBody('HQ', body('HQ'), same)).toEqual({ body: body('HQ'), found: true });
  });

  it('본점 — 회사 정보의 시·도가 조항에 없으면 조항에 적힌 시·도를 바꾼다(정관이 회사 정보보다 늦은 회사)', () => {
    const c = ctx({
      changeType: 'HQ_OUT',
      company: { name: '가나', memberType: 'A', headAddress: '부산 영도구 1' },
      payload: { newHqAddress: { address: '경기 성남시 1' } },
    });
    expect(autoArticleBody('HQ', body('HQ'), c)).toEqual({ body: '① 본 회사의 본점은 경기도에 둔다.\n② 지점을 둘 수 있다.', found: true });
  });
  it('계획 — 사람이 고친 문구가 이긴다 · 찾지 못한 역할은 오류 · 공고는 오류로 보지 않는다', () => {
    const its = items().map((i) => (i.role === 'HQ' ? { ...i, body: '본점은 부산에 둔다.' } : i));
    const c = ctx({ changeType: 'HQ', payload: { newHqAddress: { address: '경기 수원시 1' } } });
    const plan = planArticleChanges(its, ['HQ', 'NOTICE'], c);
    expect(plan.errors.map((e) => e.role)).toEqual(['HQ']);
    expect(plan.errors[0]!.message).toContain('제3조 (본점의 소재지)');
    const fixed = planArticleChanges(its, ['HQ', 'NOTICE'], { ...c, payload: { ...c.payload, articlesItems: { HQ: '본점은 수원시에 둔다.' } } });
    expect(fixed.errors).toEqual([]);
    expect(changedArticles(fixed.items).map((x) => x.role)).toEqual(['HQ', 'NOTICE']);
  });
  it('계획 — 그 역할의 조항이 없으면 건너뛴다(유한회사 공고)', () => {
    const its = items().filter((i) => i.role !== 'NOTICE');
    const c = ctx({ changeType: 'HQ_OUT', payload: { newHqAddress: { address: '경기 수원시 1' } } });
    expect(planArticleChanges(its, ['HQ', 'NOTICE'], c).items.map((x) => x.role)).toEqual(['HQ']);
  });
  it('사람이 고친 문구 읽기 — 빈 글 · 모르는 역할은 버린다', () => {
    expect(readArticleOverrides({ articlesItems: { HQ: ' x ', PURPOSE: '  ', ZZ: 'y' } })).toEqual({ HQ: ' x ' });
    expect(readArticleOverrides({ articlesItems: 'x' })).toEqual({});
  });
});

describe('완료 반영 · 개정 부칙(S8, §8-3)', () => {
  it('역할이 같은 조항의 본문을 바꾸고 부칙 두 줄을 덧붙인다 · 같은 건은 두 번 붙이지 않는다', () => {
    const its = items();
    const plan = planArticleChanges(its, ['TRADE_NAME'], ctx({ payload: { newName: '다라' } }));
    const next = applyArticleChanges(its, plan.items, { changeId: 'c1', resolutionDate: '2026-11-07' });
    expect(next.find((i) => i.role === 'TRADE_NAME')!.body).toBe('본 회사는 주식회사 다라 (이)라 한다.');
    expect(next.slice(-2).map((i) => [i.body, i.section, i.changeId])).toEqual([
      ['부　칙 (2026. 11. 7.)', 'SUPPLEMENT', 'c1'],
      ['이 정관은 2026년 11월 7일부터 시행한다.', 'SUPPLEMENT', 'c1'],
    ]);
    expect(applyArticleChanges(next, plan.items, { changeId: 'c1', resolutionDate: '2026-11-07' })).toEqual(next);
    expect(its.find((i) => i.role === 'TRADE_NAME')!.body).toBe('본 회사는 주식회사 가나 (이)라 한다.'); // 원본은 그대로
  });
  it('부칙 두 줄', () => {
    expect(supplementItems('2026-01-05', null).map((i) => i.body)).toEqual(['부　칙 (2026. 1. 5.)', '이 정관은 2026년 1월 5일부터 시행한다.']);
  });
});

describe('「변경된 정관」 정의(S7, §8-1 · §8-2)', () => {
  const its = applyArticleChanges(items(), [], { changeId: 'c1', resolutionDate: '2026-11-07' });

  it('표지(상호) → 장 · 조 · 부칙 → 끝(개정일 · 상호 · 대표이사)', () => {
    const def = amendedArticlesDefinition({ items: its, companyName: '주식회사 가나', ceoName: '홍길동', amendedOn: '2026-11-07' });
    expect(def.pages[0]!.cells.some((c) => c.text === '주식회사 가나')).toBe(true);
    const texts = def.pages.slice(1).flatMap((p) => p.cells.map((c) => c.text));
    expect(texts).toContain('제1조 (상호)');
    expect(texts).toContain('1. 소프트웨어 개발업');
    expect(texts).toContain('부　칙 (2026. 11. 7.)');
    expect(texts.slice(-3)).toEqual(['2026년 11월 7일', '주식회사 가나', '대표이사　홍길동']);
    // 서명란 · 주민번호 없음
    expect(texts.join()).not.toContain('발기인　성명');
  });

  it('긴 정관은 여러 장 — 장마다 어림 높이가 한 장을 넘지 않는다 · 조 머리는 첫 본문 줄과 같은 장', () => {
    const long: ArticleItem[] = Array.from({ length: 60 }, (_, i) => ({
      kind: 'ARTICLE' as const,
      articleNo: String(i + 1),
      title: `조항${i + 1}`,
      body: `① ${'가'.repeat(90)}\n② ${'나'.repeat(30)}`,
      role: null,
      section: 'MAIN' as const,
      changeId: null,
    }));
    const def = amendedArticlesDefinition({ items: long, companyName: 'X', ceoName: 'Y', amendedOn: '2026-11-07' });
    expect(def.pages.length).toBeGreaterThan(3);
    for (const p of def.pages.slice(1)) {
      expect(p.rowHeights.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(25.6);
      const last = p.cells[p.cells.length - 1]!;
      expect(last.text).not.toMatch(/^제\d+조 /); // 머리만 장 끝에 남지 않는다
    }
  });

  it('줄 수 어림 — 한글 1em · 그 밖 0.6em', () => {
    expect(estimateLines('가'.repeat(30), 12)).toBe(1);
    expect(estimateLines('가'.repeat(40), 12)).toBe(2);
    expect(estimateLines('a\nb', 12)).toBe(2);
  });

  it('상호 — 상호변경 건은 신규 상호', () => {
    expect(amendedArticlesCompanyName(ctx({ payload: { newName: '다라' } }))).toBe('주식회사 다라');
    expect(amendedArticlesCompanyName(ctx({ changeType: 'PURPOSE' }))).toBe('주식회사 가나');
  });
});
