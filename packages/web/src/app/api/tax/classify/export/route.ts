import type { NextRequest } from 'next/server';
import { forwardGetFile } from '@/lib/forward';

/** 거래 분류 [엑셀 내려받기] — 화면과 같은 주소로 Fastify 가 만든 xlsx 를 그대로 넘긴다(`GET /tax/classify/export`). */
export async function GET(request: NextRequest) {
  return forwardGetFile(`/tax/classify/export${request.nextUrl.search}`);
}
