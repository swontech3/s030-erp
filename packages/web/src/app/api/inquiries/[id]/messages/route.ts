import { type NextRequest } from 'next/server';
import { forwardPublicJson } from '@/lib/forward';

/**
 * 추가 질문 등록 (p2) — **인증 없음. 단, 열람 토큰이 있어야 한다.**
 *
 * ★★★ 토큰 헤더를 넘기지 않으면 서버가 401 을 낸다. 토큰 없이 쓸 수 있으면 누구나
 *    남의 글에 글을 붙인다(03-thread.md §4).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardPublicJson(request, `/inquiries/${encodeURIComponent(id)}/messages`, 'POST', ['x-inquiry-token']);
}
