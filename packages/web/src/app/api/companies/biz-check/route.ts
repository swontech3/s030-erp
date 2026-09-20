import type { NextRequest } from 'next/server';
import { forwardGetJson } from '@/lib/forward';

/**
 * 사업자번호 확인 — `GET /companies/biz-check`(Fastify)로 넘긴다.
 *
 * ★ 판정은 저쪽에 있다. 이 홉은 **쿼리만 추려서** 넘긴다 — 임의의 쿼리스트링을
 *   그대로 이어 붙이면 우리가 모르는 파라미터가 Fastify 로 흘러간다.
 *
 * ★ 이 경로가 죽어도 계약 등록은 그대로 된다. 확인은 저장 경로가 아니다.
 */
export async function GET(request: NextRequest) {
  const from = request.nextUrl.searchParams;
  const query = new URLSearchParams({ bizNumber: from.get('bizNumber') ?? '' });
  const name = from.get('companyName');
  if (name) query.set('companyName', name);
  const self = from.get('selfCompanyId');
  if (self) query.set('selfCompanyId', self);

  return forwardGetJson(`/companies/biz-check?${query.toString()}`);
}
