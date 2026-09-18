import 'server-only';
import { NextResponse } from 'next/server';
import { callApi } from './api';
import { rejectCrossSite } from './csrf';
import { readSid } from './session';

/**
 * 브라우저 → Next → Fastify 로 본문을 그대로 넘기는 얇은 통로.
 *
 * ★ 브라우저는 Fastify 에 직접 붙지 않는다(이유는 `lib/api.ts` 주석). 그래서 화면이
 *   무엇을 저장하려면 route handler 가 하나 있어야 한다. 이 함수가 그 공통부다.
 *
 * ★★ **여기서 판정하지 않는다.** 역할·잠금·금액·상태 전이는 전부 Fastify 가 본다
 *    (4-3). 이 홉이 규칙을 하나라도 다시 쓰면 두 벌이 되고, 둘이 갈리는 순간
 *    화면은 통과시키는데 서버는 거절하는 상태가 된다.
 *
 * 하는 일은 넷뿐이다.
 *   1. 출처 검사(CSRF) — 다른 사이트의 자동 제출 폼을 막는다
 *   2. 세션 쿠키를 꺼내 Fastify 로 넘긴다. 없으면 401
 *   3. 본문을 JSON 으로 읽는다. 못 읽으면 400
 *   4. Fastify 응답의 상태와 본문을 **그대로** 돌려준다 — 4xx 의 message 는 사용자용이다
 */
/**
 * 조회를 그대로 넘긴다. 본문도 CSRF 검사도 없다 — GET 은 상태를 바꾸지 않는다.
 *
 * ★ 그래도 세션은 반드시 넘긴다. 빼면 Fastify 가 401 을 내고, 그게 «데이터 없음»으로
 *   보이는 화면이 된다.
 */
export async function forwardGetJson(path: string): Promise<NextResponse> {
  const sid = await readSid();
  if (!sid) {
    return NextResponse.json({ message: '세션이 만료되었습니다. 다시 로그인해 주세요' }, { status: 401 });
  }

  let res;
  try {
    res = await callApi<{ message?: string }>(path, { erpSid: sid });
  } catch (err) {
    console.error(`[forward] GET ${path} 실패:`, (err as Error).message);
    return NextResponse.json(
      { message: '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요' },
      { status: 503 },
    );
  }

  if (!res.ok && res.status >= 500) {
    return NextResponse.json({ message: '서버 오류가 났습니다. 잠시 후 다시 시도해 주세요' }, { status: res.status });
  }
  return NextResponse.json(res.body ?? {}, { status: res.status });
}

export async function forwardJson(
  request: Request,
  path: string,
  method: 'POST' | 'PATCH' | 'PUT',
): Promise<NextResponse> {
  const blocked = rejectCrossSite(request, { requireJson: true });
  if (blocked) return blocked;

  const sid = await readSid();
  if (!sid) {
    return NextResponse.json({ message: '세션이 만료되었습니다. 다시 로그인해 주세요' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: '요청 형식이 올바르지 않습니다' }, { status: 400 });
  }

  let res;
  try {
    res = await callApi<{ message?: string }>(path, { method, body, erpSid: sid });
  } catch (err) {
    // Fastify 에 못 붙은 것은 입력 오류가 아니다 — 사용자 잘못으로 돌리지 않는다.
    console.error(`[forward] ${method} ${path} 실패:`, (err as Error).message);
    return NextResponse.json(
      { message: '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요' },
      { status: 503 },
    );
  }

  // 5xx 의 내부 문구는 가린다 — Fastify 도 가리지만 이 홉에서도 한 번 더 막는다.
  if (!res.ok && res.status >= 500) {
    return NextResponse.json({ message: '서버 오류가 났습니다. 잠시 후 다시 시도해 주세요' }, { status: res.status });
  }
  return NextResponse.json(res.body ?? {}, { status: res.status });
}
