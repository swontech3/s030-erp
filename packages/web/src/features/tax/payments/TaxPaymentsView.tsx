'use client';

/**
 * 세금 · 4대보험 · 대출(s050300040) 본문 — 1-7 (2026-11-02). **시안 없음** — 항목 지정 「이번 달 자료 전체」 탭과 같은 부품 ·
 * 모양만 쓴다(작업할 달 줄 · 제목 · 파일 띠 · 표 카드(탭 → 버튼 줄 [엑셀 내려받기] + 기간 → 표)). 읽기만.
 *
 *   탭 넷(결정 ①): 국세 · 지방세 · 4대보험 · 대출 (건수)
 *   국세 · 지방세: 납부일 · 세목 · 비용 여부(배지) · 금액 · 가산금(국세) / 귀속 · 납부방법(지방세) · 기관 · 납부번호, 아래 합계 줄
 *     (전체 · 비용 · 비용 아님 · 가산금). 「처음 보는 세목」은 보이지 않는다(결정 ③)
 *   4대보험: 안내 한 줄 「회사 · 직원 부담은 직원 급여에서 나눕니다」(결정 ②) · 보험 종류별 합계 표 · 사람별 목록. 고지 연월로 거른다(⑥)
 *   대출: 대출(은행 · 끝 4자리)별 요약 표(실행 원금 · 상환 원금 · 이자 · 수수료, 잔액 없음 ⑤) · 거래 목록(잔액 포함)
 * ★ 요약 · 합계는 새 모양을 만들지 않고 같은 표(`t.tbl`)의 줄로 그린다(자료 올리기 미리보기의 「합계 · N줄」 줄과 같은 꼴).
 * ★ 이름(보험 종류 · 구분 · 은행)은 API 가 준 코드 이름으로만 그린다. ★ 대출번호는 끝 4자리만(서버가 그것만 준다). 4대보험 가입자 번호(끝 4자리)는 화면 · 엑셀에 보이지 않는다(API 는 준다).
 * ★ 파일로 들어오면 기간 거르기를 걸지 않고 기간 칸을 숨긴다 · 다른 탭을 누르면 파일 띠가 풀린다(항목 지정과 같다).
 */
import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { socialTotals } from '@swonbiz/shared/domain/tax-pay-social-loan';
import {
  PAYMENT_TABS,
  PAYMENT_TAB_LABELS,
  loanSummary,
  payTotals,
  type PaymentTab,
} from '@swonbiz/shared/domain/tax-payments';
import { Icon } from '@/components/ds';
import { ExcelDownloadButton } from '@/components/patterns/ExcelDownloadButton';
import t from '../common/tax.module.css';
import { TaxFormErrorBanner } from '../common/TaxFormErrorBanner';
import { TaxMonthBar, monthLabel, todayNote } from '../common/TaxMonthBar';
import { won } from '../uploads/tax-uploads-model';
import { TaxPaymentsError, exportHref, loadPayments, type PaymentsQuery, type TaxPaymentsResponse } from './tax-payments-model';

interface Props {
  month: string;
  initialTab: PaymentTab;
  /** 자료 올리기 [보기]로 들어온 파일. */
  fileId: string | null;
}

/** `2026-09-25` → 「09.25」. */
const shortDate = (date: string): string => `${date.slice(5, 7)}.${date.slice(8, 10)}`;

/** 4대보험 두 표(보험 종류별 합계 · 사람별)의 폭 — 칸 폭의 합으로 맞춘다(590 = 90 + 110 + 130 + 120 + 140 = 340 + 110 + 140). */
const SOCIAL_TABLE_W = 590;

export function TaxPaymentsView({ month, initialTab, fileId: initialFile }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = useState<PaymentTab>(initialTab);
  const [fileId, setFileId] = useState<string | null>(initialFile);
  /** 기간 직접 지정 — null 이면 작업할 달. */
  const [period, setPeriod] = useState<{ from: string; to: string } | null>(null);
  const [data, setData] = useState<TaxPaymentsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const query: PaymentsQuery = {
    month,
    tab,
    from: fileId ? null : (period?.from ?? null),
    to: fileId ? null : (period?.to ?? null),
    fileId,
  };
  const key = JSON.stringify(query);

  const reload = useCallback(
    () =>
      loadPayments(JSON.parse(key) as PaymentsQuery)
        .then((d) => {
          setData(d);
          setLoadError(null);
        })
        .catch((err: unknown) =>
          setLoadError(err instanceof TaxPaymentsError ? err.message : '세금 · 4대보험 · 대출을 불러오지 못했습니다'),
        ),
    [key],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

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

  /** 보이는 탭 — 파일로 들어오면 서버가 파일 종류로 정한 탭. */
  const shown = data.query.tab;
  const codeName = (list: readonly { code: string; name: string }[], code: string) => list.find((c) => c.code === code)?.name ?? code;

  /** 탭 바꾸기 — 파일로 보는 중이면 파일 띠를 푼다. */
  const changeTab = (next: PaymentTab) => {
    setTab(next);
    setFailed(null);
    if (fileId) {
      setFileId(null);
      router.replace(`${pathname}?month=${month}&tab=${next}`);
    }
  };
  /** [모두 보기] — 파일 띠를 푼다. */
  const clearFile = () => {
    setFileId(null);
    router.replace(`${pathname}?month=${month}&tab=${shown}`);
  };

  const tabBar = (
    <div className={t.tabs} role="tablist" style={{ padding: '0 16px' }}>
      {PAYMENT_TABS.map((k) => (
        <button
          key={k}
          type="button"
          role="tab"
          aria-selected={shown === k}
          className={`${t.tab} ${shown === k ? t.tabOn : ''}`}
          onClick={() => changeTab(k)}
        >
          {PAYMENT_TAB_LABELS[k]} ({data.counts[k]})
        </button>
      ))}
    </div>
  );

  const toolbar = (
    <div className={t.tbar}>
      <ExcelDownloadButton href={exportHref({ ...query, tab: shown })} className={`${t.btn} ${t.btnSm}`} onError={setFailed} />
      {fileId ? null : (
        <span className={t.row} style={{ gap: 8, flexWrap: 'nowrap' }}>
          <span className={t.sm}>기간</span>
          <select
            className={t.select}
            style={{ height: 32, width: 'auto' }}
            value={period ? 'c' : 'm'}
            aria-label="기간"
            onChange={(e) => setPeriod(e.target.value === 'c' ? { from: `${month}-01`, to: lastDayOf(month) } : null)}
          >
            <option value="m">작업할 달 ({monthLabel(month)})</option>
            <option value="c">기간 직접 지정</option>
          </select>
          {period ? (
            <>
              <input
                type="date"
                className={t.input}
                style={{ height: 32, width: 150 }}
                value={period.from}
                aria-label="시작"
                onChange={(e) => e.target.value && setPeriod({ ...period, from: e.target.value })}
              />
              <span className={t.sm}>~</span>
              <input
                type="date"
                className={t.input}
                style={{ height: 32, width: 150 }}
                value={period.to}
                aria-label="끝"
                onChange={(e) => e.target.value && setPeriod({ ...period, to: e.target.value })}
              />
            </>
          ) : null}
        </span>
      )}
      <span className={t.sm}>
        지금 걸린 거르기 결과만 내려받습니다{shown === 'SOCIAL' && period ? ' · 4대보험은 고지 연월로 거릅니다' : ''}
      </span>
    </div>
  );

  const empty = (cols: number) => (
    <tr>
      <td colSpan={cols} className={t.empty}>
        해당하는 줄이 없습니다
      </td>
    </tr>
  );

  /* ── 국세 · 지방세 ── */
  const payTable = () => {
    const nt = shown === 'NTAX';
    const sum = payTotals(data.pays);
    const cols = nt ? 7 : 8;
    return (
      <table className={t.tbl} style={{ borderTop: '1px solid var(--border)' }}>
        <colgroup>
          <col style={{ width: 64 }} />
          <col />
          <col style={{ width: 96 }} />
          <col style={{ width: 120 }} />
          {nt ? <col style={{ width: 100 }} /> : <col style={{ width: 90 }} />}
          {nt ? null : <col style={{ width: 100 }} />}
          <col />
          <col style={{ width: 170 }} />
        </colgroup>
        <thead>
          <tr>
            <th>납부일</th>
            <th>세목</th>
            <th>비용 여부</th>
            <th className={t.num}>금액</th>
            {nt ? <th className={t.num}>가산금</th> : <th>귀속</th>}
            {nt ? null : <th>납부방법</th>}
            <th>{nt ? '수납관서' : '납부기관'}</th>
            <th>{nt ? '전자납부번호' : '납세번호'}</th>
          </tr>
        </thead>
        <tbody>
          {data.pays.length === 0
            ? empty(cols)
            : data.pays.map((r) => (
                <tr key={r.id}>
                  <td className={t.tnum}>{shortDate(r.payDate)}</td>
                  <td className={t.ell} title={r.taxItem}>
                    {r.taxItem}
                  </td>
                  <td>
                    <span className={`${t.badge} ${r.expense ? t.bDoing : t.bGray}`}>{r.expense ? '비용' : '비용 아님'}</span>
                  </td>
                  <td className={t.num}>{won(r.amount)}</td>
                  {nt ? <td className={t.num}>{won(r.penalty ?? 0)}</td> : <td className={t.mut}>{r.belongMonth ?? ''}</td>}
                  {nt ? null : <td className={`${t.mut} ${t.ell}`}>{r.payMethod ?? ''}</td>}
                  <td className={`${t.mut} ${t.ell}`} title={r.office ?? ''}>
                    {r.office ?? ''}
                  </td>
                  <td className={`${t.mut} ${t.ell}`} title={r.payNo}>
                    {r.payNo}
                  </td>
                </tr>
              ))}
          {data.pays.length ? (
            <tr>
              <td className={t.sm}>합계</td>
              <td className={t.sm} colSpan={2}>
                {won(sum.count)}줄 · 비용 {won(sum.expense)} · 비용 아님 {won(sum.nonExpense)}
              </td>
              <td className={t.num}>
                <b>{won(sum.amount)}</b>
              </td>
              {nt ? (
                <td className={t.num}>
                  <b>{won(sum.penalty)}</b>
                </td>
              ) : (
                <td />
              )}
              <td colSpan={nt ? 2 : 3} />
            </tr>
          ) : null}
        </tbody>
      </table>
    );
  };

  /* ── 4대보험 ── */
  const socialTables = () => {
    const ins = data.codes.socialIns;
    const totals = socialTotals(data.social);
    const amount = totals.reduce((n, x) => n + x.amount, 0);
    return (
      <>
        <div className={t.note} style={{ margin: '0 16px 12px' }}>
          <span>
            <Icon name="info" size={16} />
          </span>
          <span>회사 · 직원 부담은 직원 급여에서 나눕니다</span>
        </div>
        <table className={t.tbl} style={{ borderTop: '1px solid var(--border)', width: SOCIAL_TABLE_W }}>
          <colgroup>
            <col style={{ width: 340 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 140 }} />
          </colgroup>
          <thead>
            <tr>
              <th>보험 종류</th>
              <th className={t.num}>사람 수</th>
              <th className={t.num}>금액</th>
            </tr>
          </thead>
          <tbody>
            {totals.length === 0
              ? empty(3)
              : totals.map((x) => (
                  <tr key={x.insTp}>
                    <td>{codeName(ins, x.insTp)}</td>
                    <td className={t.num}>{won(x.count)}</td>
                    <td className={t.num}>{won(x.amount)}</td>
                  </tr>
                ))}
            {totals.length ? (
              <tr>
                <td className={t.sm}>합계</td>
                <td className={t.num}>
                  <b>{won(data.social.length)}</b>
                </td>
                <td className={t.num}>
                  <b>{won(amount)}</b>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <table className={t.tbl} style={{ borderTop: '1px solid var(--border)', marginTop: 16, width: SOCIAL_TABLE_W }}>
          <colgroup>
            <col style={{ width: 90 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 120 }} />
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
            {data.social.length === 0
              ? empty(5)
              : data.social.map((r) => (
                  <tr key={r.id}>
                    <td className={t.tnum}>{r.noticeMonth}</td>
                    <td className={t.mut}>{codeName(ins, r.insTp)}</td>
                    <td className={t.ell} title={r.name}>
                      {r.name}
                    </td>
                    <td className={t.num}>{r.payBase === null ? '' : won(r.payBase)}</td>
                    <td className={t.num}>{won(r.noticeAmount)}</td>
                  </tr>
                ))}
          </tbody>
        </table>
      </>
    );
  };

  /* ── 대출 ── */
  const loanTables = () => {
    const banks = data.codes.banks;
    const label = (r: { bankCode: string; loanLast4: string }) => `${codeName(banks, r.bankCode)} · 끝 ${r.loanLast4}`;
    const summary = loanSummary(data.loans);
    return (
      <>
        <table className={t.tbl} style={{ borderTop: '1px solid var(--border)' }}>
          <colgroup>
            <col />
            <col style={{ width: 130 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 100 }} />
          </colgroup>
          <thead>
            <tr>
              <th>대출</th>
              <th className={t.num}>실행 원금</th>
              <th className={t.num}>상환 원금</th>
              <th className={t.num}>이자</th>
              <th className={t.num}>수수료</th>
            </tr>
          </thead>
          <tbody>
            {summary.length === 0
              ? empty(5)
              : summary.map((s) => (
                  <tr key={`${s.bankCode}:${s.loanLast4}`}>
                    <td className={t.ell}>
                      {label(s)} <span className={t.sm}>· {won(s.count)}줄</span>
                    </td>
                    <td className={t.num}>{won(s.draw)}</td>
                    <td className={t.num}>{won(s.repay)}</td>
                    <td className={t.num}>{won(s.interest)}</td>
                    <td className={t.num}>{won(s.fee)}</td>
                  </tr>
                ))}
          </tbody>
        </table>
        <table className={t.tbl} style={{ borderTop: '1px solid var(--border)', marginTop: 16 }}>
          <colgroup>
            <col style={{ width: 64 }} />
            <col />
            <col style={{ width: 64 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 90 }} />
            <col style={{ width: 130 }} />
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
            {data.loans.length === 0
              ? empty(8)
              : data.loans.map((r) => (
                  <tr key={r.id}>
                    <td className={t.tnum}>{shortDate(r.txnDate)}</td>
                    <td className={`${t.mut} ${t.ell}`}>{label(r)}</td>
                    <td>{codeName(data.codes.loanTps, r.txnTp)}</td>
                    <td className={`${t.mut} ${t.ell}`}>{r.txnType ?? ''}</td>
                    <td className={t.num}>{won(r.principal)}</td>
                    <td className={t.num}>{won(r.interest)}</td>
                    <td className={t.num}>{won(r.fee)}</td>
                    <td className={t.num}>{won(r.balance)}</td>
                  </tr>
                ))}
          </tbody>
        </table>
      </>
    );
  };

  return (
    <div className={t.page}>
      <TaxMonthBar month={month} note={todayNote(null)} />
      <div className={t.pageH}>
        <div>
          <p>자료 올리기에서 올린 국세 · 지방세 납부, 4대보험 고지, 대출 거래를 봅니다.</p>
        </div>
      </div>

      {data.file ? (
        <div className={`${t.note} ${t.noteInfo}`} style={{ alignItems: 'center' }}>
          <span>
            <Icon name="file-text" size={16} />
          </span>
          <span style={{ flex: 1 }}>
            <b>
              「{data.file.fileName}」 파일로 들어온 {data.counts[shown]}줄만 보는 중
            </b>
          </span>
          <button type="button" className={`${t.btn} ${t.btnSm}`} onClick={clearFile}>
            모두 보기
          </button>
        </div>
      ) : null}

      <div className={t.card}>
        {tabBar}
        {toolbar}
        {failed ? (
          <div style={{ padding: '0 16px 12px' }}>
            <TaxFormErrorBanner kind="failed" message={failed} />
          </div>
        ) : null}
        <div className={t.tblWrap}>
          {shown === 'NTAX' || shown === 'LTAX' ? payTable() : shown === 'SOCIAL' ? socialTables() : loanTables()}
        </div>
      </div>
    </div>
  );
}

/** 달의 마지막 날(`YYYY-MM-DD`) — 「기간 직접 지정」의 처음 끝 날짜. */
function lastDayOf(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}
