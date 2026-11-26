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
 * ★★ 한 업무는 한 화면에서 — 처리 버튼(상태 전이 · 서류 출력)은 이 목록에 두지 않는다.
 *    상세(s040200011)가 맡는다. 목록에 있는 처리는 [새 건] 하나다(3단계, 2026-10-10).
 *
 * ★★ 2026-11-16 대표 지시 — **왼쪽 목록 4 : 오른쪽 상세 6**(지시 3.5 : 6.5 — 목록 칸이 들지 않아 4 : 6, corp-changes.module.css .split). 줄을 누르면 상세를 오른쪽 칸에
 *    그린다(`CorpChangeDetailPane` — 상세의 내용 · 동작은 그대로). 고른 건은 주소에 싣는다(`?sel=` — `legal-split.ts`).
 *    [새 건] 도 오른쪽 칸에 임시 모드로 연다. 저장 · 상태 바꾸기 뒤 왼쪽 목록을 다시 받는다.
 *    목록 칸은 회사 · 변경구분 · 진행상태 — 「대표자」 칸은 좁은 칸에 들지 않아, 「등록일」은 대표 지시로 뺐다(둘 다 상세에 있다).
 *    검색 상자는 위 이름표 없이(선택 칸은 「… 전체」, 날짜 기간만 짧은 이름).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
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
import { Button, Icon, Table, TableHead, TableRow, tableCell } from '@/components/ds';
import { ListFrame, ListNote, ListScroll, ListSpacer } from '@/components/patterns/ListFrame';
import { NewCorpChangeDialog } from './NewCorpChangeDialog';
import type { LegalDetailPane } from './CorpChangeDetail';
import { CorpChangeDetailPane, PaneEmpty } from './LegalDetailPanes';
import { readSel, selHref, selKey, writeSel, type LegalSel } from './legal-split';
import styles from './corp-changes.module.css';

const LIST_PATH = '/legal/corp-changes';
/** 오른쪽 칸의 새 건에 입력이 있을 때 — 상세의 나가기 확인과 같은 문구 */
const LEAVE_MESSAGE = '저장하지 않은 내용이 사라집니다. 이 화면을 나갈까요?';

const EMPTY_FILTER: CorpChangeListFilter = {
  from: null,
  to: null,
  changeType: null,
  status: null,
  tenancy: null,
  includeCancelled: false,
};

const TENANCY_LABEL: Record<TenancyFilter, string> = { tenant: '입주사', nontenant: '비입주사' };

/*
 * ★ 2026-11-25 법무 일관성(삐용 기준) — 목록 = 공통 표(Table). 칸 폭은 종전 .colsSplit 그대로
 *   (회사 · 변경구분 80 · 진행상태 100). 칸 사이 8 · 좌우 12 도 종전 값(.splitGrid).
 */
const CORP_COLS = 'minmax(0, 1fr) 80px 100px';

type Load =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ok'; items: CorpChangeListItem[] };

export function CorpChangesView({
  pickOrg,
  canOpenDetail,
  canOpenTenantScreen,
}: {
  pickOrg: boolean;
  /** 상세(s040200011)를 받은 사람만 오른쪽 칸을 그린다 — 화면코드 그대로(2026-11-16). */
  canOpenDetail: boolean;
  canOpenTenantScreen: boolean;
}) {
  const params = useSearchParams();
  const [creating, setCreating] = useState(false);
  /** 오른쪽 칸의 건 — 첫 값은 주소(`?sel=`)에서 온다. */
  const [sel, setSel] = useState<LegalSel | null>(() => readSel(new URLSearchParams(params.toString())));
  /** 오른쪽 칸의 새 건에 입력이 있다 — [새 건] 이 나가기 확인을 띄운다(링크인 줄은 상세의 확인이 잡는다). */
  const guard = useRef(false);

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
  const fetchList = useCallback(async (f: CorpChangeListFilter, quiet = false) => {
    const mine = ++seq.current;
    // ★ 저장 · 상태 바꾸기 뒤 다시 받을 때(quiet)는 목록을 비우지 않는다 — 줄이 깜박이지 않게.
    if (!quiet) setLoad({ state: 'loading' });
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
  }, [filter, fetchList]);

  // ★ 조건 + 고른 건을 주소에 — 새로 고침 · 바로가기가 같은 화면을 연다.
  useEffect(() => {
    const qs = writeSel(corpChangeListSearch(filter), sel).toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
    if (next !== window.location.pathname + window.location.search) window.history.replaceState(null, '', next);
  }, [filter, sel]);

  const filterRef = useRef(filter);
  filterRef.current = filter;
  /** 오른쪽 칸이 부른다 — 상세의 동작은 그대로, 「어디로 가는가」만 이 화면이 정한다. */
  const pane = useMemo<LegalDetailPane>(
    () => ({
      onOpen: (id) => {
        setSel({ kind: 'saved', id, print: null });
        void fetchList(filterRef.current, true);
      },
      onChanged: () => void fetchList(filterRef.current, true),
      onRemoved: () => {
        setSel(null);
        void fetchList(filterRef.current, true);
      },
      onGuard: (has) => {
        guard.current = has;
      },
    }),
    [fetchList],
  );

  /** [새 건] — 오른쪽 칸의 새 건에 입력이 있으면 먼저 묻는다. */
  const startNew = () => {
    if (guard.current && !window.confirm(LEAVE_MESSAGE)) return;
    setCreating(true);
  };

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

  const listQs = corpChangeListSearch(filter);

  /** 줄 누름 — 주소를 옮기지 않고 오른쪽 칸에 그린다. 새 탭(가운데 단추 · Ctrl/⌘)은 그 주소를 그대로 연다. */
  const pick = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    setSel({ kind: 'saved', id, print: null });
  };

  return (
    /*
      ★ 2026-11-16 — 왼쪽 목록 4 : 오른쪽 상세 6(청구 화면과 같은 틀 · 3.5 에서는 목록 칸이 들지 않았다).
        왼쪽: 검색(한 줄 · 위 이름표 없음 · 오른쪽 끝 [초기화] 「n건」) → 버튼 줄([새 건]) → 목록. 오른쪽: 고른 건의 상세(받는 동안 공통 로딩바).
    */
    <div className={styles.splitPage}>
      <div className={styles.head} data-page-title>
        <h1 className={styles.title}>법인변경</h1>
      </div>
      <div className={styles.split}>
        <div className={`${styles.splitLeft} ${styles.dense}`}>
          <ListFrame
            search={
              <>
                <span className={styles.searchRange}>
                  <span className={styles.searchRangeName}>작업일자</span>
                  <input
                    type="date"
                    className={`${styles.input} ${styles.searchDate}`}
                    aria-label="작업일자 시작"
                    value={filter.from ?? ''}
                    onChange={(e) => setDay('from', e.target.value)}
                  />
                  ~
                  <input
                    type="date"
                    className={`${styles.input} ${styles.searchDate}`}
                    aria-label="작업일자 끝"
                    value={filter.to ?? ''}
                    onChange={(e) => setDay('to', e.target.value)}
                  />
                </span>

                <select
                  className={`${styles.select} ${styles.searchSelect}`}
                  aria-label="변경구분"
                  value={filter.changeType ?? ''}
                  onChange={(e) => set('changeType', (e.target.value || null) as CorpChangeType | null)}
                >
                  <option value="">변경구분 전체</option>
                  {changeTypes.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.name}
                    </option>
                  ))}
                </select>

                <select
                  className={`${styles.select} ${styles.searchSelect}`}
                  aria-label="진행상태"
                  value={filter.status ?? ''}
                  onChange={(e) => set('status', (e.target.value || null) as CorpChangeStatus | null)}
                >
                  <option value="">진행상태 전체</option>
                  {statuses.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.name}
                    </option>
                  ))}
                </select>

                <select
                  className={`${styles.select} ${styles.searchSelect}`}
                  aria-label="입주 여부"
                  value={filter.tenancy ?? ''}
                  onChange={(e) => set('tenancy', (e.target.value || null) as TenancyFilter | null)}
                >
                  <option value="">입주 여부 전체</option>
                  {(Object.keys(TENANCY_LABEL) as TenancyFilter[]).map((t) => (
                    <option key={t} value={t}>
                      {TENANCY_LABEL[t]}
                    </option>
                  ))}
                </select>

                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={filter.includeCancelled}
                    onChange={(e) => set('includeCancelled', e.target.checked)}
                  />
                  취소 포함
                </label>

                {/* ★ 2026-11-25 일관성 — 고르면 바로 걸린다(그대로). 오른쪽 끝 [초기화](보통 단추) 다음 「n건」 */}
                <ListSpacer />
                <Button
                  variant="ghost"
                  size="sm"
                  iconLeft={<Icon name="rotate-ccw" size={16} />}
                  disabled={!filtered}
                  onClick={() => setFilter(EMPTY_FILTER)}
                >
                  초기화
                </Button>
                <ListNote>{load.state === 'ok' ? `${items.length}건` : ''}</ListNote>
              </>
            }
            actions={
              /*
                ★ 2026-11-25 일관성 — 등록([새 건]) = 보통 단추 · 표 위 왼쪽.
                ★ 구분 선택지가 아직 없으면(목록을 못 받음) 누를 수 없다 — 고를 것이 없다.
              */
              <Button
                variant="ghost"
                size="sm"
                iconLeft={<Icon name="plus" size={16} />}
                disabled={changeTypes.length === 0}
                onClick={startNew}
              >
                새 건
              </Button>
            }
          >
            <ListScroll>
              <Table cols={CORP_COLS}>
                <TableHead sticky className={styles.splitGrid}>
                  <span>회사</span>
                  <span>변경구분</span>
                  <span>진행상태</span>
                </TableHead>
                {/* 빈 안내는 종전 모양(아이콘 · 두 줄) 그대로 — 표 폭 전체 */}
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
                  items.map((item) => {
                    const on = sel?.kind === 'saved' && sel.id === item.id;
                    return (
                      /*
                       * ★ 줄은 공통 TableRow, 링크는 첫 칸의 `<a>` 가 줄 전체를 덮는다(.rowLink::after —
                       *   입주관리 계약 목록과 같은 수법). 누르는 자리 · 새 탭 · 가운데 단추는 종전과 같다.
                       */
                      <TableRow
                        key={item.id}
                        selected={on}
                        muted={item.status === 'X'}
                        className={`${styles.splitGrid} ${styles.linkRow}${on ? '' : ` ${styles.linkRowHover}`}`}
                      >
                        <span className={styles.company}>
                          <span className={tableCell.ellipsis} title={corpChangeCompanyLabel(item)}>
                            <a
                              href={selHref(LIST_PATH, { kind: 'saved', id: item.id, print: null }, listQs)}
                              onClick={(e) => pick(e, item.id)}
                              aria-current={on ? 'true' : undefined}
                              className={styles.rowLink}
                            >
                              {corpChangeCompanyLabel(item)}
                            </a>
                          </span>
                          <span className={`${styles.badge} ${item.isTenant ? styles.tenant : styles.nonTenant}`}>
                            {item.isTenant ? '입주사' : '비입주사'}
                          </span>
                        </span>
                        <span className={tableCell.ellipsis}>{typeNames[item.changeType] ?? item.changeType}</span>
                        <span>
                          <span className={`${styles.badge} ${statusClass(item.status)}`}>
                            {statusNames[item.status] ?? item.status}
                          </span>
                        </span>
                      </TableRow>
                    );
                  })
                )}
              </Table>
            </ListScroll>
          </ListFrame>
        </div>

        {/* 오른쪽 상세 — 처음엔 「왼쪽에서 고르세요」. 받는 동안 공통 로딩바(CorpChangeDetailPane). */}
        <div className={styles.splitRight} data-legal-detail={selKey(sel)}>
          {!canOpenDetail ? (
            <PaneEmpty lead="법인변경 상세를 볼 권한이 없습니다" />
          ) : sel === null ? (
            <PaneEmpty lead="왼쪽에서 고르세요" sub="법인변경 목록의 행을 누르면 여기에 상세가 나옵니다" />
          ) : (
            <CorpChangeDetailPane key={selKey(sel)} sel={sel} canOpenTenantScreen={canOpenTenantScreen} pane={pane} />
          )}
        </div>
      </div>

      {creating ? (
        <NewCorpChangeDialog
          changeTypes={changeTypes}
          pickOrg={pickOrg}
          onClose={() => setCreating(false)}
          onStart={(draft) => {
            setCreating(false);
            setSel({ kind: 'new', draft });
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
