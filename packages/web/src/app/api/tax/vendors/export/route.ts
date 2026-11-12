import type { NextRequest } from 'next/server';
import { forwardGetFile } from '@/lib/forward';

/** 거래처 [엑셀 내려받기] — 지금 걸린 검색 조건으로 Fastify 가 만든 xlsx 를 그대로 넘긴다(`GET /tax/vendors/export`). */
export async function GET(request: NextRequest) {
  return forwardGetFile(`/tax/vendors/export${request.nextUrl.search}`);
}
