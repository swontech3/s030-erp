import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward';

/** 거래처 합치기 `{ keepId, ids[] }` — 되돌릴 수 없다(Fastify `POST /tax/vendors/merge`). */
export async function POST(request: NextRequest) {
  return forwardJson(request, '/tax/vendors/merge', 'POST');
}
