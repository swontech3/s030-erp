/**
 * 계약 저장소 — SQL 이 모여 있는 유일한 자리.
 *
 * ★ 전부 `withCompanyScope()` 가 연 트랜잭션 안에서 도는 것을 전제한다. 이 파일의
 *   함수는 클라이언트를 받기만 하고 스스로 커넥션을 꺼내지 않는다 — 꺼내면
 *   RLS GUC 가 없는 커넥션이 섞여 조용히 0건을 보게 된다.
 *
 * =============================================================================
 * ★★ `updated_at` 을 매번 명시한다
 * =============================================================================
 * `tb_s080_contracts.updated_at` 은 **NOT NULL 인데 DEFAULT 가 없다**(2026-09-17 실측).
 * 레거시 Prisma 의 `@updatedAt` 이 늘 값을 넣어 줘서 기본값이 붙은 적이 없다.
 * 빼고 INSERT 하면 `23502` 로 죽는다. 같은 상태인 레거시 테이블이 28개다.
 * drizzle 스키마의 `.defaultNow()` 는 DDL 생성용 선언이라 이 사실을 바꾸지 않는다.
 */
import type { ScopedClient } from './withCompanyScope.ts';
import type { ContractWrite } from '@swonbiz/shared/domain/contract-payload';

/** pg 의 결과 모양. `ScopedClient.query` 가 `unknown` 을 돌려주므로 여기서 좁힌다. */
interface Rows<T> {
  rows: T[];
  rowCount: number | null;
}
const q = <T>(client: ScopedClient, sql: string, params?: unknown[]): Promise<Rows<T>> =>
  client.query(sql, params) as Promise<Rows<T>>;

export interface ContractRow {
  contract_id: string;
  company_id: string;
  build_id: string;
  status: string;
  contract_no: string | null;
  contract_room: string | null;
  payment_method: string | null;
  access_route: string | null;
  first_payment: number;
  contract_date: string | null;
  period_months: number | null;
  start_date: Date;
  end_date: Date;
  terminated_date: Date | null;
  termination_reason: string | null;
  memo: string | null;
}

export interface ContractSpaceRow {
  seq: number;
  room_type: string;
  space_id: string;
  standard_fee: number;
  deposit: number;
  monthly_fee: number;
  vat_yn: boolean;
  vat_amount: number;
  payment_amount: number;
  locker_no: string | null;
}

const CONTRACT_COLUMNS = `
  contract_id, company_id, build_id, status, contract_no, contract_room,
  payment_method, access_route, first_payment, contract_date, period_months,
  start_date, end_date, terminated_date, termination_reason, memo`;

/** 계약 1건. RLS 가 거른 뒤라 **0행은 "없다"가 아니라 "볼 수 없다"도 포함**한다. */
export async function findContract(
  client: ScopedClient,
  contractId: string,
): Promise<ContractRow | null> {
  const { rows } = await q<ContractRow>(
    client,
    `SELECT ${CONTRACT_COLUMNS} FROM public.tb_s080_contracts WHERE contract_id = $1`,
    [contractId],
  );
  return rows[0] ?? null;
}

export async function findSpaces(
  client: ScopedClient,
  contractId: string,
): Promise<ContractSpaceRow[]> {
  const { rows } = await q<ContractSpaceRow>(
    client,
    `SELECT seq, room_type, space_id, standard_fee, deposit, monthly_fee,
            vat_yn, vat_amount, payment_amount, locker_no
       FROM public.tb_s080_contract_spaces
      WHERE contract_id = $1
      ORDER BY seq`,
    [contractId],
  );
  return rows;
}

/** 목록. `companyId` 를 주면 그 입주사 것만 — 안 줘도 RLS 가 한 겹 더 거른다. */
export async function listContracts(
  client: ScopedClient,
  companyId?: string | null,
): Promise<ContractRow[]> {
  const { rows } = await q<ContractRow>(
    client,
    `SELECT ${CONTRACT_COLUMNS} FROM public.tb_s080_contracts
      WHERE ($1::text IS NULL OR company_id = $1)
      ORDER BY start_date DESC, contract_id`,
    [companyId ?? null],
  );
  return rows;
}

export async function insertContract(
  client: ScopedClient,
  args: {
    contractId: string;
    companyId: string;
    status: string;
    write: ContractWrite['contract'];
    actor: string;
  },
): Promise<void> {
  const { contractId, companyId, status, write, actor } = args;
  await q(
    client,
    `INSERT INTO public.tb_s080_contracts
       (contract_id, company_id, build_id, status, contract_room, payment_method,
        access_route, first_payment, contract_date, period_months, start_date, end_date, memo,
        created_at, updated_at, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now(), now(), $14, $14)`,
    [
      contractId, companyId, write.buildId, status, write.contractRoom, write.paymentMethod,
      write.accessRoute, write.firstPayment, write.contractDate, write.periodMonths,
      write.startDate, write.endDate, write.memo, actor,
    ],
  );
}

export async function updateContract(
  client: ScopedClient,
  args: { contractId: string; write: ContractWrite['contract']; actor: string },
): Promise<void> {
  const { contractId, write, actor } = args;
  await q(
    client,
    `UPDATE public.tb_s080_contracts
        SET build_id=$2, contract_room=$3, payment_method=$4, access_route=$5,
            first_payment=$6, contract_date=$7, period_months=$8,
            start_date=$9, end_date=$10, memo=$11, updated_at=now(), updated_by=$12
      WHERE contract_id=$1`,
    [
      contractId, write.buildId, write.contractRoom, write.paymentMethod, write.accessRoute,
      write.firstPayment, write.contractDate, write.periodMonths,
      write.startDate, write.endDate, write.memo, actor,
    ],
  );
}

/**
 * 호실 줄을 통째로 갈아 끼운다 — 지우고 다시 넣는다.
 *
 * ★ 왜 diff 가 아니라 전체 교체인가. 화면이 행을 지우고 순서를 바꾸고 새로 넣는다.
 *   어느 줄이 "같은 줄"인지 가릴 안정적인 키가 없다(`seq` 는 서버가 순서대로 다시
 *   매기는 값이라 키가 못 된다). 줄이 최대 10개라 교체 비용도 사실상 없다.
 */
export async function replaceSpaces(
  client: ScopedClient,
  args: {
    contractId: string;
    companyId: string;
    spaces: ContractWrite['spaces'];
    actor: string;
    newId: () => string;
  },
): Promise<void> {
  const { contractId, companyId, spaces, actor, newId } = args;
  await q(client, `DELETE FROM public.tb_s080_contract_spaces WHERE contract_id = $1`, [contractId]);

  for (const row of spaces) {
    await q(
      client,
      `INSERT INTO public.tb_s080_contract_spaces
         (contract_space_id, contract_id, company_id, seq, room_type, space_id,
          standard_fee, deposit, monthly_fee, vat_yn, vat_amount, payment_amount, locker_no,
          created_at, updated_at, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now(), now(), $14, $14)`,
      [
        newId(), contractId, companyId, row.seq, row.roomType, row.spaceId,
        row.standardFee, row.deposit, row.monthlyFee, row.vatYn, row.vatAmount,
        row.paymentAmount, row.lockerNo, actor,
      ],
    );
  }
}

/**
 * 상태 전이를 이력에 남긴다 — CONT-11.
 *
 * ★ 계약 상태를 바꾸는 **모든 경로**가 이 함수를 같은 트랜잭션에서 부른다.
 *   따로 부르면 이력 없는 전이가 생기고, 그건 감사 이력이 아니다.
 * ★ 이 테이블은 RLS 가 운영사 전용이다(010). 입주사 스코프로 부르면 INSERT 가
 *   WITH CHECK 에 걸린다 — 계약 쓰기가 운영사 전용이라 실제로는 닿지 않는다.
 */
export async function insertStatusHistory(
  client: ScopedClient,
  args: {
    historyId: string;
    contractId: string;
    fromStatus: string | null;
    toStatus: string;
    actor: string;
  },
): Promise<void> {
  await q(
    client,
    `INSERT INTO public.tb_s080_contract_status_history
       (history_id, contract_id, from_status, to_status, changed_by, changed_at)
     VALUES ($1,$2,$3,$4,$5, now())`,
    [args.historyId, args.contractId, args.fromStatus, args.toStatus, args.actor],
  );
}

/** 상태 전이의 계약 쪽 반영. 종료는 종료일·사유를 함께 쓴다. */
export async function updateStatus(
  client: ScopedClient,
  args: {
    contractId: string;
    toStatus: string;
    terminatedDate: Date | null;
    terminationReason: string | null;
    actor: string;
  },
): Promise<void> {
  await q(
    client,
    `UPDATE public.tb_s080_contracts
        SET status=$2,
            terminated_date = COALESCE($3, terminated_date),
            termination_reason = COALESCE($4, termination_reason),
            updated_at = now(), updated_by = $5
      WHERE contract_id=$1`,
    [args.contractId, args.toStatus, args.terminatedDate, args.terminationReason, args.actor],
  );
}
