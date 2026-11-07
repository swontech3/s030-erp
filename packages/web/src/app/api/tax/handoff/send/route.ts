import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward';

/** 세무사 전달 서류 [메일 보내기] `{ month, tp, period, to[] }` (Fastify `POST /tax/handoff/send`). 메일은 서버가 보낸다. */
export async function POST(request: NextRequest) {
  return forwardJson(request, '/tax/handoff/send', 'POST');
}
