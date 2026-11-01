import type { NextRequest } from 'next/server';

/**
 * 자료 올리기 미리보기 · 올리기 주소의 물음 — `kind`, 은행(1-5)이면 `account` · `fileTp`, 4대보험(1-6)이면 `insTp` · `noticeMonth` 도
 * 그대로 넘긴다.
 * ★ 이 홉은 판정하지 않는다. 종류 · 계좌(그 단체 것인지) · 파일 종류는 전부 Fastify 가 본다. 없는 칸은 보내지 않는다.
 */
export function uploadQuery(request: NextRequest): string {
  const q = new URLSearchParams();
  q.set('kind', request.nextUrl.searchParams.get('kind') ?? '');
  for (const key of ['account', 'fileTp', 'insTp', 'noticeMonth']) {
    const v = request.nextUrl.searchParams.get(key);
    if (v !== null) q.set(key, v);
  }
  return q.toString();
}
