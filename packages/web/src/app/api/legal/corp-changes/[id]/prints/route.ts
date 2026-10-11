import type { NextRequest } from 'next/server';
import { forwardGetJson, forwardJson } from '@/lib/forward';

/**
 * 법인변경 서류 출력 이력(040) — 판정은 Fastify(`legal/corpChangePrint.ts`).
 *
 *   GET  — 그 건의 이력(새것이 위). 회사는 자기 건, 운영사는 전체(RLS)
 *   POST — [인쇄] 를 누를 때 한 줄 `{ formId, sheet, applyDate?, writeDate? }`. 성공 201.
 *          ★ 화면은 결과를 기다리지 않는다 — 기록이 실패해도 인쇄는 한다(결정 2026-10-11)
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardGetJson(`/legal/corp-changes/${encodeURIComponent(id)}/prints`);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardJson(request, `/legal/corp-changes/${encodeURIComponent(id)}/prints`, 'POST');
}
