import type { NextRequest } from 'next/server';
import { forwardDelete } from '@/lib/forward';

/**
 * 건물 첨부 삭제. ★ 성공은 **204**다 — 본문이 없다(계약 서류와 같다).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const { id, fileId } = await params;
  return forwardDelete(
    request,
    `/facility/buildings/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}`,
  );
}
