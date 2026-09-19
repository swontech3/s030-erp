import type { NextRequest } from 'next/server';
import { forwardDelete } from '@/lib/forward';

/**
 * 첨부 서류 삭제 (CONT-17).
 *
 * ★ 성공은 **204**다 — 본문이 없다.
 * ★ 없는 파일과 남의 회사 파일을 구분해 주지 않는다. 둘 다 404 다.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const { id, fileId } = await params;
  return forwardDelete(
    request,
    `/companies/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}`,
  );
}
