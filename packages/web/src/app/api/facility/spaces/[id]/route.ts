import type { NextRequest } from 'next/server';
import { forwardDelete, forwardJson } from '@/lib/forward';

/** 호실 수정 — s030100010p3. 「사용 안 함」도 이 경로로 바꾼다(`isActive`). */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardJson(request, `/facility/spaces/${encodeURIComponent(id)}`, 'PATCH');
}

/**
 * 호실 삭제 — s030100010p5.
 *
 * ★★★ 계약 이력이 **한 번이라도** 있으면 API 가 409 로 막는다. 지난 계약서가 그 호실을
 *    가리키기 때문이다. 화면은 그 문구를 그대로 보여 준다.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardDelete(request, `/facility/spaces/${encodeURIComponent(id)}`);
}
