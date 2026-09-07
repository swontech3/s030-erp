/**
 * 어댑터 선택 — mock / http 를 고르는 **유일한 자리**.
 *
 * ★ `BBIYONG_ACL_MODE=http` 인데 URL 이 없으면 `env.ts` 가 기동을 중단시킨다.
 *   조용히 mock 으로 폴백하지 않는다 — 폴백하면 운영에 "전 화면 허용"이 올라간다.
 *   여기서도 http 구현이 아직 없다는 사실을 던져서 알린다.
 */
import { env } from '../env.ts';
import { MockBbiyongAuth } from './MockBbiyongAuth.ts';
import { MockBbiyongAcl } from './MockBbiyongAcl.ts';
import type { BbiyongAcl, BbiyongAuth } from './types.ts';

export const bbiyongAuth: BbiyongAuth = (() => {
  if (env.bbiyongMock) return new MockBbiyongAuth();
  throw new Error(
    'HttpBbiyongAuth 미구현 — 삐용 로그인 API 규격(회신 ⑦) 대기 중이다. ' +
      '지금은 packages/api/.env 에 BBIYONG_MOCK=true 로 둔다.',
  );
})();

export const bbiyongAcl: BbiyongAcl = (() => {
  if (env.aclMode === 'mock') return new MockBbiyongAcl();
  throw new Error(
    'HttpBbiyongAcl 미구현 — 권한 조회 API 규격(회신 ⑫) 대기 중이다. ' +
      'BBIYONG_ACL_MODE=mock 으로 둔다.',
  );
})();

export * from './types.ts';
