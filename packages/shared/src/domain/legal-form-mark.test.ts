import { describe, expect, it } from 'vitest';
import { incorpMarkCompanyType, markAppliesTo, officersForMark, parseLegalMark, personsForIncorpMark, type LegalFormMark } from './legal-form-mark.ts';
import { isLegalForm, migrateDefinition, parseDefinition, createEmptyDefinition, FormDefinitionError } from './form-template.ts';

describe('parseLegalMark', () => {
  it('건마다 — 변경 구분은 정해진 순서 · 중복 없이', () => {
    expect(parseLegalMark({ domain: 'corp-change', changeTypes: ['OFFICER', 'NAME', 'NAME'], companyType: 'ALL', unit: 'case' })).toEqual({
      ok: true,
      value: { domain: 'corp-change', changeTypes: ['NAME', 'OFFICER'], companyType: 'ALL', unit: 'case' },
    });
  });

  it('임원마다 — 임원 구분 여럿 · 정해진 순서', () => {
    const r = parseLegalMark({
      domain: 'corp-change',
      changeTypes: ['OFFICER'],
      companyType: 'R',
      unit: 'officer',
      officerKinds: ['REELECT', 'APPOINT'],
    });
    expect(r).toEqual({
      ok: true,
      value: { domain: 'corp-change', changeTypes: ['OFFICER'], companyType: 'R', unit: 'officer', officerKinds: ['APPOINT', 'REELECT'] },
    });
  });

  it('모르는 키는 버린다', () => {
    const r = parseLegalMark({ domain: 'corp-change', changeTypes: ['HQ'], companyType: 'A', unit: 'case', extra: 1 });
    expect(r.ok && Object.keys(r.value)).toEqual(['domain', 'changeTypes', 'companyType', 'unit']);
  });

  it.each([
    ['객체가 아님', null],
    ['모르는 업무', { domain: 'dissolution', changeTypes: ['HQ'], companyType: 'ALL', unit: 'case' }],
    ['변경 구분 없음', { domain: 'corp-change', changeTypes: [], companyType: 'ALL', unit: 'case' }],
    ['모르는 변경 구분', { domain: 'corp-change', changeTypes: ['CEO_CHG'], companyType: 'ALL', unit: 'case' }],
    ['2종 밖 회사유형', { domain: 'corp-change', changeTypes: ['HQ'], companyType: 'P', unit: 'case' }],
    ['모르는 단위', { domain: 'corp-change', changeTypes: ['HQ'], companyType: 'ALL', unit: 'page' }],
    ['건마다에 임원 구분', { domain: 'corp-change', changeTypes: ['HQ'], companyType: 'ALL', unit: 'case', officerKinds: ['APPOINT'] }],
    ['임원마다인데 임원변경 아님', { domain: 'corp-change', changeTypes: ['HQ'], companyType: 'ALL', unit: 'officer', officerKinds: ['APPOINT'] }],
    ['임원마다인데 다른 구분 섞임', { domain: 'corp-change', changeTypes: ['OFFICER', 'HQ'], companyType: 'ALL', unit: 'officer', officerKinds: ['APPOINT'] }],
    ['임원마다인데 임원 구분 없음', { domain: 'corp-change', changeTypes: ['OFFICER'], companyType: 'ALL', unit: 'officer', officerKinds: [] }],
    ['모르는 임원 구분', { domain: 'corp-change', changeTypes: ['OFFICER'], companyType: 'ALL', unit: 'officer', officerKinds: ['FIRE'] }],
  ])('거절 — %s', (_, raw) => {
    expect(parseLegalMark(raw).ok).toBe(false);
  });
});

describe('markAppliesTo — 결정 B', () => {
  const all: LegalFormMark = { domain: 'corp-change', changeTypes: ['NAME', 'OFFICER'], companyType: 'ALL', unit: 'case' };
  const onlyA: LegalFormMark = { ...all, companyType: 'A' };

  it('변경 구분이 맞아야 뜬다', () => {
    expect(markAppliesTo(all, 'NAME', 'R')).toBe(true);
    expect(markAppliesTo(all, 'HQ', 'R')).toBe(false);
    expect(markAppliesTo(all, 'NOPE', 'R')).toBe(false);
  });

  it('회사유형 — 전체는 누구에게나, 유한회사 양식은 유한회사에만', () => {
    expect(markAppliesTo(onlyA, 'NAME', 'A')).toBe(true);
    expect(markAppliesTo(onlyA, 'NAME', 'R')).toBe(false);
  });

  it('★ 2종 밖(개인사업자 · 미입력)이면 「전체」 양식만', () => {
    expect(markAppliesTo(all, 'NAME', 'P')).toBe(true);
    expect(markAppliesTo(all, 'NAME', null)).toBe(true);
    expect(markAppliesTo(onlyA, 'NAME', 'P')).toBe(false);
    expect(markAppliesTo(onlyA, 'NAME', null)).toBe(false);
  });
});

describe('officersForMark', () => {
  const officers = [
    { name: '갑', changeKind: 'APPOINT' },
    { name: '을', changeKind: 'RESIGN' },
    { name: '병', changeKind: 'REELECT' },
    { name: '정', changeKind: 'APPOINT' },
  ];
  it('표시의 임원 구분에 드는 임원만, 목록 순서대로', () => {
    const mark: LegalFormMark = { domain: 'corp-change', changeTypes: ['OFFICER'], companyType: 'ALL', unit: 'officer', officerKinds: ['APPOINT', 'REELECT'] };
    expect(officersForMark(mark, officers).map((o) => o.name)).toEqual(['갑', '병', '정']);
  });
  it('건마다 양식은 0명', () => {
    const mark: LegalFormMark = { domain: 'corp-change', changeTypes: ['OFFICER'], companyType: 'ALL', unit: 'case' };
    expect(officersForMark(mark, officers)).toEqual([]);
  });
});

describe('표양식 정의의 legal 칸', () => {
  const mark = { domain: 'corp-change', changeTypes: ['HQ'], companyType: 'ALL', unit: 'case' };

  it('parseDefinition 이 표시를 지킨다 · 틀리면 FormDefinitionError', () => {
    const def = parseDefinition({ ...createEmptyDefinition(), legal: mark });
    expect(def.legal).toEqual(mark);
    expect(() => parseDefinition({ ...createEmptyDefinition(), legal: { ...mark, unit: 'x' } })).toThrow(FormDefinitionError);
  });

  it('migrateDefinition 도 표시를 옮긴다', () => {
    expect(migrateDefinition({ ...createEmptyDefinition(), legal: mark }).legal).toEqual(mark);
  });

  it('isLegalForm — 표시가 있거나, 레거시 dataSource 가 법무면', () => {
    expect(isLegalForm({ legal: mark as LegalFormMark })).toBe(true);
    expect(isLegalForm({ dataSource: 'corp-change' })).toBe(true);
    expect(isLegalForm({})).toBe(false);
    expect(isLegalForm({ dataSource: 'employee' })).toBe(false);
  });
});

describe('법인설립 표시(10-5)', () => {
  it('단위 셋 · 회사 형태 — 다른 키는 버린다', () => {
    for (const unit of ['case', 'officer', 'founder']) {
      expect(parseLegalMark({ domain: 'incorporation', unit, changeTypes: ['NAME'] })).toEqual({
        ok: true,
        value: { domain: 'incorporation', unit },
      });
      // ★ 회사 형태(2026-10-31) — R · A 는 담는다
      expect(parseLegalMark({ domain: 'incorporation', unit, changeTypes: ['NAME'], companyType: 'R' })).toEqual({
        ok: true,
        value: { domain: 'incorporation', unit, companyType: 'R' },
      });
    }
    expect(parseLegalMark({ domain: 'incorporation', unit: 'page' }).ok).toBe(false);
    expect(parseLegalMark({ domain: 'incorporation' }).ok).toBe(false);
  });
  it('회사 형태 — 주식회사 · 유한회사만(「전체」 없음) · 없으면 주식회사로 읽는다', () => {
    expect(parseLegalMark({ domain: 'incorporation', unit: 'case', companyType: 'A' })).toEqual({
      ok: true,
      value: { domain: 'incorporation', unit: 'case', companyType: 'A' },
    });
    expect(parseLegalMark({ domain: 'incorporation', unit: 'case', companyType: 'ALL' }).ok).toBe(false);
    expect(parseLegalMark({ domain: 'incorporation', unit: 'case', companyType: 'C' }).ok).toBe(false);
    expect(incorpMarkCompanyType({ domain: 'incorporation', unit: 'case' })).toBe('R');
    expect(incorpMarkCompanyType({ domain: 'incorporation', unit: 'case', companyType: 'A' })).toBe('A');
  });

  it('★ 법인변경 서류에는 뜨지 않는다 — 임원 고르기도 빈 목록', () => {
    const m: LegalFormMark = { domain: 'incorporation', unit: 'officer' };
    expect(markAppliesTo(m, 'OFFICER', 'R')).toBe(false);
    expect(officersForMark(m, [{ changeKind: 'APPOINT' }])).toEqual([]);
  });

  it('장마다 사람 — 임원마다는 이사 · 감사 · 대표이사 중 하나, 발기인마다는 발기인, 순서 그대로', () => {
    const p = (name: string, f: boolean, d: boolean, a: boolean, r: boolean) => ({ name, isFounder: f, isDirector: d, isAuditor: a, isRepresentative: r });
    const people = [p('갑', true, false, false, false), p('을', false, false, true, false), p('병', true, true, false, true)];
    const names = (unit: 'case' | 'officer' | 'founder') => personsForIncorpMark({ domain: 'incorporation', unit }, people).map((x) => x.name);
    expect(names('officer')).toEqual(['을', '병']);
    expect(names('founder')).toEqual(['갑', '병']);
    expect(names('case')).toEqual([]);
    expect(personsForIncorpMark({ domain: 'corp-change', changeTypes: ['OFFICER'], companyType: 'ALL', unit: 'officer', officerKinds: ['APPOINT'] }, people)).toEqual([]);
  });
});
