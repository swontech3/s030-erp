'use client';

/**
 * 부가세 조회(s050400020) 본문 — 1-8 (2026-11-05). 시안 `doc/tax-service/prototypes/s05-tax/tax-screens-b.js` 의 S05-09 · 결과서 S05-09.
 *
 *   2026-11-08 대표 수정 ⑦ — 대표 설계대로:
 *   ① 맨 위 한 줄 — 왼쪽 신고 기간 선택 상자 · 오른쪽 [엑셀 내려받기](맨 앞 「부가세 요약」 + 매출 · 매입 명세)
 *   ② 표 하나, 머리 두 줄 — 월 | 매출액(공급가액 · 부가세액 · 합계) | 매입액(…) | 카드 경비(…) | 납부세액.
 *      신고 기간의 달마다 한 줄 + 합계 줄. 아직 오지 않은 달(센 범위 끝 달보다 뒤)은 모든 칸 빈칸
 *   ③ 「< 비고 >」 상자 세 줄 — 신고 · 납부 마감 / 미지정 건(빨강, 있을 때만 + [항목지정]) / 세무사 협의 안내
 * ★ 지운 것(⑦): 「공제가 안 될 수 있는 매입」 카드 · 현금 매출 안내 · 「추정 · 세무사 확인」 배지 · 「이 화면은 보기만 합니다 …」.
 * ★ [항목지정]은 항목 지정을 미지정이 있는 가장 이른 달 · 구분 「미지정」으로 연다(`?month=&status=L`).
 *
 * ★ 11-06 대표 수정: 달 고르기 대신 신고 기간 선택 상자 · 용어 풀이 · 신고 기간 카드 · 예정고지 띠 · 주황 띠 지움 · 본문을 달마다 표로.
 *   신고 기간을 고르면 주소 `?month=` 가 그 기간 끝 달(이번 달보다 뒤면 이번 달)로 바뀐다 — 다른 세무 화면도 그 달로 따라간다.
 * ★ 숫자 · 신고 기간은 서버가 정한 것만 그린다(shared `tax-vat.ts`) — 화면은 더하지 않는다.
 * ★ 사업자 유형이 없으면 세무 설정 안내만(항목 지정 화면과 같은 모양).
 * ★ 그리지 않는 것: 다음 단계 줄(결정 12). 본문 큰 제목은 머리글에 화면 이름이 있어 두지 않는다(11-05).
 */
import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { thisMonthOf } from '@swonbiz/shared/domain/tax-uploads';
import { TAX_CLS_LEFT } from '@swonbiz/shared/domain/tax-classify';
import { vatPeriodMonth, type VatAmounts } from '@swonbiz/shared/domain/tax-vat';
import { Icon } from '@/components/ds';
import { ExcelDownloadButton } from '@/components/patterns/ExcelDownloadButton';
import t from '../common/tax.module.css';
import { TaxFormErrorBanner } from '../common/TaxFormErrorBanner';
import { monthShort } from '../common/TaxMonthBar';
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
  /** 금액 칸 열 — 매출 · 매입 · 카드 경비(공급가액 · 부가세액 · 합계) · 납부세액. */
  const KEYS: (keyof VatAmounts)[] = [
    'salesSupply', 'salesTax', 'salesTotal',
    'purchaseSupply', 'purchaseTax', 'purchaseTotal',
    'cardSupply', 'cardTax', 'cardTotal',
    'payable',
  ];
  /** 묶음 첫 칸(매입 · 카드 경비 · 납부세액)에 왼쪽 선 — 머리 두 줄과 맞춘다. */
  const GROUP_START = new Set([3, 6, 9]);
  const sep = { borderLeft: '1px solid var(--border)' } as const;
  const cells = (a: VatAmounts | null, bold = false) =>
    KEYS.map((k, i) => (
      <td key={k} className={t.num} style={GROUP_START.has(i) ? sep : undefined}>
        {a === null ? null : bold ? <b>{won(a[k])}</b> : won(a[k])}
      </td>
    ));
  const groupTh = (label: string, first = false) => (
    <th colSpan={3} style={{ textAlign: 'center', ...(first ? {} : sep) }}>
      {label}
    </th>
  );
  const subTh = (label: string, first: boolean) => (
    <th className={t.num} style={first ? sep : undefined}>
      {label}
    </th>
  );
  const SUB = ['공급가액', '부가세액', '합계'];

  return (
    <div className={t.page}>
      {/* ① 신고 기간 · 엑셀 */}
      <div className={t.between}>
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
        <ExcelDownloadButton href={exportHref(data.query)} className={`${t.btn} ${t.btnSm}`} onError={setFailed} />
      </div>
      {failed ? <TaxFormErrorBanner kind="failed" message={failed} /> : null}

      {/* ② 표 — 머리 두 줄 */}
      <div className={t.card}>
        <div className={t.tblWrap}>
          <table className={t.tbl}>
            <colgroup>
              <col style={{ width: 72 }} />
              {KEYS.map((k) => (
                <col key={k} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th rowSpan={2}>월</th>
                {groupTh('매출액', true)}
                {groupTh('매입액')}
                {groupTh('카드 경비')}
                <th rowSpan={2} className={t.num} style={sep}>
                  납부세액
                </th>
              </tr>
              <tr>
                {[0, 1, 2].flatMap((g) => SUB.map((label, i) => <Fragment key={`${g}${i}`}>{subTh(label, g > 0 && i === 0)}</Fragment>))}
              </tr>
            </thead>
            <tbody>
              {vat.months.map((m) => (
                <tr key={m.month}>
                  <td>{monthShort(m.month)}</td>
                  {cells(m.amounts)}
                </tr>
              ))}
              <tr>
                <td>
                  <b>합계</b>
                </td>
                {cells(vat.total, true)}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ③ 비고 */}
      <div className={`${t.card} ${t.cardPad}`}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>&lt; 비고 &gt;</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
          <span>신고 · 납부 마감 : {dateLabel(period.deadline)}</span>
          {vat.unassignedCount > 0 && vat.unassignedFirstMonth ? (
            <span className={t.row} style={{ gap: 8, color: 'var(--color-danger)' }}>
              미지정 건 {won(vat.unassignedCount)}줄이 빠져 있습니다. 항목 지정에서 확정해 주시기 바랍니다.
              <Link href={`/tax/classify?month=${vat.unassignedFirstMonth}&status=${TAX_CLS_LEFT}`} className={`${t.btn} ${t.btnSm}`}>
                항목지정
              </Link>
            </span>
          ) : null}
          <span>법인 또는 회사 신용카드 경비 및 부가세 납부세액은 세무사와 협의하시기 바랍니다.</span>
        </div>
      </div>
    </div>
  );
}
