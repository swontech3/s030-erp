import { type NextRequest } from 'next/server';
import { forwardDelete, forwardGetJson } from '@/lib/forward';

/**
 * 문의 한 건 (s030200080) — 원글 전체 + 스레드 조회, 그리고 **글 전체 삭제**.
 *
 * ★★★ 삭제는 되돌릴 수 없다(개인정보 파기 · `purgeInquiry`). 확인 창은 화면이 띄우고,
 *    권한 판정과 실제 파기는 Fastify 가 한다 — 이 홉은 넘기기만 한다.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardGetJson(`/admin/inquiries/${encodeURIComponent(id)}`);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardDelete(request, `/admin/inquiries/${encodeURIComponent(id)}`);
}
