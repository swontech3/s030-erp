import type { NextRequest } from 'next/server';
import { forwardUpload } from '@/lib/forward';
import { uploadQuery } from '../uploadQuery';

/**
 * 세무 자료 올리기 미리보기 — 저장하지 않는다(`POST /tax/uploads/preview?kind=`). 본문은 엑셀 바이트 그대로.
 * ★ 은행(1-5)은 `&account=&fileTp=` 도 그대로 넘긴다 — 판정은 Fastify 가 한다.
 */
export async function POST(request: NextRequest) {
  return forwardUpload(request, `/tax/uploads/preview?${uploadQuery(request)}`);
}
