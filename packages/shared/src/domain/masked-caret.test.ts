import { describe, expect, it } from 'vitest';
import { caretForMasked, isDigitMaskComplete, maskValue } from './masked-caret.ts';

const D = /\d/;
const at = (raw: string, caret: number, masked: string, keep = D) =>
  caretForMasked({ raw, caret, masked, keep });

describe('caretForMasked', () => {
  it('맨 앞이면 맨 앞이다', () => {
    expect(at('111-22-85905', 0, '111-22-85905')).toBe(0);
  });

  it('★ 가운데에 한 글자를 넣어도 그 글자 뒤에 남는다', () => {
    // "111-22-85905" 의 2번 자리에 9 → 날 값 "119-22-85905" wait: 브라우저가 넣은 뒤 caret=3
    // 숫자 3개(1,1,9)가 앞에 있으므로 마스크된 값에서 3번째 숫자 다음이다.
    expect(at('1191-22-85905', 3, '119-12-28590')).toBe(3);
  });

  it('구분자를 건너뛴다 — 숫자 3개 뒤는 `-` 다음이 아니라 `-` 앞이다', () => {
    expect(at('111', 3, '111')).toBe(3);
    expect(at('1112', 4, '111-2')).toBe(5);
  });

  it('지우면 그 자리에 남는다', () => {
    // "119-12-28590" 의 2번 자리에서 Backspace → 날 값 "19-12-28590", caret 1
    expect(at('19-12-28590', 1, '191-22-8590')).toBe(1);
  });

  it('맨 끝이면 맨 끝이다', () => {
    expect(at('1112285905', 10, '111-22-85905')).toBe(12);
  });

  it('★ 상한을 넘겨 잘린 경우 끝에 둔다', () => {
    // 11자리를 쳤지만 마스크가 10자리로 자른다
    expect(at('11122859051', 11, '111-22-85905')).toBe(12);
  });

  it('caret 이 값 범위를 벗어나도 터지지 않는다', () => {
    expect(at('111', 99, '111')).toBe(3);
    expect(at('111', -5, '111')).toBe(0);
  });

  it('이메일 아이디 — 점·밑줄·붙임표가 «뜻 있는 글자»다', () => {
    const E = /[A-Za-z0-9._-]/;
    // 한글이 섞여 들어왔다가 떨어진다. 커서 앞의 유효 글자는 3개(h,o,n)
    expect(at('hon길gil', 3, 'hongil', E)).toBe(3);
    expect(at('hong.gil', 8, 'hong.gil', E)).toBe(8);
  });
});

describe('maskValue — 숫자 마스크(계약 폼 · 법무 공용)', () => {
  it.each([
    ['bizno', '1112285905', '111-22-85905'],
    ['bizno', '11122', '111-22'],
    ['corpno', '1101111234567', '110111-1234567'],
    ['corpno', '110111', '110111'],
    ['phone', '01012345678', '010-1234-5678'],
    ['phone', '0311234567', '031-123-4567'],
    ['phone', '03112345678', '031-1234-5678'],
    // ★ 02 — 결함 수정(전에는 021-234-5678)
    ['phone', '0212345678', '02-1234-5678'],
    ['phone', '021234567', '02-123-4567'],
    ['phone', '02123', '02-123'],
    ['phone', '0212345', '02-123-45'],
    // 규칙 없는 번호 — 막지 않고 「그 밖」으로 끊는다(보고용)
    ['phone', '15881234', '158-812-34'],
    ['phone', '07012345678', '070-1234-5678'],
    ['phone', '010-1234-5678', '010-1234-5678'],
  ] as const)('%s %s → %s', (kind, raw, out) => {
    expect(maskValue(kind, raw)).toBe(out);
  });
});

describe('isDigitMaskComplete — 자릿수', () => {
  it.each([
    ['corpno', '110111-1234567', true],
    ['corpno', '110111-123456', false],
    ['bizno', '111-22-85905', true],
    ['bizno', '111-22-8590', false],
    ['phone', '02-123-4567', true],
    ['phone', '02-1234-5678', true],
    ['phone', '02-12-345', false],
    ['phone', '010-1234-5678', true],
    ['phone', '010-123-4567', false],
    ['phone', '031-123-4567', true],
    ['phone', '070-1234-5678', true],
    ['phone', '031-12-345', false],
    ['phone', '1588-1234', true], // 대표번호는 막지 않는다
    ['phone', '', true],
    ['bizno', null, true],
    ['phone', '010-1234-abcd', false],
  ] as const)('%s %s → %s', (kind, value, ok) => {
    expect(isDigitMaskComplete(kind, value)).toBe(ok);
  });
});
