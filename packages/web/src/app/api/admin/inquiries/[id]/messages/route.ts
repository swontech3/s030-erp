import { type NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward';

/**
 * 답변 등록 · 전화 답변 기록 (s030200080).
 *
 * ★ 본문의 `kind` 가 `text`(글답변) · `phone`(전화로 답변함) 둘 중 하나다. 판정은
 *   shared 의 `parseOperatorReply` 가 하고 서버가 부른다 — 이 홉은 규칙을 다시 쓰지 않는다.
 * ★ 담당자 이름은 **보내지 않는다.** 세션의 주체로 서버가 정한다 — 화면이 보내면
 *   아무 이름으로나 답변에 서명할 수 있다.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardJson(request, `/admin/inquiries/${encodeURIComponent(id)}/messages`, 'POST');
}
