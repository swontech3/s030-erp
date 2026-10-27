import type { NextRequest } from 'next/server';
import { forwardUpload } from '@/lib/forward';

/** 세무 자료 올리기 미리보기 — 저장하지 않는다(`POST /tax/uploads/preview?kind=`). 본문은 엑셀 바이트 그대로. */
export async function POST(request: NextRequest) {
  const kind = request.nextUrl.searchParams.get('kind') ?? '';
  return forwardUpload(request, `/tax/uploads/preview?kind=${encodeURIComponent(kind)}`);
}
