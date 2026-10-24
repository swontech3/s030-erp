import type { NextRequest } from 'next/server';
import { forwardDelete, forwardGetJson, forwardJson } from '@/lib/forward';

type P = { params: Promise<{ id: string }> };

/** 양식 하나 — 정의까지. version 1 은 API 가 2 로 옮겨서 준다. */
export async function GET(_request: NextRequest, { params }: P) {
  const { id } = await params;
  return forwardGetJson(`/form-templates/${encodeURIComponent(id)}`);
}

/** 양식 수정 — 이름 · 종류 · 설명 · 정의를 한 번에 저장한다. */
export async function PATCH(request: NextRequest, { params }: P) {
  const { id } = await params;
  return forwardJson(request, `/form-templates/${encodeURIComponent(id)}`, 'PATCH');
}

/** 양식 삭제. ★ 등기 설정이 쓰는 양식이면 409 — FK 가 없어 API 가 세어서 막는다. */
export async function DELETE(request: NextRequest, { params }: P) {
  const { id } = await params;
  return forwardDelete(request, `/form-templates/${encodeURIComponent(id)}`);
}
