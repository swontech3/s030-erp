'use client';

/**
 * s0300200080 문의상담관리 — 좌측 목록 · 우측 상세. **화면은 전환되지 않는다.**
 *
 * 모양: `s0300200030`(입주사·계약)의 2단 레이아웃 · 검색 · 칩 · 카드 · 토스트.
 * 명세: design/handoff/inquiry-board/03-thread.md §5
 *
 * =============================================================================
 * ★★★ 기본 필터는 「접수」 — **답해야 할 것부터 보인다**
 * =============================================================================
 * 이 화면을 여는 이유가 「답을 기다리는 문의」이기 때문이다. 상태는 저장 컬럼이 아니라
 * **마지막 글**로 정해지므로(03-thread §2), 답변을 달면 목록에서 빠지고 고객이 추가
 * 질문을 남기면 **다시 들어온다.** 큐처럼 줄어들고 늘어나는 것이 이 화면의 뜻이다.
 *
 * ★ 그래서 답변을 등록하면 **왼쪽 줄이 사라진다.** 오른쪽은 그대로 열어 둔다 —
 *   방금 쓴 답변이 화면에서 같이 사라지면 저장됐는지 알 수 없다. 토스트로 상태가
 *   바뀐 것을 알린다.
 *
 * =============================================================================
 * ★★ 걸러 놓은 상태는 **주소에 있다**(`?st=&type=&q=&id=`)
 * =============================================================================
 * [이전]·새로고침·링크 공유가 전부 여기에 걸린다. 방식은 s0300200030·s0300200070 과
 * 같다(`history.replaceState` — 기록을 쌓지 않는다).
 *
 * ★ 검색은 **서버가** 한다(이름·연락처). 연락처는 목록 응답에 담기지 않으므로
 *   클라이언트가 걸러 낼 수 없다 — 담지 않는 것이 그 화면의 규칙이라 서버가 찾는다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Icon, type IconName } from '@/components/ds';
import { codeName, dotDate, type InquiryCodes } from '@/features/inquiry/inquiry-model';
import type { ThreadMessage } from '@/features/inquiry/inquiry-model';
import { DeleteInquiryDialog } from './DeleteInquiryDialog';
import { InquiryDetail } from './InquiryDetail';
import styles from './inquiry-admin.module.css';
import {
  lastLine,
  type AdminInquiry,
  type AdminListItem,
  type AdminListResponse,
} from './inquiry-admin-model';

/** 검색어를 한 자 칠 때마다 서버를 부르지 않는다. 멈추면 한 번 부른다. */
const SEARCH_DEBOUNCE_MS = 250;

interface Props {
  codes: InquiryCodes;
}

interface Detail {
  inquiry: AdminInquiry;
  messages: ThreadMessage[];
}

export function InquiryAdminView({ codes }: Props) {
  const params = useSearchParams();

  /** ★ 첫 값은 주소에서 온다. 없으면 「접수」다 — 답해야 할 것부터. */
  const [status, setStatus] = useState<string | null>(() => {
    const v = params.get('st');
    return v === 'all' ? null : v || 'R';
  });
  const [type, setType] = useState<string | null>(() => params.get('type') || null);
  const [keyword, setKeyword] = useState(() => params.get('q') ?? '');
  const [query, setQuery] = useState(keyword);
  const [selectedId, setSelectedId] = useState<string | null>(() => params.get('id') || null);

  const [items, setItems] = useState<AdminListItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [listError, setListError] = useState<string | null>(null);

  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  // 검색어가 멈추면 한 번만 넘긴다.
  useEffect(() => {
    const id = setTimeout(() => setQuery(keyword.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [keyword]);

  /**
   * 목록.
   *
   * ★ 늦게 온 응답이 새 조건을 덮지 않게 한다(`seq`). 칩을 빨리 누르면 앞 요청이 뒤에
   *   도착할 수 있고, 그러면 칩은 「답변완료」인데 목록은 「접수」가 된다.
   * ★ `append` 는 [더 보기] 다 — 앞 쪽을 지우지 않고 뒤에 붙인다.
   */
  const seq = useRef(0);
  const loadList = useCallback(
    async (at: number, append: boolean) => {
      const mine = ++seq.current;
      setListError(null);
      const qs = new URLSearchParams();
      if (status) qs.set('status', status);
      if (type) qs.set('type', type);
      if (query) qs.set('q', query);
      if (at > 1) qs.set('page', String(at));
      try {
        const res = await fetch(`/api/admin/inquiries?${qs.toString()}`);
        const body = (await res.json()) as AdminListResponse & { message?: string };
        if (!res.ok) throw new Error(body.message ?? '문의를 불러오지 못했습니다');
        if (mine !== seq.current) return;
        setTotal(body.total);
        setPageSize(body.pageSize);
        setPage(body.page);
        setItems((prev) => (append && prev ? [...prev, ...body.items] : body.items));
      } catch (err) {
        if (mine !== seq.current) return;
        setItems([]);
        setListError((err as Error).message);
      }
    },
    [status, type, query],
  );

  // 조건이 바뀌면 처음부터 다시 받는다.
  useEffect(() => {
    setItems(null);
    void loadList(1, false);
  }, [loadList]);

  /** 고른 글의 상세. ★ 누를 때가 아니라 **고른 값이 바뀔 때** 부른다 — 주소에서 되살아난
      선택도 같은 길로 채워진다(s0300200030 과 같은 이유). */
  const detailSeq = useRef(0);
  const loadDetail = useCallback(async (id: string) => {
    const mine = ++detailSeq.current;
    setDetailError(null);
    try {
      const res = await fetch(`/api/admin/inquiries/${encodeURIComponent(id)}`);
      const body = (await res.json()) as Detail & { message?: string };
      if (!res.ok) throw new Error(body.message ?? '문의를 불러오지 못했습니다');
      if (mine !== detailSeq.current) return;
      setDetail(body);
    } catch (err) {
      if (mine !== detailSeq.current) return;
      setDetail(null);
      setDetailError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    setDetail(null);
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  /**
   * ★★★ **검색 조건이 바뀌면 고른 문의를 놓는다** — 오른쪽이 닫힌다.
   *
   * 오른쪽을 비우는 일은 위 effect 에 있는데 그것은 `selectedId` 가 바뀔 때만 돈다.
   * 조건(검색어·상태·유형)을 바꾸면 목록만 다시 받고 선택은 그대로라, **검색 결과에
   * 없는 문의가 오른쪽에 열린 채로 남았다.** 왼쪽에 눌린 줄이 없는데 오른쪽에는 글이
   * 있는 화면이 되고, 거기서 [답변 등록]·[글 삭제] 를 누르게 된다.
   *
   * ★ 고른 문의가 결과에 **남아 있어도** 놓는다. 조건을 바꿨다는 것은 다른 것을 찾는
   *   중이라는 뜻이고, 그러면 다시 고르는 것이 맞다(2026-09-28 결정).
   * ★ 첫 렌더에서는 놓지 않는다 — 주소의 `?id=` 로 들어온 선택을 스스로 지우면
   *   링크를 열자마자 빈 화면이 된다.
   * ★ 검색어는 **친 그대로**(`keyword`) 본다. 서버로 나가는 것은 250ms 뒤(`query`)지만,
   *   오른쪽이 닫히는 것은 조건을 손댄 **그 순간**이어야 손이 따라온다.
   */
  const filterKey = `${status ?? ''}|${type ?? ''}|${keyword.trim()}`;
  const lastFilter = useRef(filterKey);
  useEffect(() => {
    if (lastFilter.current === filterKey) return;
    lastFilter.current = filterKey;
    setSelectedId(null);
  }, [filterKey]);

  // 주소에 적는다 — [이전]·새로고침에 살아남는다. 기록은 쌓지 않는다.
  useEffect(() => {
    const qs = new URLSearchParams();
    if (status === null) qs.set('st', 'all');
    else if (status !== 'R') qs.set('st', status);
    if (type) qs.set('type', type);
    if (query) qs.set('q', query);
    if (selectedId) qs.set('id', selectedId);
    const search = qs.toString();
    const next = window.location.pathname + (search ? `?${search}` : '');
    if (next !== window.location.pathname + window.location.search) {
      window.history.replaceState(null, '', next);
    }
  }, [status, type, query, selectedId]);

  /**
   * 답변 등록 · 전화 답변 기록.
   *
   * ★ 상태는 서버가 판정한 값을 그대로 쓴다 — 화면이 「답변했으니 답변완료」로 스스로
   *   바꾸지 않는다. 그 판정이 두 곳에 있으면 갈린다(03-thread §2).
   */
  const reply = useCallback(
    async (kind: 'text' | 'phone', body: string): Promise<boolean> => {
      if (!selectedId || !detail) return false;
      setDetailBusy(true);
      try {
        const res = await fetch(`/api/admin/inquiries/${encodeURIComponent(selectedId)}/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind, body }),
        });
        const got = (await res.json()) as { messages?: ThreadMessage[]; status?: string; message?: string };
        if (!res.ok) {
          notify(got.message ?? '답변을 등록하지 못했습니다');
          return false;
        }
        setDetail({
          inquiry: { ...detail.inquiry, status: got.status ?? detail.inquiry.status },
          messages: got.messages ?? detail.messages,
        });
        // ★ 목록을 다시 받는다 — 상태가 바뀌어 「접수」 필터에서 빠지거나 뱃지가 바뀐다.
        void loadList(1, false);
        notify(
          kind === 'phone'
            ? '전화로 답변한 기록을 남겼습니다 · 고객 화면에 「전화로 답변드렸습니다」로 보입니다'
            : '답변을 등록했습니다 · 상태가 「답변완료」로 바뀌었습니다',
        );
        return true;
      } catch {
        notify('서버에 연결할 수 없습니다');
        return false;
      } finally {
        setDetailBusy(false);
      }
    },
    [selectedId, detail, loadList, notify],
  );

  /** 답변 수정 — 「수정됨」. 순서는 그대로다(서버가 `created_at` 을 건드리지 않는다). */
  const editReply = useCallback(
    async (messageId: string, body: string): Promise<boolean> => {
      if (!selectedId || !detail) return false;
      setDetailBusy(true);
      try {
        const res = await fetch(
          `/api/admin/inquiries/${encodeURIComponent(selectedId)}/messages/${encodeURIComponent(messageId)}`,
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ body }),
          },
        );
        const got = (await res.json()) as { messages?: ThreadMessage[]; status?: string; message?: string };
        if (!res.ok) {
          notify(got.message ?? '답변을 수정하지 못했습니다');
          return false;
        }
        setDetail({
          inquiry: { ...detail.inquiry, status: got.status ?? detail.inquiry.status },
          messages: got.messages ?? detail.messages,
        });
        notify('답변을 수정했습니다 · 고객 화면에 「수정됨」으로 보입니다');
        return true;
      } catch {
        notify('서버에 연결할 수 없습니다');
        return false;
      } finally {
        setDetailBusy(false);
      }
    },
    [selectedId, detail, notify],
  );

  /** 글 전체 삭제 — 확인 창을 거친 뒤에만 여기 온다. */
  const remove = useCallback(async (): Promise<boolean> => {
    if (!selectedId) return false;
    const res = await fetch(`/api/admin/inquiries/${encodeURIComponent(selectedId)}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) return false;
    setAsking(false);
    setSelectedId(null);
    setDetail(null);
    void loadList(1, false);
    notify('문의를 삭제했습니다 · 개인정보가 함께 지워졌습니다');
    return true;
  }, [selectedId, loadList, notify]);

  const statusName = (code: string) => codeName(codes.statuses, code);
  const typeName = (code: string) => codeName(codes.types, code);

  const shown = items?.length ?? 0;
  const rest = Math.max(0, total - shown);
  const filtered = status !== null || type !== null || query !== '';

  const headNote = useMemo(() => {
    if (items === null) return '불러오는 중입니다';
    if (listError) return listError;
    const label = status === null ? '전체' : statusName(status);
    return `${label} ${total}건${type ? ` · ${typeName(type)}` : ''}${query ? ` · 「${query}」 검색` : ''}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- codeName 은 props 파생이라 안정적이다
  }, [items, listError, status, type, query, total, codes]);

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>문의상담관리</h1>
          <p className={styles.sub}>{headNote}</p>
        </div>
      </div>

      <div className={styles.body}>
        {/* ══════════ 좌측 · 문의 목록 ══════════ */}
        <div className={styles.list}>
          <div className={styles.listHead}>
            <div className={styles.searchRow}>
              <span className={styles.searchWrap}>
                <span className={styles.searchIcon}>
                  <Icon name="search" size={16} />
                </span>
                <input
                  className={styles.search}
                  placeholder="이름, 연락처 검색"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                />
              </span>
              <span className={styles.count}>{total}건</span>
            </div>

            <div className={styles.filterRow}>
              {/* ★ 상태 칩의 문구는 코드 마스터(QU_ST)에서 온다 — 「접수」를 박지 않는다. */}
              <div className={styles.chipRow}>
                {codes.statuses.map((s) => (
                  <button
                    key={s.code}
                    type="button"
                    className={`${styles.chip}${status === s.code ? ` ${styles.chipOn}` : ''}`}
                    onClick={() => setStatus(s.code)}
                  >
                    {s.name}
                  </button>
                ))}
                <button
                  type="button"
                  className={`${styles.chip}${status === null ? ` ${styles.chipOn}` : ''}`}
                  onClick={() => setStatus(null)}
                >
                  전체
                </button>
              </div>

              {/* 유형은 5종이라 칩으로 두면 줄이 넘친다 — 420px 목록 머리에는 선택이 맞다 */}
              <select
                className={styles.typeSelect}
                value={type ?? ''}
                aria-label="문의 유형"
                onChange={(e) => setType(e.target.value || null)}
              >
                <option value="">유형 전체</option>
                {codes.types.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className={styles.cards}>
            {items === null ? (
              <PanelEmpty icon="message-square-text" lead="문의를 불러오는 중입니다" />
            ) : listError ? (
              <PanelEmpty icon="circle-alert" lead={listError} />
            ) : items.length === 0 ? (
              /* ★ 걸러서 0건인 것과 아예 0건인 것은 다른 상태다 — 문구도 액션도 다르다.
                 「접수」가 비는 것은 좋은 소식이라(답할 것이 없다) 고장처럼 보이지 않게 적는다. */
              filtered ? (
                <PanelEmpty
                  icon="circle-check"
                  lead={
                    status !== null && !type && !query
                      ? `${statusName(status)} 문의가 없습니다`
                      : '조건에 맞는 문의가 없습니다'
                  }
                  sub={status === 'R' && !type && !query ? '답변을 기다리는 문의가 없습니다' : '필터나 검색어를 바꿔 보세요'}
                  action={{
                    label: '전체 보기',
                    onClick: () => {
                      setStatus(null);
                      setType(null);
                      setKeyword('');
                    },
                  }}
                />
              ) : (
                <PanelEmpty icon="message-square-text" lead="등록된 문의가 없습니다" sub="고객이 남긴 문의가 여기에 쌓입니다" />
              )
            ) : (
              <>
                {items.map((it) => (
                  <button
                    key={it.inquiryId}
                    type="button"
                    data-inquiry-row={it.inquiryId}
                    className={`${styles.card}${it.inquiryId === selectedId ? ` ${styles.cardSelected}` : ''}`}
                    onClick={() => setSelectedId(it.inquiryId)}
                  >
                    <span className={styles.cardRow1}>
                      {/* 제목 칸이 없다 — **문의 유형이 제목**이다(02-screens §2) */}
                      <span className={styles.cardType}>{typeName(it.type)}</span>
                      <span className={`${styles.badge} ${it.status === 'R' ? styles.badgeWait : styles.badgeDone}`}>
                        {statusName(it.status)}
                      </span>
                    </span>
                    <span className={styles.cardMeta}>
                      {it.name} · {dotDate(it.day)}
                      {/* ★ 「보관 기간 지남」 — 운영자 화면에만 있는 표시다 */}
                      {it.retentionPassed ? <span className={styles.badgeOld} style={{ marginLeft: 6 }}>보관 기간 지남</span> : null}
                    </span>
                    <span className={styles.cardLast}>{lastLine(it)}</span>
                  </button>
                ))}
                {rest > 0 ? (
                  <div className={styles.more}>
                    <span className={styles.moreText}>
                      {total}건 중 {shown}건 표시
                    </span>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnGhost} ${styles.btnXs}`}
                      onClick={() => void loadList(page + 1, true)}
                    >
                      {Math.min(pageSize, rest)}건 더 보기
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>

        {/* ══════════ 우측 · 상세 ══════════ */}
        <div className={styles.detail}>
          {!selectedId ? (
            <PanelEmpty icon="mouse-pointer-click" lead="왼쪽에서 문의를 선택하세요" />
          ) : detailError ? (
            <PanelEmpty icon="circle-alert" lead={detailError} />
          ) : !detail ? (
            <PanelEmpty icon="message-square-text" lead="불러오는 중입니다" />
          ) : (
            /*
             * ★★★ `key` 로 **문의마다 새로 그린다.** 상세는 쓰다 만 답변과 「수정 중」 상태를
             *    자기 안에 들고 있는데(`useState`), 다른 문의를 골라도 컴포넌트가 살아 있으면
             *    그 내용이 **다음 문의로 따라간다** — 남의 문의에 엉뚱한 답변을 저장하는 길이다.
             *    id 가 바뀌면 React 가 상태째 버리고 새로 만든다.
             */
            <InquiryDetail
              key={detail.inquiry.inquiryId}
              inquiry={detail.inquiry}
              messages={detail.messages}
              codes={codes}
              busy={detailBusy}
              onReply={reply}
              onEdit={editReply}
              onAskDelete={() => setAsking(true)}
            />
          )}
        </div>
      </div>

      {asking && detail ? (
        <DeleteInquiryDialog
          typeName={typeName(detail.inquiry.type)}
          name={detail.inquiry.name}
          day={detail.inquiry.day}
          retentionPassed={detail.inquiry.retentionPassed}
          retentionMonths={detail.inquiry.retentionMonths}
          onClose={() => setAsking(false)}
          onConfirm={remove}
        />
      ) : null}

      {toast ? (
        <div className={styles.toast} data-toast="1">
          <span className={styles.toastDot} />
          <span className={styles.toastMsg}>{toast}</span>
        </div>
      ) : null}
    </div>
  );
}

function PanelEmpty({
  icon,
  lead,
  sub,
  action,
}: {
  icon: IconName;
  lead: string;
  sub?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon}>
        <Icon name={icon} size={40} />
      </span>
      <p className={styles.emptyLead}>{lead}</p>
      {sub ? <p className={styles.emptySub}>{sub}</p> : null}
      {action ? (
        <div className={styles.emptyAct}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={action.onClick}>
            {action.label}
          </button>
        </div>
      ) : null}
    </div>
  );
}
