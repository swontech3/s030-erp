'use client';

/**
 * s0300200070 월별 청구 — 월 선택 · 입주사 검색 · 상태 필터 · 요약 카드 4개 · 표.
 *
 * =============================================================================
 * ★★ 카드와 표는 **같은 줄들**에서 나온다
 * =============================================================================
 * 요약 카드와 표의 합계 줄이 모두 `summarize(visible)` 다. 걸러 놓은 상태에서 카드만
 * 월 전체를 세면 「카드 합계 ≠ 표 합계」가 되고, 운영자는 어느 쪽이 틀렸는지 모른다.
 * 거르고 있으면 카드 아래에 그렇다고 적는다.
 *
 * ★ 상태는 `statusOf`(= `displayInvoiceStatus`) 하나로 판정한다. 필터·뱃지·카드의
 *   「미납」이 전부 그 함수를 거친다.
 *
 * ★ 월·검색어·상태는 주소에 적는다(`?ym=&q=&st=`) — [이전]·새로고침에 살아남는다.
 *   방식은 s0300200030 과 같다(`history.replaceState`, 기록을 쌓지 않는다).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { DisplayStatus } from '@swonbiz/shared/domain/invoice-status';
import { Icon } from '@/components/ds';
import { BillingEmpty, BillingTable } from '@/features/billing/BillingTable';
import styles from '@/features/billing/billing.module.css';
import {
  STATUS_LABEL,
  STATUS_ORDER,
  currentYearMonth,
  isYearMonth,
  shiftYearMonth,
  statusOf,
  summarize,
  won,
  yearMonthLabel,
  type BillingItem,
} from '@/features/billing/billing-model';

const isStatus = (s: string | null): s is DisplayStatus =>
  s !== null && (STATUS_ORDER as readonly string[]).includes(s);

export function BillingView() {
  const params = useSearchParams();
  const [ym, setYm] = useState(() => {
    const v = params.get('ym');
    return isYearMonth(v) ? v : currentYearMonth();
  });
  const [keyword, setKeyword] = useState(() => params.get('q') ?? '');
  const [status, setStatus] = useState<DisplayStatus | null>(() => {
    const v = params.get('st');
    return isStatus(v) ? v : null;
  });

  const [items, setItems] = useState<BillingItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ★ 오늘을 한 번만 정한다 — 행마다 new Date() 를 부르면 자정을 넘길 때 행끼리 기준이 갈린다.
  const asOf = useMemo(() => new Date(), [items]);

  /**
   * ★ 늦게 온 응답이 새 달을 덮지 않게 한다. 월을 빨리 넘기면 앞 달 응답이 뒤에 도착할 수
   *   있고, 그러면 제목은 10월인데 표는 9월이 된다 — 카드와 제목이 어긋나는 가장 쉬운 길이다.
   */
  const seq = useRef(0);
  const load = useCallback(async (month: string) => {
    const mine = ++seq.current;
    setError(null);
    try {
      const res = await fetch(`/api/billing/invoices?yearMonth=${encodeURIComponent(month)}`);
      const body = (await res.json()) as { invoices?: BillingItem[]; message?: string };
      if (!res.ok) throw new Error(body.message ?? '청구를 불러오지 못했습니다');
      if (mine === seq.current) setItems(body.invoices ?? []);
    } catch (err) {
      if (mine === seq.current) {
        setItems([]);
        setError((err as Error).message);
      }
    }
  }, []);

  useEffect(() => {
    setItems(null);
    void load(ym);
  }, [ym, load]);

  useEffect(() => {
    const sp = new URLSearchParams();
    sp.set('ym', ym);
    if (keyword) sp.set('q', keyword);
    if (status) sp.set('st', status);
    const next = `${window.location.pathname}?${sp.toString()}`;
    if (next !== window.location.pathname + window.location.search) window.history.replaceState(null, '', next);
  }, [ym, keyword, status]);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const notify = useCallback(
    (message: string) => {
      setToast(message);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 2800);
      void load(ym);
    },
    [load, ym],
  );

  const all = items ?? [];
  const q = keyword.trim().toLowerCase();
  const visible = all.filter(
    (it) =>
      (q === '' || it.companyName.toLowerCase().includes(q) || it.roomNames.toLowerCase().includes(q)) &&
      (status === null || statusOf(it, asOf) === status),
  );
  const sum = summarize(visible, asOf);
  const monthSum = summarize(all, asOf);
  const filtered = q !== '' || status !== null;

  const counts = useMemo(() => {
    const map = new Map<DisplayStatus, number>();
    for (const it of items ?? []) {
      const st = statusOf(it, asOf);
      map.set(st, (map.get(st) ?? 0) + 1);
    }
    return map;
  }, [items, asOf]);

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>{yearMonthLabel(ym)} 청구</h1>
          <p className={styles.sub}>
            {items === null
              ? '불러오는 중입니다'
              : `${monthSum.count}건 · 미납 ${monthSum.unpaidCount}건${
                  counts.get('canceled') ? ` · 취소 ${counts.get('canceled')}건` : ''
                }`}
          </p>
        </div>
        <div className={styles.monthNav}>
          <button type="button" className={styles.iconBtn} aria-label="이전 달" onClick={() => setYm(shiftYearMonth(ym, -1))}>
            <Icon name="chevron-left" size={18} />
          </button>
          <input
            type="month"
            className={styles.monthInput}
            value={ym}
            onChange={(e) => {
              if (isYearMonth(e.target.value)) setYm(e.target.value);
            }}
          />
          <button type="button" className={styles.iconBtn} aria-label="다음 달" onClick={() => setYm(shiftYearMonth(ym, 1))}>
            <Icon name="chevron-right" size={18} />
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost}`}
            disabled={ym === currentYearMonth()}
            onClick={() => setYm(currentYearMonth())}
          >
            이번 달
          </button>
        </div>
      </div>

      <div className={styles.cards}>
        <SummaryCard label="총 청구액" value={won(sum.total)} filtered={filtered} />
        <SummaryCard label="수납 완료" value={won(sum.paid)} filtered={filtered} />
        <SummaryCard label="미수금" value={won(sum.outstanding)} filtered={filtered} />
        <div className={styles.card}>
          <div className={styles.cardLabel}>미납</div>
          <div className={styles.cardValueRow}>
            <span className={`${styles.cardCount}${sum.unpaidCount === 0 ? ` ${styles.cardCountZero}` : ''}`}>
              {sum.unpaidCount}건
            </span>
            <span className={styles.cardNote}>{sum.unpaidCount > 0 ? won(sum.unpaidAmount) : '없음'}</span>
          </div>
          {filtered ? <div className={styles.cardNote}>필터 적용</div> : null}
        </div>
      </div>

      <div className={styles.panel}>
        <div className={styles.toolbar}>
          <span className={styles.searchWrap}>
            <span className={styles.searchIcon}>
              <Icon name="search" size={16} />
            </span>
            <input
              className={styles.search}
              placeholder="입주사, 호실 검색"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </span>
          <div className={styles.chipRow}>
            <button
              type="button"
              className={`${styles.chip}${status === null ? ` ${styles.chipOn}` : ''}`}
              onClick={() => setStatus(null)}
            >
              전체 {all.length}
            </button>
            {STATUS_ORDER.map((st) => (
              <button
                key={st}
                type="button"
                className={`${styles.chip}${status === st ? ` ${styles.chipOn}` : ''}`}
                onClick={() => setStatus(status === st ? null : st)}
              >
                {STATUS_LABEL[st]} {counts.get(st) ?? 0}
              </button>
            ))}
          </div>
        </div>

        {items === null ? (
          <BillingEmpty lead="청구를 불러오는 중입니다" />
        ) : error ? (
          <BillingEmpty lead={error} />
        ) : all.length === 0 ? (
          <BillingEmpty lead={`${yearMonthLabel(ym)} 청구가 없습니다`} sub="청구서는 계약을 확정하면 계약기간 전체가 만들어집니다" />
        ) : visible.length === 0 ? (
          <BillingEmpty lead="조건에 맞는 청구가 없습니다" sub="검색어나 상태 필터를 바꿔 보세요" />
        ) : (
          <BillingTable items={visible} mode="month" asOf={asOf} onChanged={notify} />
        )}
      </div>

      {toast ? (
        <div className={styles.toast}>
          <span className={styles.toastDot} />
          <span className={styles.toastMsg}>{toast}</span>
        </div>
      ) : null}
    </div>
  );
}

function SummaryCard({ label, value, filtered }: { label: string; value: string; filtered: boolean }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardLabel}>{label}</div>
      <div className={styles.cardValue}>{value}</div>
      {filtered ? <div className={styles.cardNote}>필터 적용</div> : null}
    </div>
  );
}
