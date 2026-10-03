import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward';

/** 회의실 등록 — s030100010p4. */
export async function POST(request: NextRequest) {
  return forwardJson(request, '/facility/facilities', 'POST');
}
