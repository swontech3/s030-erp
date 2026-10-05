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
import { MockBbiyongOrg } from './MockBbiyongOrg.ts';
import { HttpBbiyongAuth } from './HttpBbiyongAuth.ts';
import { HttpBbiyongOrg } from './HttpBbiyongOrg.ts';
import type { BbiyongAcl, BbiyongAuth, BbiyongOrg } from './types.ts';

export const bbiyongAuth: BbiyongAuth = (() => {
  if (env.bbiyongMock) return new MockBbiyongAuth();
  // URL 이 없으면 여기 오기 전에 env.ts 가 이미 기동을 막았다. 그래도 타입상 null 이 가능하므로
  // 한 번 더 던진다 — 이 두 검사가 어긋나는 날이 오면 그날 조용히 뚫리는 것보다 낫다.
  if (!env.bbiyongBaseUrl) throw new Error('BBIYONG_BASE_URL 이 없다 — 삐용 실연동으로 기동할 수 없다.');
  return new HttpBbiyongAuth({ baseUrl: env.bbiyongBaseUrl });
})();

/**
 * 회사 등록 어댑터(3-5 로 실호출이 붙었다, 2026-10-02).
 *
 * ★ 갈아 끼운 것은 이 한 줄뿐이다. 그 앞의 코드(채번 · 중복 재시도 · 연결 저장 ·
 *   실패 보관 · 화면 배너)는 3-2 에서 이미 돌고 있었고 손대지 않았다.
 *
 * ★★ **MOCK 을 남겨 둔다.** 삐용(192.168.0.22:8082)이 꺼져 있을 때 `BBIYONG_MOCK=true`
 *    로 개발이 계속돼야 한다. 꺼져 있다고 실호출이 조용히 mock 으로 떨어지지는 않는다 —
 *    모드는 환경변수 하나로만 갈린다.
 *
 * ★ 이 어댑터가 가진 것은 다섯이다 — 회사 등록 · 퇴실 · 재입주 · 회사 수정 ·
 *   **직원정보**(2026-10-05 규격). 한 객체에 모은 것은 삐용 쪽 엔드포인트가 같은
 *   계통이고(`s0211000x0`) 토큰·타임아웃·401 규칙이 하나이기 때문이다.
 */
export const bbiyongOrg: BbiyongOrg = (() => {
  if (env.bbiyongMock) return new MockBbiyongOrg();
  // URL 이 없으면 여기 오기 전에 env.ts 가 이미 기동을 막았다. auth 와 같은 이유로 한 번 더 본다.
  if (!env.bbiyongBaseUrl) throw new Error('BBIYONG_BASE_URL 이 없다 — 삐용 실연동으로 기동할 수 없다.');
  return new HttpBbiyongOrg({ baseUrl: env.bbiyongBaseUrl });
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
export {
  linkOrg,
  moduleOffOrg,
  moduleOnOrg,
  patchOrgName,
  type OrgLinkResult,
  type OrgLinkStore,
  type OrgLinkTarget,
  type OrgOp,
} from './orgLink.ts';
export {
  syncMembers,
  type MemberLinkRow,
  type MemberPending,
  type MemberSyncResult,
  type MemberSyncStore,
} from './memberSync.ts';
export { MOCK_ORG_ID_BASE, MOCK_MEMBER_ID_BASE } from './MockBbiyongOrg.ts';
export { HttpBbiyongOrg, parseCreateOrg, parseMemberOp, parseOrgOp } from './HttpBbiyongOrg.ts';
export { ORG_MODULE_CODES } from './orgLink.ts';
