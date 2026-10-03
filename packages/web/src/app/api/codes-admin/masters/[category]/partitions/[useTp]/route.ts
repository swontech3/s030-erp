import type { NextRequest } from 'next/server';
import { forwardDelete, forwardJson } from '@/lib/forward';

type P = { params: Promise<{ category: string; useTp: string }> };

const path = (category: string, useTp: string) =>
  `/codes-admin/masters/${encodeURIComponent(category)}/partitions/${encodeURIComponent(useTp)}`;

/** 파티션 수정 — s030100030p2. ★ 파티션 번호(use_tp)는 바꿀 수 없다. */
export async function PATCH(request: NextRequest, { params }: P) {
  const { category, useTp } = await params;
  return forwardJson(request, path(category, useTp), 'PATCH');
}

/**
 * 파티션 삭제 — s030100030p4.
 *
 * ★ 코드가 남아 있으면 409. 공통(000)은 아예 지울 수 없다 — 분류가 코드를 담을 자리를 잃는다.
 */
export async function DELETE(request: NextRequest, { params }: P) {
  const { category, useTp } = await params;
  return forwardDelete(request, path(category, useTp));
}
