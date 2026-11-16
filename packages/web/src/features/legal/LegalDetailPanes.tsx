'use client';

/**
 * 법인변경 · 법인설립 — 목록 화면 **오른쪽 칸**의 상세(2026-11-16 대표 지시: 왼쪽 목록 · 오른쪽 상세).
 *
 * ★ 옛 상세 화면(`[id]/page.tsx`)이 서버에서 읽던 것을 이 칸이 같은 Fastify 주소로 읽는다(웹 API 가 그대로 넘긴다):
 *     저장된 건  GET /api/legal/corp-changes/{id}      · GET /api/legal/incorporations/{id}
 *     새 건      GET /api/legal/corp-changes/draft?…  · GET /api/legal/incorporations/draft?…
 *   그린 뒤의 내용 · 입력 · 저장 · 상태 바꾸기 · 서류 출력 · 정관은 `CorpChangeDetail` · `IncorporationDetail` 그대로다.
 * ★ 받는 동안 칸 맨 위에 공통 로딩바(`LoadingBar`). 처음(고른 건 없음)은 「왼쪽에서 고르세요」.
 * ★ 없는 건 · 남의 건은 Fastify 가 404 로 준다(RLS) — 「찾을 수 없습니다」. 틀린 새 건 조건 · 남의 단체(400 · 403)는
 *   옛 화면의 「없는 화면」 대신 「열 수 없습니다」.
 */
import { useEffect, useState, type ReactNode } from 'react';
import type { CorpChangeDetailResponse, CorpChangeDraftResponse } from '@swonbiz/shared/domain/corp-change-detail';
import { presetMemberTypeFor } from '@swonbiz/shared/domain/corp-change-detail';
import type { IncorporationDetailResponse, IncorporationDraftResponse } from '@swonbiz/shared/domain/incorporation-detail';
import type { OrgInfo } from '@swonbiz/shared/domain/org-lookup';
import { INCORP_PRINT_ARTICLES } from '@swonbiz/shared/domain/legal-articles-file';
import { Icon } from '@/components/ds';
import { LoadingBar } from '@/components/patterns/LoadingBar';
import { CorpChangeDetail, type LegalDetailPane } from './CorpChangeDetail';
import { IncorporationDetail } from './IncorporationDetail';
import type { LegalSel } from './legal-split';
import styles from './corp-changes.module.css';

type Got<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ok'; body: T };

async function getJson<T>(url: string, what: string): Promise<Got<T>> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    const body = (await res.json().catch(() => ({}))) as T & { message?: string };
    if (res.ok) return { state: 'ok', body };
    if (res.status === 404) return { state: 'error', message: `이 ${what} 건을 찾을 수 없습니다 — 다른 사용자가 지웠을 수 있습니다` };
    if (res.status === 400 || res.status === 403) return { state: 'error', message: `이 ${what} 건을 열 수 없습니다` };
    return { state: 'error', message: body.message ?? `${what} 건을 불러오지 못했습니다(${res.status})` };
  } catch {
    return { state: 'error', message: '서버에 연결할 수 없습니다' };
  }
}

/** 고른 건 없음 · 권한 없음 · 못 읽음 — 칸 가운데 안내 */
export function PaneEmpty({ lead, sub }: { lead: string; sub?: string }) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon}>
        <Icon name="scale" size={28} />
      </span>
      <p className={styles.emptyLead}>{lead}</p>
      {sub ? <p className={styles.emptySub}>{sub}</p> : null}
    </div>
  );
}

function paneBody<T>(got: Got<T>, render: (body: T) => ReactNode): ReactNode {
  if (got.state === 'loading') return <LoadingBar />;
  if (got.state === 'error') return <PaneEmpty lead={got.message} />;
  return render(got.body);
}

// ── 법인변경 ────────────────────────────────────────────────
type CorpGot = { draft: CorpChangeDraftResponse; saved: CorpChangeDetailResponse | null; memberType: string | null };

export function CorpChangeDetailPane({
  sel,
  canOpenTenantScreen,
  pane,
}: {
  sel: LegalSel;
  canOpenTenantScreen: boolean;
  pane: LegalDetailPane;
}) {
  const [got, setGot] = useState<Got<CorpGot>>({ state: 'loading' });
  const id = sel.kind === 'saved' ? sel.id : null;
  const draftQs = sel.kind === 'new' ? sel.draft : null;

  useEffect(() => {
    let live = true;
    setGot({ state: 'loading' });
    void (async () => {
      let next: Got<CorpGot>;
      if (id !== null) {
        const r = await getJson<CorpChangeDetailResponse>(`/api/legal/corp-changes/${encodeURIComponent(id)}`, '법인변경');
        next = r.state === 'ok' ? { state: 'ok', body: { draft: r.body, saved: r.body, memberType: null } } : r;
      } else {
        // ★ 회사유형(memberType)은 Fastify 에 보내지 않는다 — 옛 화면처럼 화면에서만 쓴다.
        const q = new URLSearchParams(draftQs ?? '');
        const memberType = q.get('memberType');
        q.delete('memberType');
        const r = await getJson<CorpChangeDraftResponse>(`/api/legal/corp-changes/draft?${q.toString()}`, '법인변경');
        next = r.state === 'ok' ? { state: 'ok', body: { draft: r.body, saved: null, memberType } } : r;
      }
      if (live) setGot(next);
    })();
    return () => {
      live = false;
    };
  }, [id, draftQs]);

  return paneBody(got, (b) => (
    <CorpChangeDetail
      // ★ 다른 건으로 옮겨 갈 때 입력 중이던 값이 남지 않게 다시 마운트한다(옛 화면과 같다).
      key={id ?? `new:${draftQs ?? ''}`}
      draft={b.draft}
      saved={b.saved}
      presetMemberType={b.saved ? undefined : presetMemberTypeFor(b.draft, b.memberType)}
      canOpenTenantScreen={canOpenTenantScreen}
      pane={pane}
    />
  ));
}

// ── 법인설립 ────────────────────────────────────────────────
type IncorpGot = {
  draft: IncorporationDraftResponse;
  saved: IncorporationDetailResponse | null;
  picked: Pick<OrgInfo, 'orgName' | 'repName' | 'telNo'> | null;
};

/**
 * 새 건에서 고른 회사 — 옛 화면처럼 공용 회사 조회 단건(운영사 전용)으로 읽는다(회사명은 주소에 싣지 않는다).
 * ★ 못 읽으면 null — 미리 넣지 않을 뿐 작성은 막지 않는다.
 */
async function pickedOrg(orgId: number): Promise<IncorpGot['picked']> {
  try {
    const res = await fetch(`/api/org-lookup/one?orgId=${encodeURIComponent(String(orgId))}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { org?: OrgInfo | null };
    return body.org ?? null;
  } catch {
    return null;
  }
}

export function IncorporationDetailPane({ sel, pane }: { sel: LegalSel; pane: LegalDetailPane }) {
  const [got, setGot] = useState<Got<IncorpGot>>({ state: 'loading' });
  const id = sel.kind === 'saved' ? sel.id : null;
  const draftQs = sel.kind === 'new' ? sel.draft : null;
  const print = sel.kind === 'saved' ? sel.print : null;

  useEffect(() => {
    let live = true;
    setGot({ state: 'loading' });
    void (async () => {
      let next: Got<IncorpGot>;
      if (id !== null) {
        const r = await getJson<IncorporationDetailResponse>(`/api/legal/incorporations/${encodeURIComponent(id)}`, '법인설립');
        next = r.state === 'ok' ? { state: 'ok', body: { draft: r.body, saved: r.body, picked: null } } : r;
      } else {
        const q = new URLSearchParams(draftQs ?? '');
        const r = await getJson<IncorporationDraftResponse>(`/api/legal/incorporations/draft?${q.toString()}`, '법인설립');
        next =
          r.state === 'ok'
            ? { state: 'ok', body: { draft: r.body, saved: null, picked: q.get('orgId') ? await pickedOrg(r.body.orgId) : null } }
            : r;
      }
      if (live) setGot(next);
    })();
    return () => {
      live = false;
    };
  }, [id, draftQs]);

  return paneBody(got, (b) => (
    <IncorporationDetail
      key={id ?? `new:${draftQs ?? ''}`}
      draft={b.draft}
      saved={b.saved}
      picked={b.picked}
      openArticlesPrint={print === INCORP_PRINT_ARTICLES}
      pane={pane}
    />
  ));
}
