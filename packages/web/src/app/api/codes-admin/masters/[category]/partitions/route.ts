import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward';

/** 파티션 등록 — s030100030p2. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ category: string }> },
) {
  const { category } = await params;
  return forwardJson(request, `/codes-admin/masters/${encodeURIComponent(category)}/partitions`, 'POST');
}
