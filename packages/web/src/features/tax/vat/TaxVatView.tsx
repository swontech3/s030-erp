'use client';

/**
 * 부가세 조회(s050400020) 본문 — 1-8 (2026-11-05). 시안 `doc/tax-service/prototypes/s05-tax/tax-screens-b.js` 의 S05-09 · 결과서 S05-09.
 *
 *   신고 기간 줄(왼쪽 신고 기간 선택 상자 · 오른쪽 「신고 · 납부 마감 …」 + [엑셀 내려받기]) ·
 *   표 하나(신고 기간의 달마다 한 줄 + 합계 줄) · 현금 매출 안내 · 공제가 안 될 수 있는 매입 · 맨 아래 미지정 안내 + [항목지정]
 *
 * ★ 11-06 대표 수정: 달 고르기 대신 신고 기간 선택 상자 · 용어 풀이 · 신고 기간 카드 · 예정고지 띠 · 주황 띠 지움 · 본문을 달마다 표로.
 *   신고 기간을 고르면 주소 `?month=` 가 그 기간 끝 달(이번 달보다 뒤면 이번 달)로 바뀐다 — 다른 세무 화면도 그 달로 따라간다.
 * ★ 숫자 · 신고 기간은 서버가 정한 것만 그린다(shared `tax-vat.ts`) — 화면은 더하지 않는다.
 * ★ 사업자 유형이 없으면 세무 설정 안내만(항목 지정 화면과 같은 모양).
 * ★ 현금 매출은 세액 없이 안내만(결정 7). 엑셀은 그대로(매출 · 매입 명세).
 * ★ 그리지 않는 것: 다음 단계 줄(결정 12). 본문 큰 제목은 머리글에 화면 이름이 있어 두지 않는다(11-05).
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { thisMonthOf } from '@swonbiz/shared/domain/tax-uploads';
import { vatPeriodMonth, type VatAmounts } from '@swonbiz/shared/domain/tax-vat';
import { Icon } from '@/components/ds';
import { ExcelDownloadButton } from '@/components/patterns/ExcelDownloadButton';
import t from '../common/tax.module.css';
import r from '../common/tax-report.module.css';
import { TaxFormErrorBanner } from '../common/TaxFormErrorBanner';
import { TaxMonthBar, monthShort } from '../common/TaxMonthBar';
import { won } from '../uploads/tax-uploads-model';
import { TaxVatError, exportHref, loadVat, type TaxVatResponse } from './tax-vat-model';

/** `2026-10-25` → 「2026년 10월 25일」. */
const dateLabel = (date: string): string => {
  const [y, m, d] = date.split('-');
  return `${y}년 ${Number(m)}월 ${Number(d)}일`;
};

export function TaxVatView({ month }: { month: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [data, setData] = useState<TaxVatResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  // 신고 기간은 작업할 달로 정한다(서버 `vatPeriodOf`) — 기간을 고르면 주소의 달을 바꾼다.
  const reload = useCallback(
    () =>
      loadVat({ month, periodId: null })
        .then((d) => {
          setData(d);
          setLoadError(null);
        })
        .catch((err: unknown) => setLoadError(err instanceof TaxVatError ? err.message : '부가세 조회를 불러오지 못했습니다')),
    [month],
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

  const { period, vat } = data;
  if (!period || !vat) {
    return (
      <div className={t.page}>
        <div className={t.note}>
          <span>
            <Icon name="info" size={16} />
          </span>
          <span style={{ flex: 1 }}>세무 설정에서 사업자 유형을 먼저 고르세요 — 사업자 유형에 따라 신고 기간이 다릅니다.</span>
          <Link href="/tax/settings" className={`${t.btn} ${t.btnSm}`}>
            <Icon name="settings" size={16} />
            세무 설정
          </Link>
        </div>
      </div>
    );
  }

  const now = thisMonthOf(new Date());
  const picker = (
    <select
      className={t.select}
      style={{ height: 32, width: 'auto' }}
      value={period.id}
      aria-label="신고 기간"
      onChange={(e) => {
        const p = data.periods.find((x) => x.id === e.target.value);
        if (!p) return;
        setFailed(null);
        router.push(`${pathname}?month=${vatPeriodMonth(p, now)}`);
      }}
    >
      {data.periods.map((p) => (
        <option key={p.id} value={p.id}>
          {p.option}
        </option>
      ))}
    </select>
  );
  const note = (
    <span className={t.row} style={{ gap: 12, flexWrap: 'nowrap' }}>
      <span>신고 · 납부 마감 {dateLabel(period.deadline)}</span>
      <ExcelDownloadButton href={exportHref(data.query)} className={`${t.btn} ${t.btnSm}`} onError={setFailed} />
    </span>
  );
  const cells = (a: VatAmounts, bold = false) =>
    [a.salesSupply, a.salesTax, a.purchaseSupply, a.purchaseTax, a.cardSupply, a.cardTax, a.payable].map((n, i) => (
      <td key={i} className={t.num}>
        {bold ? <b>{won(n)}</b> : won(n)}
      </td>
    ));

  return (
    <div className={t.page}>
      <TaxMonthBar month={month} picker={picker} note={note} />
      {failed ? <TaxFormErrorBanner kind="failed" message={failed} /> : null}

      <div className={t.card}>
        <div className={t.tblWrap}>
          <table className={t.tbl}>
            <colgroup>
              <col style={{ width: 150 }} />
              <col />
              <col />
              <col />
              <col />
              <col />
              <col />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th>월</th>
                <th className={t.num}>매출 공급가액</th>
                <th className={t.num}>매출 부가세</th>
                <th className={t.num}>매입(계산서) 공급가액</th>
                <th className={t.num}>매입 부가세</th>
                <th className={t.num}>카드 경비 금액</th>
                <th className={t.num}>카드 부가세(공제 줄)</th>
                <th className={t.num}>낼 부가세</th>
              </tr>
            </thead>
            <tbody>
              {vat.months.map((m) => (
                <tr key={m.month}>
                  <td>{monthShort(m.month)}</td>
                  {cells(m)}
                </tr>
              ))}
              <tr>
                <td>
                  <span className={t.row} style={{ gap: 6, flexWrap: 'nowrap' }}>
                    <b>합계</b>
                    <span className={`${t.badge} ${t.bDoing} ${r.bSm}`}>추정 · 세무사 확인</span>
                  </span>
                </td>
                {cells(vat.total, true)}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {vat.cashSales !== 0 ? <p className={t.help}>현금 매출 {won(vat.cashSales)}원 — 부가세 포함 여부 세무사 확인</p> : null}

      <div className={`${t.card} ${t.cardPad}`}>
        <div className={t.between}>
          <div className={t.secT}>공제가 안 될 수 있는 매입</div>
          <span className={`${t.badge} ${t.bDoing}`}>추정</span>
        </div>
        <p className={t.help} style={{ marginTop: 6 }}>
          시스템이 추정만 하고 판단은 세무사가 합니다. 공제가 안 되면 낼 세금이 <b>최대 {won(vat.nodeduct.total)}원</b> 늘어납니다.
        </p>
        {vat.nodeduct.lines.length ? (
          <div className={r.calc}>
            {vat.nodeduct.lines.map((l) => (
              <div key={l.itemCode} className={r.ln}>
                <span>{l.label}</span>
                <span className={r.lnV}>{won(l.tax)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className={t.help} style={{ marginTop: 8 }}>
            해당하는 매입이 없습니다
          </p>
        )}
      </div>

      <p className={t.help}>이 화면은 보기만 합니다. 실제 신고는 세무사가 하며, 숫자는 세무사 전달 때 정리본에 함께 들어갑니다.</p>

      {vat.unassignedCount > 0 ? (
        <div className={t.between}>
          <p className={t.help} style={{ margin: 0 }}>
            ※ 미지정 건 {won(vat.unassignedCount)}줄은 아직 빠져 있습니다.
          </p>
          <Link href={`/tax/classify?month=${month}`} className={`${t.btn} ${t.btnSm}`}>
            항목지정
          </Link>
        </div>
      ) : null}
    </div>
  );
}
