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
import t from '../common/tax.module.css';
import { TaxFormErrorBanner } from '../common/TaxFormErrorBanner';
import { TaxMonthBar } from '../common/TaxMonthBar';
import { won } from '../uploads/tax-uploads-model';
import { DASH, EmptyRow, FileNote, codeName, shortDate, usePayments } from './payments-common';
import type { PaymentsQuery } from './tax-payments-model';

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
        <TaxMonthBar month={month} note={<FileNote file={data.file} month={month} />} />
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
          <table className={`${t.tbl} ${t.tblSticky}`}>
            <colgroup>
              <col style={{ width: 64 }} />
              <col />
              <col style={{ width: 72 }} />
              <col style={{ width: 140 }} />
              <col style={{ width: 130 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 140 }} />
            </colgroup>
            <thead>
              <tr>
                <th>거래일</th>
                <th>대출</th>
                <th>구분</th>
                <th>거래종류</th>
                <th className={t.num}>원금</th>
                <th className={t.num}>이자</th>
                <th className={t.num}>수수료</th>
                <th className={t.num}>잔액</th>
              </tr>
            </thead>
            <tbody>
              {data.loans.length === 0 ? (
                <EmptyRow cols={8} />
              ) : (
                data.loans.map((r) => (
                  <tr key={r.id}>
                    <td className={t.tnum}>{shortDate(r.txnDate)}</td>
                    <td className={`${t.mut} ${t.ell}`}>{label(r)}</td>
                    <td>{codeName(data.codes.loanTps, r.txnTp)}</td>
                    <td className={`${t.mut} ${t.ell}`}>{r.txnType ?? DASH}</td>
                    <td className={t.num}>{won(r.principal)}</td>
                    <td className={t.num}>{won(r.interest)}</td>
                    <td className={t.num}>{won(r.fee)}</td>
                    <td className={t.num}>{won(r.balance)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
