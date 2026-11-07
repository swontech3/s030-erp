import type { NextRequest } from 'next/server';
import { forwardGetJson } from '@/lib/forward';

/**
 * 정관 파일을 볼 주소 `{ url, originalName }` — 만료되는 주소다(Fastify 가 no-store). 화면은 들고 있지 않는다.
 * ★ 이 홉은 판정하지 않는다(남의 단체는 Fastify 가 403).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  return forwardGetJson(`/legal/orgs/${encodeURIComponent(orgId)}/articles-file/url`);
}
