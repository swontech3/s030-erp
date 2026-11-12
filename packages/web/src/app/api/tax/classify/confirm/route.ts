import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward';

/** 항목 지정 [확정] · [선택한 줄에 붙이기] `{ rows: [{ kind, id, itemCode, note? }] }` (Fastify `POST /tax/classify/confirm`). */
export async function POST(request: NextRequest) {
  return forwardJson(request, '/tax/classify/confirm', 'POST');
}
