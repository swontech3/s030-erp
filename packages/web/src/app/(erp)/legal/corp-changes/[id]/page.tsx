/** @screen s040200011 법인변경 상세 · 020 법인변경 · 법무 서비스(s04) */

/**
 * 법인변경 상세 — ★ 2026-11-16 부터 목록 화면(s040200010)의 **오른쪽 칸**에 그린다(대표 지시: 왼쪽 목록 · 오른쪽 상세).
 *
 * 이 주소는 옛 바로가기 · 다른 화면의 링크를 위해 남긴다 — 목록 화면에서 그 건을 고른 채로 넘긴다:
 *
 *   `/legal/corp-changes/new?changeType=&orgId=&orgCode=&memberType=`  →  `/legal/corp-changes?sel=new&draft=…`
 *   `/legal/corp-changes/{id}`                                       →  `/legal/corp-changes?sel={id}`
 *
 * ★ 화면코드(s040200011)는 그대로다 — 오른쪽 칸은 이 코드를 받은 사람에게만 그린다(`CorpChangesView` 의 `canOpenDetail`).
 *   이 주소도 `requireScreen` 을 먼저 거친다.
 * ★ 상세의 내용 · 입력 · 저장 · 상태 바꾸기 · 서류 출력은 `CorpChangeDetail` 그대로다(자리만 옮겼다).
 */
import { redirect } from 'next/navigation';
import { requireScreen } from '@/lib/session';
import { NEW_SEL, selHref } from '@/features/legal/legal-split';

export default async function CorpChangeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireScreen('s040200011', '/legal/corp-changes/[id]');
  const { id } = await params;
  if (id === NEW_SEL) {
    const sp = await searchParams;
    const draft = new URLSearchParams();
    for (const key of ['changeType', 'orgId', 'orgCode', 'memberType']) {
      const v = sp[key];
      if (typeof v === 'string' && v !== '') draft.set(key, v);
    }
    redirect(selHref('/legal/corp-changes', { kind: 'new', draft: draft.toString() }));
  }
  redirect(selHref('/legal/corp-changes', { kind: 'saved', id, print: null }));
}
