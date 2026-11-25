import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward';

/** 삐용 주인 코드값 「다시 사용」(2026-11-18). */
export async function PATCH(request: NextRequest) {
  return forwardJson(request, '/codes-admin/bbiyong/values/reuse', 'PATCH');
}
