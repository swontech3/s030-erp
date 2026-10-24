'use client';

/**
 * s040100010 법인설립 목록 — 운영사와 회사가 **함께** 쓴다(10-4, 2026-10-11).
 *
 * ★ 시안이 없다. 법인변경 목록(`CorpChangesView`)과 같은 틀 · 같은 CSS 다. 다른 것:
 *   · 조건은 진행상태 · 취소 포함 둘뿐이다(10-3 확인 4 — 작업일자 · 구분 · 입주 여부 없음)
 *   · 열은 상호 · 진행상태 · 설립예정일 · 등록일. 상호는 합친 상호(순수 상호 + 주식회사 + 위치) →
 *     단체코드 → 「단체 {ID}」(shared `incorporationDisplayName`)
 *
 * ★★ 무엇이 보이는지는 서버(RLS 042)가 정한다 — 이 화면은 거르지 않는다.
 * ★ 상태 선택지와 이름은 목록 응답에 같이 온다(코드표). 여기에 상태 이름을 적지 않는다.
 * ★ 조건은 주소에 적는다(`?status=&includeCancelled=1`) — API 와 같은 이름이다.
 *
 * ★★ 한 업무는 한 화면에서 — 상태 전이 · 서류 출력은 상세(s040100020)가 맡는다. 목록의 처리는
 *    [새 건] 하나다. [새 건] 은 DB 에 쓰지 않고 상세의 **임시 모드**로 보내기만 한다(법인변경과 같다):
 *    · 운영사 — 공용 회사 조회 팝업(`components/org-lookup`)으로 단체를 고른다(삐용에 먼저 등록한 단체)
 *    · 회사 사용자 — 자기 단체로 바로 시작한다. 고를 구분이 없어 대화상자 없이 바로 간다
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  incorporationDisplayName,
  parseIncorporationListQuery,
  type IncorporationListFilter,
  type IncorporationListItem,
  type IncorporationListResponse,
} from '@swonbiz/shared/domain/incorporation-detail';
import type { CodeOption } from '@swonbiz/shared/domain/corp-change-list';
import { Icon } from '@/components/ds';
import { OrgLookupDialog } from '@/components/org-lookup/OrgLookupDialog';
import styles from './corp-changes.module.css';

const EMPTY_FILTER: IncorporationListFilter = { status: null, includeCancelled: false };

/** 조건 → 주소 · API 조건. 빈 조건은 싣지 않는다. */
function listSearch(f: IncorporationListFilter): URLSearchParams {
  const qs = new URLSearchParams();
  if (f.status) qs.set('status', f.status);
  if (f.includeCancelled) qs.set('includeCancelled', '1');
  return qs;
}

type Load =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ok'; items: IncorporationListItem[] };

export function IncorporationsView({ pickOrg }: { pickOrg: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [lookup, setLookup] = useState(false);

  /** ★ 첫 조건은 주소에서 온다. 틀린 조건이면 기본(취소 제외 전체)으로 연다. */
  const [filter, setFilter] = useState<IncorporationListFilter>(() => {
    const parsed = parseIncorporationListQuery(Object.fromEntries(params.entries()));
    return parsed.ok ? parsed.value : EMPTY_FILTER;
  });
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [statuses, setStatuses] = useState<CodeOption[]>([]);
  const [statusNames, setStatusNames] = useState<Record<string, string>>({});

  /** ★ 늦게 온 응답이 새 조건을 덮지 않게 한다. */
  const seq = useRef(0);
  const fetchList = useCallback(async (f: IncorporationListFilter) => {
    const mine = ++seq.current;
    setLoad({ state: 'loading' });
    try {
      const res = await fetch(`/api/legal/incorporations?${listSearch(f).toString()}`);
      const body = (await res.json()) as IncorporationListResponse & { message?: string };
      if (mine !== seq.current) return;
      if (!res.ok) {
        setLoad({ state: 'error', message: body.message ?? '법인설립 목록을 불러오지 못했습니다' });
        return;
      }
      setStatuses(body.statuses);
      setStatusNames(body.statusNames);
      setLoad({ state: 'ok', items: body.items });
    } catch {
      if (mine === seq.current) setLoad({ state: 'error', message: '서버에 연결할 수 없습니다' });
    }
  }, []);

  useEffect(() => {
    void fetchList(filter);
    const qs = listSearch(filter).toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
    if (next !== window.location.pathname + window.location.search) window.history.replaceState(null, '', next);
  }, [filter, fetchList]);

  const filtered = filter.status !== null || filter.includeCancelled;
  const items = load.state === 'ok' ? load.items : [];

  /** [새 건] — 임시 모드로 간다. 아무것도 쓰지 않는다. 회사 사용자는 단체를 싣지 않는다(서버가 세션 단체를 쓴다). */
  const start = () => {
    if (pickOrg) setLookup(true);
    else router.push('/legal/incorporations/new');
  };

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>법인설립</h1>
          <p className={styles.sub}>
            {load.state === 'loading'
              ? '불러오는 중입니다'
              : load.state === 'error'
              ? '목록을 불러오지 못했습니다'
              : `${items.length}건${filter.includeCancelled ? ' · 취소 포함' : ''}`}
          </p>
        </div>
        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={start}>
          <Icon name="plus" size={16} />
          새 건
        </button>
      </div>

      <div className={styles.panel}>
        <div className={styles.toolbar}>
          <label className={styles.field}>
            <span className={styles.label}>진행상태</span>
            <select
              className={styles.select}
              value={filter.status ?? ''}
              onChange={(e) =>
                setFilter((f) => ({ ...f, status: (e.target.value || null) as IncorporationListFilter['status'] }))
              }
            >
              <option value="">전체</option>
              {statuses.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.check}>
            <input
              type="checkbox"
              checked={filter.includeCancelled}
              onChange={(e) => setFilter((f) => ({ ...f, includeCancelled: e.target.checked }))}
            />
            취소 포함
          </label>

          <span className={styles.spacer} />
          <button type="button" className={styles.btn} disabled={!filtered} onClick={() => setFilter(EMPTY_FILTER)}>
            <Icon name="rotate-ccw" size={16} />
            조건 초기화
          </button>
        </div>

        <div className={`${styles.tHead} ${styles.cols4}`}>
          <span>상호</span>
          <span>진행상태</span>
          <span>설립예정일</span>
          <span>등록일</span>
        </div>

        {load.state === 'loading' ? (
          <Empty lead="법인설립 건을 불러오는 중입니다" />
        ) : load.state === 'error' ? (
          <Empty lead={load.message} />
        ) : items.length === 0 ? (
          filtered ? (
            <Empty lead="조건에 맞는 법인설립 건이 없습니다" sub="조건을 바꾸거나 초기화해 보세요" />
          ) : (
            <Empty lead="등록된 법인설립 건이 없습니다" />
          )
        ) : (
          items.map((item) => {
            const name = incorporationDisplayName(item.composedName ?? '', item);
            return (
              <Link
                key={item.id}
                href={`/legal/incorporations/${encodeURIComponent(item.id)}`}
                className={`${styles.tRow} ${styles.cols4}${item.status === 'X' ? ` ${styles.tRowCanceled}` : ''}`}
              >
                <span className={item.composedName ? styles.ellipsis : `${styles.ellipsis} ${styles.muted}`} title={name}>
                  {name}
                </span>
                <span>
                  <span className={`${styles.badge} ${statusClass(item.status)}`}>
                    {statusNames[item.status] ?? item.status}
                  </span>
                </span>
                <span className={item.plannedDate ? styles.mono : styles.muted}>{item.plannedDate ?? '—'}</span>
                <span className={styles.mono}>{item.createdOn}</span>
              </Link>
            );
          })
        )}
      </div>

      {lookup ? (
        <OrgLookupDialog
          title="법인설립 회사 선택"
          onClose={() => setLookup(false)}
          onPick={(pick) => {
            setLookup(false);
            // ★ 단체 ID · 단체코드만 싣는다(회사명은 싣지 않는다 — 복사 금지). 서버가 세션과 대조한다.
            const qs = new URLSearchParams({ orgId: String(pick.orgId), orgCode: pick.orgCode });
            router.push(`/legal/incorporations/new?${qs.toString()}`);
          }}
        />
      ) : null}
    </div>
  );
}

function statusClass(status: string): string {
  if (status === 'X') return styles.statusCanceled ?? '';
  if (status === 'C') return styles.statusDone ?? '';
  return styles.status ?? '';
}

function Empty({ lead, sub }: { lead: string; sub?: string }) {
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
