/** @screen s040100020 법인설립 상세 · 010 법인설립 · 법무 서비스(s04) */

/**
 * 법인설립 상세 — 회사 · 자본·주식 · 설립 정보 · 사람 · 사업목적 · 상태 전이 · 삭제(10-4, 2026-10-11).
 * 서류 출력은 10-5 다.
 *
 * 라우트는 `/legal/incorporations/[id]` 하나이고, **새 건은 `/legal/incorporations/new`** 다(법인변경과 같다):
 *
 *   `/legal/incorporations/new?orgId=&orgCode=`   임시 모드 — 건이 아직 없다(회사 사용자는 조건 없이)
 *   `/legal/incorporations/{id}`                  저장된 건
 *
 * ★★ 임시 모드는 DB 의 건을 읽지 않는다 — 단체 · 상태 · 위치 선택지만 읽고, 입력은 화면이 들고 있다가
 *    첫 [저장] 에 한꺼번에 보낸다. 주소의 단체는 화면이 믿지 않는다 — Fastify 가 세션과 대조한다(403).
 * ★ 사이드바에 없고 목록에서 들어온다. 그래도 `requireScreen` 은 반드시 거친다.
 * ★ 남의 건은 없는 건과 같이 404 다(RLS 042).
 */
import { notFound } from 'next/navigation';
import type {
  IncorporationDetailResponse,
  IncorporationDraftResponse,
} from '@swonbiz/shared/domain/incorporation-detail';
import { callApi } from '@/lib/api';
import { readSid, requireScreen } from '@/lib/session';
import { IncorporationDetail } from '@/features/legal/IncorporationDetail';

/** 임시 모드를 가리키는 세그먼트. 실제 건 ID 는 UUID 라 겹치지 않는다. */
const NEW = 'new';

export default async function IncorporationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ orgId?: string; orgCode?: string }>;
}) {
  await requireScreen('s040100020', '/legal/incorporations/[id]');
  const { id } = await params;
  const sid = await readSid();

  if (id === NEW) {
    const { orgId, orgCode } = await searchParams;
    const qs = new URLSearchParams();
    if (orgId) qs.set('orgId', orgId);
    if (orgCode) qs.set('orgCode', orgCode);
    const res = await callApi<IncorporationDraftResponse>(`/legal/incorporations/draft?${qs.toString()}`, { erpSid: sid });
    // ★ 틀린 주소(단체 없음)와 남의 단체(403)는 열 것이 없다 — 「없는 화면」으로 본다.
    if (res.status === 400 || res.status === 403) notFound();
    if (!res.ok) throw new Error(`법인설립 작성 준비 실패(${res.status})`);
    return <IncorporationDetail key={`new:${qs.toString()}`} draft={res.body} saved={null} />;
  }

  const res = await callApi<IncorporationDetailResponse>(`/legal/incorporations/${encodeURIComponent(id)}`, { erpSid: sid });
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`법인설립 조회 실패(${res.status})`);

  // ★ 다른 건으로 옮겨 갈 때 입력 중이던 값이 남지 않게 다시 마운트한다.
  return <IncorporationDetail key={id} draft={res.body} saved={res.body} />;
}
