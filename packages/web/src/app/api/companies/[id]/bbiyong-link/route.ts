import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward';

/**
 * 삐용 연동 다시 시도 — `POST /companies/:id/bbiyong-link`(3-2).
 *
 * ★★ **계약 폼(`s030200040`)만 이 경로를 부른다.** 삐용 회사 생성은 계약 확정의
 *    뒷부분이고, 확정을 누르는 자리가 계약 폼이다. 입주사 목록은 「미연동」을
 *    보여 주기만 하고 계약으로 링크한다(`CLAUDE.md` 한 업무 한 화면).
 *
 * ★ 본문이 없다. `forwardJson` 은 JSON 본문을 요구하므로 화면이 `{}` 를 보낸다 —
 *   빈 본문을 보내면 400 이 된다(로그아웃에서 한 번 겪은 자리다).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardJson(request, `/companies/${encodeURIComponent(id)}/bbiyong-link`, 'POST');
}
