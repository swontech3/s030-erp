import { describe, expect, it } from 'vitest';
import { SIDO_FULL_NAMES, sidoOf } from './korea-sido.ts';

describe('sidoOf — 시·도 줄임말 → 정식 이름', () => {
  it.each([
    ['서울', '서울특별시'],
    ['부산', '부산광역시'],
    ['대구', '대구광역시'],
    ['인천', '인천광역시'],
    ['광주', '광주광역시'],
    ['대전', '대전광역시'],
    ['울산', '울산광역시'],
    ['세종', '세종특별자치시'],
    ['경기', '경기도'],
    ['강원', '강원특별자치도'],
    ['충북', '충청북도'],
    ['충남', '충청남도'],
    ['전북', '전북특별자치도'],
    ['전남', '전라남도'],
    ['경북', '경상북도'],
    ['경남', '경상남도'],
    ['제주', '제주특별자치도'],
  ])('★ 전수 — %s → %s', (short, full) => {
    expect(sidoOf(`${short} 어느구 어느로 1`)).toBe(full);
  });

  it('표는 17개뿐이다', () => {
    expect(Object.keys(SIDO_FULL_NAMES)).toHaveLength(17);
  });

  it('표에 없으면 첫 낱말 그대로 — 이미 정식 이름 · 옛 이름', () => {
    expect(sidoOf('서울특별시 강남구 테헤란로 1')).toBe('서울특별시');
    expect(sidoOf('세종특별자치시 한누리대로 1')).toBe('세종특별자치시');
    expect(sidoOf('강원도 춘천시 중앙로 1')).toBe('강원도');
  });

  it('앞뒤 공백 · 빈 주소', () => {
    expect(sidoOf('  경기   성남시 분당구 ')).toBe('경기도');
    expect(sidoOf('')).toBe('');
    expect(sidoOf(null)).toBe('');
  });
});
