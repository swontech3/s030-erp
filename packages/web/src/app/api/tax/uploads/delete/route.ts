import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward';

/** 올린 파일 지우기 `{ ids[] }` — 그 파일로 들어온 줄도 함께 지워진다(Fastify `POST /tax/uploads/delete`). */
export async function POST(request: NextRequest) {
  return forwardJson(request, '/tax/uploads/delete', 'POST');
}
