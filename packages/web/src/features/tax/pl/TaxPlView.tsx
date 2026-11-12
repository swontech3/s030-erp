'use client';

/**
 * 월별 손익(s050400010) 본문 — 1-8 (2026-11-05). 시안 `doc/tax-service/prototypes/s05-tax/tax-screens-b.js` 의 S05-08 · 결과서 S05-08.
 *
 *   달 고르기 줄(오른쪽 「부가세를 뺀 금액입니다.」) · 「{해}년」 막대 차트 카드 · 숫자 카드 셋(+ 올해 누적 한 줄) ·
 *   내역 카드 둘(매출 · 비용 — 비용 카드 아래 미지정 안내 + [항목지정])
 * ★ 11-06 대표 수정: 회색 안내 띠 · 본문 설명 · 주황 띠 · 「비용에 넣지 않는 것」 문구 지움 · 번 돈/쓴 돈/남은 돈 → 매출/비용/이익 ·
 *   숫자 카드에 올해 누적 · 미지정 줄은 비용에 「미지정」 한 줄로(계산은 shared).
 *
 * ★ 숫자는 서버가 센 것만 그린다(shared `tax-pl.ts`) — 화면은 더하지 않는다.
 * ★ 막대를 누르면 작업할 달이 그 달로 바뀐다(주소 `?month=`). 자료 없는 달 · 미래 달은 누를 수 없다.
 * ★ 그리지 않는 것: 대출 경고(결정 8) · 다음 단계 줄(결정 12). 본문 큰 제목은 머리글에 화면 이름이 있어 두지 않는다(11-05).
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { thisMonthOf } from '@swonbiz/shared/domain/tax-uploads';
import type { PlLine } from '@swonbiz/shared/domain/tax-pl';
import t from '../common/tax.module.css';
import r from '../common/tax-report.module.css';
import { TaxFormErrorBanner } from '../common/TaxFormErrorBanner';
import { TaxMonthBar, monthLabel, monthShort } from '../common/TaxMonthBar';
import { won } from '../uploads/tax-uploads-model';
import { TaxPlError, loadPl, type TaxPlResponse } from './tax-pl-model';

export function TaxPlView({ month }: { month: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [data, setData] = useState<TaxPlResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(
    () =>
      loadPl(month)
        .then((d) => {
          setData(d);
          setLoadError(null);
        })
        .catch((err: unknown) => setLoadError(err instanceof TaxPlError ? err.message : '월별 손익을 불러오지 못했습니다')),
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

  const { pl } = data;
  const d = pl.detail;
  const last = thisMonthOf(new Date());
  const max = Math.max(1, ...pl.months.flatMap((m) => [m.income, m.expense]));
  const pct = (n: number) => `${(Math.max(0, n) / max) * 100}%`;
  const ms = monthShort(month);

  const lineOf = (l: PlLine) => (
    <div key={l.key} className={r.ln}>
      <span className={r.lnL}>
        {l.label}
        {l.note ? <small>{l.note}</small> : null}
      </span>
      <span className={r.lnV}>{won(l.amount)}</span>
    </div>
  );

  return (
    <div className={t.page}>
      <TaxMonthBar month={month} note="부가세를 뺀 금액입니다." />

      <div className={`${t.card} ${t.cardPad}`}>
        <div className={t.between} style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{pl.year}년</h2>
          <span className={r.leg}>
            <span>
              <i style={{ background: 'var(--color-primary)' }} />매출
            </span>
            <span>
              <i style={{ background: 'var(--border-strong)' }} />비용
            </span>
          </span>
        </div>
        <div className={r.chart}>
          {pl.months.map((m) => {
            const can = m.hasData && m.month <= last;
            const on = m.month === month;
            return (
              <button
                key={m.month}
                type="button"
                className={`${r.barG} ${on ? r.barOn : ''} ${can ? '' : r.barOff}`}
                disabled={!can}
                title={can ? `${monthLabel(m.month)} · 매출 ${won(m.income)} · 비용 ${won(m.expense)}` : undefined}
                onClick={() => router.push(`${pathname}?month=${m.month}`)}
              >
                <span className={r.bars}>
                  {m.hasData ? (
                    <>
                      <span className={r.b1} style={{ height: pct(m.income) }} />
                      <span className={r.b2} style={{ height: pct(m.expense) }} />
                    </>
                  ) : null}
                </span>
                <span className={r.barM}>{Number(m.month.slice(5))}월</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className={t.grid3}>
        <div className={`${t.card} ${r.kpi}`}>
          <div className={r.kpiK}>{ms} 매출</div>
          <div className={r.kpiV}>
            {won(d.incomeTotal)}
            <small> 원</small>
          </div>
          <div className={r.kpiK} style={{ marginTop: 4 }}>올해 누적 {won(pl.ytd.income)}원</div>
        </div>
        <div className={`${t.card} ${r.kpi}`}>
          <div className={r.kpiK}>{ms} 비용</div>
          <div className={r.kpiV}>
            {won(d.expenseTotal)}
            <small> 원</small>
          </div>
          <div className={r.kpiK} style={{ marginTop: 4 }}>올해 누적 {won(pl.ytd.expense)}원</div>
        </div>
        <div className={`${t.card} ${r.kpi}`}>
          <div className={r.kpiK}>{ms} 이익</div>
          <div className={`${r.kpiV} ${r.kpiPrimary}`}>
            {won(d.profit)}
            <small> 원</small>
          </div>
          <div className={r.kpiK} style={{ marginTop: 4 }}>올해 누적 {won(pl.ytd.profit)}원</div>
        </div>
      </div>

      <div className={t.grid2}>
        <div className={`${t.card} ${t.cardPad}`}>
          <div className={t.secT}>매출</div>
          <div className={r.calc}>
            {d.income.map(lineOf)}
            <div className={`${r.ln} ${r.sum}`}>
              <span>합계</span>
              <span className={r.lnV}>{won(d.incomeTotal)}</span>
            </div>
          </div>
        </div>
        <div className={`${t.card} ${t.cardPad}`}>
          <div className={t.secT}>비용</div>
          <div className={r.calc}>
            {d.expense.map(lineOf)}
            <div className={`${r.ln} ${r.sum}`}>
              <span>합계</span>
              <span className={r.lnV}>{won(d.expenseTotal)}</span>
            </div>
          </div>
          {d.nonBiz !== 0 ? (
            <div className={r.calc} style={{ marginTop: 12 }}>
              <div className={r.ln} style={{ borderTop: '1px solid var(--border)' }}>
                <span className={r.lnL}>
                  사업과 무관
                  <small>비용에 넣지 않았습니다</small>
                </span>
                <span className={r.lnV}>{won(d.nonBiz)}원</span>
              </div>
            </div>
          ) : null}
          {d.unassigned.count > 0 ? (
            <div className={t.between} style={{ marginTop: 12, gap: 12 }}>
              <p className={t.help} style={{ margin: 0 }}>
                미지정 건 {won(d.unassigned.count)}줄 ({won(d.unassigned.amount)}원)은 「미지정」으로 비용에 들어가 있습니다. 항목지정을 해 주시기
                바랍니다.
              </p>
              <Link href={`/tax/classify?month=${month}`} className={`${t.btn} ${t.btnSm}`}>
                항목지정
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
