import { forwardJson } from '@/lib/forward';

/**
 * ERP 가 바깥 틀일 때, 내 안에 뜬 삐용 화면에 넘길 삐용 토큰 (2026-10-22 대표 지시 「2번」).
 *
 * ★ 자기 화면에만 — `forwardJson` 이 같은 출처 · JSON 만 받고(rejectCrossSite) erp_sid 쿠키가 있어야
 *   Fastify 로 넘긴다. 다른 사이트의 페이지는 이 응답을 읽을 수 없다(CORS 를 열지 않는다).
 * ★ 화면은 받은 토큰을 저장하지 않고 바로 안쪽 삐용에 postMessage 로 넘긴다(`@/lib/embed`).
 */
export async function POST(request: Request) {
  return forwardJson(request, '/auth/bbiyong-token', 'POST');
}
