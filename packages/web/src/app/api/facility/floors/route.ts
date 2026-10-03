import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward';

/** 층 등록 — s030100010p2. */
export async function POST(request: NextRequest) {
  return forwardJson(request, '/facility/floors', 'POST');
}
