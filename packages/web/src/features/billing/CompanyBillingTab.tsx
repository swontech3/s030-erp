'use client';

/**
 * 입주사 청구 탭 — s0300200030 오른쪽 「계약 | 청구」 의 「청구」.
 *
 * 그 입주사의 청구서를 월 순서로 · 상태 · [수납] [내역] (월별 청구와 **같은 표·같은 창**).
 * 중도해지한 계약이 있으면 위쪽에 정산 결과가 계약마다 한 장씩 붙는다.
 *
 * ★ 입주사를 바꾸면 다시 받는다. 목록의 칩·검색·선택은 부모(TenantContractsView)가
 *   주소에 들고 있고, 이 탭은 그것을 건드리지 않는다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './billing.module.css';
import { BillingEmpty, BillingTable } from './BillingTable';
import { SettlementCard } from './SettlementCard';
import type { BillingItem, Settlement } from './billing-model';

interface Props {
  companyId: string;
  /** 토스트를 부모가 띄운다 — 화면에 토스트가 두 개 겹치지 않게. */
  notify: (message: string) => void;
}

export function CompanyBillingTab({ companyId, notify }: Props) {
  const [data, setData] = useState<{ invoices: BillingItem[]; settlements: Settlement[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const asOf = useMemo(() => new Date(), [data]);

  // ★ 입주사를 빨리 바꾸면 앞 입주사의 응답이 늦게 올 수 있다 — 마지막 것만 받는다.
  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const res = await fetch(`/api/companies/${encodeURIComponent(companyId)}/billing`);
      const body = (await res.json()) as {
        invoices?: BillingItem[];
        settlements?: Settlement[];
        message?: string;
      };
      if (!res.ok) throw new Error(body.message ?? '청구를 불러오지 못했습니다');
      if (mine === seq.current) {
        setData({ invoices: body.invoices ?? [], settlements: body.settlements ?? [] });
        setError(null);
      }
    } catch (err) {
      if (mine === seq.current) {
        setData({ invoices: [], settlements: [] });
        setError((err as Error).message);
      }
    }
  }, [companyId]);

  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  const changed = useCallback(
    (message: string) => {
      notify(message);
      void load();
    },
    [load, notify],
  );

  if (data === null) return <BillingEmpty lead="청구를 불러오는 중입니다" />;
  if (error) return <BillingEmpty lead={error} />;

  return (
    <>
      {data.settlements.length > 0 ? (
        <div className={styles.settleList}>
          {data.settlements.map((s) => (
            <SettlementCard key={s.settlementId} s={s} onProcessed={changed} />
          ))}
        </div>
      ) : null}
      {data.invoices.length === 0 ? (
        <BillingEmpty lead="청구서가 없습니다" sub="청구서는 계약을 확정하면 계약기간 전체가 만들어집니다" />
      ) : (
        <BillingTable items={data.invoices} mode="company" asOf={asOf} onChanged={changed} />
      )}
    </>
  );
}
