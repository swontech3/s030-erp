import type { NextRequest } from 'next/server';
import { forwardGetJson } from '@/lib/forward';

/**
 * 한 분류의 **코드값 전부** — 사용타입을 가리지 않는다.
 *
 * ★ 왼쪽에서 분류를 고르면 오른쪽이 이것을 받는다(2026-10-03 개편). 사용타입은 표의
 *   첫 칸이자 검색 조건이라, 사용타입별로 나눠 받지 않는다.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  return forwardGetJson(`/codes-admin/masters/${encodeURIComponent(category)}/lines`);
}
