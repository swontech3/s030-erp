import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward';

/** 호실 등록 — s030100010p3. ★ `room_no` 는 서버가 만든다(기계값). */
export async function POST(request: NextRequest) {
  return forwardJson(request, '/facility/spaces', 'POST');
}
