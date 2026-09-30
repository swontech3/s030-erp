/**
 * 삐용을 부르는 **유일한 문** — 토큰을 살려서 부르고, 못 살리면 재로그인으로 보낸다.
 *
 * =============================================================================
 * ★★ 이 파일이 고치는 증상 (2026-09-30)
 * =============================================================================
 * ① 토큰이 만료되면 화면에 「서버에 연결할 수 없습니다」가 떴다. 삐용은 멀쩡한데
 *    401 을 연결 실패로 뭉갰기 때문이다. 이제 401 은 **재발급 한 번**으로 이어진다.
 * ② 재발급 함수(`auth/re-issue`)는 만들어만 두고 **아무도 부르지 않았다.**
 *    부르는 자리가 여기다.
 * ③ ERP 세션은 7일이고 삐용 토큰은 그보다 훨씬 짧다. 그래서 **부르기 직전에** 살아
 *    있는지 보고 죽었으면 먼저 되살린다 — 401 을 기다리지 않는다.
 *    ★ ERP 세션 기간은 건드리지 않는다. 운영자를 매일 로그인시키지 않는다.
 *
 * =============================================================================
 * ★★★ 재발급은 **한 번**이다
 * =============================================================================
 * 방금 받은 토큰으로도 401 이면 재발급이 문제를 해결하지 못한다는 뜻이다. 거기서
 * 한 번 더 시도하면 삐용이 401 을 주는 동안 무한히 돈다 — 그건 장애를 증폭시키는
 * 모양이다. 두 번째 401 은 재로그인이다.
 *
 * =============================================================================
 * 왜 저장소를 주입받는가
 * =============================================================================
 * 이 파일에는 DB 도 fetch 도 없다. 그래서 「401 이 재발급으로 이어지는가」,
 * 「재발급도 실패하면 재로그인인가」를 **DB 도 삐용도 없이** 시험할 수 있다.
 * DB 를 붙이는 자리는 `session/bbiyongToken.ts` 다.
 */
import {
  BbiyongReloginRequiredError,
  BbiyongTokenExpiredError,
  type BbiyongAuth,
} from './types.ts';
import { isAccessTokenExpired } from './accessToken.ts';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

/** 세션 한 건의 토큰을 읽고 쓰는 자리. 구현은 `session/bbiyongToken.ts` 가 준다. */
export interface AccessTokenStore {
  /** `null` = 세션이 없거나 복호화할 수 없다 = 되살릴 수 없다. */
  read(): Promise<SessionTokens | null>;
  /** 재발급으로 받은 새 access 토큰을 보관한다(암호화해서). */
  saveAccess(accessToken: string): Promise<void>;
  /** 되살릴 수 없을 때 ERP 세션을 폐기한다 — 살려 두면 같은 오류가 반복된다. */
  revoke(): Promise<void>;
}

/**
 * 살아 있는 access 토큰으로 `call` 을 실행한다.
 *
 * `call` 은 삐용이 401 을 주면 `BbiyongTokenExpiredError` 를 던져야 한다 —
 * `HttpBbiyongAuth` 의 `#call` 이 이미 그렇게 한다.
 *
 * @throws {BbiyongReloginRequiredError} 되살릴 수 없다. ERP 세션도 폐기된 상태다.
 * @throws {BbiyongUnavailableError} 삐용 장애. **재로그인으로 번역하지 않는다** —
 *   그러면 삐용이 잠깐 흔들릴 때마다 전원이 로그인 화면으로 튕긴다.
 */
export async function withFreshAccess<T>(
  store: AccessTokenStore,
  auth: Pick<BbiyongAuth, 'reIssue'>,
  call: (accessToken: string) => Promise<T>,
  { now = Date.now }: { now?: () => number } = {},
): Promise<T> {
  const tokens = await store.read();
  if (!tokens) {
    // 세션이 없거나 토큰을 복호화할 수 없다(암호화 키 회전 등). 재발급할 재료가 없다.
    await store.revoke();
    throw new BbiyongReloginRequiredError();
  }

  let access = tokens.accessToken;
  let reissued = false;

  /** 재발급 1회. 실패는 전부 여기서 재로그인·장애로 갈린다. */
  const reissue = async (): Promise<void> => {
    reissued = true;
    let fresh: string;
    try {
      fresh = await auth.reIssue(access, tokens.refreshToken);
    } catch (err) {
      // ★ 재발급이 「만료」로 실패하면 refresh 도 죽었다 → 재로그인. ERP 세션도 폐기한다.
      //   그 밖의 실패(삐용 장애)는 그대로 올려보낸다 — 세션을 죽이지 않는다.
      if (err instanceof BbiyongReloginRequiredError || err instanceof BbiyongTokenExpiredError) {
        await store.revoke();
        throw new BbiyongReloginRequiredError();
      }
      throw err;
    }
    access = fresh;
    await store.saveAccess(fresh);
  };

  // ③ 부르기 **직전에** 살아 있는지 본다. 모르는 토큰(MOCK 등)은 그냥 불러 본다.
  if (isAccessTokenExpired(access, { now: now() })) await reissue();

  try {
    return await call(access);
  } catch (err) {
    if (!(err instanceof BbiyongTokenExpiredError)) throw err;

    // ★ 방금 재발급한 토큰으로도 401 이면 재발급이 답이 아니다. 여기서 멈춘다.
    if (reissued) {
      await store.revoke();
      throw new BbiyongReloginRequiredError();
    }

    // ② 401 → 재발급 한 번 → 다시 부른다.
    await reissue();
    try {
      return await call(access);
    } catch (retryErr) {
      if (retryErr instanceof BbiyongTokenExpiredError) {
        await store.revoke();
        throw new BbiyongReloginRequiredError();
      }
      throw retryErr;
    }
  }
}
