import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@swonbiz/shared';
import { callApi } from '@/lib/api';
import { readSid } from '@/lib/session';

/**
 * 로그아웃 — 세션을 끊고 쿠키를 지우고 /login 으로 보낸다.
 *
 * 접근권한없음 화면(s0300000080)에서 나갈 길이 이것뿐이라 **장식이면 사용자가 갇힌다**.
 *
 * 세 단계 (ORG_ARCHITECTURE.md §3-5)
 *   1. tb_s080_auth_session.revoked_at = now()   ← Fastify 가 한다. 즉시 무효(캐시도 버림)
 *   2. POST 삐용 sign-out                         ← Fastify 가 한다. 실패해도 계속 간다
 *   3. erp_sid 쿠키 삭제                          ← 여기서 한다
 *
 * ★ 1·2 가 실패해도 3 과 리다이렉트는 그대로 진행한다. **끊는 쪽으로 실패한다** —
 *   서버 세션이 남더라도 이 브라우저에서는 로그아웃된 상태여야 한다.
 *
 * ★ POST 로만 받는다. GET 으로 두면 링크 프리페치나 이미지 태그만으로도 로그아웃이
 *   일어난다(CSRF 의 고전적 형태).
 */
export async function POST(request: Request) {
  const sid = await readSid();

  if (sid) {
    try {
      const res = await callApi<{ ok?: boolean; message?: string }>('/auth/logout', {
        method: 'POST',
        erpSid: sid,
      });
      // ★ 던지지 않는 실패를 놓치지 않는다. callApi 는 상태코드를 예외로 바꾸지 않으므로
      //   여기서 확인하지 않으면 "쿠키는 지워졌는데 서버 세션은 살아 있는" 상태가
      //   조용히 생긴다. 실제로 그 버그가 있었다(빈 본문 + content-type → 400).
      if (!res.ok) {
        console.error('[logout] 세션 폐기 실패:', res.status, res.body?.message ?? '');
      }
    } catch (err) {
      console.error('[logout] 세션 폐기 요청 실패 — 쿠키는 그대로 지운다:', (err as Error).message);
    }
  }

  const res = NextResponse.redirect(new URL('/login', request.url), { status: 303 });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
