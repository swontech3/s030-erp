'use client';

/**
 * 입주사 청구 탭 — s030200030 오른쪽 「계약 | 청구」 의 「청구」. **조회 전용.**
 *
 * 그 입주사의 청구서를 월 순서로 · 상태 · 예치금 보유 줄 · 정산 요약 한 줄.
 *
 * =============================================================================
 * ★★ 한 업무는 한 화면에서 (CLAUDE.md)
 * =============================================================================
 * 돈을 만지는 일(수납 입력·수정·삭제 · 정산 처리 · 예치금 반환 · 정산서 출력)은 사이드바
 * 「청구」(/billing) 에서만 한다. 이 탭에는 처리 버튼이 **하나도 없다** — 「청구에서 처리」
 * 링크가 그 입주사로 걸러진 청구 화면(정산은 정산 탭의 그 계약)으로 보낸다.
 *
 * ★ 입주사를 바꾸면 다시 받는다. 목록의 칩·검색·선택은 부모(TenantContractsView)가
 *   주소에 들고 있고, 이 탭은 그것을 건드리지 않는다.
 */
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEPOSIT_ENTRY_LABEL } from '@swonbiz/shared/domain/deposit-ledger';
import { settlementDirection } from '@swonbiz/shared/domain/settlement-view';
import styles from './billing.module.css';
import { BillingEmpty, BillingTable } from './BillingTable';
import { billingHref, dotDate, type BillingItem, type ContractDeposit, type Settlement } from './billing-model';

/**
 * 「예치금 1,000,000원 보유 · 2026.09.26 받음」 — 보유 중인 계약마다 한 줄.
 * ★ 날짜와 이름은 **마지막으로 들어온 기록**(받음 · 이월)의 것이다 — 언제 어떻게 들고 있게
 *   됐는지가 보여야 한다. 보유액이 0 인 계약(반환·이월 끝)은 적지 않는다.
 */
function depositLine(d: ContractDeposit, rooms: string): string {
  const lastIn = [...d.entries].reverse().find((e) => e.kind === 'receive' || e.kind === 'carry_in');
  const when = lastIn ? ` · ${dotDate(lastIn.entryOn)} ${DEPOSIT_ENTRY_LABEL[lastIn.kind]}` : '';
  // ★ 계약이 여럿이면 어느 계약의 예치금인지가 보여야 한다 — 호실을 앞에 붙인다.
  return `${rooms ? `${rooms} — ` : ''}예치금 ${d.balance.toLocaleString('ko-KR')}원 보유${when}`;
}

/** 「중도해지 정산 · 환불할 금액 550,000원 · 처리 대기」 — 정산 카드 대신 한 줄. */
function settlementLine(s: Settlement): string {
  const dir = settlementDirection(s.netAmount);
  const money = dir.kind === 'none' ? dir.label : `${dir.label} ${dir.amount.toLocaleString('ko-KR')}원`;
  const state = s.processed ? `${dotDate(s.processed.processedOn)} 처리 완료` : '처리 대기';
  return `중도해지 정산 · ${money} · ${state}`;
}

export function CompanyBillingTab({ companyId }: { companyId: string }) {
  const [data, setData] = useState<{
    invoices: BillingItem[];
    settlements: Settlement[];
    deposits: ContractDeposit[];
  } | null>(null);
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
        deposits?: ContractDeposit[];
        message?: string;
      };
      if (!res.ok) throw new Error(body.message ?? '청구를 불러오지 못했습니다');
      if (mine === seq.current) {
        setData({ invoices: body.invoices ?? [], settlements: body.settlements ?? [], deposits: body.deposits ?? [] });
        setError(null);
      }
    } catch (err) {
      if (mine === seq.current) {
        setData({ invoices: [], settlements: [], deposits: [] });
        setError((err as Error).message);
      }
    }
  }, [companyId]);

  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  if (data === null) return <BillingEmpty lead="청구를 불러오는 중입니다" />;
  if (error) return <BillingEmpty lead={error} />;

  const held = data.deposits.filter((d) => d.balance > 0);
  // 계약 → 호실. 청구서 목록이 이미 갖고 있다(예치금 API 에 따로 싣지 않는다).
  const roomsOf = new Map(data.invoices.map((i) => [i.contractId, i.roomNames] as const));

  return (
    <>
      <div className={styles.readOnlyBar}>
        <span className={styles.muted}>조회 전용 — 수납·정산은 청구 화면에서 합니다</span>
        <Link href={billingHref({ company: companyId })} data-billing-link="company">
          청구에서 처리
        </Link>
      </div>
      {held.length > 0 ? (
        <div className={styles.depositList} data-deposit-list="1">
          {held.map((d) => (
            <span key={d.contractId}>{depositLine(d, roomsOf.get(d.contractId) ?? '')}</span>
          ))}
        </div>
      ) : null}
      {data.settlements.length > 0 ? (
        <div className={styles.depositList} data-settlement-lines="1">
          {data.settlements.map((s) => (
            <span key={s.settlementId} className={styles.settleLine} data-settlement-line={s.contractId}>
              <span>
                {s.roomNames ? `${s.roomNames} — ` : ''}
                {settlementLine(s)}
              </span>
              <Link href={billingHref({ tab: 'settle', company: companyId, contract: s.contractId })}>
                {s.processed ? '청구에서 보기' : '청구에서 처리'}
              </Link>
            </span>
          ))}
        </div>
      ) : null}
      {data.invoices.length === 0 ? (
        <BillingEmpty lead="청구서가 없습니다" sub="청구서는 계약을 확정하면 계약기간 전체가 만들어집니다" />
      ) : (
        <BillingTable items={data.invoices} mode="company" asOf={asOf} readOnly />
      )}
    </>
  );
}
