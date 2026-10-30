import type { NextRequest } from 'next/server';
import { forwardGetFile } from '@/lib/forward';

/** 자료 올리기 [양식 내려받기] — Fastify 가 만든 표준 양식 xlsx 를 그대로 넘긴다(`GET /tax/uploads/template?kind=CASH`, 1-4). */
export async function GET(request: NextRequest) {
  return forwardGetFile(`/tax/uploads/template${request.nextUrl.search}`);
}
