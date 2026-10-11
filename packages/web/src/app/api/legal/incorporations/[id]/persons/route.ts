import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward';

/** 사람 추가 — 서류작성중(P)만. ★ 주민번호 평문은 지나가기만 한다(기록하지 않는다). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardJson(request, `/legal/incorporations/${encodeURIComponent(id)}/persons`, 'POST');
}
