import { forwardGetJson } from '@/lib/forward';

/**
 * 한 층의 호실 — ★ **「사용 안 함」인 호실도 내려온다.** 관리 화면에서 보이지 않으면
 * 다시 켤 방법이 없다(계약 폼의 목록은 `is_active = true` 만 받는다).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardGetJson(`/facility/floors/${encodeURIComponent(id)}/spaces`);
}
