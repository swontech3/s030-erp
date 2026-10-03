import { type NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward';

/**
 * 답변 수정 (s030200080) — 「수정됨」.
 *
 * ★ 고칠 수 있는 것은 글답변(`text`)의 본문뿐이다. 전화 기록·고객 추가 질문은 서버가
 *   409 로 거절한다.
 * ★ **DELETE 가 없다.** 메시지 단위 삭제 기능을 두지 않는다(03-thread.md §5) —
 *   삭제는 글 전체 하나뿐이고 그것은 `../../route.ts` 다.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  const { id, messageId } = await params;
  return forwardJson(
    request,
    `/admin/inquiries/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}`,
    'PATCH',
  );
}
