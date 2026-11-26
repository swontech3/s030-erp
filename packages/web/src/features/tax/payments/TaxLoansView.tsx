'use client';

/**
 * 대출내역(s050300060) 본문 — 2026-11-08 대표 수정 ⑥ 으로 「세금 · 4대보험 · 대출」의 대출 탭을 한 메뉴로 나눴다. 읽기만.
 *
 *   ① 검색조건 — 년월(세무 공통 연도 · 월)
 *   ② 목록 위 대출(은행 · 끝 4자리)별 요약(작게 — 실행 원금 · 상환 원금 · 이자 · 수수료, 잔액 없음 — 1-7 결정 ⑤) ·
 *      거래 목록(거래일 · 대출 · 구분 · 거래종류 · 원금 · 이자 · 수수료 · 잔액)
 * ★ [엑셀 내려받기]를 없앴다(2026-11-08) — 짜임은 검색조건 / 목록 둘.
 * ★ 기간 직접 지정 · 설명 글을 없앴다. ★ 대출번호는 끝 4자리만(서버가 그것만 준다). 이름(은행 · 구분)은 API 의 코드 이름.
 */
import { loanSummary } from '@swonbiz/shared/domain/tax-payments';
import { Table, TableHead, TableRow, tableCell } from '@/components/ds';
import t from '../common/tax.module.css';
import { TaxFormErrorBanner } from '../common/TaxFormErrorBanner';
import { TaxMonthBar } from '../common/TaxMonthBar';
import { won } from '../uploads/tax-uploads-model';
import { DASH, EmptyRow, FileNote, codeName, shortDate, usePayments } from './payments-common';
import type { PaymentsQuery } from './tax-payments-model';

/* ★ 2026-11-26 세무 일관성(삐용 기준) — 표 = 공통 Table(머리글 아쿠아 · 머리 고정 · 칸 폭은 종전 colgroup 값) ·
 *   검색조건은 바꾸면 바로 다시 읽음(그대로) · 줄 오른쪽 끝 「n건」 · [모두 보기] = 공통 Button 보통 */
const LOAN_COLS = '64px minmax(0,1fr) 72px 140px 130px 120px 100px 140px';

interface Props {
  month: string;
  /** 자료 올리기 [보기]로 들어온 파일. */
  fileId: string | null;
}

export function TaxLoansView({ month, fileId }: Props) {
  const query: PaymentsQuery = { month, tab: 'LOAN', from: null, to: null, fileId };
  const { data, loadError } = usePayments(query, '대출내역을 불러오지 못했습니다');

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

  const label = (r: { bankCode: string; loanLast4: string }) => `${codeName(data.codes.banks, r.bankCode)} · 끝 ${r.loanLast4}`;
  const summary = loanSummary(data.loans);

  return (
    <div className={`${t.page} ${t.pageFill}`}>
      {/* ① 검색조건 */}
      <div className={`${t.card} ${t.secLow}`}>
        <TaxMonthBar month={month} note={<FileNote file={data.file} month={month} />} count={data.loans.length} />
      </div>

      {/* 대출별 요약 — 작게 */}
      {summary.length ? (
        <div className={`${t.card} ${t.secLow}`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {summary.map((s) => (
              <span key={`${s.bankCode}:${s.loanLast4}`} className={t.sm}>
                <b>{label(s)}</b> ({won(s.count)}줄) · 실행 원금 <b>{won(s.draw)}</b> · 상환 원금 <b>{won(s.repay)}</b> · 이자{' '}
                <b>{won(s.interest)}</b> · 수수료 <b>{won(s.fee)}</b>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {/* ② 거래 목록 */}
      <div className={`${t.card} ${t.listCard}`}>
        <div className={t.listScroll}>
          <Table cols={LOAN_COLS}>
            <TableHead sticky>
              <span>거래일</span>
              <span>대출</span>
              <span>구분</span>
              <span>거래종류</span>
              <span className={tableCell.right}>원금</span>
              <span className={tableCell.right}>이자</span>
              <span className={tableCell.right}>수수료</span>
              <span className={tableCell.right}>잔액</span>
            </TableHead>
            {data.loans.length === 0 ? (
              <EmptyRow />
            ) : (
              data.loans.map((r) => (
                <TableRow key={r.id}>
                  <span className={t.tnum}>{shortDate(r.txnDate)}</span>
                  <span className={`${t.mutT} ${tableCell.ellipsis}`}>{label(r)}</span>
                  <span>{codeName(data.codes.loanTps, r.txnTp)}</span>
                  <span className={`${t.mutT} ${tableCell.ellipsis}`}>{r.txnType ?? DASH}</span>
                  <span className={t.numC}>{won(r.principal)}</span>
                  <span className={t.numC}>{won(r.interest)}</span>
                  <span className={t.numC}>{won(r.fee)}</span>
                  <span className={t.numC}>{won(r.balance)}</span>
                </TableRow>
              ))
            )}
          </Table>
        </div>
      </div>
    </div>
  );
}
