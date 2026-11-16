import type { NextRequest } from 'next/server';
import { forwardGetFile } from '@/lib/forward';

/** 청구 · 수납 [엑셀 내려받기] — 지금 걸린 검색 조건으로 Fastify 가 만든 xlsx 를 그대로 넘긴다(`GET /billing/invoices/export`). */
export async function GET(request: NextRequest) {
  return forwardGetFile(`/billing/invoices/export${request.nextUrl.search}`);
}
