import 'server-only';
import { SESSION_COOKIE } from '@swonbiz/shared';

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

/**
 * Fastify 주소. ★ 첨부 업로드(`forwardUpload`)는 `callApi` 를 쓸 수 없어서
 *   직접 `fetch` 하는데, 그쪽이 주소를 따로 들고 있으면 배포에서 한쪽만 바뀐다.
 */
export const apiBaseUrl = (): string => API_BASE_URL;
const API_TIMEOUT_MS = 5_000;

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  body: T;
}

export async function callApi<T>(
  path: string,
  init: {
    method?: string;
    body?: unknown;
    erpSid?: string | null;
    headers?: Record<string, string>;
    /** 상한(기본 5초). ★ 바깥(AI)을 부르는 주소만 늘린다 — 사업목적 [AI 추천] */
    timeoutMs?: number;
  } = {},
): Promise<ApiResult<T>> {
  // ★ 공개 라우트(문의상담)가 클라이언트 IP·열람 토큰을 넘길 때 쓴다. 세션과 섞이지 않는다.
  const headers: Record<string, string> = { ...init.headers };
  // ★ 본문이 있을 때만 content-type 을 붙인다. 본문 없이 이 헤더만 보내면 Fastify 가
  //   FST_ERR_CTP_EMPTY_JSON_BODY 로 400 을 낸다 — 실제로 로그아웃이 그렇게 조용히
  //   실패했다(쿠키는 지워지고 서버 세션은 살아 있는 상태). 2026-09-07 확인.
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  // 세션은 쿠키 헤더로 넘긴다 — Fastify 쪽 훅이 읽는 것과 같은 형식이다.
  if (init.erpSid) headers.cookie = `${SESSION_COOKIE}=${encodeURIComponent(init.erpSid)}`;

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    // 인증 응답은 절대 캐시하지 않는다. 캐시되면 다른 사용자에게 남의 세션이 간다.
    cache: 'no-store',
    // ★ 상한 없는 대기가 서버 컴포넌트 렌더를 통째로 멈추게 둔다(리뷰 2026-09-07).
    //   DB 가 잠기면 Fastify 가 응답을 못 하고, 그 동안 Next 워커가 하나씩 묶인다.
    signal: AbortSignal.timeout(init.timeoutMs ?? API_TIMEOUT_MS),
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
