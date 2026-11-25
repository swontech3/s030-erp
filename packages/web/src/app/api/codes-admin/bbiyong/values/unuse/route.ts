import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward';

/** 삐용 주인 코드값 「사용 안 함」(2026-11-18) — 지우지 않는다. */
export async function PATCH(request: NextRequest) {
  return forwardJson(request, '/codes-admin/bbiyong/values/unuse', 'PATCH');
}
