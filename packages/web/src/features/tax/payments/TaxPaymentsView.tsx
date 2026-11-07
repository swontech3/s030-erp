'use client';

/**
 * 세금 납부(s050300040) 본문 — 2026-11-08 대표 수정 ⑥ 으로 「세금 · 4대보험 · 대출」의 국세 · 지방세 탭을 한 메뉴로 나눴다. 읽기만.
 *
 *   ① 검색조건 — 년월(세무 공통) · 「세금 전체 / 국세 / 지방세」(코드 TAX_PAY_SRC, 223 — 「세금 전체」는 첫 줄이고 코드가 아니다)
 *   ② 버튼 줄 — 오른쪽 [엑셀 내려받기](걸린 조건 결과 — 세금 전체면 국세 · 지방세 두 시트)
 *   ③ 목록 — 국세 · 지방세를 한 목록에: 납부일 · 구분 · 세목 · 비용 여부(배지) · 금액 · 가산금(국세) · 귀속 · 납부방법(지방세) ·
 *      기관(국세 수납관서 · 지방세 납부기관) · 납부번호(국세 전자납부번호 · 지방세 납세번호). 그 세금에 없는 칸은 「—」. 맨 아래 합계 줄
 * ★ 기간 직접 지정 · 설명 글 · 「오늘 …」 · 「지금 걸린 거르기 결과만 내려받습니다」를 없앴다.
 * ★ 「처음 보는 세목」은 보이지 않는다(1-7 결정 ③). 이름(구분)은 API 가 준 코드 이름으로만 그린다.
 * ★ 파일로 들어오면 기간 거르기 없이 그 파일 줄만 — 서버가 구분을 파일 종류(국세 / 지방세)로 정한다.
 */
import { useState } from 'react';
import { PAY_ALL, payTotals, type PaymentView } from '@swonbiz/shared/domain/tax-payments';
import { ExcelDownloadButton } from '@/components/patterns/ExcelDownloadButton';
import t from '../common/tax.module.css';
import { TaxFormErrorBanner } from '../common/TaxFormErrorBanner';
import { TaxMonthBar } from '../common/TaxMonthBar';
import { won } from '../uploads/tax-uploads-model';
import { DASH, EmptyRow, FileNote, codeName, shortDate, usePayments } from './payments-common';
import { exportHref, type PaymentsQuery } from './tax-payments-model';

interface Props {
  month: string;
  /** 자료 올리기 [보기]로 들어온 파일. */
  fileId: string | null;
}

export function TaxPaymentsView({ month, fileId }: Props) {
  const [src, setSrc] = useState<PaymentView>(PAY_ALL);
  const [failed, setFailed] = useState<string | null>(null);
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
  const dash = <span className={t.mut}>{DASH}</span>;

  return (
    <div className={`${t.page} ${t.pageFill}`}>
      {/* ① 검색조건 */}
      <div className={`${t.card} ${t.secLow}`}>
        <TaxMonthBar month={month} note={<FileNote file={data.file} month={month} />}>
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

      {/* ② 버튼 */}
      <div className={`${t.tbar} ${t.tbarOut}`}>
        <span className={t.sp} />
        <ExcelDownloadButton href={exportHref({ ...query, tab: shown })} className={`${t.btn} ${t.btnSm}`} onError={setFailed} />
      </div>
      {failed ? <TaxFormErrorBanner kind="failed" message={failed} /> : null}

      {/* ③ 목록 */}
      <div className={`${t.card} ${t.listCard}`}>
        <div className={t.listScroll}>
          <table className={`${t.tbl} ${t.tblSticky}`}>
            <colgroup>
              <col style={{ width: 64 }} />
              <col style={{ width: 72 }} />
              <col />
              <col style={{ width: 96 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 84 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 160 }} />
              <col style={{ width: 170 }} />
            </colgroup>
            <thead>
              <tr>
                <th>납부일</th>
                <th>구분</th>
                <th>세목</th>
                <th>비용 여부</th>
                <th className={t.num}>금액</th>
                <th className={t.num}>가산금</th>
                <th>귀속</th>
                <th>납부방법</th>
                <th>기관</th>
                <th>납부번호</th>
              </tr>
            </thead>
            <tbody>
              {data.pays.length === 0 ? (
                <EmptyRow cols={10} />
              ) : (
                data.pays.map((r) => {
                  const nt = r.kind === 'NTAX';
                  return (
                    <tr key={`${r.kind}:${r.id}`}>
                      <td className={t.tnum}>{shortDate(r.payDate)}</td>
                      <td className={t.mut}>{srcName(r.kind)}</td>
                      <td className={t.ell} title={r.taxItem}>
                        {r.taxItem}
                      </td>
                      <td>
                        <span className={`${t.badge} ${r.expense ? t.bDoing : t.bGray}`}>{r.expense ? '비용' : '비용 아님'}</span>
                      </td>
                      <td className={t.num}>{won(r.amount)}</td>
                      <td className={t.num}>{nt ? won(r.penalty ?? 0) : dash}</td>
                      <td className={t.mut}>{nt ? dash : (r.belongMonth ?? dash)}</td>
                      <td className={`${t.mut} ${t.ell}`}>{nt ? dash : (r.payMethod ?? dash)}</td>
                      <td className={`${t.mut} ${t.ell}`} title={r.office ?? ''}>
                        {r.office ?? dash}
                      </td>
                      <td className={`${t.mut} ${t.ell}`} title={r.payNo}>
                        {r.payNo}
                      </td>
                    </tr>
                  );
                })
              )}
              {data.pays.length ? (
                <tr>
                  <td className={t.sm}>합계</td>
                  <td className={t.sm} colSpan={3}>
                    {won(sum.count)}줄 · 비용 {won(sum.expense)} · 비용 아님 {won(sum.nonExpense)}
                  </td>
                  <td className={t.num}>
                    <b>{won(sum.amount)}</b>
                  </td>
                  <td className={t.num}>
                    <b>{won(sum.penalty)}</b>
                  </td>
                  <td colSpan={4} />
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
