'use client';

/**
 * 청구 표 — 청구 · 수납 탭(s030200070)과 입주사 청구 탭이 **같은 표**를 쓴다.
 *
 * ★ 2026-11-16 대표 지시 — 청구 · 수납 탭은 줄마다 있던 [수납] · [내역] 단추를 없앴다. 줄을 누르면
 *   고른 줄(`selectedId`)이 되고, 부르는 쪽(`BillingView`)이 오른쪽에 그 청구서 상세를 그린다.
 *   수납은 버튼 줄 [수납](고른 줄)과 오른쪽 상세에서만 한다(한 업무는 한 화면에서 — CLAUDE.md).
 *   입주사 청구 탭은 `readOnly` 로 같은 표를 고르기 없이 보여 주고, 처리는 링크로 보낸다(모양 그대로).
 *
 * ★ 합계 줄은 `summarize` 가 낸다 — 요약 카드와 **같은 함수**다. 그래서 카드 합계와
 *   표 합계가 다를 수 없다.
 */
import type { DisplayStatus } from '@swonbiz/shared/domain/invoice-status';
import { Icon, Table, TableHead, TableRow } from '@/components/ds';
import styles from './billing.module.css';
import {
  STATUS_LABEL,
  dotDate,
  invoiceItemLabel,
  monthDay,
  statusOf,
  summarize,
  won,
  yearMonthDot,
  type BillingItem,
} from './billing-model';

interface Props {
  items: readonly BillingItem[];
  /** `month` — 첫 열이 입주사. `company` — 첫 열이 청구 월(입주사는 이미 골랐다). */
  mode: 'month' | 'company';
  asOf: Date;
  /** 조회 전용 — 줄을 고를 수 없고 계약의 값 세 열 · 납부일 칸이 없다. 입주사 청구 탭이 쓴다. */
  readOnly?: boolean;
  /** 고른 줄(청구 · 수납 탭). */
  selectedId?: string | null;
  /** 줄을 눌렀다 — 부르는 쪽이 오른쪽 상세를 연다(청구 · 수납 탭). */
  onSelect?: (item: BillingItem) => void;
  /**
   * 합계를 낼 줄들 — **그리는 줄(`items`)보다 많을 수 있다.** 안 주면 그리는 줄로 낸다
   * (입주사 청구 탭은 다 그린다).
   */
  total?: readonly BillingItem[];
}

/**
 * 표 안 작은 단추(30px) — 공통 Button 의 색 · 테두리에 전 `.btnXs` 크기만 얹는다(2026-11-25 입주관리 일관성).
 * 오른쪽 상세 수납 줄(약 430px 칸)에 [수정][삭제 확인]이 들게 잰 크기다.
 */
export const BTN_XS = { height: 30, padding: '0 10px', fontSize: 'var(--text-micro-size)' } as const;

/*
 * ★ 2026-11-25 입주관리 일관성 — 표는 공통 Table(머리글 색 · 줄 선은 그 부품). 칸 폭은 전의 grid-template-columns 값 그대로(cols).
 *   청구 · 수납 탭(왼쪽 60%)은 칸 사이 8 · 좌우 10 을 그대로 둔다(.gridTight) — 1500px 창에서 넘치지 않게 잰 값이다.
 */
const SPLIT_COLS = {
  month: 'minmax(88px, 1.2fr) minmax(96px, 1fr) 104px 74px 74px 140px',
  company: '56px minmax(96px, 1fr) 104px 74px 74px 140px',
} as const;
const READONLY_COLS = {
  month: 'minmax(150px, 1.3fr) minmax(140px, 1.2fr) minmax(120px, 0.9fr) 84px 92px',
  company: '72px minmax(140px, 1.3fr) minmax(120px, 0.9fr) 84px 92px',
} as const;

export function BillingTable({ items, mode, asOf, readOnly = false, selectedId = null, onSelect, total }: Props) {
  const sum = summarize(total ?? items, asOf);

  if (!readOnly) {
    return (
      <Table cols={SPLIT_COLS[mode]} dense>
        {/*
          ★ 2026-11-16 — 왼쪽 60% 목록. 칸: 입주사(청구 월) · 항목 · 청구액 · 납부기한 · 납부일 · 상태.
            액션 칸은 없다(줄을 누르면 오른쪽 상세). 계약의 값 셋(예치금 · 이용 시작일 · 이용 종료일)은
            1500px 창에서 넘쳐 오른쪽 상세 머리로 옮겼다(엑셀에는 그대로 있다).
        */}
        <TableHead sticky className={styles.gridTight}>
          <span>{mode === 'month' ? '입주사' : '청구 월'}</span>
          <span>항목</span>
          <span className={styles.right}>청구액</span>
          <span>납부기한</span>
          <span>납부일</span>
          <span>상태</span>
        </TableHead>

        {items.map((item) => {
          const st: DisplayStatus = statusOf(item, asOf);
          const canceled = st === 'canceled';
          return (
            <TableRow
              key={item.invoiceId}
              onClick={() => onSelect?.(item)}
              selected={selectedId === item.invoiceId}
              muted={canceled}
              className={`${styles.gridTight}${canceled ? ` ${styles.tRowCanceled}` : ''}`}
            >
              <span
                data-invoice-row={item.invoiceId}
                className={`${styles.ellipsis} ${styles.strong}`}
                title={mode === 'month' ? item.companyName : ''}
              >
                {mode === 'month' ? item.companyName : yearMonthDot(item.yearMonth)}
              </span>
              {/* ★ 「종류(호실)」 — 예: 이용료(FREE03). 엑셀과 같은 함수. */}
              <span className={styles.ellipsis} title={invoiceItemLabel(item.roomNames)}>
                {invoiceItemLabel(item.roomNames)}
              </span>
              {/* ★ 금액만 — 미수 · 과납 · 수납은 상태 칸 · 오른쪽 상세에 있다. 무상은 금액 대신 「무상」. */}
              <span className={styles.right}>
                {item.isFree ? (
                  <span className={styles.free}>무상</span>
                ) : (
                  <span className={styles.amount}>{won(item.totalAmount)}</span>
                )}
              </span>
              <span className={`${styles.mono} ${styles.sDate}`}>{dotDate(item.dueDate)}</span>
              <span className={`${styles.mono} ${styles.sDate}`}>{item.lastPaidOn ? dotDate(item.lastPaidOn) : ''}</span>
              <span className={styles.stCell}>
                <span className={`${styles.badge} ${styles[`st_${st}`]}`}>{STATUS_LABEL[st]}</span>
                {item.terminated ? <span className={styles.endMark}>해지</span> : null}
              </span>
            </TableRow>
          );
        })}
      </Table>
    );
  }

  /* ── 조회 전용(입주사 청구 탭) — 칸 · 값 그대로 ── */
  return (
    <Table cols={READONLY_COLS[mode]}>
      <TableHead>
        <span>{mode === 'month' ? '입주사' : '청구 월'}</span>
        <span>항목(호실)</span>
        <span className={styles.right}>청구액</span>
        <span className={styles.right}>납부기한</span>
        <span className={styles.center}>상태</span>
      </TableHead>

      {items.map((item) => {
        const st: DisplayStatus = statusOf(item, asOf);
        const canceled = st === 'canceled';
        return (
          <TableRow key={item.invoiceId} muted={canceled} className={canceled ? styles.tRowCanceled : undefined}>
            <span
              data-invoice-row={item.invoiceId}
              className={`${styles.ellipsis} ${styles.strong}`}
              title={mode === 'month' ? item.companyName : ''}
            >
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
          </TableRow>
        );
      })}

      {/* 합계 줄 — 표와 같은 칸(--table-cols)을 쓴다(.tableFoot) */}
      {items.length > 0 ? (
        <div className={`${styles.tFoot} ${styles.tableFoot}`}>
          <span>합계 {sum.count}건</span>
          <span className={styles.muted} style={{ fontWeight: 400, fontSize: 12 }}>
            취소 제외
          </span>
          <span className={styles.right}>
            <span className={styles.amount}>{won(sum.total)}</span>
          </span>
          <span className={styles.right} style={{ gridColumn: 'span 2', fontWeight: 400 }}>
            수납 <b className={styles.mono}>{won(sum.received)}</b> · 미수 <b className={styles.mono}>{won(sum.outstanding)}</b>
            {sum.overpaidCount > 0 ? (
              <>
                {' '}· 과납 <b className={styles.mono}>{won(sum.overpaid)}</b>
              </>
            ) : null}
          </span>
        </div>
      ) : null}
    </Table>
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
