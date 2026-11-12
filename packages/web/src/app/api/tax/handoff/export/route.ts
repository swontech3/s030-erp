import type { NextRequest } from 'next/server';
import { forwardGetFile } from '@/lib/forward';

/** 세무사 전달 서류 [엑셀 내려받기] — Fastify 가 만든 시트 아홉 xlsx 를 그대로 넘긴다(`GET /tax/handoff/export`). */
export async function GET(request: NextRequest) {
  return forwardGetFile(`/tax/handoff/export${request.nextUrl.search}`);
}
