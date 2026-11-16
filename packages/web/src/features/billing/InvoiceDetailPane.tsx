'use client';

/** @screen s030200070 청구 · 수납 오른쪽 상세 · 020 입주사관리 */

/**
 * 청구서 한 장의 상세 — 청구 항목 · 수납 목록 · 수납 수정·삭제. 청구 · 수납 탭의 **오른쪽 칸**에 그린다.
 *
 * ★ 2026-11-16 대표 지시 — 줄마다 있던 [내역] 창(s030200070p2)을 오른쪽 상세로 옮겼다. 자리 · 모양만 바뀌었고
 *   보이는 값 · 수납 고치기/지우기 · 「+ 수납」 동작은 창일 때 그대로다(한 업무는 한 화면에서 — CLAUDE.md).
 * ★ 받는 동안 칸 맨 위에 공통 로딩바(`LoadingBar`).
 * ★ 수납을 고치거나 지우면 Fastify 가 **같은 트랜잭션에서** 청구 상태를 다시 센다.
 *   여기서는 다시 받아 그릴 뿐이고, 부르는 쪽 목록도 `onChanged` 로 다시 받게 한다 —
 *   상세의 숫자와 왼쪽 목록이 다르면 운영자가 어느 쪽을 믿을지 모른다.
 * ★ 부르는 쪽이 따로 수납을 넣으면(버튼 줄 [수납]) `reloadKey` 를 올려 다시 받게 한다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/ds';
import { LoadingBar } from '@/components/patterns/LoadingBar';
import styles from './billing.module.css';
import {
  PAY_METHOD_LABEL,
  STATUS_LABEL,
  dotDate,
  statusOf,
  won,
  yearMonthDot,
  type InvoiceDetail,
  type Payment,
} from './billing-model';
import { PaymentDialog, type PaymentTarget } from './PaymentDialog';

interface Props {
  invoiceId: string;
  companyName: string;
  roomNames: string;
  /**
   * 그 계약의 값 — 예치금(장부 잔액, 계약 없는 청구서는 null) · 이용 기간(2026-11-16 목록에서 옮김).
   * 목록 줄에서 넘겨받는다. 목록에 없으면(null) 「—」.
   */
  contract: { deposit: number | null; usageStart: string | null; usageEnd: string | null } | null;
  /** 올리면 다시 받는다(버튼 줄 [수납] 뒤). */
  reloadKey: number;
  /** 수납이 바뀌었다 — 왼쪽 목록을 다시 받는다. */
  onChanged: (message: string) => void;
}

export function InvoiceDetailPane({ invoiceId, companyName, roomNames, contract, reloadKey, onChanged }: Props) {
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** 열린 수납 창 — `null` 이면 닫힘, `'new'` 면 새 수납, 아니면 고칠 수납. */
  const [paying, setPaying] = useState<'new' | Payment | null>(null);
  /** 삭제를 한 번 누른 수납. 두 번째 눌러야 지운다. */
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** ★ 늦게 온 응답이 새로 고른 청구서를 덮지 않게 한다. */
  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}`);
      const body = (await res.json()) as InvoiceDetail & { message?: string };
      if (!res.ok) throw new Error(body.message ?? '청구서를 불러오지 못했습니다');
      if (mine !== seq.current) return;
      setDetail(body);
      setError(null);
    } catch (err) {
      if (mine !== seq.current) return;
      setError((err as Error).message);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [invoiceId]);

  // 다른 청구서를 고르면 앞 청구서를 지우고 받는다 — 받는 동안 앞 값이 남아 보이지 않게.
  useEffect(() => {
    setDetail(null);
    setError(null);
    setPaying(null);
    setConfirmDelete(null);
  }, [invoiceId]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const today = useMemo(() => new Date(), [detail]);
  const status = detail ? statusOf(detail, today) : null;
  const free = detail?.lines.some((l) => l.isFree) ?? false;

  const target: PaymentTarget | null = detail
    ? {
        invoiceId,
        yearMonth: detail.yearMonth,
        companyName,
        roomNames,
        totalAmount: detail.totalAmount,
        outstanding: detail.outstanding,
      }
    : null;

  const remove = async (payment: Payment) => {
    if (confirmDelete !== payment.paymentId) {
      setConfirmDelete(payment.paymentId);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/payments/${payment.paymentId}`, { method: 'DELETE' });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) throw new Error(body.message ?? '수납을 지우지 못했습니다');
      setConfirmDelete(null);
      await load();
      onChanged(`${won(payment.amount)} 수납을 지웠습니다`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const title = detail ? `${yearMonthDot(detail.yearMonth)} 청구 내역` : '청구 내역';

  return (
    <>
      {loading ? <LoadingBar /> : null}
      <div className={styles.settleCard} data-invoice-detail={invoiceId}>
        <div className={styles.settleHead}>
          <span className={styles.settleTitle}>
            {title}
            <span className={styles.settleMeta}>
              {companyName}
              {roomNames ? ` · ${roomNames}` : ''}
              {detail ? ` · 납부기한 ${dotDate(detail.dueDate)}` : ''}
            </span>
          </span>
          {status ? (
            <span>
              <span className={`${styles.badge} ${styles[`st_${status}`]}`}>{STATUS_LABEL[status]}</span>
              {free ? (
                <>
                  {' '}
                  <span className={styles.free}>무상</span>
                </>
              ) : null}
            </span>
          ) : null}
        </div>

        {error ? <p className={styles.formError}>{error}</p> : null}

        {detail ? (
          <>
            <div className={styles.facts}>
              <div className={styles.fact}>
                <div className={styles.factKey}>청구액</div>
                <div className={styles.factValue}>{free ? '무상' : won(detail.totalAmount)}</div>
              </div>
              <div className={styles.fact}>
                <div className={styles.factKey}>수납</div>
                <div className={styles.factValue}>{won(detail.paidAmount)}</div>
              </div>
              <div className={styles.fact}>
                <div className={styles.factKey}>남은 금액</div>
                <div className={`${styles.factValue}${detail.outstanding > 0 ? ` ${styles.negative}` : ''}`}>
                  {won(detail.outstanding)}
                </div>
              </div>
              {/*
                ★ 2026-11-16 — 목록에서 뺀 계약의 값 셋(예치금 · 이용 시작일 · 이용 종료일)을 여기에.
                  오른쪽 칸 폭(약 430px)에 다섯 칸이 한 줄로 들지 않아 같은 상자의 둘째 줄에 둔다.
                  ★ 예치금은 **장부 잔액**이다 — 반환·차감 뒤에는 0 이다. 중도해지면 종료는 실제 종료일자.
              */}
              <div className={`${styles.fact} ${styles.factRow2}`}>
                <div className={styles.factKey}>예치금</div>
                <div className={styles.factValue}>
                  {contract && contract.deposit !== null ? won(contract.deposit) : '—'}
                </div>
              </div>
              <div className={`${styles.fact} ${styles.factRow2} ${styles.factSpan2}`}>
                <div className={styles.factKey}>이용 기간</div>
                <div className={styles.factValue}>
                  {contract?.usageStart ? dotDate(contract.usageStart) : '—'} ~{' '}
                  {contract?.usageEnd ? dotDate(contract.usageEnd) : '—'}
                </div>
              </div>
            </div>

            <div className={styles.section}>
              <div className={styles.sectionHead}>
                <h4 className={styles.sectionTitle}>청구 항목</h4>
              </div>
              <div className={styles.miniTable}>
                <div className={`${styles.miniRow} ${styles.miniHead} ${styles.linesGrid}`}>
                  <span>호실</span>
                  <span className={styles.right}>수량</span>
                  <span className={styles.right}>공급가</span>
                  <span className={styles.right}>부가세</span>
                  <span className={styles.right}>합계</span>
                </div>
                {detail.lines.map((line) => (
                  <div key={line.invoiceLineId} className={`${styles.miniRow} ${styles.linesGrid}`}>
                    <span className={styles.ellipsis}>{line.roomName || '—'}</span>
                    <span className={`${styles.right} ${styles.mono}`}>{line.quantity}</span>
                    {line.isFree ? (
                      /*
                       * ★ 무상 줄은 금액이 0 이다. 「₩0」만 적으면 청구를 빠뜨린 것처럼
                       *   읽힌다 — 얼마짜리를 무상으로 줬는지(단가)를 같이 적는다.
                       */
                      <span className={styles.right} style={{ gridColumn: 'span 3' }}>
                        <span className={styles.free}>무상</span>{' '}
                        <span className={styles.muted}>이용료 {won(line.unitPrice * line.quantity)}</span>
                      </span>
                    ) : (
                      <>
                        <span className={`${styles.right} ${styles.mono}`}>{won(line.supplyAmount)}</span>
                        <span className={`${styles.right} ${styles.mono}`}>{won(line.vatAmount)}</span>
                        <span className={`${styles.right} ${styles.mono} ${styles.strong}`}>
                          {won(line.totalAmount)}
                        </span>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.section}>
              <div className={styles.sectionHead}>
                <h4 className={styles.sectionTitle}>수납 {detail.payments.length}건</h4>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnGhost} ${styles.btnXs}`}
                  disabled={detail.status === 'C' || busy}
                  onClick={() => setPaying('new')}
                >
                  <Icon name="plus" size={14} />
                  수납
                </button>
              </div>
              <div className={styles.miniTable}>
                {detail.payments.length === 0 ? (
                  <div className={styles.miniEmpty}>들어온 수납이 없습니다</div>
                ) : (
                  <>
                    <div className={`${styles.miniRow} ${styles.miniHead} ${styles.paysGrid}`}>
                      <span>입금일</span>
                      <span className={styles.right}>금액</span>
                      <span>수단</span>
                      <span />
                      <span />
                    </div>
                    {detail.payments.map((p) => {
                      /*
                       * ★ 2026-11-16 — 비고는 칸이 아니라 **그 줄 아래 한 줄**(말줄임 없이). 비고가 있는 줄만.
                       *   오른쪽 상세(약 430px)에 다섯 칸이 들지 않아 비고 칸이 거의 0 이 됐다(대표 결정).
                       *   보이는 글은 전과 같다 — 비고, 비고 없는 음수 수납은 「환불」.
                       */
                      const memo = p.amount < 0 && !p.memo ? '환불' : p.memo;
                      return (
                      <div key={p.paymentId} className={`${styles.miniRow} ${styles.paysGrid}`}>
                        <span className={styles.mono}>{dotDate(p.paidOn)}</span>
                        <span
                          className={`${styles.right} ${styles.mono} ${styles.strong}${p.amount < 0 ? ` ${styles.negative}` : ''}`}
                        >
                          {won(p.amount)}
                        </span>
                        <span>{PAY_METHOD_LABEL[p.payMethod] ?? p.payMethod}</span>
                        <span />
                        <span className={styles.actions}>
                          <button
                            type="button"
                            className={`${styles.btn} ${styles.btnGhost} ${styles.btnXs}`}
                            disabled={busy}
                            onClick={() => setPaying(p)}
                          >
                            수정
                          </button>
                          <button
                            type="button"
                            className={`${styles.btn} ${styles.btnGhost} ${styles.btnXs}`}
                            disabled={busy}
                            onClick={() => void remove(p)}
                          >
                            {confirmDelete === p.paymentId ? '삭제 확인' : '삭제'}
                          </button>
                        </span>
                        {memo ? <span className={`${styles.muted} ${styles.paysMemo}`}>{memo}</span> : null}
                      </div>
                      );
                    })}
                  </>
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>

      {paying && target ? (
        <PaymentDialog
          target={target}
          editing={paying === 'new' ? null : paying}
          onClose={() => setPaying(null)}
          onSaved={(message) => {
            setPaying(null);
            void load();
            onChanged(message);
          }}
        />
      ) : null}
    </>
  );
}
