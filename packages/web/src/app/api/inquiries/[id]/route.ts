import { type NextRequest } from 'next/server';
import { forwardPublicGetJson } from '@/lib/forward';

/**
 * 글 머리 (p2 비밀번호 화면) — **인증 없음**.
 *
 * ★ 나가는 것은 목록 한 줄과 같은 넷이다 — 유형 · 가린 이름 · 날짜.
 *   본문·연락처·이메일은 `unlock` 을 통과해야 나온다.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardPublicGetJson(`/inquiries/${encodeURIComponent(id)}`);
}
