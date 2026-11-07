import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { forwardGetJson } from '@/lib/forward';

/**
 * 내 청구서 (s030200090) — `GET /my/invoices?from=YYYY-MM&to=YYYY-MM` · 앱 1단계 7-나.
 *
 * ★ **입주사만 · 자기 회사만** 은 Fastify 가 정한다(운영사 403 · RLS). 이 홉은 주소만 조립한다.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  // 모양만 본다. 기간 길이 · 순서는 Fastify 가 400 으로 말해 준다.
  if (!/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to)) {
    return NextResponse.json({ message: '기간은 YYYY-MM 이어야 합니다' }, { status: 400 });
  }
  return forwardGetJson(`/my/invoices?${new URLSearchParams({ from, to }).toString()}`);
}
