import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@swonbiz/shared';

/**
 * 미들웨어 — Next 16 에서 `middleware.ts` 가 `proxy.ts` 로 개명됐다(기능 동일).
 *
 * ★★ 이것은 **UX 게이트일 뿐이다.** 진짜 차단은 Fastify 의 onRequest 훅이 한다.
 *    CVE-2025-29927 은 Next 미들웨어가 헤더 하나로 우회된 사건이고, 그 교훈은
 *    "미들웨어에 인가를 걸지 말라"이다. 여기서 하는 일은 쿠키가 아예 없는 요청을
 *    로그인 화면으로 보내 **왕복 한 번을 아끼는 것**뿐이다.
 *
 * ★ 쿠키의 유효성(만료·폐기)은 검사하지 않는다. 검사하려면 DB 를 봐야 하고,
 *   그러면 미들웨어가 데이터 조회를 하게 된다(공식 문서가 말리는 그 용법).
 *   폐기된 세션은 페이지의 서버 컴포넌트가 /auth/me 에서 401 을 받고 걸러낸다.
 */
export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has(SESSION_COOKIE);
  if (hasSession) return NextResponse.next();

  // 로그인 후 원래 가려던 곳으로 되돌려 보낸다.
  const url = new URL('/login', request.url);
  const from = request.nextUrl.pathname + request.nextUrl.search;
  if (from && from !== '/') url.searchParams.set('redirect', from);
  return NextResponse.redirect(url);
}

/**
 * 보호 대상 경로만 나열한다.
 *
 * ★ 화이트리스트가 아니라 명시 목록이다 — `(erp)` 라우트 그룹은 URL 에 나타나지
 *   않으므로 matcher 로는 그룹을 가리킬 수 없다. 화면이 늘어나면 여기와
 *   `lib/screens.ts` 를 함께 고친다.
 */
export const config = {
  matcher: ['/dashboard/:path*', '/booking/:path*', '/tenants/:path*', '/contracts/:path*', '/settings/:path*', '/facility/:path*'],
};
