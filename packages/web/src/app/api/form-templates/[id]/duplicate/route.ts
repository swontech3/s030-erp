import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward';

type P = { params: Promise<{ id: string }> };

/** 양식 복사 — 이름 뒤에 「(복사본)」. ★ 본문은 `{}` 다(출처 검사가 JSON 을 요구한다). */
export async function POST(request: NextRequest, { params }: P) {
  const { id } = await params;
  return forwardJson(request, `/form-templates/${encodeURIComponent(id)}/duplicate`, 'POST');
}
