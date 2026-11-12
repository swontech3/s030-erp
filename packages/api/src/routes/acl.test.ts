/**
 * 화면코드 형식 — `/acl/verify` 가 받는 코드.
 *
 * ★ 2026-10-02 에 자리수를 바꾸면서 이 정규식을 놓쳐 모든 확인 요청이 400 이 됐다.
 *   시스템 코드(s03 · s04)나 자리수를 바꿀 때 이 시험이 먼저 깨지게 둔다.
 */
import { describe, expect, it } from 'vitest';
import { SCREENS } from '@swonbiz/shared';
import { SCREEN_CODE } from './acl.ts';

describe('SCREEN_CODE', () => {
  it('★★ screens.ts 에 등록된 화면은 전부 통과한다 — s03 · s04 모두', () => {
    const bad = Object.keys(SCREENS).filter((id) => !SCREEN_CODE.test(id));
    expect(bad).toEqual([]);
    expect(Object.keys(SCREENS).some((id) => id.startsWith('s04'))).toBe(true);
  });

  it('법무 서비스 화면 · 팝업', () => {
    expect(SCREEN_CODE.test('s040200010')).toBe(true);
    expect(SCREEN_CODE.test('s040200011p1')).toBe(true);
    expect(SCREEN_CODE.test('s040900010')).toBe(true);
  });

  it('다른 시스템 코드 · 옛 11자리 · 잘린 코드는 거부한다', () => {
    for (const bad of ['s021200010', 's060100010', 's0300200070', 's04020001', 'S040200010', 's040200010p', 's040200010p123']) {
      expect(SCREEN_CODE.test(bad)).toBe(false);
    }
  });

  it('세무 서비스(s05) 화면은 통과한다', () => {
    expect(SCREEN_CODE.test('s050000010')).toBe(true);
  });

  it('s06 은 거부한다 — 시스템 코드는 s03 · s04 · s05 뿐', () => {
    expect(SCREEN_CODE.test('s060000010')).toBe(false);
  });
});
