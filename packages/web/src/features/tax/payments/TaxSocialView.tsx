'use client';

/**
 * 4대보험(s050300050) 본문 — 2026-11-08 대표 수정 ⑥ 으로 「세금 · 4대보험 · 대출」의 4대보험 탭을 한 메뉴로 나눴다. 읽기만.
 *
 *   ① 검색조건 — 고지 연월(세무 공통 연도 · 월) · 「보험 전체 / 국민연금 / 건강보험 / 고용보험 / 산재보험」
 *      (기존 코드 TAX_SOCIAL_INS 이름. 장기요양은 따로 두지 않고 건강보험에 들어간다 — 서버 `filterSocialIns`)
 *   ② 버튼 줄 — 오른쪽 [엑셀 내려받기](사람별 + 보험 종류별 합계 두 시트 — 지금 그대로)
 *   ③ 목록 위 보험 종류별 합계(작게) · 사람별 목록(고지 연월 · 보험 종류 · 가입자 · 보수월액 · 금액)
 * ★ 「회사 · 직원 부담은 직원 급여에서 나눕니다」 · 기간 직접 지정 · 설명 글을 없앴다.
 * ★ 가입자 번호(끝 4자리)는 화면 · 엑셀에 보이지 않는다(API 는 준다 — 직원 급여에서 씀).
 */
import { useState } from 'react';
import { socialTotals } from '@swonbiz/shared/domain/tax-pay-social-loan';
import { SOCIAL_INS_FILTERS } from '@swonbiz/shared/domain/tax-payments';
import { ExcelDownloadButton } from '@/components/patterns/ExcelDownloadButton';
import t from '../common/tax.module.css';
import { TaxFormErrorBanner } from '../common/TaxFormErrorBanner';
import { TaxMonthBar } from '../common/TaxMonthBar';
import { won } from '../uploads/tax-uploads-model';
import { DASH, EmptyRow, FileNote, codeName, usePayments } from './payments-common';
import { exportHref, type PaymentsQuery } from './tax-payments-model';

interface Props {
  month: string;
  /** 자료 올리기 [보기]로 들어온 파일. */
  fileId: string | null;
}

export function TaxSocialView({ month, fileId }: Props) {
  const [ins, setIns] = useState('');
  const [failed, setFailed] = useState<string | null>(null);
  const query: PaymentsQuery = { month, tab: 'SOCIAL', from: null, to: null, fileId, ...(ins ? { ins } : {}) };
  const { data, loadError } = usePayments(query, '4대보험을 불러오지 못했습니다');

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

  const names = data.codes.socialIns;
  const options = names.filter((c) => SOCIAL_INS_FILTERS.includes(c.code));
  const totals = socialTotals(data.social);
  const amount = totals.reduce((n, x) => n + x.amount, 0);

  return (
    <div className={`${t.page} ${t.pageFill}`}>
      {/* ① 검색조건 */}
      <div className={`${t.card} ${t.secLow}`}>
        <TaxMonthBar month={month} note={<FileNote file={data.file} month={month} />}>
          <select
            className={t.select}
            style={{ height: 32, width: 'auto', minWidth: 120 }}
            aria-label="보험"
            value={ins}
            onChange={(e) => setIns(e.target.value)}
          >
            <option value="">보험 전체</option>
            {options.map((c) => (
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
        <ExcelDownloadButton href={exportHref(query)} className={`${t.btn} ${t.btnSm}`} onError={setFailed} />
      </div>
      {failed ? <TaxFormErrorBanner kind="failed" message={failed} /> : null}

      {/* 보험 종류별 합계 — 작게 */}
      {totals.length ? (
        <div className={`${t.card} ${t.secLow}`}>
          <div className={t.row} style={{ gap: 20, rowGap: 6 }}>
            {totals.map((x) => (
              <span key={x.insTp} className={t.sm}>
                {codeName(names, x.insTp)} <b>{won(x.count)}명</b> · <b>{won(x.amount)}원</b>
              </span>
            ))}
            <span className={t.sm}>
              합계 <b>{won(data.social.length)}명</b> · <b>{won(amount)}원</b>
            </span>
          </div>
        </div>
      ) : null}

      {/* ③ 사람별 목록 */}
      <div className={`${t.card} ${t.listCard}`}>
        <div className={t.listScroll}>
          <table className={`${t.tbl} ${t.tblSticky}`}>
            <colgroup>
              <col style={{ width: 100 }} />
              <col style={{ width: 120 }} />
              <col />
              <col style={{ width: 140 }} />
              <col style={{ width: 140 }} />
            </colgroup>
            <thead>
              <tr>
                <th>고지 연월</th>
                <th>보험 종류</th>
                <th>가입자</th>
                <th className={t.num}>보수월액</th>
                <th className={t.num}>금액</th>
              </tr>
            </thead>
            <tbody>
              {data.social.length === 0 ? (
                <EmptyRow cols={5} />
              ) : (
                data.social.map((r) => (
                  <tr key={r.id}>
                    <td className={t.tnum}>{r.noticeMonth}</td>
                    <td className={t.mut}>{codeName(names, r.insTp)}</td>
                    <td className={t.ell} title={r.name}>
                      {r.name}
                    </td>
                    <td className={t.num}>{r.payBase === null ? <span className={t.mut}>{DASH}</span> : won(r.payBase)}</td>
                    <td className={t.num}>{won(r.noticeAmount)}</td>
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
