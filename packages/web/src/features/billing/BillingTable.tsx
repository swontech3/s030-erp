'use client';

/**
 * 청구 표 — 월별 청구(s0300200070)와 입주사 청구 탭이 **같은 표, 같은 창**을 쓴다.
 *
 * ★ [수납]·[내역] 창을 이 컴포넌트가 들고 있다. 두 화면이 각자 창을 열면 한쪽만
 *   고쳐지고, 「같은 청구서인데 여기서 넣으면 되고 저기서 넣으면 안 된다」가 생긴다.
 *
 * ★ 합계 줄은 `summarize` 가 낸다 — 요약 카드와 **같은 함수**다. 그래서 카드 합계와
 *   표 합계가 다를 수 없다.
 */
import { useState } from 'react';
import type { DisplayStatus } from '@swonbiz/shared/domain/invoice-status';
import { Icon } from '@/components/ds';
import styles from './billing.module.css';
import {
  STATUS_LABEL,
  monthDay,
  statusOf,
  summarize,
  won,
  yearMonthDot,
  type BillingItem,
} from './billing-model';
import { InvoiceDetailDialog } from './InvoiceDetailDialog';
import { PaymentDialog } from './PaymentDialog';

interface Props {
  items: readonly BillingItem[];
  /** `month` — 첫 열이 입주사. `company` — 첫 열이 청구 월(입주사는 이미 골랐다). */
  mode: 'month' | 'company';
  asOf: Date;
  /** 수납이 바뀌었다 — 부르는 쪽이 목록을 다시 받는다. */
  onChanged: (message: string) => void;
}

export function BillingTable({ items, mode, asOf, onChanged }: Props) {
  const [paying, setPaying] = useState<BillingItem | null>(null);
  const [viewing, setViewing] = useState<BillingItem | null>(null);
  const sum = summarize(items, asOf);
  const grid = mode === 'company' ? `${styles.tCompany}` : '';

  return (
    <>
      <div className={`${styles.tHead} ${grid}`}>
        <span>{mode === 'month' ? '입주사' : '청구 월'}</span>
        <span>{mode === 'month' ? '항목(호실)' : '항목(호실)'}</span>
        <span className={styles.right}>청구액</span>
        <span className={styles.right}>납부일</span>
        <span className={styles.center}>상태</span>
        <span />
      </div>

      {items.map((item) => {
        const st: DisplayStatus = statusOf(item, asOf);
        const canceled = st === 'canceled';
        return (
          <div key={item.invoiceId} className={`${styles.tRow} ${grid}${canceled ? ` ${styles.tRowCanceled}` : ''}`}>
            <span className={`${styles.ellipsis} ${styles.strong}`} title={mode === 'month' ? item.companyName : ''}>
              {mode === 'month' ? item.companyName : yearMonthDot(item.yearMonth)}
            </span>
            <span className={styles.ellipsis} title={item.roomNames}>
              이용료{item.roomNames ? ` · ${item.roomNames}` : ''}
            </span>
            <span className={styles.right}>
              {item.isFree ? (
                /*
                 * ★ 무상 달은 금액이 0 이다. 「₩0」으로만 보이면 청구를 빠뜨린 줄로 읽힌다 —
                 *   「무상」이라고 쓰고 얼마짜리를 무상으로 줬는지를 아래에 적는다.
                 */
                <>
                  <span className={styles.free}>무상</span>
                  <span className={styles.amountSub}>이용료 {won(item.freeSupply)}</span>
                </>
              ) : (
                <>
                  <span className={styles.amount}>{won(item.totalAmount)}</span>
                  {st === 'partial' || (st === 'unpaid' && item.paidAmount !== 0) ? (
                    <span className={`${styles.amountSub} ${styles.amountSubDanger}`}>
                      미수 {won(item.outstanding)}
                    </span>
                  ) : st === 'paid' && item.paidAmount !== item.totalAmount ? (
                    <span className={styles.amountSub}>수납 {won(item.paidAmount)}</span>
                  ) : null}
                </>
              )}
            </span>
            <span className={`${styles.right} ${styles.mono}`}>{monthDay(item.dueDate)}</span>
            <span className={styles.center}>
              <span className={`${styles.badge} ${styles[`st_${st}`]}`}>{STATUS_LABEL[st]}</span>
            </span>
            <span className={styles.actions}>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnGhost} ${styles.btnXs}`}
                // ★ 취소된 장·무상 장·남은 금액이 없는 장에는 수납할 것이 없다.
                disabled={canceled || item.isFree || item.outstanding <= 0}
                onClick={() => setPaying(item)}
              >
                수납
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnGhost} ${styles.btnXs}`}
                onClick={() => setViewing(item)}
              >
                내역
              </button>
            </span>
          </div>
        );
      })}

      {items.length > 0 ? (
        <div className={`${styles.tFoot} ${grid}`}>
          <span>합계 {sum.count}건</span>
          <span className={styles.muted} style={{ fontWeight: 400, fontSize: 12 }}>
            취소 제외
          </span>
          <span className={styles.right}>
            <span className={styles.amount}>{won(sum.total)}</span>
          </span>
          <span className={styles.right} style={{ gridColumn: 'span 3', fontWeight: 400 }}>
            수납 <b className={styles.mono}>{won(sum.paid)}</b> · 미수 <b className={styles.mono}>{won(sum.outstanding)}</b>
          </span>
        </div>
      ) : null}

      {paying ? (
        <PaymentDialog
          target={paying}
          onClose={() => setPaying(null)}
          onSaved={(message) => {
            setPaying(null);
            onChanged(message);
          }}
        />
      ) : null}

      {viewing ? (
        <InvoiceDetailDialog
          invoiceId={viewing.invoiceId}
          companyName={viewing.companyName}
          roomNames={viewing.roomNames}
          onClose={() => setViewing(null)}
          onChanged={onChanged}
        />
      ) : null}
    </>
  );
}

/** 빈 상태 — 표 상자 안에서 쓴다. */
export function BillingEmpty({ lead, sub }: { lead: string; sub?: string }) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon}>
        <Icon name="receipt" size={40} />
      </span>
      <p className={styles.emptyLead}>{lead}</p>
      {sub ? <p className={styles.emptySub}>{sub}</p> : null}
    </div>
  );
}
