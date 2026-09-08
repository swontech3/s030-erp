import 'server-only';
import { NextResponse } from 'next/server';

/**
 * 상태를 바꾸는 route handler 의 출처 검사 (리뷰 2026-09-07 H1·H2).
 *
 * "POST 로만 받는다"는 CSRF 를 막지 못한다 — 다른 사이트의 자동 제출 <form> 도 POST 이고,
 * `enctype=text/plain` 이면 본문을 JSON 모양으로 꾸며 `request.json()` 을 통과시킬 수 있다.
 * 그 결과가 **로그인 CSRF** 다: 피해자 브라우저에 공격자 세션이 심긴다(그 뒤 피해자가 입력하는
 * 데이터는 공격자 회사로 들어간다). SameSite=Lax 는 최상위 탐색의 응답이 쿠키를 *굽는* 것까지
 * 막아 주지 않는다.
 *
 * 판정 순서
 *   1. `Sec-Fetch-Site` (모던 브라우저가 항상 보낸다): same-origin · none(주소창 직접 입력)만 통과
 *   2. 헤더가 없으면 `Origin` 으로 대신 판정(브라우저는 POST 에 Origin 을 반드시 싣는다)
 *   3. 둘 다 없으면 브라우저가 아니다(curl·서버 간 호출) — 통과. CSRF 는 브라우저의 문제다.
 *   4. requireJson 이면 content-type 이 application/json 이어야 한다 — text/plain 폼 우회 차단
 */
export function rejectCrossSite(request: Request, opts: { requireJson?: boolean } = {}): NextResponse | null {
  const site = request.headers.get('sec-fetch-site');
  if (site !== null) {
    if (site !== 'same-origin' && site !== 'none') return forbidden('cross_site');
  } else {
    const origin = request.headers.get('origin');
    if (origin !== null) {
      let originHost: string | null = null;
      try {
        originHost = new URL(origin).host;
      } catch {
        return forbidden('bad_origin');
      }
      const selfHost = request.headers.get('host');
      if (!selfHost || originHost !== selfHost) return forbidden('cross_site');
    }
  }

  if (opts.requireJson) {
    const ct = request.headers.get('content-type') ?? '';
    if (!ct.toLowerCase().startsWith('application/json')) return forbidden('not_json');
  }
  return null;
}

function forbidden(reason: string): NextResponse {
  return NextResponse.json({ error: reason, message: '요청 출처를 확인할 수 없습니다' }, { status: 403 });
}
