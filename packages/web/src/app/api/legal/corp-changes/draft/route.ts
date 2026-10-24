import type { NextRequest } from 'next/server';
import { forwardGetJson } from '@/lib/forward';

/**
 * 임시 모드의 기본정보 — `?changeType=&orgId=&orgCode=`. 건을 읽지 않는다(아직 없다).
 * ★ 이 홉은 판정하지 않는다. 회사 세션이 남의 단체를 적으면 Fastify 가 403 을 낸다.
 */
export async function GET(request: NextRequest) {
  const qs = request.nextUrl.searchParams.toString();
  return forwardGetJson(`/legal/corp-changes/draft${qs ? `?${qs}` : ''}`);
}
