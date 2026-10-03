import type { NextRequest } from 'next/server';
import { forwardGetJson, forwardJson } from '@/lib/forward';

type P = { params: Promise<{ category: string; useTp: string }> };

const path = (category: string, useTp: string) =>
  `/codes-admin/${encodeURIComponent(category)}/${encodeURIComponent(useTp)}/lines`;

/**
 * 한 파티션의 코드값 — **쓰임까지 함께** 받는다.
 *
 * ★★ 행마다 「쓰는 중인가」를 따로 묻지 않는다. 서버가 한 번에 세어 보내고 화면은
 *    그것으로 버튼을 잠근다 — 두 곳이 따로 판정하면 어긋난다.
 */
export async function GET(_request: NextRequest, { params }: P) {
  const { category, useTp } = await params;
  return forwardGetJson(path(category, useTp));
}

/** 코드값 등록 — s030100030p3. */
export async function POST(request: NextRequest, { params }: P) {
  const { category, useTp } = await params;
  return forwardJson(request, path(category, useTp), 'POST');
}
