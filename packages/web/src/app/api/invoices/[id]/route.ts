import type { NextRequest } from 'next/server';
import { forwardGetJson } from '@/lib/forward';

/** 청구서 한 장 — 호실 줄과 수납 목록까지. [내역] 창이 부른다. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardGetJson(`/invoices/${encodeURIComponent(id)}`);
}
