import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@swonbiz/shared';

/**
 * 로그아웃 — 쿠키를 지우고 /login 으로 보낸다.
 *
 * 접근권한없음 화면(s0300000080)에서 나갈 길이 이것뿐이라 **장식이면 사용자가 갇힌다**.
 * 그래서 세션 발급(2-8)보다 먼저 이 경로만 실제로 동작하게 만들어 둔다.
 *
 * 완성된 로그아웃은 세 단계다 (ORG_ARCHITECTURE.md §3-5):
 *   1. tb_s080_auth_session.revoked_at = now()   ← 즉시 무효화. 30초 캐시 우회
 *   2. POST 삐용 /rest/v1/s021200010/sign-out    ← refresh-token 헤더로 그 세션 1건 삭제
 *   3. erp_sid 쿠키 삭제
 * 2번이 실패해도 1·3번은 진행한다. ERP 세션만 끊겨도 사용자는 로그아웃된 것이다.
 *
 * TODO(2-8): 위 1·2번을 여기에 채운다. Fastify 의 로그아웃 엔드포인트를 호출하고,
 *   실패해도 아래 쿠키 삭제와 리다이렉트는 그대로 진행한다(끊는 쪽으로 실패한다).
 *
 * ★ POST 로만 받는다. GET 으로 두면 링크 프리페치나 이미지 태그만으로도 로그아웃이
 *   일어난다(CSRF 의 고전적 형태).
 */
export async function POST(request: Request) {
  const res = NextResponse.redirect(new URL('/login', request.url), { status: 303 });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
