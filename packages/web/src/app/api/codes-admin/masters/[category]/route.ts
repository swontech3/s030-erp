import type { NextRequest } from 'next/server';
import { forwardDelete, forwardJson } from '@/lib/forward';

/** 분류 수정 — s030100030p1. ★ 분류 키는 바꿀 수 없다(소스에 박히는 값이다). */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  return forwardJson(request, `/codes-admin/masters/${encodeURIComponent(category)}`, 'PATCH');
}

/** 분류 삭제 — s030100030p4. ★ 파티션이 남아 있으면 API 가 409 로 막는다. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  return forwardDelete(request, `/codes-admin/masters/${encodeURIComponent(category)}`);
}
