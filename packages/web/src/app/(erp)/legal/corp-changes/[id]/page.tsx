/** @screen s040200011 법인변경 상세 · 020 법인변경 · 법무 서비스(s04) */

/**
 * 법인변경 상세 — 기본정보 · 변경 내용 · 임원(3단계) · 상태 전이 · 삭제(4단계, 2026-10-10).
 * 서류 출력은 5단계다.
 *
 * 라우트는 `/legal/corp-changes/[id]` 하나이고, **새 건은 `/legal/corp-changes/new`** 다(계약 폼과 같다):
 *
 *   `/legal/corp-changes/new?changeType=&orgId=&orgCode=`   임시 모드 — 건이 아직 없다
 *   `/legal/corp-changes/{id}`                              저장된 건
 *
 * ★★ 임시 모드는 DB 의 건을 읽지 않는다 — 기본정보(회사 정보)만 읽어서 보여 주고, 변경 내용 ·
 *    임원은 화면이 들고 있다가 첫 [저장] 에 한꺼번에 보낸다(결정 2026-10-10). 주소의 단체는
 *    화면이 믿지 않는다 — Fastify 가 세션과 대조한다(회사 세션이 남의 단체면 403).
 * ★ 계약 목록 → 계약 폼과 같은 방식이다. 사이드바에 없고 목록에서 들어온다. 그래도
 *   `requireScreen` 은 반드시 거친다 — 메뉴에 없다는 것은 방어가 아니다.
 * ★ 운영사와 회사가 함께 쓴다. 무엇이 보이는지는 Fastify 쪽 RLS(037)가 가른다 — 남의 건은
 *   없는 건과 같이 404 다.
 * ★ 「입주사 화면에서 입력」 링크는 그 화면(s030200030)을 받은 사람에게만 보인다 — 회사 사용자가
 *   눌러 봐야 「접근 권한 없음」이다. 판정은 화면 목록으로 한다(역할로 하지 않는다).
 */
import { notFound } from 'next/navigation';
import type {
  CorpChangeDetailResponse,
  CorpChangeDraftResponse,
} from '@swonbiz/shared/domain/corp-change-detail';
import { callApi } from '@/lib/api';
import { getMe, readSid, requireScreen } from '@/lib/session';
import { CorpChangeDetail } from '@/features/legal/CorpChangeDetail';

/** 임시 모드를 가리키는 세그먼트. 실제 건 ID 는 UUID 라 겹치지 않는다. */
const NEW = 'new';

export default async function CorpChangeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ changeType?: string; orgId?: string; orgCode?: string }>;
}) {
  await requireScreen('s040200011', '/legal/corp-changes/[id]');
  const { id } = await params;
  const sid = await readSid();
  const me = await getMe();
  const canOpenTenantScreen = me?.screens.includes('s030200030') ?? false;
  const operator = me?.role === 'operator';

  if (id === NEW) {
    const { changeType, orgId, orgCode } = await searchParams;
    const qs = new URLSearchParams();
    if (changeType) qs.set('changeType', changeType);
    if (orgId) qs.set('orgId', orgId);
    if (orgCode) qs.set('orgCode', orgCode);
    const res = await callApi<CorpChangeDraftResponse>(`/legal/corp-changes/draft?${qs.toString()}`, { erpSid: sid });
    // ★ 틀린 주소(모르는 구분 · 단체 없음)와 남의 단체(403)는 열 것이 없다 — 「없는 화면」으로 본다.
    if (res.status === 400 || res.status === 403) notFound();
    if (!res.ok) throw new Error(`법인변경 작성 준비 실패(${res.status})`);
    return (
      <CorpChangeDetail
        key={`new:${qs.toString()}`}
        draft={res.body}
        saved={null}
        canOpenTenantScreen={canOpenTenantScreen}
        operator={operator}
      />
    );
  }

  const res = await callApi<CorpChangeDetailResponse>(`/legal/corp-changes/${encodeURIComponent(id)}`, { erpSid: sid });
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`법인변경 조회 실패(${res.status})`);

  return (
    <CorpChangeDetail
      // ★ 다른 건으로 옮겨 갈 때 입력 중이던 값이 남지 않게 다시 마운트한다.
      key={id}
      draft={res.body}
      saved={res.body}
      canOpenTenantScreen={canOpenTenantScreen}
      operator={operator}
    />
  );
}
