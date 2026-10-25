import { describe, expect, it } from 'vitest';
import {
  digitsOnly,
  isAccountNumberInput,
  isBizNumberChecksumOk,
  isBizNumberLength,
  isCardLast4,
  isCorpNumberLength,
  isEmailShape,
} from './tax-number.ts';

describe('digitsOnly — 숫자만 남긴다', () => {
  it('하이픈 · 공백을 뗀다', () => {
    expect(digitsOnly('220-81-62517')).toBe('2208162517');
    expect(digitsOnly(' 110111 - 7654321 ')).toBe('1101117654321');
  });
  it('숫자가 없으면 빈 문자열', () => {
    expect(digitsOnly('abc-')).toBe('');
  });
});

describe('사업자 10자리 · 법인 13자리 — 숫자만 받은 값을 본다', () => {
  it('사업자번호는 숫자 10자리', () => {
    expect(isBizNumberLength('2208162517')).toBe(true);
    expect(isBizNumberLength('220816251')).toBe(false);
    expect(isBizNumberLength('22081625170')).toBe(false);
    expect(isBizNumberLength('220-81-62517')).toBe(false);
  });
  it('법인번호는 숫자 13자리', () => {
    expect(isCorpNumberLength('1101117654321')).toBe(true);
    expect(isCorpNumberLength('110111765432')).toBe(false);
    expect(isCorpNumberLength('110111-7654321')).toBe(false);
  });
});

describe('isBizNumberChecksumOk — 사업자번호 끝자리 검증 번호(경고용)', () => {
  it('끝자리가 맞으면 true', () => {
    expect(isBizNumberChecksumOk('2208162517')).toBe(true);
    expect(isBizNumberChecksumOk('1248100998')).toBe(true);
  });
  it('끝자리가 틀리면 false', () => {
    expect(isBizNumberChecksumOk('2208162518')).toBe(false);
    expect(isBizNumberChecksumOk('1248100990')).toBe(false);
  });
  it('10자리 숫자가 아니면 false — 자리수부터 본다', () => {
    expect(isBizNumberChecksumOk('220816251')).toBe(false);
    expect(isBizNumberChecksumOk('220-81-62517')).toBe(false);
    expect(isBizNumberChecksumOk('')).toBe(false);
  });
});

describe('계좌 · 카드 · 메일 모양', () => {
  it('계좌번호 — 숫자와 - 만, 숫자 10~14자리', () => {
    expect(isAccountNumberInput('123-456-7890')).toBe(true);
    expect(isAccountNumberInput('12345678901234')).toBe(true);
    expect(isAccountNumberInput('123456789')).toBe(false);
    expect(isAccountNumberInput('123456789012345')).toBe(false);
    expect(isAccountNumberInput('1234 567890')).toBe(false);
    expect(isAccountNumberInput('12345abcde')).toBe(false);
    expect(isAccountNumberInput('')).toBe(false);
  });
  it('카드 — 끝 4자리 숫자만', () => {
    expect(isCardLast4('1234')).toBe(true);
    expect(isCardLast4('123')).toBe(false);
    expect(isCardLast4('12345')).toBe(false);
    expect(isCardLast4('12-4')).toBe(false);
    expect(isCardLast4('abcd')).toBe(false);
  });
  it('메일 — name@example.com 모양', () => {
    expect(isEmailShape('tax@example.com')).toBe(true);
    expect(isEmailShape('tax@example')).toBe(false);
    expect(isEmailShape('tax example.com')).toBe(false);
    expect(isEmailShape('@example.com')).toBe(false);
    expect(isEmailShape('')).toBe(false);
  });
});
