import { describe, expect, it } from 'vitest';
import {
  BIZ_PURPOSE_TEXT_MAX,
  appendPurposeLines,
  checkBizPurposeText,
  parseBizPurposeCreate,
  parseBizPurposeListQuery,
  parseBizPurposePatch,
  sameBizPurposeText,
} from './biz-purpose.ts';
import { CHANGE_TYPE_DEFS } from './corp-change.ts';

describe('checkBizPurposeText', () => {
  it('앞뒤 공백을 걷고 안쪽은 그대로 둔다', () => {
    expect(checkBizPurposeText('  소프트웨어  개발 및 공급업 ')).toEqual({ ok: true, value: '소프트웨어  개발 및 공급업' });
  });
  it('빈 문구 · 글자가 아닌 값은 거절', () => {
    for (const v of ['', '   ', undefined, null, 3]) expect(checkBizPurposeText(v).ok).toBe(false);
  });
  it('줄바꿈이 섞이면 거절 — purposes 의 한 줄이 된다', () => {
    const r = checkBizPurposeText('경영 컨설팅업\n부동산 임대업');
    expect(r).toEqual({ ok: false, field: 'text', message: '사업목적 문구는 한 줄로 입력하세요' });
  });
  it(`${BIZ_PURPOSE_TEXT_MAX}자까지 받는다`, () => {
    expect(checkBizPurposeText('가'.repeat(BIZ_PURPOSE_TEXT_MAX)).ok).toBe(true);
    expect(checkBizPurposeText('가'.repeat(BIZ_PURPOSE_TEXT_MAX + 1)).ok).toBe(false);
    // 앞뒤 공백은 길이에 넣지 않는다
    expect(checkBizPurposeText(` ${'가'.repeat(BIZ_PURPOSE_TEXT_MAX)} `).ok).toBe(true);
  });
});

describe('sameBizPurposeText', () => {
  it('앞뒤 공백만 무시한다', () => {
    expect(sameBizPurposeText(' 경영 컨설팅업 ', '경영 컨설팅업')).toBe(true);
    expect(sameBizPurposeText('경영  컨설팅업', '경영 컨설팅업')).toBe(false);
  });
});

describe('parseBizPurposeCreate · parseBizPurposePatch', () => {
  it('추가 — text 하나', () => {
    expect(parseBizPurposeCreate({ text: ' 경영 컨설팅업 ' })).toEqual({ ok: true, value: { text: '경영 컨설팅업' } });
    expect(parseBizPurposeCreate(null)).toMatchObject({ ok: false, field: 'body' });
    expect(parseBizPurposeCreate({})).toMatchObject({ ok: false, field: 'text' });
  });
  it('수정 — text · active 중 하나 이상', () => {
    expect(parseBizPurposePatch({ active: false })).toEqual({ ok: true, value: { active: false } });
    expect(parseBizPurposePatch({ text: ' 가 ', active: true })).toEqual({ ok: true, value: { text: '가', active: true } });
    expect(parseBizPurposePatch({})).toMatchObject({ ok: false, field: 'body' });
    expect(parseBizPurposePatch({ active: 'false' })).toMatchObject({ ok: false, field: 'active' });
    expect(parseBizPurposePatch({ text: '' })).toMatchObject({ ok: false, field: 'text' });
  });
});

describe('parseBizPurposeListQuery', () => {
  it('검색어는 다듬고, 비면 null', () => {
    expect(parseBizPurposeListQuery({ q: ' 컨설팅 ' }, 'tenant')).toEqual({ ok: true, value: { q: '컨설팅', includeInactive: false } });
    expect(parseBizPurposeListQuery({ q: '  ' }, 'operator')).toEqual({ ok: true, value: { q: null, includeInactive: false } });
    expect(parseBizPurposeListQuery({ q: ['a'] }, 'operator').ok).toBe(false);
  });
  it('★ 사용 끈 줄은 운영사만 — 회사가 보내면 조용히 끈다', () => {
    expect(parseBizPurposeListQuery({ includeInactive: '1' }, 'operator')).toMatchObject({ value: { includeInactive: true } });
    expect(parseBizPurposeListQuery({ includeInactive: 'true' }, 'operator')).toMatchObject({ value: { includeInactive: true } });
    expect(parseBizPurposeListQuery({ includeInactive: '1' }, 'tenant')).toMatchObject({ value: { includeInactive: false } });
  });
});

describe('appendPurposeLines', () => {
  it('빈 칸이면 고른 문구만', () => {
    expect(appendPurposeLines('', ['경영 컨설팅업', '부동산 임대업'])).toEqual({
      text: '경영 컨설팅업\n부동산 임대업',
      added: ['경영 컨설팅업', '부동산 임대업'],
      skipped: [],
    });
  });
  it('끝에 줄로 덧붙이고, 끝의 빈 줄만 걷는다', () => {
    expect(appendPurposeLines('1. 소프트웨어 개발\n  \n', ['경영 컨설팅업']).text).toBe('1. 소프트웨어 개발\n경영 컨설팅업');
  });
  it('★ 이미 있는 줄(앞뒤 공백 무시)과 고른 것끼리의 중복은 건너뛴다', () => {
    const r = appendPurposeLines('  경영 컨설팅업 \n부동산 임대업', ['경영 컨설팅업', '전자상거래업', '전자상거래업']);
    expect(r.text).toBe('  경영 컨설팅업 \n부동산 임대업\n전자상거래업');
    expect(r.added).toEqual(['전자상거래업']);
    expect(r.skipped).toEqual(['경영 컨설팅업', '전자상거래업']);
  });
  it('덧붙일 것이 없으면 텍스트를 그대로 둔다', () => {
    expect(appendPurposeLines('경영 컨설팅업\n', ['경영 컨설팅업'])).toEqual({ text: '경영 컨설팅업\n', added: [], skipped: ['경영 컨설팅업'] });
  });
  it('번호를 붙여 적은 줄은 다른 줄로 본다 — 번호 규칙을 추측하지 않는다', () => {
    expect(appendPurposeLines('1. 경영 컨설팅업', ['경영 컨설팅업']).added).toEqual(['경영 컨설팅업']);
  });
});

describe('목적변경 사업목적 칸 안내', () => {
  it('변경 후 전체 목적이라고 적혀 있다', () => {
    expect(CHANGE_TYPE_DEFS.PURPOSE.fields.find((f) => f.name === 'purposes')?.hint).toBe(
      '변경 후 전체 목적을 한 줄에 하나씩 적습니다(기존 목적 + 추가분)',
    );
  });
});
