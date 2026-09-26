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
 *
 * =============================================================================
 * ★★ 한 업무는 한 화면에서 (CLAUDE.md) — 돈을 만지는 처리는 전부 이 화면에 있다
 * =============================================================================
 * 수납 입력·수정·삭제([수납]·[내역]) · 정산 처리 · 정산서 · 예치금 반환. 입주사 청구 탭과
 * 계약 폼은 조회 + 링크(`billingHref`)로 여기에 보낸다.
 *
 *   ?company=  그 입주사로 거른다 — ★ 월을 넘기지 않고 그 입주사의 **전 기간**을 보인다
 *              (입주사 청구 탭에서 넘어올 때). 정산 탭도 그 입주사 것만 보인다.
 *   ?contract= 정산 탭에서 그 계약의 정산 상세를 연다(계약 폼 「정산 결과 보기」).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { DisplayStatus } from '@swonbiz/shared/domain/invoice-status';
import { Icon } from '@/components/ds';
import { BillingEmpty, BillingTable } from '@/features/billing/BillingTable';
import { SettlementQueue } from '@/features/billing/SettlementQueue';
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

  /**
   * 「월별 청구 | 정산」 — 정산 탭은 중도해지 정산 대기와 예치금 반환 대기(`SettlementQueue`).
   * ★ 주소에 적는다(`?tab=settle`) — 정산서를 보고 [이전] 으로 돌아와도 같은 탭이다.
   */
  const [tab, setTab] = useState<'month' | 'settle'>(() => (params.get('tab') === 'settle' ? 'settle' : 'month'));
  /** 입주사로 거르기 — 있으면 월 대신 그 입주사의 전 기간. */
  const [company, setCompany] = useState<string | null>(() => params.get('company') || null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  /** 정산 탭에서 상세를 연 계약. */
  const [contract, setContract] = useState<string | null>(() => params.get('contract') || null);

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
  const load = useCallback(async (month: string, companyId: string | null) => {
    const mine = ++seq.current;
    setError(null);
    try {
      // ★ 입주사로 걸렀으면 그 입주사의 전 기간(입주사 청구 API) — 월 조건을 붙이지 않는다.
      const res = await fetch(
        companyId
          ? `/api/companies/${encodeURIComponent(companyId)}/billing`
          : `/api/billing/invoices?yearMonth=${encodeURIComponent(month)}`,
      );
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
    void load(ym, company);
  }, [ym, company, load]);

  // 거른 입주사의 이름 — 제목과 거르기 칩에 쓴다(청구서가 한 장도 없어도 보이게 따로 받는다).
  useEffect(() => {
    setCompanyName(null);
    if (!company) return;
    let alive = true;
    void fetch(`/api/companies/${encodeURIComponent(company)}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ companyName?: string }>) : null))
      .then((b) => {
        if (alive) setCompanyName(b?.companyName ?? '알 수 없는 입주사');
      })
      .catch(() => {
        if (alive) setCompanyName('알 수 없는 입주사');
      });
    return () => {
      alive = false;
    };
  }, [company]);

  useEffect(() => {
    const sp = new URLSearchParams();
    if (tab === 'settle') sp.set('tab', 'settle');
    if (company) sp.set('company', company);
    if (tab === 'settle' && contract) sp.set('contract', contract);
    sp.set('ym', ym);
    if (keyword) sp.set('q', keyword);
    if (status) sp.set('st', status);
    const next = `${window.location.pathname}?${sp.toString()}`;
    if (next !== window.location.pathname + window.location.search) window.history.replaceState(null, '', next);
  }, [tab, company, contract, ym, keyword, status]);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const toastOnly = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  const notify = useCallback(
    (message: string) => {
      toastOnly(message);
      void load(ym, company);
    },
    [load, toastOnly, ym, company],
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
          <h1 className={styles.title}>
            {tab === 'settle' ? '정산' : company ? `${companyName ?? '입주사'} 청구` : `${yearMonthLabel(ym)} 청구`}
          </h1>
          <p className={styles.sub}>
            {tab === 'settle'
              ? '중도해지 정산 · 기간 만료 예치금 반환'
              : items === null
              ? '불러오는 중입니다'
              : `${company ? '전 기간 · ' : ''}${monthSum.count}건 · 미납 ${monthSum.unpaidCount}건${
                  counts.get('canceled') ? ` · 취소 ${counts.get('canceled')}건` : ''
                }`}
          </p>
        </div>
        {company ? (
          // ★ 입주사로 걸렀을 때는 월 넘기기 대신 거르기 칩 — ✕ 로 풀면 월별로 돌아간다.
          <div className={styles.monthNav}>
            <span className={`${styles.chip} ${styles.chipOn}`} data-company-filter={company}>
              입주사 · {companyName ?? '…'}
            </span>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              onClick={() => {
                setCompany(null);
                setContract(null);
              }}
            >
              거르기 해제
            </button>
          </div>
        ) : (
        <div className={styles.monthNav} style={tab === 'settle' ? { visibility: 'hidden' } : undefined}>
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
        )}
      </div>

      <div className={styles.tabs} role="tablist">
        {(
          [
            ['month', '월별 청구'],
            ['settle', '정산'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`${styles.tab}${tab === key ? ` ${styles.tabOn}` : ''}`}
            onClick={() => {
              setTab(key);
              if (key !== 'settle') setContract(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'settle' ? (
        <div className={styles.panel}>
          <SettlementQueue notify={toastOnly} company={company} selected={contract} onSelect={setContract} />
        </div>
      ) : (
      <>
      <div className={styles.cards}>
        <SummaryCard label="총 청구액" value={won(sum.total)} filtered={filtered} />
        {/*
          ★ 수납 완료는 **청구에 들어간 몫**만이다. 과납분(돌려줄 돈)은 여기에도 미수금에도
            섞지 않고 아래 줄에 따로 적는다 — 섞으면 다른 입주사의 미수금이 깎여 보인다.
        */}
        <SummaryCard
          label="수납 완료"
          value={won(sum.received)}
          filtered={filtered}
          note={sum.overpaidCount > 0 ? `과납 ${won(sum.overpaid)} · 정산 대기 ${sum.overpaidCount}건 별도` : undefined}
        />
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
          <BillingEmpty
            lead={company ? '이 입주사의 청구서가 없습니다' : `${yearMonthLabel(ym)} 청구가 없습니다`}
            sub="청구서는 계약을 확정하면 계약기간 전체가 만들어집니다"
          />
        ) : visible.length === 0 ? (
          <BillingEmpty lead="조건에 맞는 청구가 없습니다" sub="검색어나 상태 필터를 바꿔 보세요" />
        ) : (
          <BillingTable items={visible} mode={company ? 'company' : 'month'} asOf={asOf} onChanged={notify} />
        )}
      </div>
      </>
      )}

      {toast ? (
        <div className={styles.toast}>
          <span className={styles.toastDot} />
          <span className={styles.toastMsg}>{toast}</span>
        </div>
      ) : null}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  filtered,
  note,
}: {
  label: string;
  value: string;
  filtered: boolean;
  note?: string;
}) {
  return (
    <div className={styles.card}>
      <div className={styles.cardLabel}>{label}</div>
      <div className={styles.cardValue}>{value}</div>
      {note ? <div className={styles.cardNote}>{note}</div> : null}
      {filtered ? <div className={styles.cardNote}>필터 적용</div> : null}
    </div>
  );
}
