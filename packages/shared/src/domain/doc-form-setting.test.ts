import { describe, expect, it } from 'vitest';
import {
  buildDocFormItems,
  companyTypesOf,
  incorpTaxSettingOf,
  parseDocFormSettingDeleteKey,
  parseDocFormSettingSave,
  type DocFormSettingView,
} from './doc-form-setting.ts';
import type { DocFormSettingRow } from './corp-change-print.ts';

const view = (o: Partial<DocFormSettingView> & { regTypeKey: string }): DocFormSettingView & { regTypeKey: string } => ({
  companyType: '',
  label: '표시',
  formNo: null,
  matter: null,
  matterBody: null,
  regPurpose: null,
  regReason: null,
  isActive: true,
  taxes: null,
  incorpTax: null,
  attachments: [],
  updatedAt: '2026-10-18 10:00',
  ...o,
});

const corpBase = { domain: 'corp-change', regTypeKey: 'HQ', companyType: '', label: '본점이전' };
const incorpBase = { domain: 'incorporation', regTypeKey: 'R_PROMOTER', companyType: '', label: '발기설립' };
const TAX = { regLicenseRate: 4, regLicenseMin: 112_500, metroMultiplier: 3, localEduRate: 20, regFee: 35_000 };

describe('companyTypesOf — 설립은 기본 줄만(결정 3)', () => {
  it('법인변경 = 기본 · R · A, 설립 = 기본', () => {
    expect(companyTypesOf('corp-change')).toEqual(['', 'R', 'A']);
    expect(companyTypesOf('incorporation')).toEqual(['']);
  });
});

describe('buildDocFormItems — 코드 순서에 줄을 붙인다', () => {
  const codes = [
    { code: 'NAME', name: '상호변경' },
    { code: 'PURPOSE', name: '목적변경' },
    { code: 'HQ', name: '본점이전' },
    { code: 'NAME', name: '중복' },
  ];
  const rows = [
    view({ regTypeKey: 'HQ', companyType: 'A' }),
    view({ regTypeKey: 'HQ' }),
    view({ regTypeKey: 'NAME', companyType: 'R' }),
    view({ regTypeKey: 'GONE' }),
  ];
  const items = buildDocFormItems('corp-change', codes, rows);

  it('코드 순서 · 중복 코드는 처음 것만 · 코드에 없는 줄은 버린다', () => {
    expect(items.map((i) => i.code)).toEqual(['NAME', 'PURPOSE', 'HQ']);
  });
  it('★ 목적변경은 상호 줄을 같이 쓴다 — 줄 없이 sharedWith', () => {
    expect(items[1]).toMatchObject({ sharedWith: 'NAME', rows: [] });
    expect(items[0]!.sharedWith).toBeNull();
  });
  it('줄 순서는 기본 → R → A, 응답에 regTypeKey 를 싣지 않는다', () => {
    expect(items[2]!.rows.map((r) => r.companyType)).toEqual(['', 'A']);
    expect('regTypeKey' in items[2]!.rows[0]!).toBe(false);
    expect(items[0]!.rows.map((r) => r.companyType)).toEqual(['R']);
  });
  it('★ 설립은 회사유형 줄을 버린다(고칠 탭이 없다)', () => {
    const inc = buildDocFormItems('incorporation', [{ code: 'R_PROMOTER', name: '발기설립' }], [
      view({ regTypeKey: 'R_PROMOTER' }),
      view({ regTypeKey: 'R_PROMOTER', companyType: 'R' }),
    ]);
    expect(inc[0]!.rows.map((r) => r.companyType)).toEqual(['']);
  });
});

describe('parseDocFormSettingSave — 저장 규칙', () => {
  it('★ 기본 줄은 표시명 필수, 회사유형 줄은 빈 표시명 = 기본 값을 씀(규칙 3)', () => {
    expect(parseDocFormSettingSave({ ...corpBase, label: '  ' })).toMatchObject({ ok: false, field: 'label' });
    const r = parseDocFormSettingSave({ ...corpBase, companyType: 'A', label: '' });
    expect(r).toMatchObject({ ok: true, value: { label: '' } });
  });

  it('글 칸 — 앞뒤 공백 걷기 · 빈칸 null · 줄바꿈 그대로(\\r\\n → \\n) · 옛 \\n 글자는 그대로(규칙 6)', () => {
    const r = parseDocFormSettingSave({ ...corpBase, formNo: ' [양식 제92-1호] ', matter: '본점을\r\n이전한 뜻', matterBody: '', regPurpose: '상호,\\n목적' });
    expect(r).toMatchObject({ ok: true, value: { formNo: '[양식 제92-1호]', matter: '본점을\n이전한 뜻', matterBody: null, regPurpose: '상호,\\n목적', regReason: null } });
  });

  it('글자 수 상한', () => {
    expect(parseDocFormSettingSave({ ...corpBase, label: 'x'.repeat(201) })).toMatchObject({ ok: false, field: 'label' });
    expect(parseDocFormSettingSave({ ...corpBase, matter: 'x'.repeat(2001) })).toMatchObject({ ok: false, field: 'matter' });
  });

  it('★ 구분 · 회사유형 — 설립은 기본 줄만, 목적변경 키는 거절(상호 줄을 같이 쓴다)', () => {
    expect(parseDocFormSettingSave({ ...corpBase, domain: 'x' })).toMatchObject({ ok: false, field: 'domain' });
    expect(parseDocFormSettingSave({ ...corpBase, companyType: 'C' })).toMatchObject({ ok: false, field: 'companyType' });
    expect(parseDocFormSettingSave({ ...incorpBase, companyType: 'R' })).toMatchObject({ ok: false, field: 'companyType' });
    expect(parseDocFormSettingSave({ ...corpBase, regTypeKey: 'PURPOSE' })).toMatchObject({ ok: false, field: 'regTypeKey' });
    expect(parseDocFormSettingSave({ ...corpBase, regTypeKey: '' })).toMatchObject({ ok: false, field: 'regTypeKey' });
  });

  it('★ 첨부서면 — {name, copies} 한 모양 · 빈 이름 행은 버림 · 통수 0~99 정수 · 비면 null(규칙 4)', () => {
    const r = parseDocFormSettingSave({
      ...corpBase,
      attachments: [{ name: ' 정관 ', copies: 1 }, { name: '', copies: 1 }, { name: '<기   타>', copies: 0 }],
    });
    expect(r).toMatchObject({ ok: true, value: { attachments: [{ name: '정관', copies: 1 }, { name: '<기   타>', copies: 0 }] } });
    expect(parseDocFormSettingSave({ ...corpBase, attachments: [{ name: ' ', copies: 1 }] })).toMatchObject({ ok: true, value: { attachments: null } });
    expect(parseDocFormSettingSave({ ...corpBase, attachments: [{ name: 'a', copies: 1.5 }] })).toMatchObject({ ok: false, field: 'attachments.0.copies' });
    expect(parseDocFormSettingSave({ ...corpBase, attachments: [{ name: 'a', copies: 100 }] })).toMatchObject({ ok: false });
    expect(parseDocFormSettingSave({ ...corpBase, attachments: ['정관'] })).toMatchObject({ ok: false, field: 'attachments.0' });
  });

  it('★ 법인변경 세금 — 0 이상 정수, 셋 다 비면 null, 일부만 있어도 된다(규칙 5)', () => {
    expect(parseDocFormSettingSave({ ...corpBase, taxes: { regLicense: 112_500, localEdu: 22_500, regFee: 7_000 } })).toMatchObject({
      ok: true,
      value: { taxes: { regLicense: 112_500, localEdu: 22_500, regFee: 7_000 }, incorpTax: null },
    });
    expect(parseDocFormSettingSave({ ...corpBase, taxes: { regLicense: null, localEdu: '', regFee: undefined } })).toMatchObject({ ok: true, value: { taxes: null } });
    expect(parseDocFormSettingSave({ ...corpBase, taxes: { regFee: 6_000 } })).toMatchObject({ ok: true, value: { taxes: { regLicense: null, localEdu: null, regFee: 6_000 } } });
    expect(parseDocFormSettingSave({ ...corpBase, taxes: { regLicense: -1 } })).toMatchObject({ ok: false, field: 'taxes.regLicense' });
    expect(parseDocFormSettingSave({ ...corpBase, taxes: { regLicense: '40200' } })).toMatchObject({ ok: false });
  });

  it('★ 설립 세금 — 다섯 칸 모두 또는 모두 비움, 일부만이면 거절(결정 1)', () => {
    expect(parseDocFormSettingSave({ ...incorpBase, incorpTax: TAX })).toMatchObject({ ok: true, value: { incorpTax: TAX, taxes: null } });
    expect(parseDocFormSettingSave({ ...incorpBase, incorpTax: { regLicenseRate: null } })).toMatchObject({ ok: true, value: { incorpTax: null } });
    expect(parseDocFormSettingSave({ ...incorpBase, incorpTax: { ...TAX, regFee: null } })).toMatchObject({ ok: false, field: 'incorpTax.regFee' });
    expect(parseDocFormSettingSave({ ...incorpBase, incorpTax: { ...TAX, localEduRate: 0.2 } })).toMatchObject({ ok: false, field: 'incorpTax.localEduRate' });
  });

  it('★ 설립 줄은 등기할 사항 · 고정 세금을 받지 않는다(출력이 읽지 않는다)', () => {
    const r = parseDocFormSettingSave({ ...incorpBase, matter: '제목', matterBody: '내용', taxes: { regLicense: 1 } });
    expect(r).toMatchObject({ ok: true, value: { matter: null, matterBody: null, taxes: null } });
  });

  it('★ 사용 여부는 기본 줄만 — 회사유형 줄은 언제나 true(규칙 7)', () => {
    expect(parseDocFormSettingSave({ ...corpBase, isActive: false })).toMatchObject({ ok: true, value: { isActive: false } });
    expect(parseDocFormSettingSave({ ...corpBase })).toMatchObject({ ok: true, value: { isActive: true } });
    expect(parseDocFormSettingSave({ ...corpBase, companyType: 'R', isActive: false })).toMatchObject({ ok: true, value: { isActive: true } });
    expect(parseDocFormSettingSave({ ...corpBase, isActive: 'no' })).toMatchObject({ ok: false, field: 'isActive' });
  });

  it('본문이 객체가 아니면 거절', () => {
    expect(parseDocFormSettingSave(null)).toMatchObject({ ok: false, field: 'body' });
  });
});

describe('incorpTaxSettingOf — 설립 기본 줄의 세금 설정', () => {
  const row = (o: Partial<DocFormSettingRow>): DocFormSettingRow => ({
    regTypeKey: 'R_PROMOTER',
    companyType: '',
    isActive: true,
    label: '발기설립',
    formNo: null,
    matter: null,
    taxMode: 'computed',
    taxes: TAX,
    attachments: null,
    regPurpose: null,
    regReason: null,
    matterBody: null,
    ...o,
  });
  it('기본 줄의 다섯 칸', () => {
    expect(incorpTaxSettingOf([row({})], 'R_PROMOTER')).toEqual(TAX);
  });
  it('★ 없음 · 끈 줄 · 빈 값 · 회사유형 줄뿐이면 null(세금 칸 빈칸)', () => {
    expect(incorpTaxSettingOf([], 'R_PROMOTER')).toBeNull();
    expect(incorpTaxSettingOf([row({ isActive: false })], 'R_PROMOTER')).toBeNull();
    expect(incorpTaxSettingOf([row({ taxes: null })], 'R_PROMOTER')).toBeNull();
    expect(incorpTaxSettingOf([row({ companyType: 'R' })], 'R_PROMOTER')).toBeNull();
    expect(incorpTaxSettingOf([row({ regTypeKey: 'R_SUBSCRIPTION' })], 'R_PROMOTER')).toBeNull();
  });
});

describe('parseDocFormSettingDeleteKey — 회사유형 줄만 지운다(결정 2)', () => {
  it('회사유형 줄은 통과', () => {
    expect(parseDocFormSettingDeleteKey({ domain: 'corp-change', regTypeKey: 'HQ', companyType: 'A' })).toEqual({
      ok: true,
      value: { domain: 'corp-change', regTypeKey: 'HQ', companyType: 'A' },
    });
  });
  it('★ 기본 줄은 거절 — 사용 끔으로', () => {
    expect(parseDocFormSettingDeleteKey({ domain: 'corp-change', regTypeKey: 'HQ', companyType: '' })).toMatchObject({ ok: false, field: 'companyType' });
    expect(parseDocFormSettingDeleteKey({ domain: 'incorporation', regTypeKey: 'R_PROMOTER', companyType: 'R' })).toMatchObject({ ok: false });
  });
});
