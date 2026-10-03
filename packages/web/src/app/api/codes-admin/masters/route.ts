import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward';

/** 분류 등록 — s030100030p1. ★ 공통(000) 파티션이 함께 생긴다. */
export async function POST(request: NextRequest) {
  return forwardJson(request, '/codes-admin/masters', 'POST');
}
