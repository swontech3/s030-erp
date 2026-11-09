import type { NextRequest } from 'next/server';
import { forwardGetJson } from '@/lib/forward';

/**
 * 새 건 대화상자의 회사유형 — `?orgId=&orgCode=`(회사 사용자는 비움) → `{ memberType }`(2026-11-01).
 * ★ 이 홉은 판정하지 않는다. 회사 세션이 남의 단체를 적으면 Fastify 가 403 을 낸다.
 */
export async function GET(request: NextRequest) {
  const qs = request.nextUrl.searchParams.toString();
  return forwardGetJson(`/legal/corp-changes/company-type${qs ? `?${qs}` : ''}`);
}
