/**
 * 예치금 장부(`tb_s080_deposit_ledger`, 024) — 읽기·쓰기.
 *
 * 무엇을 남길지는 `@swonbiz/shared/domain/deposit-ledger` 의 순수 함수가 정한다.
 * 이 파일은 SQL 만 한다. 날짜는 전부 `to_char` 문자열로 읽는다(`invoices.ts` 머리말).
 *
 * ★ 보유액 칸이 없다 — 기록의 합이다. 여기서도 합을 SQL 로 낸다.
 */
import type { DepositEntryKind } from '@swonbiz/shared/domain/deposit-ledger';
import type { ScopedClient } from './withCompanyScope.ts';

interface Rows<T> {
  rows: T[];
  rowCount: number | null;
}
const q = <T>(client: ScopedClient, sql: string, params?: unknown[]): Promise<Rows<T>> =>
  client.query(sql, params) as Promise<Rows<T>>;

/** 보유액 = 받음 + 이월(받음) − 이월(넘김) − 반환 − 차감. `deposit-ledger.ts` 와 같은 식. */
const BALANCE_SQL = `
  coalesce(sum(CASE WHEN d.entry_kind IN ('receive', 'carry_in') THEN d.amount ELSE -d.amount END), 0)::int`;

export interface DepositRow {
  deposit_entry_id: string;
  contract_id: string;
  entry_kind: DepositEntryKind;
  amount: number;
  /** `YYYY-MM-DD`. */
  entry_day: string;
  related_contract_id: string | null;
  refund_bank: string | null;
  refund_account: string | null;
  refund_holder: string | null;
  memo: string | null;
}

export async function listContractDeposits(client: ScopedClient, contractId: string): Promise<DepositRow[]> {
  const { rows } = await q<DepositRow>(
    client,
    `SELECT deposit_entry_id, contract_id, entry_kind, amount,
            to_char(entry_on, 'YYYY-MM-DD') AS entry_day, related_contract_id,
            refund_bank, refund_account, refund_holder, memo
       FROM public.tb_s080_deposit_ledger
      WHERE contract_id = $1
      ORDER BY entry_on, created_at, deposit_entry_id`,
    [contractId],
  );
  return rows;
}

export async function listCompanyDeposits(client: ScopedClient, companyId: string): Promise<DepositRow[]> {
  const { rows } = await q<DepositRow>(
    client,
    `SELECT deposit_entry_id, contract_id, entry_kind, amount,
            to_char(entry_on, 'YYYY-MM-DD') AS entry_day, related_contract_id,
            refund_bank, refund_account, refund_holder, memo
       FROM public.tb_s080_deposit_ledger
      WHERE company_id = $1
      ORDER BY entry_on, created_at, deposit_entry_id`,
    [companyId],
  );
  return rows;
}

export async function insertDepositEntry(
  client: ScopedClient,
  args: {
    depositEntryId: string;
    buildId: string;
    companyId: string;
    contractId: string;
    kind: DepositEntryKind;
    amount: number;
    /** `YYYY-MM-DD`. */
    entryOn: string;
    relatedContractId?: string | null;
    settlementId?: string | null;
    refund?: { bank: string; account: string; holder: string } | null;
    memo?: string | null;
    actor: string;
  },
): Promise<void> {
  await q(
    client,
    `INSERT INTO public.tb_s080_deposit_ledger
       (deposit_entry_id, build_id, company_id, contract_id, entry_kind, amount, entry_on,
        related_contract_id, settlement_id, refund_bank, refund_account, refund_holder, memo,
        created_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10,$11,$12,$13, now(), $14)`,
    [
      args.depositEntryId, args.buildId, args.companyId, args.contractId, args.kind, args.amount,
      args.entryOn, args.relatedContractId ?? null, args.settlementId ?? null,
      args.refund?.bank ?? null, args.refund?.account ?? null, args.refund?.holder ?? null,
      args.memo ?? null, args.actor,
    ],
  );
}

/**
 * 정산 탭의 처리 대기 후보 — 종료된 계약 중 **처리 전 정산이 있거나 예치금이 남은** 것,
 * 그리고 최근에 처리된 것.
 *
 * ★ 대기인지 아닌지의 판정은 여기서 하지 않는다 — `pendingKind`(shared)가 한다. 여기서는
 *   판정에 필요한 칸만 모은다. 처리 완료는 최근 것만(정산 처리일 · 반환일 기준 90일).
 */
export interface SettlementQueueRow {
  contract_id: string;
  company_id: string;
  company_name: string;
  status: string;
  /** 종료일자 `YYYY-MM-DD`. */
  terminated_day: string | null;
  end_day: string;
  room_names: string | null;
  deposit_balance: number;
  settlement_id: string | null;
  net_amount: number | null;
  /** 정산 처리일 `YYYY-MM-DD`. */
  processed_day: string | null;
  processed_amount: number | null;
  settlement_refund_account: string | null;
  /** 정산 없이 한 예치금 반환 — 마지막 반환일·금액·계좌. */
  last_return_day: string | null;
  last_return_amount: number | null;
  last_return_account: string | null;
}

export async function listSettlementQueue(client: ScopedClient): Promise<SettlementQueueRow[]> {
  const { rows } = await q<SettlementQueueRow>(
    client,
    `SELECT k.contract_id, k.company_id, c.company_name, k.status,
            to_char(k.terminated_date, 'YYYY-MM-DD') AS terminated_day,
            to_char(k.end_date, 'YYYY-MM-DD')        AS end_day,
            (SELECT string_agg(s.room_name, ' / ' ORDER BY cs.seq)
               FROM public.tb_s080_contract_spaces cs
               LEFT JOIN public.tb_s080_spaces s ON s.space_id = cs.space_id
              WHERE cs.contract_id = k.contract_id) AS room_names,
            (SELECT ${BALANCE_SQL} FROM public.tb_s080_deposit_ledger d WHERE d.contract_id = k.contract_id)
              AS deposit_balance,
            st.settlement_id, st.net_amount,
            to_char(st.processed_on, 'YYYY-MM-DD') AS processed_day, st.processed_amount,
            st.refund_account AS settlement_refund_account,
            r.entry_day AS last_return_day, r.amount AS last_return_amount, r.refund_account AS last_return_account
       FROM public.tb_s080_contracts k
       JOIN public.tb_s080_companies c ON c.company_id = k.company_id
       LEFT JOIN public.tb_s080_settlements st ON st.contract_id = k.contract_id
       LEFT JOIN LATERAL (
         SELECT to_char(d.entry_on, 'YYYY-MM-DD') AS entry_day, d.amount, d.refund_account
           FROM public.tb_s080_deposit_ledger d
          WHERE d.contract_id = k.contract_id AND d.entry_kind = 'return' AND d.settlement_id IS NULL
          ORDER BY d.entry_on DESC, d.created_at DESC
          LIMIT 1
       ) r ON true
      WHERE k.status = 'terminated'
        AND (
          (st.settlement_id IS NOT NULL AND (st.processed_on IS NULL OR st.processed_on >= current_date - 90))
          OR EXISTS (SELECT 1 FROM public.tb_s080_deposit_ledger d WHERE d.contract_id = k.contract_id)
        )
      ORDER BY coalesce(k.terminated_date, k.end_date) DESC, c.company_name, k.contract_id`,
  );
  return rows;
}

/** 계약 한 건의 보유액과 장부 유무 — 재계약 이월이 본다. */
export async function contractDepositState(
  client: ScopedClient,
  contractId: string,
): Promise<{ balance: number; hasRecords: boolean }> {
  const { rows } = await q<{ balance: number; n: number }>(
    client,
    `SELECT ${BALANCE_SQL} AS balance, count(*)::int AS n
       FROM public.tb_s080_deposit_ledger d
      WHERE d.contract_id = $1`,
    [contractId],
  );
  return { balance: rows[0]?.balance ?? 0, hasRecords: (rows[0]?.n ?? 0) > 0 };
}
