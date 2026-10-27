import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward';

/** 거래처 지우기 `{ ids[] }` — 거래 0건만, 되돌릴 수 없다(Fastify `POST /tax/vendors/delete`). */
export async function POST(request: NextRequest) {
  return forwardJson(request, '/tax/vendors/delete', 'POST');
}
