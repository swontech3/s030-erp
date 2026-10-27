import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward';

/** 지우기 전 확인 `{ ids[] }` — 지우기와 같은 계산, 지우지 않는다(Fastify `POST /tax/uploads/delete-check`). */
export async function POST(request: NextRequest) {
  return forwardJson(request, '/tax/uploads/delete-check', 'POST');
}
