import type { NextRequest } from 'next/server';
import { forwardGetJson, forwardUpload } from '@/lib/forward';

/**
 * 법무 회사별 정관 파일(결정 2026-11-07) — 읽기 `{ file, canUpload, completedIncorporationId }` · 올리기 · 바꾸기.
 * ★ 이 홉은 판정하지 않는다. 남의 단체 · 권한 없음은 Fastify 가 403 을 낸다(`routes/legalArticlesFile.ts`).
 * 올리기 본문은 파일 바이트 그대로, 원본 이름은 `X-File-Name` 헤더(계약 첨부와 같다).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  return forwardGetJson(`/legal/orgs/${encodeURIComponent(orgId)}/articles-file`);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  return forwardUpload(request, `/legal/orgs/${encodeURIComponent(orgId)}/articles-file`);
}
