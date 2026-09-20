import type { NextRequest } from 'next/server';
import { forwardUpload } from '@/lib/forward';

/**
 * 사업자등록증 **판독만** — `POST /contracts/ocr-biz-reg`(Fastify)로 바이트를 넘긴다.
 *
 * ★ 신규 등록 폼(`/contracts/new`)처럼 **아직 입주사가 없을 때**만 쓴다. 회사가 있으면
 *   첨부 업로드(`/api/companies/:id/files`)가 저장과 판독을 한 번에 한다 — 그쪽이
 *   파일을 두 번 보내지 않는 경로다.
 *
 * ★ 여기로 보낸 파일은 **저장되지 않는다.** 화면이 그 파일을 붙들고 있다가 첫 저장
 *   직후에 첨부로 다시 올린다(`ContractForm` 의 `flushPendingDocs`).
 */
export async function POST(request: NextRequest) {
  return forwardUpload(request, '/contracts/ocr-biz-reg');
}
