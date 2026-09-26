'use client';

/** @screen s0300200070p3 중도해지 정산서 · 020 입주사관리 */

/**
 * 중도해지 정산서 — 계약서처럼 인쇄한다. **A4 한 장 · 서명란 없음.**
 *
 * ★★ 인쇄 규칙은 계약서와 **같은 방식**이다(`styles/print.css` 머리말).
 *    ① body 로 포털한다 — 문서가 정상 흐름에 놓여야 페이지가 안 잘린다
 *    ② 열려 있는 동안 body 에 `data-printing='contract-doc'` — 형제만 감춘다
 *    ③ 표는 계약서의 표(`contract-document.module.css`)를 그대로 쓴다 — 칸마다 선을
 *       스스로 그려서, 뒤에 칠해지는 배경이 선을 덮지 않는다(`verify:print` 가 본다)
 *
 * ★★ 금액을 여기서 계산하지 않는다. 전부 정산 원장의 값이고, 나누어 보여 주는 것
 *    (실이용료의 「개월 + 일할」 · 방향 이름)은 shared 의 함수가 한다.
 *
 * ★ **할인** 환수의 근거는 **전대차계약서 제8조 3항**이다(「월회비 할인률이 적용된 경우 …
 *   할인 받은 총금액을 최종 정산시 일괄 반환한다」). 지시서에는 「제5조 3항」으로 적혀
 *   있었는데 우리 전대차계약서의 5조는 회비 지급(2항까지)이다 — 실제 문구가 있는 조항을
 *   적었다.
 *
 * ★★ **무상** 환수를 말하는 조항은 계약서에 없다. 그래서 근거를 **특기사항**으로
 *    가리킨다(`FREE_CLAWBACK_BASIS`) — 무상이 있는 계약이면 특기사항 맨 위에
 *    「무상 n개월 제공 — … 정산 시 반환한다」가 자동으로 찍혀 나간다
 *    (`contract-memo.ts` 의 `freeLabel`). 그 줄이 곧 이 환수의 약정이다.
 */
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CONTRACT_OFFICE } from '@swonbiz/shared';
import { settlementDirection } from '@swonbiz/shared/domain/settlement-view';
import { usageChargeBreakdown, usedPeriodLabel } from '@swonbiz/shared/domain/usage-period';
import { Icon } from '@/components/ds';
import docStyles from '@/features/contracts/contract-document.module.css';
import styles from './billing.module.css';
import { dotDate, localTodayIso, type Settlement } from './billing-model';

/** 할인 환수의 근거 조항 — 정산 카드와 정산서가 같은 문구를 쓴다. */
export const CLAWBACK_BASIS = '전대차계약서 제8조 3항';

/**
 * 무상 환수의 근거 — **조항이 아니라 특기사항**이다(머리말 ★★).
 *
 * ★ 계약서에 무상 환수 조항이 없어서, 무상이 있는 계약의 특기사항에 자동으로 찍히는
 *   「무상 n개월 제공 — … 정산 시 반환한다」 줄을 가리킨다(`freeLabel`).
 */
export const FREE_CLAWBACK_BASIS = '전대차계약서 특기사항';

const wonText = (n: number) => `${n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('ko-KR')}원`;

export function SettlementDocument({ s, onClose }: { s: Settlement; onClose: () => void }) {
  const printed = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // ★ 계약서와 같은 인쇄 규칙을 탄다(`print.css`). 닫히면 지운다 — 다른 화면의 Ctrl+P 가 빈 종이가 된다.
    document.body.dataset.printing = 'contract-doc';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      delete document.body.dataset.printing;
    };
  }, [onClose]);

  const doPrint = () => {
    if (printed.current) return;
    printed.current = true;
    window.print();
    window.setTimeout(() => {
      printed.current = false;
    }, 1000);
  };

  const dir = settlementDirection(s.netAmount);
  const usage = usageChargeBreakdown({
    startDate: s.startDate,
    terminateDate: s.terminateDate,
    freeMonths: s.freeMonths,
    monthlyTotal: s.monthlyTotal,
    usageCharge: s.usageCharge,
  });
  const usageText =
    `${usage.paidMonths}개월 ${usage.monthsAmount.toLocaleString('ko-KR')}원 + ` +
    `일할 ${usage.usedDays}/${usage.monthDays}일 ${usage.daysAmount.toLocaleString('ko-KR')}원`;

  const body = typeof document === 'undefined' ? null : document.body;
  if (!body) return null;

  return createPortal(
    <div
      data-print-portal="settlement-doc"
      className={docStyles.overlay}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div data-print-modal="1" className={docStyles.modal} role="dialog" aria-modal="true" aria-label="정산서">
        <div data-print-hide="1" className={docStyles.head}>
          <strong className={styles.docHeadTitle}>중도해지 정산서</strong>
          <div className={docStyles.headRight}>
            <button type="button" className={`${docStyles.btn} ${docStyles.btnGhost}`} onClick={doPrint}>
              <Icon name="file-text" size={16} />
              인쇄
            </button>
            <button type="button" className={docStyles.iconBtn} aria-label="닫기" onClick={onClose}>
              <Icon name="x" size={20} />
            </button>
          </div>
        </div>
        <p data-print-hide="1" className={docStyles.printHint}>
          <Icon name="circle-alert" size={14} />
          날짜·주소·쪽번호가 함께 인쇄되면 인쇄 대화상자에서 <b>머리글·바닥글</b>을 꺼 주세요.
        </p>

        <div data-scroll="1" className={docStyles.scroll}>
          <div data-doc-page="settlement" className={docStyles.page}>
            <div className={docStyles.brand}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img data-brand-mark="1" src="/brand/swonbiz-logo.png" alt="" className={docStyles.brandMark} />
              <span className={docStyles.brandWord}>
                S<span className={docStyles.brandDot}>·</span>won<span className={docStyles.brandBiz}>Biz</span>
              </span>
            </div>
            <h3 data-doc-title="1" className={docStyles.docTitle}>
              중 도 해 지 정 산 서
            </h3>

            <Section first>계약</Section>
            <div className={docStyles.table} data-doc-table="1">
              <Row th="입주사" td={s.companyName} th2="사업자번호" td2={s.bizNumber} />
              <Row th="계약 호실" td={[s.contractRoom, s.roomNames].filter(Boolean).join(' · ')} wide />
              <Row th="계약 기간" td={`${dotDate(s.startDate)} ~ ${dotDate(s.endDate)}`} wide />
              <Row th="실제 이용 기간" td={usedPeriodLabel(s.startDate, s.terminateDate)} wide />
            </div>

            <Section>이용료</Section>
            <div className={docStyles.table} data-doc-table="1">
              <Row th="받은 이용료" td={wonText(s.totalPaid)} wide />
              <Row th="실제 이용료" td={`${wonText(s.usageCharge)}  (${usageText})`} wide />
              <Row th="이용료 차액" td={`${wonText(s.rentNet)}  (받은 이용료 − 실제 이용료)`} wide />
            </div>

            <Section>정산</Section>
            <div className={docStyles.table} data-doc-table="1">
              <Row th="예치금 반환" td={wonText(s.depositReturn)} wide />
              <Row th="할인 환수" td={`${wonText(-s.discountClawback)}  (근거: ${CLAWBACK_BASIS})`} wide />
              <Row
                th="무상 환수"
                td={`${wonText(-s.freeClawback)}  (근거: ${FREE_CLAWBACK_BASIS})`}
                wide
              />
              <Row th={dir.label} td={dir.kind === 'none' ? '0원' : wonText(dir.amount)} wide strong />
            </div>

            <Section>{dir.kind === 'charge' ? '입금 계좌' : '환불 계좌'}</Section>
            <div className={docStyles.table} data-doc-table="1">
              {dir.kind === 'charge' ? (
                // ★ 추가로 받을 금액이면 **우리 입금 계좌** — 계약서에 찍힌 그 계좌다.
                <Row th="입금 계좌" td={`${CONTRACT_OFFICE.BANK}  (${CONTRACT_OFFICE.ACCOUNT_HOLDER})`} wide />
              ) : s.refund ? (
                <Row th="환불 계좌" td={`${s.refund.bank} ${s.refund.account}  (예금주 ${s.refund.holder})`} wide />
              ) : (
                // ★ 계좌를 지어내지 않는다 — 처리 전이라 비어 있으면 기입선을 그린다.
                <Row th="환불 계좌" td="" wide />
              )}
            </div>

            <p className={styles.docFoot}>
              발행일 {dotDate(localTodayIso())}
              {s.processed ? ` · 정산 처리일 ${dotDate(s.processed.processedOn)}` : ' · 정산 처리 전'}
            </p>
          </div>
        </div>
      </div>
    </div>,
    body,
  );
}

function Section({ children, first }: { children: React.ReactNode; first?: boolean }) {
  return (
    <div data-section-title="1" className={`${docStyles.sectionTitle}${first ? ` ${docStyles.sectionTitleFirst}` : ''}`}>
      <span className={docStyles.sectionBar} />
      <span>{children}</span>
    </div>
  );
}

/** 표 한 줄 — 계약서 표와 같은 칸(`data-th` / `data-td`). 값이 비면 기입선을 그린다. */
function Row(props: { th: string; td: string; th2?: string; td2?: string; wide?: boolean; strong?: boolean }) {
  const cell = (v: string) => (v.trim() !== '' ? v : <span className={docStyles.blank} style={{ width: 240 }} />);
  return (
    <div className={docStyles.tr} data-no-break="1">
      <span data-th="1" className={docStyles.th}>
        {props.th}
      </span>
      {props.wide ? (
        <span
          data-td="1"
          className={`${docStyles.td} ${docStyles.tdLast} ${docStyles.tdWide}`}
          style={props.strong ? { fontWeight: 700 } : undefined}
        >
          {cell(props.td)}
        </span>
      ) : (
        <>
          <span data-td="1" className={docStyles.td}>
            {cell(props.td)}
          </span>
          <span data-th="1" className={docStyles.th}>
            {props.th2}
          </span>
          <span data-td="1" className={`${docStyles.td} ${docStyles.tdLast}`}>
            {cell(props.td2 ?? '')}
          </span>
        </>
      )}
    </div>
  );
}
