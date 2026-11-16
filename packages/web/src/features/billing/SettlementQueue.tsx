'use client';

/**
 * 청구 화면의 「정산」 탭 — 왼쪽 목록(공통 목록 틀) 6 : 오른쪽 상세 4 (대표 지시 2026-11-15).
 *
 *   왼쪽  검색 한 줄(정산 기준일 From ~ To · 입주사 · 구분 전체 · 상태 전체 + [조회] [초기화]) → 버튼 줄(입주사 칩 · 건수) → 목록
 *         목록 칸(2026-11-16): 구분 · 입주사 · 호실 · 상태 · 시작일 · 종료일 · 중도해지일(만료는 빈칸) · 환불일자(완료 건만) · 정산금액
 *   오른쪽 고른 행의 상세 — 처음엔 「왼쪽에서 고르세요」 · 받는 동안 공통 로딩바
 *         중도해지 정산이 있는 계약 → 정산 카드([정산서] · 처리 전이면 [정산 처리])
 *         정산 없이 예치금만 남은 계약 → 반환할 예치금 · [반환 처리] / 반환한 뒤에는 반환일 · 금액 · 가린 계좌
 *
 * ★★ 한 업무는 한 화면에서(CLAUDE.md) — [정산 처리]·[정산서]·[예치금 반환] 은 **여기에만**
 *   있다. 동작은 그대로이고 자리만 오른쪽 상세로 옮겼다. 입주사 청구 탭은 요약 한 줄과 링크,
 *   계약 폼은 링크만 둔다. 링크는 `?tab=settle&company=&contract=` 로 와서 그 계약의 상세를 연 채로 보인다.
 * ★ 정산 기준일 = 중도해지면 중도해지일, 만료면 종료일. 처음은 이번 달 1일 ~ 말일, 상한 6개월
 *   (청구 화면 납부기한과 같은 함수 · 같은 말 — shared `billing-due-range`). 서버가 이 기간으로 거른다.
 * ★ 구분 · 상태의 코드값은 서버가 판정해 싣는다(shared `settleTypeOf` · `settleStatusOf`). 선택지와 목록의
 *   이름은 공통 코드 `SETTLE_TP` · `SETTLE_ST`(일회용 37)에서 읽는다 — 「전체」만 화면에 있다.
 * ★ 금액은 방향이 드러나는 이름으로 — 「환불할 금액」·「추가로 받을 금액」.
 * ★ 계좌번호는 목록에서 **가려서** 보인다(서버가 가려 준다). 전체 번호는 정산 카드 · 정산서에서만.
 * ★ 정산 한 장 전체는 입주사 청구 API 에서 받는다(목록 API 는 요약만 싣는다).
 * ★ 처리 뒤에는 목록 · 상세를 다시 받는다(`changed`).
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  SETTLE_STATUS_CATEGORY,
  SETTLE_TYPE_CATEGORY,
  settlementDirection,
} from '@swonbiz/shared/domain/settlement-view';
import { DUE_RANGE_TOO_LONG, isDueRangeTooLong } from '@swonbiz/shared/domain/billing-due-range';
import { Icon } from '@/components/ds';
import { ListFrame, ListNote, ListScroll } from '@/components/patterns/ListFrame';
import { LoadingBar } from '@/components/patterns/LoadingBar';
// ★ 검색 칸은 청구 탭과 같은 모양 · 같은 클래스(법인변경 목록의 것).
import cs from '@/features/legal/corp-changes.module.css';
import styles from './billing.module.css';
import { BillingEmpty } from './BillingTable';
import { DepositReturnDialog } from './DepositReturnDialog';
import { SettlementCard } from './SettlementCard';
import { currentMonthRange, dotDate, isIsoDay, won, type QueueItem, type Settlement } from './billing-model';

interface Props {
  notify: (message: string) => void;
  /** 입주사로 거르기(`?company=`) — null 이면 전체. */
  company: string | null;
  /** 상세를 연 계약(`?contract=`). */
  selected: string | null;
  onSelect: (contractId: string | null) => void;
  /** 버튼 줄 — 입주사 거르기 칩(있을 때만). */
  actions?: ReactNode;
}

/** 검색 조건 — 정산 기준일 From ~ To · 입주사(이름 일부) · 구분(SETTLE_TP) · 상태(SETTLE_ST). null = 전체. */
interface Cond {
  from: string;
  to: string;
  name: string;
  tp: string | null;
  st: string | null;
}

const defaultCond = (): Cond => ({ ...currentMonthRange(), name: '', tp: null, st: null });

/** 조건 검사 — 틀리면 화면에 보일 말. 기간은 둘 다 있어야 한다(서버가 전체를 내리지 않는다). */
function condError(c: Cond): string | null {
  if (!isIsoDay(c.from)) return '정산 기준일 시작일을 확인해 주세요';
  if (!isIsoDay(c.to)) return '정산 기준일 끝일을 확인해 주세요';
  if (c.from > c.to) return '정산 기준일 시작일이 끝일보다 늦습니다';
  // ★ 기간 상한 6개월 — 청구 화면 · API 와 같은 함수 · 같은 말(대표 결정).
  if (isDueRangeTooLong(c.from, c.to)) return DUE_RANGE_TOO_LONG;
  return null;
}

type Detail = { contractId: string; state: 'loading' } | { contractId: string; state: 'ok'; s: Settlement } | {
  contractId: string;
  state: 'missing';
  message: string;
};

type Option = { code: string; name: string };

export function SettlementQueue({ notify, company, selected, onSelect, actions }: Props) {
  const [cond, setCond] = useState<Cond>(defaultCond);
  const [draft, setDraft] = useState<Cond>(cond);
  const [formError, setFormError] = useState<string | null>(null);
  const [typeOptions, setTypeOptions] = useState<Option[]>([]);
  const [statusOptions, setStatusOptions] = useState<Option[]>([]);

  const [data, setData] = useState<{ pending: QueueItem[]; done: QueueItem[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [returning, setReturning] = useState<QueueItem | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);

  // 구분 · 상태 이름 — 공통 코드. 못 읽으면 선택지는 「전체」만, 목록에는 코드값이 보인다.
  useEffect(() => {
    let alive = true;
    void fetch('/api/codes')
      .then((r) => (r.ok ? (r.json() as Promise<{ codes?: { category: string; code: string; name: string }[] }>) : null))
      .then((b) => {
        if (!alive) return;
        const codes = b?.codes ?? [];
        const of = (category: string) => codes.filter((c) => c.category === category).map(({ code, name }) => ({ code, name }));
        setTypeOptions(of(SETTLE_TYPE_CATEGORY));
        setStatusOptions(of(SETTLE_STATUS_CATEGORY));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  /** ★ 늦게 온 응답이 새 조건을 덮지 않게 한다. */
  const seq = useRef(0);
  const load = useCallback(async (from: string, to: string) => {
    const mine = ++seq.current;
    try {
      const res = await fetch(`/api/billing/settlements?${new URLSearchParams({ from, to }).toString()}`);
      const body = (await res.json()) as { pending?: QueueItem[]; done?: QueueItem[]; message?: string };
      if (!res.ok) throw new Error(body.message ?? '정산 목록을 불러오지 못했습니다');
      if (mine !== seq.current) return;
      setData({ pending: body.pending ?? [], done: body.done ?? [] });
      setError(null);
    } catch (err) {
      if (mine !== seq.current) return;
      setData({ pending: [], done: [] });
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    setData(null);
    void load(cond.from, cond.to);
  }, [cond.from, cond.to, load]);

  const all = [...(data?.pending ?? []), ...(data?.done ?? [])];
  const itemOf = (contractId: string | null) => (contractId ? all.find((i) => i.contractId === contractId) ?? null : null);

  /**
   * 고른 계약의 정산 한 장. 입주사는 목록 행에서 찾고, 목록에 없으면(기간 밖 등)
   * 주소의 `company` 로 받는다 — 계약 폼·입주사 탭 링크는 둘 다 싣고 온다.
   */
  const companyOf = useCallback(
    (contractId: string) =>
      [...(data?.pending ?? []), ...(data?.done ?? [])].find((i) => i.contractId === contractId)?.companyId ?? company,
    [data, company],
  );

  /** 정산 한 장 — 상세 카드와 정산서가 같은 길로 받는다. 없으면 이유를 던진다. */
  const loadSettlement = useCallback(
    async (contractId: string): Promise<Settlement> => {
      const companyId = companyOf(contractId);
      if (!companyId) throw new Error('이 계약의 정산을 찾지 못했습니다');
      const res = await fetch(`/api/companies/${encodeURIComponent(companyId)}/billing`);
      const body = (await res.json()) as { settlements?: Settlement[]; message?: string };
      if (!res.ok) throw new Error(body.message ?? '정산을 불러오지 못했습니다');
      const s = body.settlements?.find((x) => x.contractId === contractId);
      if (!s) throw new Error('이 계약에는 중도해지 정산이 없습니다');
      return s;
    },
    [companyOf],
  );

  const fetchDetail = useCallback(
    async (contractId: string) => {
      setDetail((d) => (d?.contractId === contractId && d.state === 'ok' ? d : { contractId, state: 'loading' }));
      try {
        setDetail({ contractId, state: 'ok', s: await loadSettlement(contractId) });
      } catch (err) {
        setDetail({ contractId, state: 'missing', message: (err as Error).message });
      }
    },
    [loadSettlement],
  );

  // ★ 목록이 온 뒤에 연다 — 입주사를 목록 행에서 찾아야 한다.
  //   예치금 반환 행(정산 없음)은 받을 것이 없다 — 목록 행으로 그린다.
  const selectedItem = itemOf(selected);
  const needsCard = selected !== null && selectedItem?.kind !== 'deposit';
  useEffect(() => {
    if (data === null) return;
    if (!needsCard || selected === null) setDetail(null);
    else if (detail?.contractId !== selected) void fetchDetail(selected);
  }, [data, selected, needsCard, detail?.contractId, fetchDetail]);

  /** 처리 뒤 — 목록 · 상세를 다시 받는다. */
  const changed = (message: string) => {
    setReturning(null);
    notify(message);
    void load(cond.from, cond.to);
    if (selected && needsCard) void fetchDetail(selected);
  };

  /** [조회] — 쓰는 중인 조건을 적용한다. 틀리면 적용하지 않고 까닭을 보인다. */
  const search = () => {
    const next = { ...draft, name: draft.name.trim() };
    const err = condError(next);
    setFormError(err);
    if (err) return;
    setDraft(next);
    setCond(next);
    // 기간이 같아도 [조회] 는 다시 받는다.
    if (next.from === cond.from && next.to === cond.to) void load(next.from, next.to);
  };

  /** [초기화] — 처음 조건(이번 달 1일 ~ 말일 · 전체)으로 되돌리고 바로 적용. */
  const reset = () => {
    const base = defaultCond();
    setFormError(null);
    setDraft(base);
    setCond(base);
  };

  const q = cond.name.toLowerCase();
  const visible = all.filter(
    (i) =>
      (company === null || i.companyId === company) &&
      (q === '' || i.companyName.toLowerCase().includes(q)) &&
      (cond.tp === null || i.typeCode === cond.tp) &&
      (cond.st === null || i.statusCode === cond.st),
  );
  const nameOf = (options: Option[], code: string) => options.find((o) => o.code === code)?.name ?? code;

  const pick = (contractId: string) => onSelect(selected === contractId ? null : contractId);

  // ★ 2026-11-16 — 위 이름표 없음 · 한 줄(청구 · 수납 탭과 같은 모양). 날짜 기간만 왼쪽에 짧은 이름.
  const searchBox = (
    <>
      <span className={styles.searchRange}>
        <span className={styles.searchRangeName}>정산 기준일</span>
        <input
          type="date"
          className={`${cs.input} ${styles.searchDate}`}
          aria-label="정산 기준일 시작일"
          value={draft.from}
          onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
        />
        ~
        <input
          type="date"
          className={`${cs.input} ${styles.searchDate}`}
          aria-label="정산 기준일 끝일"
          value={draft.to}
          onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
        />
      </span>
      <input
        className={`${cs.input} ${styles.searchText}`}
        placeholder="입주사"
        aria-label="입주사"
        value={draft.name}
        onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') search();
        }}
      />
      <select
        className={`${cs.select} ${styles.searchSelect}`}
        aria-label="구분"
        value={draft.tp ?? ''}
        onChange={(e) => setDraft((d) => ({ ...d, tp: e.target.value || null }))}
      >
        <option value="">구분 전체</option>
        {typeOptions.map((o) => (
          <option key={o.code} value={o.code}>
            {o.name}
          </option>
        ))}
      </select>
      <select
        className={`${cs.select} ${styles.searchSelect}`}
        aria-label="상태"
        value={draft.st ?? ''}
        onChange={(e) => setDraft((d) => ({ ...d, st: e.target.value || null }))}
      >
        <option value="">상태 전체</option>
        {statusOptions.map((o) => (
          <option key={o.code} value={o.code}>
            {o.name}
          </option>
        ))}
      </select>
      <button type="button" className={`${styles.btn} ${styles.btnPrimary} ${styles.searchBtn}`} onClick={search}>
        조회
      </button>
      <button type="button" className={`${styles.btn} ${styles.btnGhost} ${styles.searchBtn}`} onClick={reset}>
        <Icon name="rotate-ccw" size={16} />
        초기화
      </button>
      {formError ? (
        <span className={styles.searchError} role="alert">
          {formError}
        </span>
      ) : null}
    </>
  );

  const rowProps = (item: QueueItem) => ({
    role: 'button' as const,
    tabIndex: 0,
    'aria-selected': selected === item.contractId,
    className: `${styles.sRow} ${styles.qRowClickable}${selected === item.contractId ? ` ${styles.qRowOn}` : ''}`,
    onClick: () => pick(item.contractId),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        pick(item.contractId);
      }
    },
  });

  /**
   * 정산금액 칸 — 금액 한 줄만(대표 지시 2026-11-15). 처리 전 · 처리 뒤 같은 규칙.
   *   입주사가 낼 돈(추가로 받을 금액) → 앞에 「−」(저장소 다른 금액과 같은 빼기표, `won`) · 예: −₩120,000
   *   입주사에게 돌려줄 돈(환불 · 예치금 반환) → 부호 없음 · 예: ₩350,000
   *   0 → 「—」
   * ★ `amount` 부호는 순정산금과 같다(양수 = 돌려줄 돈). 방향 판정은 `settlementDirection` 하나.
   */
  const amountCell = (item: QueueItem) => {
    const dir = settlementDirection(item.amount);
    return (
      <span className={styles.right}>
        <span className={styles.amount}>
          {dir.kind === 'none' ? '—' : won(item.amount)}
        </span>
      </span>
    );
  };

  const list =
    data === null ? (
      <BillingEmpty lead="정산 목록을 불러오는 중입니다" />
    ) : error ? (
      <BillingEmpty lead={error} />
    ) : visible.length === 0 ? (
      <BillingEmpty lead="조건에 맞는 정산이 없습니다" sub="정산 기준일 · 입주사 · 구분 · 상태를 바꿔 보세요" />
    ) : (
      <>
        <div className={`${styles.sHead} ${styles.tHeadSticky}`}>
          {/* ★ 2026-11-16 칸 순서(대표 지시): 구분 · 입주사 · 호실 · 상태 · 시작일 · 종료일 · 중도해지일 · 환불일자 · 정산금액 */}
          <span>구분</span>
          <span>입주사</span>
          <span>호실</span>
          <span>상태</span>
          {/* ★ 시작일 — 종료일 앞이다. 둘을 나란히 보면 얼마나 쓰다 나갔는지가 읽힌다. */}
          <span>시작일</span>
          <span>종료일</span>
          <span>중도해지일</span>
          <span>환불일자</span>
          <span className={styles.right}>정산금액</span>
        </div>
        {visible.map((item) => (
          <div key={`${item.kind}:${item.contractId}`} {...rowProps(item)} data-queue-row={item.contractId}>
            <span className={styles.ellipsis}>{nameOf(typeOptions, item.typeCode)}</span>
            <span className={`${styles.ellipsis} ${styles.strong}`} title={item.companyName}>
              {item.companyName}
            </span>
            <span className={styles.ellipsis} title={item.roomNames}>
              {item.roomNames || '—'}
            </span>
            <span>
              <span className={`${styles.badge} ${item.statusCode === 'WAIT' ? styles.st_partial : styles.st_paid}`}>
                {nameOf(statusOptions, item.statusCode)}
              </span>
            </span>
            <span className={`${styles.mono} ${styles.sDate}`}>{item.startDate ? dotDate(item.startDate) : '—'}</span>
            <span className={`${styles.mono} ${styles.sDate}`}>{dotDate(item.endDate)}</span>
            <span className={`${styles.mono} ${styles.sDate}`}>
              {item.terminatedDate ? dotDate(item.terminatedDate) : ''}
            </span>
            {/* ★ 환불일자 — 완료 건은 처리한 날(processedOn), 대기 건은 빈칸(2026-11-15). */}
            <span className={`${styles.mono} ${styles.sDate}`}>
              {item.statusCode === 'DONE' && item.processedOn ? dotDate(item.processedOn) : ''}
            </span>
            {amountCell(item)}
          </div>
        ))}
      </>
    );

  /** 오른쪽 상세 — 처음엔 「왼쪽에서 고르세요」. */
  const detailPane =
    selected === null ? (
      <BillingEmpty lead="왼쪽에서 고르세요" sub="정산 목록의 행을 누르면 여기에 상세가 나옵니다" />
    ) : selectedItem?.kind === 'deposit' ? (
      <DepositDetail item={selectedItem} onReturn={() => setReturning(selectedItem)} />
    ) : detail === null || detail.state === 'loading' ? (
      // ★ 2026-11-16 — 받는 동안 공통 로딩바(「불러오는 중」 글자 대신).
      <LoadingBar />
    ) : detail.state === 'missing' ? (
      <p className={styles.muted}>{detail.message}</p>
    ) : (
      <SettlementCard s={detail.s} onProcessed={changed} />
    );

  return (
    <div className={styles.settleSplit}>
      {/* ★ 2026-11-16 — 청구 · 수납 탭과 같은 촘촘한 틀(.dense) — 검색 상자 같게. */}
      <div className={`${styles.settleLeft} ${styles.dense}`}>
        {/* ★ 2026-11-16 — 건수는 버튼 줄로(검색 상자 한 줄). 입주사 칩이 있으면 그 옆. */}
        <ListFrame
          search={searchBox}
          actions={
            <>
              {actions ?? null}
              {data === null || error ? null : <ListNote>{visible.length}건</ListNote>}
            </>
          }
        >
          <ListScroll>{list}</ListScroll>
        </ListFrame>
      </div>
      <div className={styles.settleRight} data-settle-detail={selected ?? ''}>
        {detailPane}
      </div>

      {returning ? (
        <DepositReturnDialog
          contractId={returning.contractId}
          companyName={returning.companyName}
          amount={returning.amount}
          onClose={() => setReturning(null)}
          onDone={changed}
        />
      ) : null}
    </div>
  );
}

/**
 * 정산 없이 예치금만 남은 계약(기간 만료 등)의 상세 — 정산서가 없다.
 * 처리 전: 반환할 예치금 · [반환 처리](전에 목록 행에 있던 단추) / 처리 뒤: 반환일 · 금액 · 가린 계좌.
 */
function DepositDetail({ item, onReturn }: { item: QueueItem; onReturn: () => void }) {
  const waiting = item.statusCode === 'WAIT';
  return (
    <div className={styles.settleCard} data-deposit-detail={item.contractId}>
      <div className={styles.settleHead}>
        <span className={styles.settleTitle}>
          예치금 반환
          <span className={styles.settleMeta}>
            {item.companyName} · {item.roomNames || '—'}
          </span>
        </span>
        <span className={`${styles.badge} ${waiting ? styles.st_partial : styles.st_paid}`}>
          {waiting ? '처리 대기' : `${item.processedOn ? dotDate(item.processedOn) : ''} 처리 완료`}
        </span>
      </div>
      <div className={styles.settlePeriods}>
        <span>
          <span className={styles.factKey}>계약 기간</span> {item.startDate ? dotDate(item.startDate) : '—'} ~{' '}
          {dotDate(item.endDate)}
        </span>
        {item.terminatedDate ? (
          <span>
            <span className={styles.factKey}>중도해지일</span> {dotDate(item.terminatedDate)}
          </span>
        ) : null}
      </div>
      <div className={styles.settleNet}>
        <div>
          <div className={styles.factKey}>{waiting ? '반환할 예치금' : '반환한 예치금'}</div>
          <div className={styles.settleNetValue}>{won(Math.abs(item.amount))}</div>
        </div>
        <span className={styles.actions}>
          {waiting ? (
            <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onReturn}>
              반환 처리
            </button>
          ) : null}
        </span>
      </div>
      {!waiting ? (
        <div className={styles.settleProcessed}>
          {item.processedOn ? dotDate(item.processedOn) : '—'} · <b>예치금 반환 {won(Math.abs(item.amount))}</b> ·{' '}
          <span className={styles.mono} data-account="1">
            {item.account || '—'}
          </span>
        </div>
      ) : null}
    </div>
  );
}
