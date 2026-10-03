import type { NextRequest } from 'next/server';
import { forwardGetJson, forwardUpload } from '@/lib/forward';

/**
 * 건물 첨부 — 임대차계약서 목록과 업로드 (s030100010p1 안의 칸).
 *
 * ★ 계약 서류(`/api/companies/[id]/files`)와 **같은 통로**다. `forwardUpload` 가 바이트를
 *   그대로 넘기고, 종류·형식·크기·권한은 전부 Fastify 가 본다 — **이 홉은 판정하지 않는다.**
 *
 * ★ `?purpose=` 가 없다. 건물에 붙는 서류는 한 가지뿐이라 서버가 종류를 안다.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardGetJson(`/facility/buildings/${encodeURIComponent(id)}/files`);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardUpload(request, `/facility/buildings/${encodeURIComponent(id)}/files`);
}
