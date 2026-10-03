import type { NextRequest } from 'next/server';
import { forwardDelete, forwardJson } from '@/lib/forward';

type P = { params: Promise<{ id: string }> };

/**
 * 코드값 수정 — s030100030p3.
 *
 * ★★★ **이름은 언제나 바뀐다.** 코드값·사용여부는 쓰이는 중이면 API 가 409 로 막는다 —
 *    업무 자료가 코드 문자열로만 연결돼 있어서다(`domain/code-usage.ts`).
 */
export async function PATCH(request: NextRequest, { params }: P) {
  const { id } = await params;
  return forwardJson(request, `/codes-admin/lines/${encodeURIComponent(id)}`, 'PATCH');
}

/** 코드값 삭제 — s030100030p4. ★ 쓰이는 중이면 409 에 몇 건인지와 대안이 담긴다. */
export async function DELETE(request: NextRequest, { params }: P) {
  const { id } = await params;
  return forwardDelete(request, `/codes-admin/lines/${encodeURIComponent(id)}`);
}
