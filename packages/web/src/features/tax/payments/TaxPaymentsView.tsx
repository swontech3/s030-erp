'use client';

/**
 * 세금 납부(s050300040) 본문 — 2026-11-08 대표 수정 ⑥ 으로 「세금 · 4대보험 · 대출」의 국세 · 지방세 탭을 한 메뉴로 나눴다. 읽기만.
 *
 *   ① 검색조건 — 년월(세무 공통) · 「세금 전체 / 국세 / 지방세」(코드 TAX_PAY_SRC, 223 — 「세금 전체」는 첫 줄이고 코드가 아니다)
 *   ② 목록 — 국세 · 지방세를 한 목록에: 납부일 · 구분 · 세목 · 비용 여부(배지) · 금액 · 가산금(국세) · 귀속 · 납부방법(지방세) ·
 *      기관(국세 수납관서 · 지방세 납부기관) · 납부번호(국세 전자납부번호 · 지방세 납세번호). 그 세금에 없는 칸은 「—」. 맨 아래 합계 줄
 * ★ [엑셀 내려받기]를 없앴다(2026-11-08) — 짜임은 검색조건 / 목록 둘.
 * ★ 기간 직접 지정 · 설명 글 · 「오늘 …」 · 「지금 걸린 거르기 결과만 내려받습니다」를 없앴다.
 * ★ 「처음 보는 세목」은 보이지 않는다(1-7 결정 ③). 이름(구분)은 API 가 준 코드 이름으로만 그린다.
 * ★ 파일로 들어오면 기간 거르기 없이 그 파일 줄만 — 서버가 구분을 파일 종류(국세 / 지방세)로 정한다.
 */
import { useState } from 'react';
import { PAY_ALL, payTotals, type PaymentView } from '@swonbiz/shared/domain/tax-payments';
import { Table, TableHead, TableRow, tableCell } from '@/components/ds';
import t from '../common/tax.module.css';
import { TaxFormErrorBanner } from '../common/TaxFormErrorBanner';
import { TaxMonthBar } from '../common/TaxMonthBar';
import { won } from '../uploads/tax-uploads-model';
import { DASH, EmptyRow, FileNote, codeName, shortDate, usePayments } from './payments-common';
import type { PaymentsQuery } from './tax-payments-model';

/* ★ 2026-11-26 세무 일관성(삐용 기준) — 표 = 공통 Table(머리글 아쿠아 · 머리 고정 · 칸 폭은 종전 colgroup 값) ·
 *   검색조건은 바꾸면 바로 다시 읽음(그대로) · 줄 오른쪽 끝 「n건」 · [모두 보기] = 공통 Button 보통 */
const PAY_COLS = '64px 72px minmax(0,1fr) 96px 120px 100px 84px 100px 160px 170px';

interface Props {
  month: string;
  /** 자료 올리기 [보기]로 들어온 파일. */
  fileId: string | null;
}

export function TaxPaymentsView({ month, fileId }: Props) {
  const [src, setSrc] = useState<PaymentView>(PAY_ALL);
  const query: PaymentsQuery = { month, tab: src, from: null, to: null, fileId };
  const { data, loadError } = usePayments(query, '세금 납부를 불러오지 못했습니다');

  if (loadError) {
    return (
      <div className={t.page}>
        <TaxFormErrorBanner kind="failed" message={loadError} />
      </div>
    );
  }
  if (!data) {
    return (
      <div className={t.page}>
        <p className={t.help}>불러오는 중…</p>
      </div>
    );
  }

  const shown = data.query.tab;
  const sum = payTotals(data.pays);
  const srcName = (k: string) => codeName(data.codes.paySrcs, k);
  const dash = <span className={t.mutT}>{DASH}</span>;

  return (
    <div className={`${t.page} ${t.pageFill}`}>
      {/* ① 검색조건 */}
      <div className={`${t.card} ${t.secLow}`}>
        <TaxMonthBar month={month} note={<FileNote file={data.file} month={month} />} count={data.pays.length}>
          <select
            className={t.select}
            style={{ height: 32, width: 'auto', minWidth: 120 }}
            aria-label="세금"
            value={shown}
            disabled={!!fileId}
            onChange={(e) => setSrc(e.target.value as PaymentView)}
          >
            <option value={PAY_ALL}>세금 전체</option>
            {data.codes.paySrcs.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </TaxMonthBar>
      </div>

      {/* ② 목록 */}
      <div className={`${t.card} ${t.listCard}`}>
        <div className={t.listScroll}>
          <Table cols={PAY_COLS}>
            <TableHead sticky>
              <span>납부일</span>
              <span>구분</span>
              <span>세목</span>
              <span>비용 여부</span>
              <span className={tableCell.right}>금액</span>
              <span className={tableCell.right}>가산금</span>
              <span>귀속</span>
              <span>납부방법</span>
              <span>기관</span>
              <span>납부번호</span>
            </TableHead>
            {data.pays.length === 0 ? (
              <EmptyRow />
            ) : (
              data.pays.map((r) => {
                const nt = r.kind === 'NTAX';
                return (
                  <TableRow key={`${r.kind}:${r.id}`}>
                    <span className={t.tnum}>{shortDate(r.payDate)}</span>
                    <span className={t.mutT}>{srcName(r.kind)}</span>
                    <span className={tableCell.ellipsis} title={r.taxItem}>
                      {r.taxItem}
                    </span>
                    <span>
                      <span className={`${t.badge} ${r.expense ? t.bDoing : t.bGray}`}>{r.expense ? '비용' : '비용 아님'}</span>
                    </span>
                    <span className={t.numC}>{won(r.amount)}</span>
                    <span className={t.numC}>{nt ? won(r.penalty ?? 0) : dash}</span>
                    <span className={t.mutT}>{nt ? dash : (r.belongMonth ?? dash)}</span>
                    <span className={`${t.mutT} ${tableCell.ellipsis}`}>{nt ? dash : (r.payMethod ?? dash)}</span>
                    <span className={`${t.mutT} ${tableCell.ellipsis}`} title={r.office ?? ''}>
                      {r.office ?? dash}
                    </span>
                    <span className={`${t.mutT} ${tableCell.ellipsis}`} title={r.payNo}>
                      {r.payNo}
                    </span>
                  </TableRow>
                );
              })
            )}
            {data.pays.length ? (
              <TableRow>
                <span className={t.sm}>합계</span>
                <span className={`${t.sm} ${t.span3}`}>
                  {won(sum.count)}줄 · 비용 {won(sum.expense)} · 비용 아님 {won(sum.nonExpense)}
                </span>
                <span className={t.numC}>
                  <b>{won(sum.amount)}</b>
                </span>
                <span className={t.numC}>
                  <b>{won(sum.penalty)}</b>
                </span>
                <span className={t.span4} />
              </TableRow>
            ) : null}
          </Table>
        </div>
      </div>
    </div>
  );
}
