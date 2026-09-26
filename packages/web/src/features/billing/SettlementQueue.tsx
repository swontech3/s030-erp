'use client';

/**
 * 청구 화면의 「정산」 탭 — 처리 대기 목록과 최근 처리 완료.
 *
 *   중도해지 정산 대기   행을 누르면 그 아래에 정산 상세(카드) — [정산 처리] [정산서]
 *   예치금 반환 대기     [반환 처리]            ← 기간 만료로 끝난 계약. 정산서 없이 반환만
 *
 * ★★ 한 업무는 한 화면에서(CLAUDE.md) — [정산 처리]·[정산서]·[예치금 반환] 은 **여기에만**
 *   있다. 입주사 청구 탭은 요약 한 줄과 링크, 계약 폼은 링크만 둔다. 링크는
 *   `?tab=settle&company=&contract=` 로 와서 그 계약의 상세를 연 채로 보인다.
 *
 * ★ 무엇이 대기인지는 서버가 `pendingKind`(shared) 하나로 판정해서 준다.
 * ★ 금액은 방향이 드러나는 이름으로 — 「환불할 금액」·「추가로 받을 금액」.
 * ★ 계좌번호는 목록에서 **가려서** 보인다(서버가 가려 준다). 전체 번호는 상세·정산서에서만.
 * ★ 정산 한 장 전체는 입주사 청구 API 에서 받는다(목록 API 는 요약만 싣는다).
 */
import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
import { settlementDirection } from '@swonbiz/shared/domain/settlement-view';
import { Icon } from '@/components/ds';
import styles from './billing.module.css';
import { BillingEmpty } from './BillingTable';
import { DepositReturnDialog } from './DepositReturnDialog';
import { SettlementCard } from './SettlementCard';
import { dotDate, won, type QueueItem, type Settlement } from './billing-model';

const KIND_LABEL: Record<QueueItem['kind'], string> = {
  settlement: '중도해지 정산 대기',
  deposit: '예치금 반환 대기',
};

interface Props {
  notify: (message: string) => void;
  /** 입주사로 거르기(`?company=`) — null 이면 전체. */
  company: string | null;
  /** 상세를 연 계약(`?contract=`). */
  selected: string | null;
  onSelect: (contractId: string | null) => void;
}

type Detail = { contractId: string; state: 'loading' } | { contractId: string; state: 'ok'; s: Settlement } | {
  contractId: string;
  state: 'missing';
  message: string;
};

export function SettlementQueue({ notify, company, selected, onSelect }: Props) {
  const [data, setData] = useState<{ pending: QueueItem[]; done: QueueItem[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [returning, setReturning] = useState<QueueItem | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/billing/settlements');
      const body = (await res.json()) as { pending?: QueueItem[]; done?: QueueItem[]; message?: string };
      if (!res.ok) throw new Error(body.message ?? '정산 목록을 불러오지 못했습니다');
      setData({ pending: body.pending ?? [], done: body.done ?? [] });
      setError(null);
    } catch (err) {
      setData({ pending: [], done: [] });
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * 고른 계약의 정산 한 장. 입주사는 목록 행에서 찾고, 목록에 없으면(90일 지난 처리 완료 등)
   * 주소의 `company` 로 받는다 — 계약 폼·입주사 탭 링크는 둘 다 싣고 온다.
   */
  const companyOf = useCallback(
    (contractId: string) =>
      [...(data?.pending ?? []), ...(data?.done ?? [])].find((i) => i.contractId === contractId)?.companyId ?? company,
    [data, company],
  );

  const fetchDetail = useCallback(
    async (contractId: string) => {
      const companyId = companyOf(contractId);
      if (!companyId) {
        setDetail({ contractId, state: 'missing', message: '이 계약의 정산을 찾지 못했습니다' });
        return;
      }
      setDetail((d) => (d?.contractId === contractId && d.state === 'ok' ? d : { contractId, state: 'loading' }));
      try {
        const res = await fetch(`/api/companies/${encodeURIComponent(companyId)}/billing`);
        const body = (await res.json()) as { settlements?: Settlement[]; message?: string };
        if (!res.ok) throw new Error(body.message ?? '정산을 불러오지 못했습니다');
        const s = body.settlements?.find((x) => x.contractId === contractId);
        setDetail(
          s
            ? { contractId, state: 'ok', s }
            : { contractId, state: 'missing', message: '이 계약에는 중도해지 정산이 없습니다' },
        );
      } catch (err) {
        setDetail({ contractId, state: 'missing', message: (err as Error).message });
      }
    },
    [companyOf],
  );

  // ★ 목록이 온 뒤에 연다 — 입주사를 목록 행에서 찾아야 한다.
  useEffect(() => {
    if (data === null) return;
    if (selected === null) setDetail(null);
    else if (detail?.contractId !== selected) void fetchDetail(selected);
  }, [data, selected, detail?.contractId, fetchDetail]);

  const changed = (message: string) => {
    setReturning(null);
    notify(message);
    void load();
    if (selected) void fetchDetail(selected);
  };

  if (data === null) return <BillingEmpty lead="정산 목록을 불러오는 중입니다" />;
  if (error) return <BillingEmpty lead={error} />;

  const mine = (i: QueueItem) => company === null || i.companyId === company;
  const pending = data.pending.filter(mine);
  const done = data.done.filter(mine);
  const listed = [...pending, ...done].some((i) => i.kind === 'settlement' && i.contractId === selected);

  const detailBlock =
    detail === null ? null : (
      <div className={styles.settleList} data-settle-detail={detail.contractId}>
        {detail.state === 'loading' ? (
          <p className={styles.muted}>정산을 불러오는 중입니다</p>
        ) : detail.state === 'missing' ? (
          <p className={styles.muted}>{detail.message}</p>
        ) : (
          <SettlementCard s={detail.s} onProcessed={changed} />
        )}
      </div>
    );

  /** 정산 행은 눌러서 상세를 연다(다시 누르면 닫는다). 예치금 반환 행은 상세가 없다. */
  const rowProps = (item: QueueItem) =>
    item.kind === 'settlement'
      ? {
          role: 'button' as const,
          tabIndex: 0,
          'aria-expanded': selected === item.contractId,
          className: `${styles.qRow} ${styles.qRowClickable}${selected === item.contractId ? ` ${styles.qRowOn}` : ''}`,
          onClick: () => onSelect(selected === item.contractId ? null : item.contractId),
          onKeyDown: (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelect(selected === item.contractId ? null : item.contractId);
            }
          },
        }
      : { className: styles.qRow };

  return (
    <>
      {/* 목록에 없는 계약(90일 지난 처리 완료 · 거른 입주사 밖)의 상세는 위에 연다. */}
      {selected && !listed ? detailBlock : null}

      <h3 className={styles.sectionLabel}>처리 대기 {pending.length}건</h3>
      {pending.length === 0 ? (
        <BillingEmpty lead="처리할 정산이 없습니다" />
      ) : (
        <>
          <div className={styles.qHead}>
            <span>구분</span>
            <span>입주사</span>
            <span>호실</span>
            <span>종료일</span>
            <span className={styles.right}>환불할 / 받을 금액</span>
            <span />
          </div>
          {pending.map((item) => {
            const dir = settlementDirection(item.amount);
            return (
              <div key={`${item.kind}:${item.contractId}`}>
                <div {...rowProps(item)} data-queue-row={item.contractId}>
                  <span>
                    <span className={`${styles.badge} ${styles.st_partial}`}>{KIND_LABEL[item.kind]}</span>
                  </span>
                  <span className={`${styles.ellipsis} ${styles.strong}`}>{item.companyName}</span>
                  <span className={styles.ellipsis}>{item.roomNames || '—'}</span>
                  <span className={styles.mono}>{dotDate(item.terminatedDate)}</span>
                  <span className={styles.right}>
                    <span className={styles.amountSub} style={{ marginTop: 0 }}>
                      {dir.label}
                    </span>
                    <span className={styles.amount}>{dir.kind === 'none' ? '—' : won(dir.amount)}</span>
                  </span>
                  <span className={styles.actions}>
                    {item.kind === 'settlement' ? (
                      <span className={styles.muted}>
                        상세 <Icon
                          name="chevron-right"
                          size={16}
                          style={{ transform: selected === item.contractId ? 'rotate(-90deg)' : 'rotate(90deg)' }}
                        />
                      </span>
                    ) : (
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnPrimary} ${styles.btnXs}`}
                        onClick={() => setReturning(item)}
                      >
                        반환 처리
                      </button>
                    )}
                  </span>
                </div>
                {item.kind === 'settlement' && selected === item.contractId ? detailBlock : null}
              </div>
            );
          })}
        </>
      )}

      <h3 className={styles.sectionLabel}>처리 완료 (최근 90일) {done.length}건</h3>
      {done.length === 0 ? (
        <BillingEmpty lead="최근에 처리한 정산이 없습니다" />
      ) : (
        done.map((item) => {
          const dir = settlementDirection(item.amount);
          return (
            <div key={`done:${item.kind}:${item.contractId}`}>
              <div {...rowProps(item)} data-done-row={item.contractId}>
                <span>
                  <span className={`${styles.badge} ${styles.st_paid}`}>처리 완료</span>
                </span>
                <span className={`${styles.ellipsis} ${styles.strong}`}>{item.companyName}</span>
                <span className={styles.ellipsis}>{item.roomNames || '—'}</span>
                <span className={styles.mono}>{dotDate(item.processedOn ?? '')}</span>
                <span className={styles.right}>
                  <span className={styles.amountSub} style={{ marginTop: 0 }}>
                    {item.kind === 'deposit' ? '예치금 반환' : dir.kind === 'charge' ? '받음' : '환불'}
                  </span>
                  <span className={styles.amount}>{won(Math.abs(item.amount))}</span>
                </span>
                <span className={`${styles.right} ${styles.muted} ${styles.mono}`} data-account="1">
                  {item.account || '—'}
                </span>
              </div>
              {item.kind === 'settlement' && selected === item.contractId ? detailBlock : null}
            </div>
          );
        })
      )}

      {returning ? (
        <DepositReturnDialog
          contractId={returning.contractId}
          companyName={returning.companyName}
          amount={returning.amount}
          onClose={() => setReturning(null)}
          onDone={changed}
        />
      ) : null}
    </>
  );
}
