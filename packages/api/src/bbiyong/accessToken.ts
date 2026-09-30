/**
 * access 토큰의 남은 수명 — **토큰 자신에게 물어본다.**
 *
 * =============================================================================
 * ★★ 왜 필요한가 — ERP 세션 7일 vs 삐용 토큰 24시간
 * =============================================================================
 * ERP 세션은 7일이고(운영자를 매일 로그인시키지 않는다), 삐용 access 토큰은 그보다
 * 훨씬 짧다. 그래서 **멀쩡한 ERP 세션이 죽은 삐용 토큰을 들고 있는 시간이 대부분이다.**
 * 그 상태로 삐용을 부르면 401 이 오고, 사용자는 「서버에 연결할 수 없습니다」를 본다.
 *
 * 그래서 부르기 **직전에** 살아 있는지 보고, 죽었으면 먼저 재발급한다.
 *
 * =============================================================================
 * ★★★ 만료 시각을 **코드에 박지 않는다**
 * =============================================================================
 * "access 30분 · refresh 7일" 은 삐용의 폴백값이고, 개발계·가동계가 각 DB 의
 * `code010` 으로 분리돼 **값이 다를 수 있다**(회신 ⑤). 그 숫자를 ERP 가 들고 있으면
 * 삐용이 설정을 바꾼 날 조용히 어긋난다.
 *
 * 이 파일은 숫자를 들고 있지 않다. **토큰 안에 적힌 `exp` 를 읽을 뿐이다** —
 * 삐용 JWT 페이로드는 `sub`·`auth`·`exp` 셋이다(회신 ⑦). 서명은 검증하지 않는다:
 * 검증할 비밀을 ERP 는 갖고 있지 않고, 여기서 하려는 일은 **인증이 아니라 일정 판단**이다.
 * 위조된 exp 로 얻을 수 있는 최악은 「재발급을 한 번 더 부르는 것」뿐이고, 진짜 판정은
 * 삐용이 401 로 한다.
 */

/**
 * 재발급을 앞당기는 여유. 만료 직전에 보낸 요청이 삐용에 닿는 사이 만료되는 경우를 막는다.
 *
 * ★ 이 값은 **삐용의 만료 시간이 아니다.** 왕복 시간에 대한 여유폭이라
 *   삐용 설정과 무관하게 ERP 가 정해도 되는 유일한 숫자다.
 */
export const EXPIRY_SKEW_MS = 30_000;

/**
 * JWT 의 `exp`(초) → epoch 밀리초. 읽을 수 없으면 `null`.
 *
 * ★ **`null` 은 "만료됐다"가 아니라 "모른다"다.** JWT 가 아닌 토큰(MOCK 모드의
 *   `mock-access.…`)이나 `exp` 가 없는 토큰이 여기 온다. 모를 때는 그냥 불러 보고
 *   삐용의 401 에 맡긴다 — 모른다고 미리 재발급하면 멀쩡한 토큰을 매번 버린다.
 */
export function accessTokenExpiresAt(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null; // JWT 모양이 아니다
  const payload = parts[1];
  if (!payload) return null;

  let exp: unknown;
  try {
    exp = (JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown }).exp;
  } catch {
    return null; // 페이로드가 base64url JSON 이 아니다
  }
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return null;
  return exp * 1000;
}

/**
 * 지금 이 토큰으로 삐용을 부를 수 있는가 — **부르기 직전에 묻는다.**
 *
 * `true` 면 재발급이 먼저다. 모르는 토큰(`exp` 없음)은 `false` — 위 주석 참조.
 */
export function isAccessTokenExpired(
  token: string,
  { now = Date.now(), skewMs = EXPIRY_SKEW_MS }: { now?: number; skewMs?: number } = {},
): boolean {
  const expiresAt = accessTokenExpiresAt(token);
  if (expiresAt === null) return false;
  return expiresAt - skewMs <= now;
}
