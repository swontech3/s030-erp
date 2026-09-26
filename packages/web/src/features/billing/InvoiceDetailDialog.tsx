'use client';

/** @screen s0300200070p2 청구서 내역 · 020 입주사관리 */

/**
 * 청구서 한 장의 내역 — 호실 줄 · 수납 목록 · 수납 수정·삭제.
 *
 * ★ 디자인이 없다 — 상태 전이 확인 창(s0300200040p2)의 뼈대를 쓰고, 표가 들어가서
 *   폭만 넓혔다(640px).
 *
 * ★ 수납을 고치거나 지우면 Fastify 가 **같은 트랜잭션에서** 청구 상태를 다시 센다.
 *   여기서는 다시 받아 그릴 뿐이고, 부르는 쪽 목록도 `onChanged` 로 다시 받게 한다 —
 *   창 안의 숫자와 뒤의 표가 다르면 운영자가 어느 쪽을 믿을지 모른다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/ds';
import cf from '@/features/contracts/contract-form.module.css';
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
  onClose: () => void;
  /** 수납이 바뀌었다 — 뒤의 목록을 다시 받는다. */
  onChanged: (message: string) => void;
}

export function InvoiceDetailDialog({ invoiceId, companyName, roomNames, onClose, onChanged }: Props) {
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 열린 수납 창 — `null` 이면 닫힘, `'new'` 면 새 수납, 아니면 고칠 수납. */
  const [paying, setPaying] = useState<'new' | Payment | null>(null);
  /** 삭제를 한 번 누른 수납. 두 번째 눌러야 지운다. */
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/invoices/${invoiceId}`);
      const body = (await res.json()) as InvoiceDetail & { message?: string };
      if (!res.ok) throw new Error(body.message ?? '청구서를 불러오지 못했습니다');
      setDetail(body);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [invoiceId]);

  useEffect(() => {
    void load();
  }, [load]);

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
      <div
        className={cf.overlay}
        role="presentation"
        onClick={(e) => {
          if (e.target === e.currentTarget && !paying) onClose();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !paying) onClose();
        }}
      >
        <div className={`${cf.modal} ${styles.wideModal}`} role="dialog" aria-modal="true" aria-label={title}>
          <div className={cf.modalIconWrap}>
            <span className={`${cf.modalIcon} ${cf.modalIconConfirm}`}>
              <Icon name="file-text" size={24} />
            </span>
          </div>
          <h3 className={cf.modalTitle}>{title}</h3>
          <p className={cf.modalDesc}>
            {companyName}
            {roomNames ? ` · ${roomNames}` : ''}
            {detail ? ` · 납부일 ${dotDate(detail.dueDate)}` : ''}
            {status ? (
              <>
                {' '}
                <span className={`${styles.badge} ${styles[`st_${status}`]}`}>{STATUS_LABEL[status]}</span>
                {free ? (
                  <>
                    {' '}
                    <span className={styles.free}>무상</span>
                  </>
                ) : null}
              </>
            ) : null}
          </p>

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
                        <span>비고</span>
                        <span />
                      </div>
                      {detail.payments.map((p) => (
                        <div key={p.paymentId} className={`${styles.miniRow} ${styles.paysGrid}`}>
                          <span className={styles.mono}>{dotDate(p.paidOn)}</span>
                          <span
                            className={`${styles.right} ${styles.mono} ${styles.strong}${p.amount < 0 ? ` ${styles.negative}` : ''}`}
                          >
                            {won(p.amount)}
                          </span>
                          <span>{PAY_METHOD_LABEL[p.payMethod] ?? p.payMethod}</span>
                          <span className={`${styles.ellipsis} ${styles.muted}`} title={p.memo}>
                            {p.amount < 0 && !p.memo ? '환불' : p.memo || '—'}
                          </span>
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
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
            </>
          ) : !error ? (
            <p className={cf.modalDesc}>불러오는 중입니다</p>
          ) : null}

          <div className={cf.modalFoot}>
            <button type="button" className={`${cf.btn} ${cf.btnGhost}`} onClick={onClose}>
              닫기
            </button>
          </div>
        </div>
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
