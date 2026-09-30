/**
 * 어댑터 선택 — mock / http 를 고르는 **유일한 자리**.
 *
 * ★ `BBIYONG_ACL_MODE=http` 인데 URL 이 없으면 `env.ts` 가 기동을 중단시킨다.
 *   조용히 mock 으로 폴백하지 않는다 — 폴백하면 운영에 "전 화면 허용"이 올라간다.
 *
 * 인증(auth)은 2026-09-08 회신 ⑦로 실구현(HttpBbiyongAuth)이 붙었다. 권한(acl)은 회신 ⑫
 * 대기 중이라 mock 뿐이고, http 를 고르면 구현이 없다는 사실을 던져서 알린다.
 */
import { env } from '../env.ts';
import { MockBbiyongAuth } from './MockBbiyongAuth.ts';
import { MockBbiyongAcl } from './MockBbiyongAcl.ts';
import { HttpBbiyongAuth } from './HttpBbiyongAuth.ts';
import type { BbiyongAcl, BbiyongAuth } from './types.ts';

export const bbiyongAuth: BbiyongAuth = (() => {
  if (env.bbiyongMock) return new MockBbiyongAuth();
  // URL 이 없으면 여기 오기 전에 env.ts 가 이미 기동을 막았다. 그래도 타입상 null 이 가능하므로
  // 한 번 더 던진다 — 이 두 검사가 어긋나는 날이 오면 그날 조용히 뚫리는 것보다 낫다.
  if (!env.bbiyongBaseUrl) throw new Error('BBIYONG_BASE_URL 이 없다 — 삐용 실연동으로 기동할 수 없다.');
  return new HttpBbiyongAuth({ baseUrl: env.bbiyongBaseUrl });
})();

export const bbiyongAcl: BbiyongAcl = (() => {
  if (env.aclMode === 'mock') return new MockBbiyongAcl();
  throw new Error(
    'HttpBbiyongAcl 미구현 — 권한 조회 API 규격(회신 ⑫) 대기 중이다. ' +
      'BBIYONG_ACL_MODE=mock 으로 둔다.',
  );
})();

export * from './types.ts';
export { accessTokenExpiresAt, isAccessTokenExpired, EXPIRY_SKEW_MS } from './accessToken.ts';
export { withFreshAccess, type AccessTokenStore, type SessionTokens } from './withFreshAccess.ts';
