import { type NextRequest } from 'next/server';
import { forwardPublicJson } from '@/lib/forward';

/**
 * 비밀번호 확인 → 열람 토큰 (p2 첫 단계) — **인증 없음**.
 *
 * ★★ 판정은 서버가 한다. 맞으면 원글·스레드와 30분짜리 토큰이 함께 온다.
 * ★ 시도 제한(10분 5회)이 클라이언트 IP 로 묶이므로 `forwardPublicJson` 이 IP 를
 *   붙여 넘긴다 — 그러지 않으면 모두가 같은 카운터를 쓴다.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardPublicJson(request, `/inquiries/${encodeURIComponent(id)}/unlock`, 'POST');
}
