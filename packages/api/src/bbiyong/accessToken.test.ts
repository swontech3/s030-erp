/**
 * 토큰 만료 판정 — **삐용의 만료 시간을 코드에 박지 않는다**는 원칙을 고정한다.
 *
 * 이 파일에 "30분" 도 "24시간" 도 없다. 읽는 것은 토큰 안의 `exp` 뿐이다.
 */
import { describe, it, expect } from 'vitest';
import { accessTokenExpiresAt, isAccessTokenExpired, EXPIRY_SKEW_MS } from './accessToken.ts';

/** 삐용 JWT 페이로드는 sub·auth·exp 셋이다(회신 ⑦). */
function jwt(payload: Record<string, unknown>): string {
  return `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;
}

const NOW = 1_800_000_000_000;

describe('accessTokenExpiresAt', () => {
  it('exp(초)를 밀리초로 돌려준다', () => {
    expect(accessTokenExpiresAt(jwt({ sub: '1', auth: 'R', exp: 1_800_000_060 }))).toBe(1_800_000_060_000);
  });

  it('★ MOCK 토큰은 null — "만료"가 아니라 "모른다" 다', () => {
    expect(accessTokenExpiresAt('mock-access.1001.123')).toBeNull();
  });

  it('exp 가 없거나 숫자가 아니면 null', () => {
    expect(accessTokenExpiresAt(jwt({ sub: '1' }))).toBeNull();
    expect(accessTokenExpiresAt(jwt({ exp: 'soon' }))).toBeNull();
  });

  it('깨진 토큰이어도 던지지 않는다 — 여기서 던지면 삐용 호출이 아니라 판정이 죽는다', () => {
    expect(() => accessTokenExpiresAt('')).not.toThrow();
    expect(accessTokenExpiresAt('a.b.c')).toBeNull();
    expect(accessTokenExpiresAt('..')).toBeNull();
  });
});

describe('isAccessTokenExpired', () => {
  it('넉넉히 남았으면 살아 있다', () => {
    expect(isAccessTokenExpired(jwt({ exp: NOW / 1000 + 3600 }), { now: NOW })).toBe(false);
  });

  it('지났으면 죽었다', () => {
    expect(isAccessTokenExpired(jwt({ exp: NOW / 1000 - 1 }), { now: NOW })).toBe(true);
  });

  it('★ 여유폭 안에 들어오면 미리 되살린다 — 왕복 중에 만료되는 것을 막는다', () => {
    const almost = (NOW + EXPIRY_SKEW_MS - 1_000) / 1000;
    expect(isAccessTokenExpired(jwt({ exp: almost }), { now: NOW })).toBe(true);
    const justOutside = (NOW + EXPIRY_SKEW_MS + 1_000) / 1000;
    expect(isAccessTokenExpired(jwt({ exp: justOutside }), { now: NOW })).toBe(false);
  });

  it('★★ 모르는 토큰은 만료로 보지 않는다 — 불러 보고 401 에 맡긴다', () => {
    expect(isAccessTokenExpired('mock-access.1001.123', { now: NOW })).toBe(false);
  });
});
