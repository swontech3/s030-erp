import { describe, it, expect } from 'vitest';
import {
  createEmptyDefinition,
  createEmptyPage,
  definitionTokens,
  extractTokens,
  FormDefinitionError,
  inputFieldsOf,
  isLegalForm,
  migrateDefinition,
  parseDefinition,
  resolveTokens,
  splitTokens,
  withFieldLabel,
  type FormDefinition,
} from './form-template.ts';

/**
 * 양식 정의 · 자리표시.
 * 앞 두 묶음은 레거시 `form-template-schema.test.ts` · `form-tokens.test.ts` 를 옮겼다.
 * 「입력칸」 묶음은 새 규칙(자리표시가 곧 입력칸, 결정 2026-10-07)이다.
 */

describe('양식 정의 (레거시와 같은 기대값)', () => {
  it('기본 정의는 1페이지·3x3 빈 그리드', () => {
    const d = createEmptyDefinition();
    expect(d.version).toBe(2);
    expect(d.font).toEqual({ family: '굴림', size: 9 });
    expect(d.pages).toHaveLength(1);
    expect(createEmptyPage().colWidths).toEqual([3, 3, 3]);
    expect(createEmptyPage().rowHeights).toEqual([1, 1, 1]);
    expect(createEmptyPage().cells).toEqual([]);
  });
  it('유효 정의는 통과', () => {
    expect(() => parseDefinition(createEmptyDefinition())).not.toThrow();
  });
  it('토큰 텍스트는 그대로 허용', () => {
    const d = createEmptyDefinition();
    d.pages[0]!.cells.push({ row: 0, col: 0, text: '{{회사명}}' });
    expect(parseDefinition(d).pages[0]!.cells[0]!.text).toBe('{{회사명}}');
  });
  it('colSpan은 1 이상 정수', () => {
    const d = createEmptyDefinition();
    d.pages[0]!.cells.push({ row: 0, col: 0, colSpan: 0 });
    expect(() => parseDefinition(d)).toThrow(FormDefinitionError);
  });
  it('필수: version·font·pages 누락 시 실패', () => {
    expect(() => parseDefinition({ pages: [] })).toThrow(FormDefinitionError);
  });
  it('align은 정의된 값만', () => {
    const d = createEmptyDefinition();
    d.pages[0]!.cells.push({ row: 0, col: 0, align: 'justify' as never });
    expect(() => parseDefinition(d)).toThrow(FormDefinitionError);
  });
  it('border 4변·dataSource·manualFields 허용', () => {
    const d = createEmptyDefinition();
    d.dataSource = 'corp-change';
    d.manualFields = [{ name: 'applyDate', label: '신청일' }];
    d.pages[0]!.cells.push({ row: 0, col: 0, text: '{{회사명}}', border: { bottom: false } });
    expect(() => parseDefinition(d)).not.toThrow();
  });
  it('v1 bordered:false → border 4변 false', () => {
    const v1 = {
      version: 1,
      font: { family: '굴림', size: 9 },
      pages: [{ colWidths: [3], rowHeights: [1], cells: [{ row: 0, col: 0, bordered: false }] }],
    };
    const m = migrateDefinition(v1);
    expect(m.version).toBe(2);
    expect(m.pages[0]!.cells[0]!.border).toEqual({ top: false, right: false, bottom: false, left: false });
    expect(m.pages[0]!.cells[0]!.bordered).toBeUndefined();
  });
  it('v1 bordered 없음 → border 키 없음(=4변 실선)', () => {
    const v1 = {
      version: 1,
      font: { family: '굴림', size: 9 },
      pages: [{ colWidths: [3], rowHeights: [1], cells: [{ row: 0, col: 0, text: 'x' }] }],
    };
    expect(migrateDefinition(v1).pages[0]!.cells[0]!.border).toBeUndefined();
  });
  it('migrateDefinition 멱등(v2 입력)', () => {
    const d = createEmptyDefinition();
    d.pages[0]!.cells.push({ row: 0, col: 0, border: { top: false } });
    expect(migrateDefinition(d)).toEqual(d);
  });
});

describe('검사가 새로 막는 것', () => {
  it('★ 모르는 키는 저장하지 않는다 — 아는 칸만 담은 새 정의', () => {
    const d = { ...createEmptyDefinition(), evil: 1 } as unknown;
    expect(parseDefinition(d)).not.toHaveProperty('evil');
  });
  it('열 폭이 0 이면 거절', () => {
    const d = createEmptyDefinition();
    d.pages[0]!.colWidths = [0];
    expect(() => parseDefinition(d)).toThrow(/열 폭/);
  });
  it('장이 0 개면 거절', () => {
    expect(() => parseDefinition({ ...createEmptyDefinition(), pages: [] })).toThrow(/장/);
  });
  it('위 여백은 0 을 받는다', () => {
    const d = createEmptyDefinition();
    d.pages[0]!.marginTop = 0;
    expect(parseDefinition(d).pages[0]!.marginTop).toBe(0);
  });
});

describe('자리표시 (레거시와 같은 기대값)', () => {
  it('extractTokens: 토큰 추출·중복제거·trim', () => {
    expect(extractTokens('{{a}} x {{ b }} y {{a}}')).toEqual(['a', 'b']);
    expect(extractTokens('no tokens')).toEqual([]);
  });
  it('resolveTokens: 값 치환, 미존재→빈칸', () => {
    expect(resolveTokens('대표 {{ceo}} 귀하', { ceo: '도정형' })).toBe('대표 도정형 귀하');
    expect(resolveTokens('{{x}}', {})).toBe('');
  });
  it('splitTokens: 이어 붙이면 resolveTokens 와 같다', () => {
    const t = '대표 {{ ceo }} 귀하 {{x}}{{y}}끝';
    const values: Record<string, string> = { ceo: '도정형', y: 'Y' };
    const joined = splitTokens(t)
      .map((p) => (p.kind === 'text' ? p.text : (values[p.name] ?? '')))
      .join('');
    expect(joined).toBe(resolveTokens(t, values));
    expect(splitTokens('글자만')).toEqual([{ kind: 'text', text: '글자만' }]);
    expect(splitTokens('')).toEqual([]);
  });
  it('definitionTokens: 전 셀 토큰 합집합', () => {
    const d = createEmptyDefinition();
    d.pages[0]!.cells.push({ row: 0, col: 0, text: '{{a}}' }, { row: 1, col: 0, text: '{{b}} {{a}}' });
    expect(definitionTokens(d).sort()).toEqual(['a', 'b']);
  });
});

describe('★★ 입력칸 = 양식 안의 자리표시 전부 (결정 2026-10-07)', () => {
  /** 기존 「사내이사 중임승낙서」와 같은 모양 — 이름표 사전이 없고 자리표시만 있다. */
  const legacyLike = (): FormDefinition => ({
    version: 2,
    font: { family: '굴림', size: 9 },
    dataSource: 'corp-change',
    pages: [
      {
        colWidths: [3, 3],
        rowHeights: [1, 1, 1],
        cells: [
          // ★ 배열 순서는 편집한 순서다 — 종이 순서(행→열)와 다르게 둔다.
          { row: 2, col: 0, text: '{{today}}' },
          { row: 0, col: 1, text: '{{ceoName}}' },
          { row: 0, col: 0, text: '{{companyName}} 귀중' },
        ],
      },
    ],
  });

  it('★ 이름표 사전이 없어도 입력칸이 뜬다 — 기존 양식이 그대로 뽑힌다', () => {
    expect(inputFieldsOf(legacyLike())).toEqual([
      { name: 'companyName', label: 'companyName' },
      { name: 'ceoName', label: 'ceoName' },
      { name: 'today', label: 'today' },
    ]);
  });
  it('★ 입력칸은 종이에 나오는 순서다(장 → 행 → 열)', () => {
    const d = legacyLike();
    d.pages.push({ colWidths: [3], rowHeights: [1], cells: [{ row: 0, col: 0, text: '{{second}} {{companyName}}' }] });
    expect(inputFieldsOf(d).map((f) => f.name)).toEqual(['companyName', 'ceoName', 'today', 'second']);
  });
  it('이름표가 있으면 이름표를 쓴다', () => {
    const d = { ...legacyLike(), manualFields: [{ name: 'ceoName', label: '대표자' }] };
    expect(inputFieldsOf(d).find((f) => f.name === 'ceoName')?.label).toBe('대표자');
  });
  it('★ 칸에서 쓰지 않는 이름표는 입력칸을 만들지 않는다', () => {
    const d = { ...legacyLike(), manualFields: [{ name: 'gone', label: '지운 칸' }] };
    expect(inputFieldsOf(d).some((f) => f.name === 'gone')).toBe(false);
  });
  it('withFieldLabel — 이름표를 달고, 비우면 지운다', () => {
    const named = withFieldLabel(legacyLike(), 'ceoName', ' 대표자 ');
    expect(named.manualFields).toEqual([{ name: 'ceoName', label: '대표자' }]);
    const cleared = withFieldLabel(named, 'ceoName', '');
    expect(cleared.manualFields).toBeUndefined();
  });
  it('withFieldLabel — 쓰지 않는 이름의 이름표는 함께 걸러 낸다', () => {
    const d = { ...legacyLike(), manualFields: [{ name: 'gone', label: '지운 칸' }] };
    expect(withFieldLabel(d, 'today', '작성일').manualFields).toEqual([{ name: 'today', label: '작성일' }]);
  });
  it('★ 레거시 dataSource 는 그대로 남는다 — 저장해도 레거시 자료를 바꾸지 않는다', () => {
    expect(parseDefinition(legacyLike()).dataSource).toBe('corp-change');
  });
});

describe('isLegalForm — 법무 양식은 표양식 화면에서 뽑지 않는다', () => {
  it('★ 법인변경 · 법인설립 원천이면 법무 양식', () => {
    expect(isLegalForm({ dataSource: 'corp-change' })).toBe(true);
    expect(isLegalForm({ dataSource: 'incorporation' })).toBe(true);
  });
  it('원천이 없거나 다른 것이면 일반 서류(재직증명서 등)', () => {
    expect(isLegalForm({})).toBe(false);
    expect(isLegalForm({ dataSource: 'employee' })).toBe(false);
    expect(isLegalForm(createEmptyDefinition())).toBe(false);
  });
  it('저장된 정의를 읽어도 원천이 남아 법무 양식으로 판정된다', () => {
    const stored = { ...createEmptyDefinition(), dataSource: 'corp-change' };
    expect(isLegalForm(parseDefinition(JSON.parse(JSON.stringify(stored))))).toBe(true);
  });
});
