'use client';

/**
 * s030200070 청구 — 공통 목록 틀(검색 조건 → 총괄표 → 버튼 줄 → 목록, 2026-11-15).
 *
 * =============================================================================
 * ★★ 2026-11-15 대표 지시 — 자리 · 조건 · 칸만 바꿨다. 수납 · 정산 처리의 동작은 그대로다
 * =============================================================================
 *   · 「년월 청구」 제목 칸과 월 넘기기를 없앴다 → 검색 상자의 **납부기한 From ~ To**(처음은 이번 달 1일 ~ 말일)
 *   · 입주사 · 호실 검색과 상태 칩을 목록 상자 밖 검색 상자로 옮겼다 — 회사명(입주사 · 호실) · 상태(선택)
 *   · 조건은 [조회]를 눌러야 적용된다(회사명 칸 Enter 도 같다). [초기화]는 처음 조건으로 되돌리고 바로 적용
 *   · 상태 선택지는 공통 코드 `PAY_ST`(파티션 000)에서 읽는다 — 「전체」만 화면에 있다(`payStCodeOf`)
 *   · 목록 맨 아래 합계 줄은 없다. 버튼 줄에는 건수만(「N건」)
 *
 * ★★ 총괄표와 표는 **같은 줄들**에서 나온다 — 그려진 줄이 아니라 **조건에 맞는 전체**(`visible`).
 *    표가 그리는 것은 그중 앞 40줄(`drawn`)이고 스크롤하면 늘어난다. 총괄표를 `drawn` 으로 내면
 *    스크롤할 때마다 합계가 커진다.
 *
 * ★ 상태는 `statusOf`(= `displayInvoiceStatus`) 하나로 판정한다. 상태 조건 · 뱃지 · 총괄표의
 *   「미납」이 전부 그 함수를 거친다.
 *
 * ★ 조건은 주소에 적는다(`?from=&to=&q=&st=`) — [이전] · 새로고침에 살아남는다(`history.replaceState`).
 *
 * =============================================================================
 * ★★ 한 업무는 한 화면에서 (CLAUDE.md) — 돈을 만지는 처리는 전부 이 화면에 있다
 * =============================================================================
 * 수납 입력·수정·삭제([수납]·[내역]) · 정산 처리 · 정산서 · 예치금 반환. 입주사 청구 탭과
 * 계약 폼은 조회 + 링크(`billingHref`)로 여기에 보낸다.
 *
 *   ?company=  그 입주사로 거른다 — 그 입주사의 **전 기간**을 받는다(입주사 청구 탭에서 넘어올 때).
 *              그래서 이 주소로 열면 납부기한 칸이 비어 있다(비면 기간 제한 없음). 정산 탭도 그 입주사 것만.
 *   ?contract= 정산 탭에서 그 계약의 정산 상세를 연다(계약 폼 「정산 결과 보기」).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { DUE_RANGE_TOO_LONG, isDueRangeTooLong } from '@swonbiz/shared/domain/billing-due-range';
import { Icon } from '@/components/ds';
import { ListFrame, ListNote, ListScroll } from '@/components/patterns/ListFrame';
import { BillingEmpty, BillingTable } from '@/features/billing/BillingTable';
import { SettlementQueue } from '@/features/billing/SettlementQueue';
import styles from '@/features/billing/billing.module.css';
// ★ 검색 상자 칸은 법인변경 목록과 같은 모양 · 같은 클래스(.field · .label · .range · .input · .select) — 대표 지시 2026-11-15.
import cs from '@/features/legal/corp-changes.module.css';
import {
  PAY_ST_CATEGORY,
  currentMonthRange,
  isIsoDay,
  payStCodeOf,
  statusOf,
  summarize,
  won,
  type BillingItem,
} from '@/features/billing/billing-model';

/**
 * 한 번에 그리는 줄 수.
 *
 * ★ 40줄이면 화면 두세 개 분량이라 스크롤이 한 번은 있어야 다음 묶음이 온다 —
 *   너무 작으면(10) 스크롤마다 끊기고, 너무 크면(200) 처음 그리는 것이 무겁다.
 */
const PAGE = 40;

/** 검색 조건 — 납부기한 From ~ To(`YYYY-MM-DD`, 빈 문자열 = 제한 없음) · 회사명 · 상태(`PAY_ST` 코드값). */
interface Cond {
  from: string;
  to: string;
  name: string;
  st: string | null;
}

const defaultCond = (company: string | null): Cond => {
  // ★ 입주사로 거르고 들어오면 전 기간 — 납부기한을 비운다.
  const range = company ? { from: '', to: '' } : currentMonthRange();
  return { ...range, name: '', st: null };
};

/** 조건 검사 — 틀리면 화면에 보일 말. 입주사로 거르지 않으면 납부기한 둘 다 있어야 한다(서버가 전체를 내리지 않는다). */
function condError(c: Cond, company: string | null): string | null {
  if (c.from && !isIsoDay(c.from)) return '납부기한 시작일을 확인해 주세요';
  if (c.to && !isIsoDay(c.to)) return '납부기한 끝일을 확인해 주세요';
  if (!company && (!c.from || !c.to)) return '납부기한 시작일과 끝일을 넣어 주세요';
  if (c.from && c.to && c.from > c.to) return '납부기한 시작일이 끝일보다 늦습니다';
  // ★ 기간 상한 6개월(2026-11-15) — API 와 같은 함수 · 같은 말. 입주사로 거른 경우(전 기간)는 보지 않는다.
  if (!company && isDueRangeTooLong(c.from, c.to)) return DUE_RANGE_TOO_LONG;
  return null;
}

export function BillingView() {
  const params = useSearchParams();

  /**
   * 「청구 | 정산」 — 정산 탭은 중도해지 정산 대기와 예치금 반환 대기(`SettlementQueue`).
   * ★ 주소에 적는다(`?tab=settle`) — 정산서를 보고 [이전] 으로 돌아와도 같은 탭이다.
   */
  const [tab, setTab] = useState<'month' | 'settle'>(() => (params.get('tab') === 'settle' ? 'settle' : 'month'));
  /** 입주사로 거르기 — 있으면 그 입주사의 전 기간을 받는다. */
  const [company, setCompany] = useState<string | null>(() => params.get('company') || null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  /** 정산 탭에서 상세를 연 계약. */
  const [contract, setContract] = useState<string | null>(() => params.get('contract') || null);

  /** 적용된 조건(`cond`)과 검색 상자에 쓰는 중인 조건(`draft`). [조회] 가 draft → cond. */
  const [cond, setCond] = useState<Cond>(() => {
    const base = defaultCond(params.get('company') || null);
    const from = params.get('from');
    const to = params.get('to');
    return {
      from: from !== null && (from === '' || isIsoDay(from)) ? from : base.from,
      to: to !== null && (to === '' || isIsoDay(to)) ? to : base.to,
      name: params.get('q') ?? '',
      st: /^[A-Z]$/.test(params.get('st') ?? '') ? params.get('st') : null,
    };
  });
  const [draft, setDraft] = useState<Cond>(cond);
  const [formError, setFormError] = useState<string | null>(null);

  /** 상태 선택지 — 공통 코드 `PAY_ST`(000). 못 읽으면 「전체」만 보인다. */
  const [statusOptions, setStatusOptions] = useState<{ code: string; name: string }[]>([]);

  const [items, setItems] = useState<BillingItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ★ 오늘을 한 번만 정한다 — 행마다 new Date() 를 부르면 자정을 넘길 때 행끼리 기준이 갈린다.
  const asOf = useMemo(() => new Date(), [items]);

  useEffect(() => {
    let alive = true;
    void fetch('/api/codes')
      .then((r) => (r.ok ? (r.json() as Promise<{ codes?: { category: string; code: string; name: string }[] }>) : null))
      .then((b) => {
        if (!alive) return;
        setStatusOptions((b?.codes ?? []).filter((c) => c.category === PAY_ST_CATEGORY).map(({ code, name }) => ({ code, name })));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  /**
   * ★ 늦게 온 응답이 새 조건을 덮지 않게 한다. 조건을 빨리 바꾸면 앞 응답이 뒤에 도착할 수 있다.
   */
  const seq = useRef(0);
  const load = useCallback(async (from: string, to: string, companyId: string | null) => {
    const mine = ++seq.current;
    setError(null);
    try {
      // ★ 입주사로 걸렀으면 그 입주사의 전 기간(입주사 청구 API) — 납부기한은 화면이 거른다(아래 `inRange`).
      const res = await fetch(
        companyId
          ? `/api/companies/${encodeURIComponent(companyId)}/billing`
          : `/api/billing/invoices?${new URLSearchParams({ dueFrom: from, dueTo: to }).toString()}`,
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

  // ★ 입주사로 거를 때는 받는 것이 기간과 무관하다 — 기간이 바뀌어도 다시 받지 않는다.
  const fetchFrom = company ? '' : cond.from;
  const fetchTo = company ? '' : cond.to;
  useEffect(() => {
    // ★ 주소로 빈 기간이 왔을 때 — 서버에 전체를 달라고 하지 않는다.
    const bad = company ? null : condError({ from: fetchFrom, to: fetchTo, name: '', st: null }, null);
    if (bad) {
      setItems([]);
      setError(bad);
      return;
    }
    setItems(null);
    void load(fetchFrom, fetchTo, company);
  }, [fetchFrom, fetchTo, company, load]);

  // 거른 입주사의 이름 — 거르기 칩에 쓴다(청구서가 한 장도 없어도 보이게 따로 받는다).
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
    sp.set('from', cond.from);
    sp.set('to', cond.to);
    if (cond.name) sp.set('q', cond.name);
    if (cond.st) sp.set('st', cond.st);
    const next = `${window.location.pathname}?${sp.toString()}`;
    if (next !== window.location.pathname + window.location.search) window.history.replaceState(null, '', next);
  }, [tab, company, contract, cond]);

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
      void load(fetchFrom, fetchTo, company);
    },
    [load, toastOnly, fetchFrom, fetchTo, company],
  );

  /** [조회] — 쓰는 중인 조건을 적용한다. 틀리면 적용하지 않고 까닭을 보인다. */
  const search = () => {
    const next = { ...draft, name: draft.name.trim() };
    const err = condError(next, company);
    setFormError(err);
    if (err) return;
    setDraft(next);
    setCond(next);
  };

  /** [초기화] — 처음 조건(이번 달 1일 ~ 말일, 입주사로 걸렀으면 전 기간)으로 되돌리고 바로 적용. */
  const reset = () => {
    const base = defaultCond(company);
    setFormError(null);
    setDraft(base);
    setCond(base);
  };

  const all = items ?? [];
  /** 납부기한 기간 안 — 서버가 이미 거른 것이지만 입주사로 거를 때는 화면이 거른다(비면 제한 없음). */
  const inRange = company
    ? all.filter((it) => (!cond.from || it.dueDate >= cond.from) && (!cond.to || it.dueDate <= cond.to))
    : all;
  const q = cond.name.toLowerCase();
  const visible = inRange.filter(
    (it) =>
      (q === '' || it.companyName.toLowerCase().includes(q) || it.roomNames.toLowerCase().includes(q)) &&
      (cond.st === null || payStCodeOf(statusOf(it, asOf)) === cond.st),
  );
  const sum = summarize(visible, asOf);
  const filtered = q !== '' || cond.st !== null;

  /*
   * ══════════════════════════════════════════════════════════════════════════
   * ★★★ 한 번에 다 그리지 않는다 — **그리는 줄 수만** 늘린다
   * ══════════════════════════════════════════════════════════════════════════
   * 줄을 전부 DOM 에 올리면 조건을 바꿀 때마다 눈에 보이게 멈춘다.
   * ★★ 총괄표는 `visible` 전체에서 낸다 — 그려진 것만 세지 않는다.
   * ★ 서버 페이지 나누기가 아니다. 받는 것은 그대로 두고 **그리는 것만** 끊는다.
   */
  const [shown, setShown] = useState(PAGE);
  // 조건 · 입주사가 바뀌면 처음부터 다시 그린다
  useEffect(() => setShown(PAGE), [cond, company, items]);
  const drawn = visible.slice(0, shown);
  const rest = visible.length - drawn.length;

  /** 바닥에 닿으면 더 그린다. `IntersectionObserver` 가 없거나 안 걸리면 [더 보기] 가 같은 일을 한다. */
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || rest <= 0 || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setShown((n) => n + PAGE);
      },
      // ★ 닿기 전에 미리 — 바닥에 정확히 닿아야 늘어나면 스크롤이 한 번 걸린다.
      { rootMargin: '300px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rest]);

  const tabs = (
    <div className={styles.tabs} role="tablist">
      {(
        [
          ['month', '청구'],
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
  );

  const companyChip = company ? (
    // ★ 입주사로 걸렀을 때 — ✕ 로 풀면 이번 달 납부기한으로 돌아간다(기간이 비어 있으면).
    <>
      <span className={`${styles.chip} ${styles.chipOn}`} data-company-filter={company}>
        입주사 · {companyName ?? '…'}
      </span>
      <button
        type="button"
        className={`${styles.btn} ${styles.btnGhost}`}
        onClick={() => {
          setCompany(null);
          setContract(null);
          if (!cond.from || !cond.to) {
            const base = { ...cond, ...currentMonthRange() };
            setDraft((d) => ({ ...d, from: base.from, to: base.to }));
            setCond(base);
          }
          setFormError(null);
        }}
      >
        거르기 해제
      </button>
    </>
  ) : null;

  const toastEl = toast ? (
    <div className={styles.toast}>
      <span className={styles.toastDot} />
      <span className={styles.toastMsg}>{toast}</span>
    </div>
  ) : null;

  if (tab === 'settle') {
    return (
      <div className={styles.page}>
        {tabs}
        {company ? <div className={styles.monthNav}>{companyChip}</div> : null}
        <div className={styles.panel}>
          <SettlementQueue notify={toastOnly} company={company} selected={contract} onSelect={setContract} />
        </div>
        {toastEl}
      </div>
    );
  }

  return (
    <>
      {/*
        ★ 2026-11-15 — 촘촘하게(대표 지시: 목록을 한 화면에 최대한 많이). 공통 목록 틀은 그대로 두고
          청구 화면만 이 감싸개(.dense)로 틀 안 간격 · 검색 상자 여백을 줄인다.
      */}
      <div className={styles.dense}>
      <ListFrame
        head={tabs}
        search={
          <>
            <div className={cs.field}>
              <span className={cs.label}>납부기한</span>
              <span className={cs.range}>
                <input
                  type="date"
                  className={cs.input}
                  aria-label="납부기한 시작일"
                  value={draft.from}
                  onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
                />
                ~
                <input
                  type="date"
                  className={cs.input}
                  aria-label="납부기한 끝일"
                  value={draft.to}
                  onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
                />
              </span>
            </div>
            <label className={cs.field}>
              <span className={cs.label}>회사명</span>
              <input
                className={cs.input}
                placeholder="입주사, 호실"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') search();
                }}
              />
            </label>
            <label className={cs.field}>
              <span className={cs.label}>상태</span>
              <select
                className={cs.select}
                value={draft.st ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, st: e.target.value || null }))}
              >
                <option value="">전체</option>
                {statusOptions.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={search}>
              조회
            </button>
            <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={reset}>
              <Icon name="rotate-ccw" size={16} />
              초기화
            </button>
            {/* ★ 2026-11-15 — 건수는 [초기화] 오른쪽. 목록 위 건수 줄은 없앴다(입주사 칩이 있을 때만 그 자리에 칩). */}
            <ListNote>{items === null || error ? '' : `${visible.length}건`}</ListNote>
            {formError ? (
              <span className={styles.searchError} role="alert">
                {formError}
              </span>
            ) : null}
          </>
        }
        summary={
          <div className={styles.summaryBar} data-summary="1">
            <SumCell label="총 청구액" value={won(sum.total)} note={filtered ? '필터 적용' : undefined} />
            {/*
              ★ 수납 완료는 **청구에 들어간 몫**만이다. 과납분(돌려줄 돈)은 여기에도 미수금에도
                섞지 않는다 — 섞으면 다른 입주사의 미수금이 깎여 보인다. 옆의 「환불액」이 그 몫이다.
            */}
            <SumCell label="수납 완료" value={won(sum.received)} />
            <SumCell label="미수금" value={won(sum.outstanding)} />
            {/*
              ★★ 환불액 — **과납 합계**다(받은 것이 청구보다 많은 장). 미수금과 반대 방향이고
                 절대 섞지 않는다. 정산 처리가 음수 수납으로 0 을 만든다.
              ★ 2026-11-15 — 이름 · 값 한 줄(나란히). 「없음」 · 「정산 대기 N건」 셋째 줄은 지웠다.
            */}
            <SumCell label="환불액 (과납)" value={won(sum.overpaid)} />
            {/* ★ 2026-11-15 — 이름 · 값 한 줄. 미납 금액은 건수 옆 괄호에(예: 3건 (1,250,000)). */}
            <div className={styles.sumCell}>
              <div className={styles.sumLabel}>미납</div>
              <div className={`${styles.sumValue} ${sum.unpaidCount === 0 ? styles.sumCountZero : styles.sumCount}`}>
                {sum.unpaidCount}건
                {sum.unpaidCount > 0 ? ` (${sum.unpaidAmount.toLocaleString('ko-KR')})` : ''}
              </div>
            </div>
          </div>
        }
        actions={companyChip}
      >
        <ListScroll>
          {items === null ? (
            <BillingEmpty lead="청구를 불러오는 중입니다" />
          ) : error ? (
            <BillingEmpty lead={error} />
          ) : inRange.length === 0 ? (
            <BillingEmpty
              lead={company ? '이 입주사의 청구서가 없습니다' : '이 납부기한에 든 청구가 없습니다'}
              sub="청구서는 계약을 확정하면 계약기간 전체가 만들어집니다"
            />
          ) : visible.length === 0 ? (
            <BillingEmpty lead="조건에 맞는 청구가 없습니다" sub="회사명이나 상태를 바꿔 보세요" />
          ) : (
            <>
              <BillingTable items={drawn} mode={company ? 'company' : 'month'} asOf={asOf} onChanged={notify} />
              {rest > 0 ? (
                <div className={styles.more} ref={sentinel} data-more={rest}>
                  <span className={styles.moreText}>
                    {visible.length}건 중 {drawn.length}건 표시 · 스크롤하면 더 나옵니다
                  </span>
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnGhost} ${styles.btnXs}`}
                    onClick={() => setShown((n) => n + PAGE)}
                  >
                    {Math.min(PAGE, rest)}건 더 보기
                  </button>
                </div>
              ) : null}
            </>
          )}
        </ListScroll>
      </ListFrame>
      </div>
      {toastEl}
    </>
  );
}

/** 총괄표 한 칸 — 이름 · 값(· 있으면 작은 글)을 한 줄에 나란히. 값은 `summarize` 가 낸다. */
function SumCell({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className={styles.sumCell} data-sum={label}>
      <div className={styles.sumLabel}>{label}</div>
      <div className={styles.sumValue}>{value}</div>
      {note ? <div className={styles.sumNote}>{note}</div> : null}
    </div>
  );
}
