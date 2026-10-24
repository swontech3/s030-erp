import type { NextRequest } from 'next/server';
import { forwardGetJson } from '@/lib/forward';

/**
 * 서류 출력 값 `?applyDate=&writeDate=` — 판정은 Fastify(`legal/corpChangePrint.ts`). 작성완료 · 완료만.
 *
 * ★★ 응답에 주민번호 평문이 실린다(Q4) — 이 홉에서도 `Cache-Control: no-store` 를 단다(성공 · 거절 모두).
 *   `forwardGetJson` 은 Fastify 의 머리를 옮기지 않는다.
 * ★ 날짜 두 개만 옮긴다 — 다른 쿼리는 넘기지 않는다.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const q = new URLSearchParams();
  for (const key of ['applyDate', 'writeDate']) {
    const v = request.nextUrl.searchParams.get(key);
    if (v) q.set(key, v);
  }
  const qs = q.toString();
  const res = await forwardGetJson(`/legal/corp-changes/${encodeURIComponent(id)}/print${qs ? `?${qs}` : ''}`);
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
