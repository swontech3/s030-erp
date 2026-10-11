import type { NextRequest } from 'next/server';
import { forwardGetJson } from '@/lib/forward';

/** 임시 모드 `?orgId=&orgCode=` — 건을 읽지 않는다. 회사 세션이 남의 단체를 적으면 Fastify 가 403. */
export async function GET(request: NextRequest) {
  const qs = request.nextUrl.searchParams.toString();
  return forwardGetJson(`/legal/incorporations/draft${qs ? `?${qs}` : ''}`);
}
