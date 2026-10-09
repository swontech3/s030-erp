'use client';

/**
 * s040200010 법인변경 목록 — 운영사와 회사가 **함께** 쓴다(2단계, 2026-10-10).
 *
 * ★ 시안이 없다. 레거시 목록(`corp-changes/page.tsx`)의 기능 — 작업일자 · 구분 · 입주 여부 ·
 *   취소 포함 필터와 회사 · 진행상태 · 구분 · 대표자 · 등록일 열 — 을 ERP 목록 틀(월별 청구
 *   s030200070)에 얹었다. 레거시의 「연락처」 열과 「법인명」 검색은 뺐다(결정 2026-10-10 —
 *   비입주사 회사명이 삐용에 있어 DB 가 다 갖고 있지 않다).
 *
 * =============================================================================
 * ★★ 무엇이 보이는지는 서버(RLS)가 정한다 — 이 화면은 거르지 않는다
 * =============================================================================
 * 운영사는 전체 건, 회사는 자기 건만 받는다(037 `erp_org_scope`). 화면이 역할을 보고 줄을
 * 감추는 일은 없다 — 화면에서 감추는 것은 방어가 아니다.
 *
 * ★ 구분 · 상태 선택지와 이름은 **목록 응답에 같이 온다**(코드표에서 읽고 shared 의
 *   `CORP_CHANGE_TYPES` · `CORP_CHANGE_STATUSES` 로 거른 것). 여기에 코드를 적지 않는다.
 * ★ 조건은 주소에 적는다(`?from=&to=&changeType=&status=&tenancy=&includeCancelled=`) —
 *   API 와 같은 이름이다. 방식은 s030200070 과 같다(`history.replaceState`).
 *
 * ★★ 한 업무는 한 화면에서 — 처리 버튼(새 건 · 상태 전이 · 서류 출력)은 이 목록에 두지 않는다.
 *    상세(s040200011, 3단계)가 맡는다. 지금은 줄을 눌러도 열리는 것이 없다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  corpChangeCompanyLabel,
  corpChangeListSearch,
  parseCorpChangeListQuery,
  type CodeOption,
  type CorpChangeListFilter,
  type CorpChangeListItem,
  type CorpChangeListResponse,
  type TenancyFilter,
} from '@swonbiz/shared/domain/corp-change-list';
import type { CorpChangeStatus, CorpChangeType } from '@swonbiz/shared/domain/corp-change';
import { Icon } from '@/components/ds';
import styles from './corp-changes.module.css';

const EMPTY_FILTER: CorpChangeListFilter = {
  from: null,
  to: null,
  changeType: null,
  status: null,
  tenancy: null,
  includeCancelled: false,
};

const TENANCY_LABEL: Record<TenancyFilter, string> = { tenant: '입주사', nontenant: '비입주사' };

type Load =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ok'; items: CorpChangeListItem[] };

export function CorpChangesView() {
  const params = useSearchParams();

  /** ★ 첫 조건은 주소에서 온다. 틀린 조건이면 기본(취소 제외 전체)으로 연다. */
  const [filter, setFilter] = useState<CorpChangeListFilter>(() => {
    const parsed = parseCorpChangeListQuery(Object.fromEntries(params.entries()));
    return parsed.ok ? parsed.filter : EMPTY_FILTER;
  });
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [changeTypes, setChangeTypes] = useState<CodeOption[]>([]);
  const [statuses, setStatuses] = useState<CodeOption[]>([]);
  const [statusNames, setStatusNames] = useState<Record<string, string>>({});

  const typeNames = useMemo(() => Object.fromEntries(changeTypes.map((t) => [t.code, t.name])), [changeTypes]);

  /** ★ 늦게 온 응답이 새 조건을 덮지 않게 한다. */
  const seq = useRef(0);
  const fetchList = useCallback(async (f: CorpChangeListFilter) => {
    const mine = ++seq.current;
    setLoad({ state: 'loading' });
    try {
      const res = await fetch(`/api/legal/corp-changes?${corpChangeListSearch(f).toString()}`);
      const body = (await res.json()) as CorpChangeListResponse & { message?: string };
      if (mine !== seq.current) return;
      if (!res.ok) {
        setLoad({ state: 'error', message: body.message ?? '법인변경 목록을 불러오지 못했습니다' });
        return;
      }
      setChangeTypes(body.changeTypes);
      setStatuses(body.statuses);
      setStatusNames(body.statusNames);
      setLoad({ state: 'ok', items: body.items });
    } catch {
      if (mine === seq.current) setLoad({ state: 'error', message: '서버에 연결할 수 없습니다' });
    }
  }, []);

  useEffect(() => {
    void fetchList(filter);
    const qs = corpChangeListSearch(filter).toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
    if (next !== window.location.pathname + window.location.search) window.history.replaceState(null, '', next);
  }, [filter, fetchList]);

  const set = <K extends keyof CorpChangeListFilter>(key: K, value: CorpChangeListFilter[K]) =>
    setFilter((f) => ({ ...f, [key]: value }));

  /** 날짜는 앞뒤가 뒤집히면 서버가 400 을 낸다 — 고르는 쪽에서 막는다. */
  const setDay = (key: 'from' | 'to', value: string) => {
    const day = value === '' ? null : value;
    setFilter((f) => {
      const next = { ...f, [key]: day };
      if (next.from && next.to && next.from > next.to) {
        if (key === 'from') next.to = day;
        else next.from = day;
      }
      return next;
    });
  };

  const filtered =
    filter.from !== null ||
    filter.to !== null ||
    filter.changeType !== null ||
    filter.status !== null ||
    filter.tenancy !== null ||
    filter.includeCancelled;

  const items = load.state === 'ok' ? load.items : [];

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>법인변경</h1>
          <p className={styles.sub}>
            {load.state === 'loading'
              ? '불러오는 중입니다'
              : load.state === 'error'
              ? '목록을 불러오지 못했습니다'
              : `${items.length}건${filter.includeCancelled ? ' · 취소 포함' : ''}`}
          </p>
        </div>
      </div>

      <div className={styles.panel}>
        <div className={styles.toolbar}>
          <div className={styles.field}>
            <span className={styles.label}>작업일자</span>
            <span className={styles.range}>
              <input
                type="date"
                className={styles.input}
                aria-label="작업일자 시작"
                value={filter.from ?? ''}
                onChange={(e) => setDay('from', e.target.value)}
              />
              ~
              <input
                type="date"
                className={styles.input}
                aria-label="작업일자 끝"
                value={filter.to ?? ''}
                onChange={(e) => setDay('to', e.target.value)}
              />
            </span>
          </div>

          <label className={styles.field}>
            <span className={styles.label}>변경구분</span>
            <select
              className={styles.select}
              value={filter.changeType ?? ''}
              onChange={(e) => set('changeType', (e.target.value || null) as CorpChangeType | null)}
            >
              <option value="">전체</option>
              {changeTypes.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span className={styles.label}>진행상태</span>
            <select
              className={styles.select}
              value={filter.status ?? ''}
              onChange={(e) => set('status', (e.target.value || null) as CorpChangeStatus | null)}
            >
              <option value="">전체</option>
              {statuses.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span className={styles.label}>입주 여부</span>
            <select
              className={styles.select}
              value={filter.tenancy ?? ''}
              onChange={(e) => set('tenancy', (e.target.value || null) as TenancyFilter | null)}
            >
              <option value="">전체</option>
              {(Object.keys(TENANCY_LABEL) as TenancyFilter[]).map((t) => (
                <option key={t} value={t}>
                  {TENANCY_LABEL[t]}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.check}>
            <input
              type="checkbox"
              checked={filter.includeCancelled}
              onChange={(e) => set('includeCancelled', e.target.checked)}
            />
            취소 포함
          </label>

          <span className={styles.spacer} />
          <button type="button" className={styles.btn} disabled={!filtered} onClick={() => setFilter(EMPTY_FILTER)}>
            <Icon name="rotate-ccw" size={16} />
            조건 초기화
          </button>
        </div>

        <div className={styles.tHead}>
          <span>회사</span>
          <span>변경구분</span>
          <span>진행상태</span>
          <span>대표자</span>
          <span>등록일</span>
        </div>

        {load.state === 'loading' ? (
          <Empty lead="법인변경 건을 불러오는 중입니다" />
        ) : load.state === 'error' ? (
          <Empty lead={load.message} />
        ) : items.length === 0 ? (
          filtered ? (
            <Empty lead="조건에 맞는 법인변경 건이 없습니다" sub="조건을 바꾸거나 초기화해 보세요" />
          ) : (
            <Empty lead="등록된 법인변경 건이 없습니다" />
          )
        ) : (
          items.map((item) => (
            <div key={item.id} className={`${styles.tRow}${item.status === 'X' ? ` ${styles.tRowCanceled}` : ''}`}>
              <span className={styles.company}>
                <span className={styles.ellipsis} title={corpChangeCompanyLabel(item)}>
                  {corpChangeCompanyLabel(item)}
                </span>
                <span className={`${styles.badge} ${item.isTenant ? styles.tenant : styles.nonTenant}`}>
                  {item.isTenant ? '입주사' : '비입주사'}
                </span>
              </span>
              <span className={styles.ellipsis}>{typeNames[item.changeType] ?? item.changeType}</span>
              <span>
                <span className={`${styles.badge} ${statusClass(item.status)}`}>
                  {statusNames[item.status] ?? item.status}
                </span>
              </span>
              <span className={item.ceoName ? styles.ellipsis : styles.muted}>{item.ceoName ?? '—'}</span>
              <span className={styles.mono}>{item.createdOn}</span>
            </div>
          ))
        )}
      </div>
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
