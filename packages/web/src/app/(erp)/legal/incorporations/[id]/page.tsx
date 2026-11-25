/** @screen s040100020 법인설립 상세 · 010 법인설립 · 법무 서비스(s04) */

/**
 * 법인설립 상세 — ★ 2026-11-16 부터 목록 화면(s040100010)의 **오른쪽 칸**에 그린다(대표 지시: 왼쪽 목록 · 오른쪽 상세).
 *
 * 이 주소는 옛 바로가기 · 다른 화면의 링크를 위해 남긴다 — 목록 화면에서 그 건을 고른 채로 넘긴다:
 *
 *   `/legal/incorporations/new?orgId=&orgCode=`       →  `/legal/incorporations?sel=new&draft=…`
 *   `/legal/incorporations/{id}`                      →  `/legal/incorporations?sel={id}`
 *   `/legal/incorporations/{id}?print=articles`       →  `/legal/incorporations?sel={id}&print=articles` (정관 보기 바로가기)
 *
 * ★ 화면코드(s040100020)는 그대로다 — 오른쪽 칸은 이 코드를 받은 사람에게만 그린다(`IncorporationsView` 의 `canOpenDetail`).
 *   이 주소도 `requireScreen` 을 먼저 거친다.
 * ★ 상세의 내용 · 입력 · 저장 · 상태 바꾸기 · 서류 출력 · 정관은 `IncorporationDetail` 그대로다(자리만 옮겼다).
 */
import { redirect } from 'next/navigation';
import { requireScreen } from '@/lib/session';
import { NEW_SEL, selHref } from '@/features/legal/legal-split';

export default async function IncorporationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireScreen('s040100020', '/legal/incorporations/[id]');
  const { id } = await params;
  const sp = await searchParams;
  if (id === NEW_SEL) {
    const draft = new URLSearchParams();
    for (const key of ['orgId', 'orgCode']) {
      const v = sp[key];
      if (typeof v === 'string' && v !== '') draft.set(key, v);
    }
    redirect(selHref('/legal/incorporations', { kind: 'new', draft: draft.toString() }));
  }
  const print = typeof sp.print === 'string' && sp.print !== '' ? sp.print : null;
  redirect(selHref('/legal/incorporations', { kind: 'saved', id, print }));
}
