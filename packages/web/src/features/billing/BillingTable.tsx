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
  dotDate,
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
  /**
   * 합계를 낼 줄들 — **그리는 줄(`items`)보다 많을 수 있다.**
   *
   * ★★ 월별 청구는 줄을 40개씩 끊어 그린다(`BillingView`). 합계를 `items` 로 내면
   *    스크롤할 때마다 합계가 커진다 — 아무도 믿을 수 없는 숫자다. 그래서 「조건에 맞는
   *    전체」를 따로 받는다. 안 주면 그리는 줄로 낸다(입주사 청구 탭은 다 그린다).
   */
  total?: readonly BillingItem[];
}

export function BillingTable({ items, mode, asOf, onChanged = () => {}, readOnly = false, total }: Props) {
  const [paying, setPaying] = useState<BillingItem | null>(null);
  const [viewing, setViewing] = useState<BillingItem | null>(null);
  const sum = summarize(total ?? items, asOf);
  const grid = `${mode === 'company' ? styles.tCompany : ''}${readOnly ? ` ${styles.tReadOnly}` : ''}`;
  /**
   * 계약의 값 세 열(예치금 · 이용 시작일 · 이용 종료일)을 보이는가.
   *
   * ★ 청구 화면에서만 보인다. 조회 전용(입주사 화면 청구 탭)은 420px 목록 옆의 좁은
   *   패널이라 열이 가로로 넘친다 — 그 탭의 할 일은 조회와 「청구에서 처리」 링크뿐이다.
   */
  const contractCols = !readOnly;

  return (
    <>
      <div className={`${styles.tHead} ${grid}`}>
        <span>{mode === 'month' ? '입주사' : '청구 월'}</span>
        <span>항목(호실)</span>
        <span className={styles.right}>청구액</span>
        {/*
          ★ 예치금 · 이용 시작일 · 이용 종료일은 **그 계약의 값**이다(청구서의 값이 아니다).
            한 입주사가 계약을 여러 건 들고 있으면 줄마다 다르다.
          ★★ **조회 전용(입주사 화면 청구 탭)에는 두지 않는다.** 그 탭은 420px 목록 옆의
             좁은 패널이라 열 아홉 개가 가로로 넘친다. 거기 할 일은 조회와 링크뿐이다.
        */}
        {contractCols ? (
          <>
            <span className={styles.right}>예치금</span>
            <span>이용 시작일</span>
            <span>이용 종료일</span>
          </>
        ) : null}
        <span className={styles.right}>납부일</span>
        <span className={styles.center}>상태</span>
        {readOnly ? null : <span />}
      </div>

      {items.map((item) => {
        const st: DisplayStatus = statusOf(item, asOf);
        const canceled = st === 'canceled';
        return (
          <div
            key={item.invoiceId}
            data-invoice-row={item.invoiceId}
            className={`${styles.tRow} ${grid}${canceled ? ` ${styles.tRowCanceled}` : ''}`}
          >
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
            {contractCols ? (
              <>
                {/* ★ 예치금은 **장부 잔액**이다 — 반환·차감 뒤에는 0 이다(사용자 결정). */}
                <span className={`${styles.right} ${styles.mono}`}>
                  {item.contractId === null ? '—' : won(item.deposit)}
                </span>
                <span className={styles.mono}>{item.usageStart ? dotDate(item.usageStart) : '—'}</span>
                <span className={styles.mono}>
                  {item.usageEnd ? dotDate(item.usageEnd) : '—'}
                  {/* ★ 중도해지면 계약 종료일이 아니라 **실제 종료일자**다 — 그렇다고 적는다. */}
                  {item.terminated ? <span className={styles.endMark}>해지</span> : null}
                </span>
              </>
            ) : null}
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
          <span className={styles.right} style={{ gridColumn: readOnly ? 'span 2' : 'span 6', fontWeight: 400 }}>
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
