import type { NextRequest } from 'next/server';
import { forwardGetJson } from '@/lib/forward';

/**
 * 사업목적 「추천」 탭의 고른 업종 — `GET /legal/biz-purposes/recommend/:bizCode` (Fastify) 로 넘긴다.
 * 업태 · 종목 · KSIC · 「검토됨」 인허가와 근거 조문 · 사업목적 문구. 없는 업종코드는 404. 읽기 전용이다.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ bizCode: string }> }) {
  const { bizCode } = await params;
  return forwardGetJson(`/legal/biz-purposes/recommend/${encodeURIComponent(bizCode)}`);
}
