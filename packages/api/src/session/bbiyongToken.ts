/**
 * 세션 한 건의 삐용 토큰을 읽고 쓰는 자리 — `withFreshAccess` 에 DB 를 붙인다.
 *
 * =============================================================================
 * ★★ 삐용을 부르는 코드는 **반드시 `callBbiyong` 을 거친다**
 * =============================================================================
 * 세션에서 토큰을 직접 꺼내 삐용을 부르면 그 경로만 재발급을 빠뜨린다. 그러면 화면
 * 하나만 「서버에 연결할 수 없습니다」로 죽고, 원인을 찾는 데 오래 걸린다.
 *
 *     await callBbiyong(session.erpSid, (accessToken) => bbiyongAcl.listScreens(...))
 *
 * ★ 지금 이 함수를 부르는 **업무 코드는 없다.** 페이즈 1 은 삐용 API 를 로그인·
 *   로그아웃에만 쓰고, 그 둘은 토큰을 싣지 않는다(로그인은 토큰을 받고, 로그아웃은
 *   refresh 를 헤더로 보낸다). 첫 호출자는 `HttpBbiyongAcl`(회신 ⑫)이다.
 *   ★★ 그때 **이 함수를 거치지 않고** 토큰을 직접 꺼내 쓰면 ②③ 이 다시 사라진다.
 *
 * =============================================================================
 * 알려진 낭비 — 같은 세션의 동시 요청
 * =============================================================================
 * 한 화면이 API 를 5개 동시에 부르고 토큰이 막 만료됐다면 재발급이 5번 나간다.
 * 삐용은 refresh 를 회전하지 않으므로(회신 ⑦) 5번 다 성공하고 마지막 값이 남는다 —
 * **틀리지는 않고 낭비만 있다.** 한 번으로 합치는 장치(single-flight)를 두면 상태가
 * 하나 더 생기므로, 실제로 문제가 될 때 넣는다.
 */
import { pool } from '../db/pool.ts';
import { decrypt, encrypt } from '../lib/crypto.ts';
import { revokeSessionByHash } from './store.ts';
import {
  bbiyongAuth,
  withFreshAccess,
  type AccessTokenStore,
  type SessionTokens,
} from '../bbiyong/index.ts';

/**
 * `tb_s080_auth_session` 한 행을 `AccessTokenStore` 로 감싼다.
 *
 * @param erpSid 세션 id 의 **SHA-256 해시**(`ErpSession.erpSid`). 원문이 아니다.
 */
export function sessionTokenStore(erpSid: string): AccessTokenStore {
  return {
    async read(): Promise<SessionTokens | null> {
      const { rows } = await pool.query<{
        bbiyong_access_encrypted: string;
        bbiyong_refresh_encrypted: string;
        revoked_at: Date | null;
      }>(
        `SELECT bbiyong_access_encrypted, bbiyong_refresh_encrypted, revoked_at
           FROM public.tb_s080_auth_session
          WHERE erp_sid = $1`,
        [erpSid],
      );
      const row = rows[0];
      // ★ 폐기된 세션의 토큰은 없는 것으로 본다 — 훅이 걸러 주지만 여기서도 본다.
      if (!row || row.revoked_at !== null) return null;

      try {
        return {
          accessToken: decrypt(row.bbiyong_access_encrypted),
          refreshToken: decrypt(row.bbiyong_refresh_encrypted),
        };
      } catch (err) {
        // 복호화 실패(ERP_ENCRYPTION_KEY 회전 등)는 되살릴 수 없다 → 재로그인.
        console.error('[session] 삐용 토큰 복호화 실패:', (err as Error).message);
        return null;
      }
    },

    async saveAccess(accessToken: string): Promise<void> {
      // ★ refresh 는 건드리지 않는다 — 삐용은 refresh 를 회전하지 않는다(회신 ⑦).
      await pool.query(
        `UPDATE public.tb_s080_auth_session
            SET bbiyong_access_encrypted = $1
          WHERE erp_sid = $2`,
        [encrypt(accessToken), erpSid],
      );
    },

    async revoke(): Promise<void> {
      await revokeSessionByHash(erpSid);
    },
  };
}

/**
 * 살아 있는 삐용 access 토큰으로 `call` 을 실행한다. **삐용을 부르는 유일한 문이다.**
 *
 * @throws {BbiyongReloginRequiredError} 되살릴 수 없다 — ERP 세션도 폐기된 상태다.
 *   Fastify 의 에러 핸들러(`index.ts`)가 401 `session_expired` 로 번역한다.
 */
export async function callBbiyong<T>(
  erpSid: string,
  call: (accessToken: string) => Promise<T>,
): Promise<T> {
  return withFreshAccess(sessionTokenStore(erpSid), bbiyongAuth, call);
}
