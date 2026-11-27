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
 *
 * ★★ 2026-11-16 대표 지시 — **왼쪽 목록 4 : 오른쪽 상세 6**(지시 3.5 : 6.5 — 목록 칸이 들지 않아 4 : 6, corp-changes.module.css .split). 줄을 누르면 상세를 오른쪽 칸에
 *    그린다(`IncorporationDetailPane` — 상세의 내용 · 동작 · 정관은 그대로). 고른 건은 주소에 싣는다(`?sel=` · 정관 보기
 *    바로가기는 `&print=articles` — `legal-split.ts`). [새 건] 도 오른쪽 칸에 임시 모드로 연다. 저장 · 상태 바꾸기 뒤
 *    왼쪽 목록을 다시 받는다. 검색 상자는 위 이름표 없이(선택 칸은 「진행상태 전체」).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  incorporationDisplayName,
  parseIncorporationListQuery,
  type IncorporationListFilter,
  type IncorporationListItem,
  type IncorporationListResponse,
} from '@swonbiz/shared/domain/incorporation-detail';
import type { CodeOption } from '@swonbiz/shared/domain/corp-change-list';
import { Button, Icon, Table, TableHead, TableRow, tableCell } from '@/components/ds';
import { ListFrame, ListNote, ListScroll, ListSpacer } from '@/components/patterns/ListFrame';
import { OrgLookupDialog } from '@/components/org-lookup/OrgLookupDialog';
import { BBIYONG } from '@swonbiz/shared';
import type { LegalDetailPane } from './CorpChangeDetail';
import { IncorporationDetailPane, PaneEmpty } from './LegalDetailPanes';
import { readSel, selHref, selKey, writeSel, type LegalSel } from './legal-split';
import styles from './corp-changes.module.css';

const LIST_PATH = '/legal/incorporations';
/** 오른쪽 칸의 새 건에 입력이 있을 때 — 상세의 나가기 확인과 같은 문구 */
const LEAVE_MESSAGE = '저장하지 않은 내용이 사라집니다. 이 화면을 나갈까요?';

const EMPTY_FILTER: IncorporationListFilter = { status: null, includeCancelled: false };

/*
 * ★ 2026-11-25 법무 일관성(삐용 기준) — 목록 = 공통 표(Table). 칸 폭은 종전 .colsSplitIncorp 그대로
 *   (상호 · 진행상태 100 · 설립예정일 92 · 등록일 92). 칸 사이 8 · 좌우 12 도 종전 값(.splitGrid).
 */
const INCORP_COLS = 'minmax(0, 1fr) 100px 92px 92px';

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

export function IncorporationsView({
  pickOrg,
  canOpenDetail,
}: {
  pickOrg: boolean;
  /** 상세(s040100020)를 받은 사람만 오른쪽 칸을 그린다 — 화면코드 그대로(2026-11-16). */
  canOpenDetail: boolean;
}) {
  const params = useSearchParams();
  const [lookup, setLookup] = useState(false);
  /** 오른쪽 칸의 건 — 첫 값은 주소(`?sel=` · `&print=`)에서 온다. */
  const [sel, setSel] = useState<LegalSel | null>(() => readSel(new URLSearchParams(params.toString())));
  /** 오른쪽 칸의 새 건에 입력이 있다 — [새 건] 이 나가기 확인을 띄운다(링크인 줄은 상세의 확인이 잡는다). */
  const guard = useRef(false);

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
  const fetchList = useCallback(async (f: IncorporationListFilter, quiet = false) => {
    const mine = ++seq.current;
    // ★ 저장 · 상태 바꾸기 뒤 다시 받을 때(quiet)는 목록을 비우지 않는다 — 줄이 깜박이지 않게.
    if (!quiet) setLoad({ state: 'loading' });
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
  }, [filter, fetchList]);

  // ★ 조건 + 고른 건을 주소에 — 새로 고침 · 바로가기가 같은 화면을 연다.
  useEffect(() => {
    const qs = writeSel(listSearch(filter), sel).toString();
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

  const filtered = filter.status !== null || filter.includeCancelled;
  const items = load.state === 'ok' ? load.items : [];

  /** [새 건] — 임시 모드로 간다. 아무것도 쓰지 않는다. 회사 사용자는 단체를 싣지 않는다(서버가 세션 단체를 쓴다). */
  const start = () => {
    // ★ 오른쪽 칸의 새 건에 입력이 있으면 먼저 묻는다.
    if (guard.current && !window.confirm(LEAVE_MESSAGE)) return;
    if (pickOrg) setLookup(true);
    else setSel({ kind: 'new', draft: '' });
  };

  const listQs = listSearch(filter);

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
        <h1 className={styles.title}>법인설립</h1>
      </div>
      <div className={styles.split}>
        <div className={`${styles.splitLeft} ${styles.dense}`}>
          <ListFrame
            search={
              <>
                <select
                  className={`${styles.select} ${styles.searchSelect}`}
                  aria-label="진행상태"
                  value={filter.status ?? ''}
                  onChange={(e) =>
                    setFilter((f) => ({ ...f, status: (e.target.value || null) as IncorporationListFilter['status'] }))
                  }
                >
                  <option value="">진행상태 전체</option>
                  {statuses.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.name}
                    </option>
                  ))}
                </select>

                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={filter.includeCancelled}
                    onChange={(e) => setFilter((f) => ({ ...f, includeCancelled: e.target.checked }))}
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
              /* ★ 2026-11-25 일관성 — 등록([새 건]) = 보통 단추 · 표 위 왼쪽 */
              <Button variant="ghost" size="sm" iconLeft={<Icon name="plus" size={16} />} onClick={start}>
                새 건
              </Button>
            }
          >
            <ListScroll>
              <Table cols={INCORP_COLS}>
                <TableHead sticky className={styles.splitGrid}>
                  <span>상호</span>
                  <span>진행상태</span>
                  <span>설립예정일</span>
                  <span>등록일</span>
                </TableHead>
                {/* 빈 안내는 종전 모양(아이콘 · 두 줄) 그대로 — 표 폭 전체 */}
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
                        <span className={item.composedName ? tableCell.ellipsis : `${tableCell.ellipsis} ${styles.muted}`} title={name}>
                          <a
                            href={selHref(LIST_PATH, { kind: 'saved', id: item.id, print: null }, listQs)}
                            onClick={(e) => pick(e, item.id)}
                            aria-current={on ? 'true' : undefined}
                            className={styles.rowLink}
                          >
                            {name}
                          </a>
                        </span>
                        <span>
                          <span className={`${styles.badge} ${statusClass(item.status)}`}>
                            {statusNames[item.status] ?? item.status}
                          </span>
                        </span>
                        <span className={item.plannedDate ? styles.mono : styles.muted}>{item.plannedDate ?? '—'}</span>
                        <span className={styles.mono}>{item.createdOn}</span>
                      </TableRow>
                    );
                  })
                )}
              </Table>
            </ListScroll>
          </ListFrame>
        </div>

        {/* 오른쪽 상세 — 처음엔 「왼쪽에서 고르세요」. 받는 동안 공통 로딩바(IncorporationDetailPane). */}
        <div className={styles.splitRight} data-legal-detail={selKey(sel)}>
          {!canOpenDetail ? (
            <PaneEmpty lead="법인설립 상세를 볼 권한이 없습니다" />
          ) : sel === null ? (
            <PaneEmpty lead="왼쪽에서 고르세요" sub="법인설립 목록의 행을 누르면 여기에 상세가 나옵니다" />
          ) : (
            <IncorporationDetailPane key={selKey(sel)} sel={sel} pane={pane} />
          )}
        </div>
      </div>

      {lookup ? (
        <OrgLookupDialog
          title="법인설립 회사 선택"
          // ★ 2026-11-27 — 법무 서비스를 지금 구독 중인 회사만(삐용 org-list moduleCode)
          moduleCode={BBIYONG.LEGAL_MODULE_CODE}
          onClose={() => setLookup(false)}
          onPick={(pick) => {
            setLookup(false);
            // ★ 단체 ID · 단체코드만 싣는다(회사명은 싣지 않는다 — 복사 금지). 서버가 세션과 대조한다.
            const qs = new URLSearchParams({ orgId: String(pick.orgId), orgCode: pick.orgCode });
            setSel({ kind: 'new', draft: qs.toString() });
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
