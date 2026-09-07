import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@swonbiz/shared';
import { callApi } from '@/lib/api';

/**
 * 로그인 — 브라우저와 Fastify 사이의 유일한 통로.
 *
 * 브라우저가 Fastify 를 직접 부르지 않는 이유는 `lib/api.ts` 주석에 있다.
 * 여기서 하는 일은 셋이다.
 *   1. Fastify `/auth/login` 호출
 *   2. 응답의 **원문 erp_sid 를 HttpOnly 쿠키로 굽는다** — 이 값이 브라우저 JS 에
 *      노출되면 XSS 하나로 세션이 통째로 털린다
 *   3. 원문 sid 를 응답 본문에서 **지운 뒤** 나머지만 화면에 돌려준다
 *
 * ★ 브라우저 쿠키에 삐용 토큰은 하나도 내려가지 않는다(완료 기준). 삐용 access·refresh 는
 *   Fastify 가 암호화해서 DB 에만 둔다 — 이 파일은 그 값을 받지도 않는다.
 */
interface ApiLoginResponse {
  erpSid: string;
  expiresAt: string;
  home: string;
  screens: string[];
  display: { memberName: string; orgName: string; orgTp: string };
  companyId: string | null;
  message?: string;
}

export async function POST(request: Request) {
  let payload: { email?: string; password?: string };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ message: '요청 형식이 올바르지 않습니다' }, { status: 400 });
  }

  const res = await callApi<ApiLoginResponse>('/auth/login', {
    method: 'POST',
    body: { email: payload.email, password: payload.password },
  });

  if (!res.ok) {
    // ★ 실패 사유를 그대로 통과시키되 상태코드는 유지한다. 화면은 message 만 읽는다.
    return NextResponse.json(
      { message: res.body?.message ?? '로그인에 실패했습니다' },
      { status: res.status },
    );
  }

  const { erpSid, expiresAt, ...safe } = res.body;

  const response = NextResponse.json(safe);
  response.cookies.set({
    name: SESSION_COOKIE,
    value: erpSid,
    httpOnly: true,
    // ★ 개발은 http://localhost 라 Secure 를 켜면 쿠키가 아예 저장되지 않는다.
    //   운영에서는 반드시 켠다.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: new Date(expiresAt),
  });
  return response;
}
