import type { NextRequest } from 'next/server';
import { forwardGetJson } from '@/lib/forward';

/**
 * 입주사 청구 탭 — 그 입주사의 청구서 전부와 정산 원장. s0300200030 오른쪽 「청구」 탭이 부른다.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardGetJson(`/companies/${encodeURIComponent(id)}/billing`);
}
