import { describe, expect, it } from 'vitest';
import { incorporationTax, metroSurchargeOf, readIncorpTaxSetting, type IncorpTaxSetting } from './incorporation-tax.ts';

/** 2026-10-14 의 값 — 일회용 스크립트가 등기 설정에 넣는 값과 같다. */
const SETTING: IncorpTaxSetting = { regLicenseRate: 4, regLicenseMin: 112_500, metroMultiplier: 3, localEduRate: 20, regFee: 35_000 };

describe('incorporationTax — 자본금으로 계산', () => {
  it('★ 자본금 × 4/1000 · 지방교육세 20% · 합계 · 수수료 35,000원', () => {
    expect(incorporationTax(100_000_000, false, SETTING)).toEqual({ regLicense: 400_000, localEdu: 80_000, total: 480_000, regFee: 35_000 });
  });

  it('★ 최소 112,500원 · 대도시 중과면 3배(최소 337,500원)', () => {
    expect(incorporationTax(10_000_000, false, SETTING)).toEqual({ regLicense: 112_500, localEdu: 22_500, total: 135_000, regFee: 35_000 });
    expect(incorporationTax(10_000_000, true, SETTING)).toEqual({ regLicense: 337_500, localEdu: 67_500, total: 405_000, regFee: 35_000 });
    expect(incorporationTax(100_000_000, true, SETTING)).toEqual({ regLicense: 1_200_000, localEdu: 240_000, total: 1_440_000, regFee: 35_000 });
  });

  it('★ 10원 미만 버림 — 등록면허세 · 지방교육세 각각', () => {
    // 30,001,234 × 4/1000 = 120,004.936 → 120,000 · 교육세 24,000
    expect(incorporationTax(30_001_234, false, SETTING)).toMatchObject({ regLicense: 120_000, localEdu: 24_000, total: 144_000 });
    // 중과 360,014.808 → 360,010 · 교육세 72,002 → 72,000
    expect(incorporationTax(30_001_234, true, SETTING)).toMatchObject({ regLicense: 360_010, localEdu: 72_000, total: 432_010 });
  });

  it('★ 설정 값을 그대로 쓴다 — 세율 · 최소액 · 배수 · 교육세율 · 수수료', () => {
    const s = { regLicenseRate: 5, regLicenseMin: 100_000, metroMultiplier: 2, localEduRate: 10, regFee: 30_000 };
    // 100,000,000 × 5/1000 = 500,000 · 교육세 50,000
    expect(incorporationTax(100_000_000, false, s)).toEqual({ regLicense: 500_000, localEdu: 50_000, total: 550_000, regFee: 30_000 });
    // 최소 100,000 × 2 = 200,000 · 교육세 20,000
    expect(incorporationTax(1_000_000, true, s)).toEqual({ regLicense: 200_000, localEdu: 20_000, total: 220_000, regFee: 30_000 });
  });

  it('자본금이 없거나 0 이하면 null(서류는 빈칸)', () => {
    expect(incorporationTax(null, true, SETTING)).toBeNull();
    expect(incorporationTax(0, false, SETTING)).toBeNull();
  });

  it('★ 설정이 비면 null(세금 칸 빈칸)', () => {
    expect(incorporationTax(100_000_000, false, null)).toBeNull();
  });
});

describe('readIncorpTaxSetting — 등기 설정 taxes 읽기', () => {
  it('다섯 칸이 모두 0 이상 정수면 그 값', () => {
    expect(readIncorpTaxSetting({ ...SETTING, extra: 1 })).toEqual(SETTING);
  });
  it('★ 하나라도 비거나 정수가 아니면 null', () => {
    expect(readIncorpTaxSetting(null)).toBeNull();
    expect(readIncorpTaxSetting([])).toBeNull();
    expect(readIncorpTaxSetting({ ...SETTING, regFee: undefined })).toBeNull();
    expect(readIncorpTaxSetting({ ...SETTING, regLicenseRate: 0.4 })).toBeNull();
    expect(readIncorpTaxSetting({ ...SETTING, metroMultiplier: -1 })).toBeNull();
    expect(readIncorpTaxSetting({ ...SETTING, localEduRate: '20' })).toBeNull();
    // 법인변경(fixed) 모양은 설립 설정이 아니다
    expect(readIncorpTaxSetting({ regLicense: 40_200, localEdu: 8_040, regFee: 4_000 })).toBeNull();
  });
});

describe('metroSurchargeOf — 사람이 고친 값 → 없으면 본점이 서울이면 중과', () => {
  it('비어 있으면 본점 시·도로', () => {
    expect(metroSurchargeOf(null, '서울 강남구 테헤란로 1')).toBe(true);
    expect(metroSurchargeOf(null, '서울특별시 중구 세종대로 110')).toBe(true);
    expect(metroSurchargeOf(undefined, '경기 성남시 분당구 1')).toBe(false);
    expect(metroSurchargeOf(null, null)).toBe(false);
  });
  it('★ 사람이 고친 값이 먼저다', () => {
    expect(metroSurchargeOf(false, '서울 강남구 1')).toBe(false);
    expect(metroSurchargeOf(true, '경기 성남시 1')).toBe(true);
  });
});
