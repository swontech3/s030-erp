import 'server-only';

/**
 * Fastify 호출 — **서버에서만** 부른다.
 *
 * 브라우저는 Fastify 에 직접 붙지 않는다. 이유 둘:
 *   1) `/auth/login` 응답 본문에 세션 원문(erp_sid)이 들어 있다. 외부에 노출되면
 *      세션을 아무나 받아간다. Fastify 는 127.0.0.1 에만 바인딩돼 있다
 *   2) 오리진이 갈리면 쿠키가 크로스 사이트가 되어 SameSite=None + Secure 가 강제되고,
 *      CORS 허용 목록까지 관리해야 한다. 같은 오리진이면 그 문제가 통째로 사라진다
 *
 * `import 'server-only'` 는 이 파일이 클라이언트 번들에 딸려 들어가면 **빌드를 깨뜨린다.**
 * 주석으로 "서버 전용"이라고 적어두는 것과 달리 실제로 막는다.
 */
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  body: T;
}

export async function callApi<T>(
  path: string,
  init: { method?: string; body?: unknown; erpSid?: string | null } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  // ★ 본문이 있을 때만 content-type 을 붙인다. 본문 없이 이 헤더만 보내면 Fastify 가
  //   FST_ERR_CTP_EMPTY_JSON_BODY 로 400 을 낸다 — 실제로 로그아웃이 그렇게 조용히
  //   실패했다(쿠키는 지워지고 서버 세션은 살아 있는 상태). 2026-09-07 확인.
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  // 세션은 쿠키 헤더로 넘긴다 — Fastify 쪽 훅이 읽는 것과 같은 형식이다.
  if (init.erpSid) headers.cookie = `erp_sid=${encodeURIComponent(init.erpSid)}`;

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    // 인증 응답은 절대 캐시하지 않는다. 캐시되면 다른 사용자에게 남의 세션이 간다.
    cache: 'no-store',
  });

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { error: 'invalid_response', message: text.slice(0, 200) };
  }

  return { ok: res.ok, status: res.status, body: body as T };
}
