import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@swonbiz/shared';
import { callApi } from '@/lib/api';
import { rejectCrossSite } from '@/lib/csrf';

/**
 * 로그인 — 브라우저와 Fastify 사이의 유일한 통로.
 *
 * ★ 2026-10-22 — 규격서 Q6 : 브라우저가 삐용 로그인을 **직접** 부르고, 받은 삐용 토큰 둘만
 *   이리로 넘긴다. 이 파일도 ERP 서버도 **비밀번호를 받지 않는다.** 토큰은 Fastify 가 삐용에
 *   물어 확인한 뒤에만 세션이 된다.
 *
 * 브라우저가 Fastify 를 직접 부르지 않는 이유는 `lib/api.ts` 주석에 있다.
 * 여기서 하는 일은 셋이다.
 *   1. Fastify `/auth/login` 호출(삐용 토큰 둘)
 *   2. 응답의 **원문 erp_sid 를 HttpOnly 쿠키로 굽는다** — 이 값이 브라우저 JS 에
 *      노출되면 XSS 하나로 세션이 통째로 털린다
 *   3. 원문 sid 를 응답 본문에서 **지운 뒤** 나머지만 화면에 돌려준다
 *
 * ★ 브라우저 쿠키에 삐용 토큰은 하나도 내려가지 않는다(완료 기준). 삐용 access·refresh 는
 *   Fastify 가 암호화해서 DB 에만 둔다 — 이 파일은 본문으로 받아 그대로 넘기기만 한다(남기지 않는다).
 */
interface ApiLoginResponse {
  erpSid: string;
  expiresAt: string;
  home: string;
  screens: string[];
  display: { memberName: string; orgName: string; orgTp: string | null };
  companyId: string | null;
  message?: string;
}

export async function POST(request: Request) {
  // ★ 로그인 CSRF(리뷰 2026-09-07 H1): 다른 사이트의 <form enctype=text/plain> 이 JSON 모양 본문을
  //   보내 피해자 브라우저에 공격자 세션을 심을 수 있다. 출처와 content-type 을 먼저 본다.
  const blocked = rejectCrossSite(request, { requireJson: true });
  if (blocked) return blocked;

  let payload: { accessToken?: unknown; refreshToken?: unknown } | null;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ message: '요청 형식이 올바르지 않습니다' }, { status: 400 });
  }
  // null · 비문자열도 400 이다(리뷰 M6). ★ 이메일 · 비밀번호는 받지 않는다 — 넘기는 것은 토큰 둘뿐이다.
  if (!payload || typeof payload.accessToken !== 'string' || typeof payload.refreshToken !== 'string') {
    return NextResponse.json({ message: '로그인 정보가 올바르지 않습니다. 다시 로그인해 주세요' }, { status: 400 });
  }

  let res;
  try {
    res = await callApi<ApiLoginResponse>('/auth/login', {
      method: 'POST',
      body: { accessToken: payload.accessToken, refreshToken: payload.refreshToken },
    });
  } catch (err) {
    // ★ Fastify 에 못 붙은 것(기동 전·죽음)은 인증 실패가 아니다. 여기서 잡지 않으면
    //   Next 가 500 을 내고, 화면은 본문이 없어 기본 문구 "이메일 또는 비밀번호가 올바르지
    //   않습니다"를 띄운다 — 서버 장애를 사용자 잘못으로 돌리는 셈이다.
    console.error('[login] api 연결 실패:', (err as Error).message);
    return NextResponse.json({ message: '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요' }, { status: 503 });
  }

  if (!res.ok) {
    // 4xx 의 message 는 사용자용이라 통과시킨다. 5xx 는 Fastify 가 이미 가리지만(setErrorHandler),
    // 여기서도 한 번 더 — 내부 문구가 브라우저까지 오는 경로를 둘 다 막는다(리뷰 H3).
    const message = res.status < 500 ? (res.body?.message ?? '로그인에 실패했습니다') : '서버 오류가 났습니다. 잠시 후 다시 시도해 주세요';
    return NextResponse.json({ message }, { status: res.status });
  }

  const { erpSid, expiresAt, home } = res.body;
  // 200 인데 sid 가 없으면 계약 위반이다. 쿠키에 "undefined" 를 굽고 넘어가지 않는다.
  const expires = new Date(expiresAt);
  if (typeof erpSid !== 'string' || !erpSid || Number.isNaN(expires.getTime()) || !home) {
    console.error('[login] api 응답에 erpSid/expiresAt/home 없음');
    return NextResponse.json({ message: '로그인 처리 중 오류가 났습니다' }, { status: 502 });
  }

  // ★ 브라우저에는 화면이 쓰는 것만 준다(리뷰 2026-09-07). Fastify 응답을 그대로 펼치면
  //   companyId·screens 같은 서버 판정값이 공개 계약이 된다. 화면은 home 하나만 쓴다.
  const response = NextResponse.json({ home });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: erpSid,
    httpOnly: true,
    // ★ 개발은 http://localhost 라 Secure 를 켜면 쿠키가 아예 저장되지 않는다.
    //   운영에서는 반드시 켠다.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires,
  });
  return response;
}
