/**
 * 삐용 로그인 응답 읽기 — **브라우저**가 쓴다 (규격서 Q6 · 2026-10-22).
 *
 * ERP 로그인 = 삐용 로그인. 브라우저가 삐용 sign-in 을 직접 부르고, 여기서 **토큰 둘만** 꺼내
 * ERP 웹(`/api/auth/login`)에 넘긴다. ERP 서버는 비밀번호를 받지 않는다.
 * ★ 회원번호 · 회사번호는 여기서 꺼내지 않는다 — 브라우저가 보낸 값은 믿지 않고,
 *   ERP 서버가 삐용에 물어 확인한다(api `HttpBbiyongAuth.verifySession`).
 *
 * 종전 API 의 parseSignIn 이 지키던 함정을 그대로 지킨다.
 *   ① 삐용은 실패도 HTTP 200 이다 — 성공은 `result === 'success' && status === 200`(엄격)
 *   ② needOrgSelect 는 성공 게이트보다 **먼저** 본다 — 겸직을 「비밀번호 틀림」으로 뭉개지 않는다
 *   ③ 어떤 입력에도 던지지 않는다 — 깨진 응답은 실패다
 */

/**
 * 로그인 실패 문구. **하나뿐이다** — 삐용은 「이메일 없음」과 「비밀번호 틀림」을 둘 다 A005 로 준다.
 * 삐용의 `massage` 를 화면에 흘리지 않는다(계정 존재 여부 · 삐용 문구 변경이 그대로 새어 나간다).
 */
export const INVALID_CREDENTIALS_MESSAGE = '이메일 또는 비밀번호가 올바르지 않습니다';

/** 겸직 계정 안내. 2단계 로그인 팝업을 만들기 전까지 이 문구가 유일한 출구다. */
export const ORG_SELECT_MESSAGE =
  '이 계정은 여러 단체에 소속되어 있습니다. 삐용에서 로그인한 뒤 다시 시도해 주세요.';

export type SignInTokens =
  | { kind: 'success'; accessToken: string; refreshToken: string }
  | { kind: 'orgSelect'; message: string }
  | { kind: 'fail'; message: string };

function asRecord(v: unknown): Record<string, unknown> | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

const FAIL: SignInTokens = { kind: 'fail', message: INVALID_CREDENTIALS_MESSAGE };

/** POST /rest/v1/s021200010/sign-in 응답 본문 → 토큰 둘 · 겸직 · 실패 */
export function readSignInTokens(body: unknown): SignInTokens {
  const root = asRecord(body);
  if (!root) return FAIL;
  const data = asRecord(root.data);

  // ② 판정은 값이 아니라 **존재 여부**로 한다(회신 §4)
  if (data && Object.hasOwn(data, 'needOrgSelect')) {
    return { kind: 'orgSelect', message: ORG_SELECT_MESSAGE };
  }
  // ① 성공 게이트 — 셋 다
  if (root.result !== 'success' || root.status !== 200 || !data) return FAIL;

  const accessToken = str(data.accessToken);
  const refreshToken = str(data.refreshToken);
  if (accessToken === null || refreshToken === null) return FAIL;
  return { kind: 'success', accessToken, refreshToken };
}
