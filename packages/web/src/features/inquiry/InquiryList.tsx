'use client';

/**
 * s0300500070 문의 목록 — 공개. 2열 · 20건 · 즉시 검색.
 *
 * 시안: design/handoff/prototypes/s0300500070.html (`data-screen="list"`)
 * 명세: design/handoff/inquiry-board/02-screens.md §2
 *
 * =============================================================================
 * ★★★ 목록에 있는 것은 넷뿐이다 — 유형 · 가린 이름 · 날짜 · 상태
 * =============================================================================
 * 서버가 그 넷만 내려보낸다. 본문·연락처·이메일은 응답에 오지 않는다 —
 * 화면에서 가리는 것이 아니라 **없다**(`api/src/routes/inquiry.ts` 머리말).
 *
 * ★ 제목 칸이 없다. **문의 유형이 제목**이다(01-flow.md 「확정된 결정」) —
 *   목록에 개인정보가 드러나지 않게 한 결정이다.
 * ★ 검색은 바꾸는 즉시 적용하고 1페이지로 간다. 검색 버튼이 없다.
 * ★ 조건은 URL 에 둔다 — 글을 보고 돌아와도 보던 자리가 그대로다(02-screens §2).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { PAGE_SIZE } from '@swonbiz/shared/domain/inquiry';
import { Icon } from '@/components/ds';
import styles from './inquiry.module.css';
import {
  TEL_HREF,
  codeName,
  dotDate,
  type CodeOption,
  type InquiryCodes,
  type ListItem,
} from './inquiry-model';

interface Filter {
  from: string;
  to: string;
  status: string;
  type: string;
  page: number;
}

const EMPTY: Filter = { from: '', to: '', status: '', type: '', page: 1 };

export function InquiryList() {
  const router = useRouter();
  const params = useSearchParams();
  const [codes, setCodes] = useState<InquiryCodes>({ types: [], statuses: [] });
  const [items, setItems] = useState<ListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  /** 검색 조건이 하나도 없을 때의 전체 건수 — 「빈 목록」과 「검색 0건」을 가른다. */
  const [totalAll, setTotalAll] = useState(0);

  const filter: Filter = useMemo(
    () => ({
      from: params.get('from') ?? '',
      to: params.get('to') ?? '',
      status: params.get('status') ?? '',
      type: params.get('type') ?? '',
      page: Math.max(1, Number(params.get('page') ?? 1) || 1),
    }),
    [params],
  );
  const searching = !!(filter.from || filter.to || filter.status || filter.type);

  /** 조건을 URL 에 쓴다. 조건을 바꾸면 늘 1페이지부터다. */
  const apply = useCallback(
    (next: Partial<Filter>) => {
      const merged = { ...filter, ...next, page: next.page ?? 1 };
      const qs = new URLSearchParams();
      if (merged.from) qs.set('from', merged.from);
      if (merged.to) qs.set('to', merged.to);
      if (merged.status) qs.set('status', merged.status);
      if (merged.type) qs.set('type', merged.type);
      if (merged.page > 1) qs.set('page', String(merged.page));
      const query = qs.toString();
      router.replace(query ? `/inquiry?${query}` : '/inquiry', { scroll: false });
      window.scrollTo(0, 0);
    },
    [filter, router],
  );

  useEffect(() => {
    void fetch('/api/inquiries/codes')
      .then((r) => (r.ok ? (r.json() as Promise<InquiryCodes>) : null))
      .then((b) => setCodes(b ?? { types: [], statuses: [] }))
      .catch(() => setCodes({ types: [], statuses: [] }));
  }, []);

  useEffect(() => {
    const qs = new URLSearchParams();
    if (filter.from) qs.set('from', filter.from);
    if (filter.to) qs.set('to', filter.to);
    if (filter.status) qs.set('status', filter.status);
    if (filter.type) qs.set('type', filter.type);
    qs.set('page', String(filter.page));
    let alive = true;
    void fetch(`/api/inquiries?${qs.toString()}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ total: number; items: ListItem[] }>) : null))
      .then((b) => {
        if (!alive) return;
        setItems(b?.items ?? []);
        setTotal(b?.total ?? 0);
        setLoaded(true);
      })
      .catch(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [filter]);

  /* 전체 건수는 따로 한 번 — 「아직 등록된 문의가 없습니다」는 조건과 무관한 상태다. */
  useEffect(() => {
    void fetch('/api/inquiries?page=1')
      .then((r) => (r.ok ? (r.json() as Promise<{ total: number }>) : null))
      .then((b) => setTotalAll(b?.total ?? 0))
      .catch(() => setTotalAll(0));
  }, [items]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const empty = loaded && totalAll === 0;
  const noMatch = loaded && totalAll > 0 && total === 0;

  const statusBadge = (code: string) => (
    <span className={`${styles.badge} ${code === 'R' ? styles.badgeWait : styles.badgeDone}`}>
      {codeName(codes.statuses, code)}
    </span>
  );

  return (
    <>
      <div className={styles.listTop}>
        <div>
          <h1 className={styles.h1}>문의상담</h1>
          <p className={styles.lede}>로그인 없이 남기실 수 있습니다. 영업일 1일 내 답변드립니다.</p>
        </div>
        <Link className={`${styles.btn} ${styles.btnPrimary}`} href="/inquiry/new" data-go="write">
          <Icon name="pencil-line" size={16} />
          문의하기
        </Link>
      </div>

      {/* 글이 하나도 없으면 검색 카드를 숨긴다 */}
      {empty ? null : (
        <div className={`${styles.card} ${styles.filters}`} data-filters="1">
          <div className={`${styles.field} ${styles.fRange}`}>
            <span className={styles.lab}>문의일자</span>
            <span className={styles.pair}>
              <input
                className={styles.input}
                type="date"
                aria-label="문의일자 시작"
                value={filter.from}
                /* 뒤집힌 범위를 애초에 고르지 못하게 한다 */
                max={filter.to || undefined}
                onChange={(e) => apply({ from: e.target.value })}
              />
              <span className={styles.tilde}>~</span>
              <input
                className={styles.input}
                type="date"
                aria-label="문의일자 종료"
                value={filter.to}
                min={filter.from || undefined}
                onChange={(e) => apply({ to: e.target.value })}
              />
            </span>
          </div>

          <label className={styles.field}>
            <span className={styles.lab}>상태</span>
            <select
              className={styles.select}
              value={filter.status}
              data-f="status"
              onChange={(e) => apply({ status: e.target.value })}
            >
              <option value="">전체</option>
              {codes.statuses.map((s: CodeOption) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <div className={styles.field}>
            {/* ★ [검색조건 초기화] 를 label 안에 넣지 않는다 — 누르면 Select 로 포커스가 간다 */}
            <span className={styles.labRow}>
              <label className={styles.lab} htmlFor="f-type">
                문의유형
              </label>
              <button className={styles.fReset} type="button" data-reset="1" onClick={() => apply(EMPTY)}>
                <Icon name="rotate-ccw" size={12} />
                검색조건 초기화
              </button>
            </span>
            <select
              className={styles.select}
              id="f-type"
              value={filter.type}
              data-f="type"
              onChange={(e) => apply({ type: e.target.value })}
            >
              <option value="">전체</option>
              {codes.types.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {empty ? (
        <div className={`${styles.card} ${styles.empty}`} data-empty="1">
          <span className={styles.icCircle}>
            <Icon name="message-square-text" size={26} />
          </span>
          <h2 className={styles.emptyTitle}>아직 등록된 문의가 없습니다</h2>
          <p className={styles.emptyText}>첫 문의를 남겨 주세요. 영업일 1일 내 담당자가 답변드립니다.</p>
          <div className={styles.emptyBtns}>
            <Link className={`${styles.btn} ${styles.btnPrimary}`} href="/inquiry/new" style={{ height: 48 }}>
              문의하기
            </Link>
            <a className={`${styles.btn} ${styles.btnGhost}`} href={TEL_HREF} style={{ height: 48 }}>
              <Icon name="phone" size={16} />전화 상담
            </a>
          </div>
        </div>
      ) : noMatch ? (
        <div className={`${styles.card} ${styles.empty} ${styles.emptySm}`} data-nomatch="1">
          <span className={styles.icMuted}>
            <Icon name="search-x" size={22} />
          </span>
          <h2 className={styles.emptyTitleSm}>조건에 맞는 문의가 없습니다</h2>
          <button
            className={`${styles.btn} ${styles.btnGhost}`}
            type="button"
            data-reset="2"
            style={{ marginTop: 16, fontSize: 14 }}
            onClick={() => apply(EMPTY)}
          >
            검색조건 초기화
          </button>
        </div>
      ) : (
        <div>
          <div className={styles.countLine}>
            <span>
              <span data-count-label="1">{searching ? '검색 결과' : '전체'}</span>{' '}
              <b data-total="1">{total}</b>건
            </span>
          </div>

          <div className={`${styles.card} ${styles.rowsCard}`}>
            <div className={styles.rowsGrid} data-rows="1">
              {items.map((it) => (
                <Link
                  key={it.inquiryId}
                  className={styles.row}
                  href={`/inquiry/${it.inquiryId}`}
                  data-row={it.inquiryId}
                >
                  <span className={styles.lock}>
                    <Icon name="lock" size={16} />
                  </span>
                  <span className={styles.rowText}>
                    <span className={styles.rowTitle}>{codeName(codes.types, it.type)}</span>
                    <span className={styles.rowMeta}>
                      {it.maskedName} · {dotDate(it.day)}
                    </span>
                  </span>
                  {statusBadge(it.status)}
                </Link>
              ))}
            </div>
          </div>

          {pages > 1 ? (
            <div className={styles.pager} data-pager="1">
              {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  className={n === filter.page ? styles.pagerOn : undefined}
                  aria-current={n === filter.page ? 'page' : undefined}
                  onClick={() => apply({ page: n })}
                >
                  {n}
                </button>
              ))}
            </div>
          ) : null}

          {/* 조건 없이 1~3건일 때만 — 비어 보이는 목록을 그냥 두지 않는다 */}
          {!searching && totalAll > 0 && totalAll < 4 ? (
            <div className={styles.few} data-few="1">
              <div>
                <div className={styles.fewLead}>궁금한 점이 있으신가요?</div>
                <div className={styles.fewSub}>입주 · 법무 · 세무 · 연구소 설립 무엇이든 남겨 주세요</div>
              </div>
              <Link
                className={`${styles.btn} ${styles.btnGhost}`}
                href="/inquiry/new"
                style={{ fontSize: 14 }}
              >
                문의 남기기
              </Link>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
