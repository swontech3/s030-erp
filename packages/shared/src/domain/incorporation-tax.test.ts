import { describe, expect, it } from 'vitest';
import { INCORP_REG_FEE, REG_LICENSE_MIN, incorporationTax, metroSurchargeOf } from './incorporation-tax.ts';

describe('incorporationTax — 자본금으로 계산', () => {
  it('★ 자본금 × 4/1000 · 지방교육세 20% · 합계 · 수수료 35,000원', () => {
    expect(incorporationTax(100_000_000, false)).toEqual({ regLicense: 400_000, localEdu: 80_000, total: 480_000, regFee: INCORP_REG_FEE });
    expect(INCORP_REG_FEE).toBe(35_000);
  });

  it('★ 최소 112,500원 · 대도시 중과면 3배(최소 337,500원)', () => {
    expect(incorporationTax(10_000_000, false)).toEqual({ regLicense: REG_LICENSE_MIN, localEdu: 22_500, total: 135_000, regFee: 35_000 });
    expect(incorporationTax(10_000_000, true)).toEqual({ regLicense: 337_500, localEdu: 67_500, total: 405_000, regFee: 35_000 });
    expect(incorporationTax(100_000_000, true)).toEqual({ regLicense: 1_200_000, localEdu: 240_000, total: 1_440_000, regFee: 35_000 });
  });

  it('★ 10원 미만 버림 — 등록면허세 · 지방교육세 각각', () => {
    // 30,001,234 × 4/1000 = 120,004.936 → 120,000 · 교육세 24,000
    expect(incorporationTax(30_001_234, false)).toMatchObject({ regLicense: 120_000, localEdu: 24_000, total: 144_000 });
    // 중과 360,014.808 → 360,010 · 교육세 72,002 → 72,000
    expect(incorporationTax(30_001_234, true)).toMatchObject({ regLicense: 360_010, localEdu: 72_000, total: 432_010 });
  });

  it('자본금이 없거나 0 이하면 null(서류는 빈칸)', () => {
    expect(incorporationTax(null, true)).toBeNull();
    expect(incorporationTax(0, false)).toBeNull();
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
