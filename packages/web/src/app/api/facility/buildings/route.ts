import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward';

/** 건물 등록 — s030100010p1. */
export async function POST(request: NextRequest) {
  return forwardJson(request, '/facility/buildings', 'POST');
}
