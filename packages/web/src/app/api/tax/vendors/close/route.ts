import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward';

/** 거래처 [거래종료] `{ ids[] }` — 종료로 바꾼다(지우지 않음, Fastify `POST /tax/vendors/close`). */
export async function POST(request: NextRequest) {
  return forwardJson(request, '/tax/vendors/close', 'POST');
}
