import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward';

/** 주거래처 / 일반 `{ ids[], tp }` (Fastify `POST /tax/vendors/type`). */
export async function POST(request: NextRequest) {
  return forwardJson(request, '/tax/vendors/type', 'POST');
}
