'use client';

/**
 * 청구 표 — 월별 청구(s0300200070)와 입주사 청구 탭이 **같은 표**를 쓴다.
 *
 * ★ [수납]·[내역] 창은 **청구 화면에서만** 연다(한 업무는 한 화면에서 — CLAUDE.md).
 *   입주사 청구 탭은 `readOnly` 로 같은 표를 버튼 없이 보여 주고, 처리는 링크로 보낸다.
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
  /** 수납이 바뀌었다 — 부르는 쪽이 목록을 다시 받는다. `readOnly` 면 부르지 않는다. */
  onChanged?: (message: string) => void;
  /** 조회 전용 — [수납]·[내역] 칸이 없다. 입주사 청구 탭이 쓴다. */
  readOnly?: boolean;
}

export function BillingTable({ items, mode, asOf, onChanged = () => {}, readOnly = false }: Props) {
  const [paying, setPaying] = useState<BillingItem | null>(null);
  const [viewing, setViewing] = useState<BillingItem | null>(null);
  const sum = summarize(items, asOf);
  const grid = `${mode === 'company' ? styles.tCompany : ''}${readOnly ? ` ${styles.tReadOnly}` : ''}`;

  return (
    <>
      <div className={`${styles.tHead} ${grid}`}>
        <span>{mode === 'month' ? '입주사' : '청구 월'}</span>
        <span>{mode === 'month' ? '항목(호실)' : '항목(호실)'}</span>
        <span className={styles.right}>청구액</span>
        <span className={styles.right}>납부일</span>
        <span className={styles.center}>상태</span>
        {readOnly ? null : <span />}
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
                  ) : st === 'overpaid' ? (
                    // ★ 돌려줄 돈 — 미수금이 아니다. 정산 처리가 음수 수납으로 0 을 만든다.
                    <span className={`${styles.amountSub} ${styles.amountSubWarn}`}>
                      과납 {won(item.paidAmount - item.totalAmount)}
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
            {readOnly ? null : (
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
            )}
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
          <span className={styles.right} style={{ gridColumn: readOnly ? 'span 2' : 'span 3', fontWeight: 400 }}>
            수납 <b className={styles.mono}>{won(sum.received)}</b> · 미수 <b className={styles.mono}>{won(sum.outstanding)}</b>
            {sum.overpaidCount > 0 ? (
              <>
                {' '}· 과납 <b className={styles.mono}>{won(sum.overpaid)}</b>
              </>
            ) : null}
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
