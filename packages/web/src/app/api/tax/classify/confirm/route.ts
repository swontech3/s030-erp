import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward';

/** 거래 분류 [확정] · [선택한 줄에 붙이기] `{ rows: [{ id, itemCode }] }` (Fastify `POST /tax/classify/confirm`). */
export async function POST(request: NextRequest) {
  return forwardJson(request, '/tax/classify/confirm', 'POST');
}
