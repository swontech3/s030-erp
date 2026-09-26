/**
 * 계약 상태가 바뀔 때 청구서에 일어나는 일 — **배선만** 한다.
 *
 * 판정과 금액은 전부 `@swonbiz/shared/domain/invoice-plan` 의 순수 함수가 한다.
 * 이 파일은 계약에서 값을 꺼내 넘기고, 받은 계획을 `db/invoices.ts` 로 쓴다.
 *
 * =============================================================================
 * ★★★ 계약 확정과 청구서 생성은 **같은 트랜잭션**이다
 * =============================================================================
 * 부르는 쪽(`routes/contracts.ts`)이 연 트랜잭션 안에서 돈다. 그래서
 *
 *   · 확정이 막히면(서류 부족·호실 중복) 청구서도 **안 생긴다** — 검사가 전부
 *     끝난 뒤에 쓰기가 시작되기 때문이다
 *   · 청구서를 못 만들면(모르는 납부방법 등) **확정도 안 된다** — 던지면
 *     `withCompanyScope` 가 ROLLBACK 한다
 *
 * 둘째가 중요하다. 청구서 없이 확정된 계약은 **아무도 청구하지 않는 계약**이 되고,
 * 그 사실은 한 달 뒤 돈이 안 들어와야 드러난다. 차라리 확정이 막히는 편이 낫다.
 */
import {
  planInvoices,
  planTerminationChanges,
  prorateInvoiceLines,
  type TerminationChanges,
} from '@swonbiz/shared/domain/invoice-plan';
import { parseDay } from '@swonbiz/shared/domain/day';
import { planDepositOnConfirm } from '@swonbiz/shared/domain/deposit-ledger';
import { contractDepositState, insertDepositEntry } from '../db/deposits.ts';
import type { ScopedClient } from '../db/withCompanyScope.ts';
import {
  applyProrate,
  cancelInvoices,
  countContractInvoices,
  findBillingContract,
  findBillingSpaces,
  insertInvoicePlans,
  insertSettlement,
  listContractInvoices,
  listInvoiceLines,
  recalcInvoice,
  sumContractPayments,
  type BillingSpace,
} from '../db/invoices.ts';

/**
 * 계약 항목 행 → 금액·환수 계산이 보는 모양.
 *
 * ★ 합계를 미리 내서 넘기지 않는다. **환수는 줄마다** 계산해야 하고(부가세가 줄
 *   단위로 버려진다), 실이용료가 쓰는 합계도 같은 목록에서 나와야 둘이 같은 계약을 본다.
 */
const toAmounts = (row: BillingSpace) => ({
  seq: row.seq,
  standardFee: row.standard_fee,
  deposit: row.deposit,
  monthlyFee: row.monthly_fee,
  vatYn: row.vat_yn,
});

/** `YYYY-MM-DD` → UTC 자정 `Date`. 읽을 수 없으면 던진다 — 청구를 추측으로 만들지 않는다. */
function requireDay(iso: string | null, label: string): Date {
  const at = iso === null ? null : parseDay(iso);
  if (at === null) throw new RangeError(`${label}를 읽을 수 없다: ${iso}`);
  return at;
}

export type BillOnConfirmResult =
  | { kind: 'created'; invoiceCount: number }
  /** 이미 청구서가 있는 계약이다. 확정 경로가 여럿이라 실제로 일어난다. */
  | { kind: 'already' }
  /** 계약을 찾을 수 없다(RLS 가 걸렀거나 없다). */
  | { kind: 'no_contract' };

/**
 * 계약 확정 — 계약기간 전체의 청구서를 만든다.
 *
 * ★ 확정 경로 **전부**가 이 함수를 부른다 — 신규 확정 · 계약대기→확정 · 재계약 확정.
 *   경로마다 따로 쓰면 한 경로만 고쳐지고, 그 경로로 확정한 계약은 청구서가 없다.
 *
 * ★ 재계약이어도 **이전 계약의 청구서는 건드리지 않는다.** 이전 계약은 원래 종료일에
 *   맞춰 닫히고(`routes/contracts.ts`), 그건 「종료일자 == 원래 종료일」이라
 *   `planTerminationChanges` 가 손대지 않는 길이다.
 */
export async function billOnConfirm(
  client: ScopedClient,
  args: { contractId: string; actor: string; newId: () => string },
): Promise<BillOnConfirmResult> {
  const { contractId, actor, newId } = args;

  const contract = await findBillingContract(client, contractId);
  if (!contract) return { kind: 'no_contract' };

  // ★ 두 번 만들지 않는다. DB 의 유일 인덱스도 막지만 그건 500 으로 막는 것이다.
  if ((await countContractInvoices(client, contractId)) > 0) return { kind: 'already' };

  const spaces = await findBillingSpaces(client, contractId);

  const plans = planInvoices({
    startDate: requireDay(contract.start_day, '계약 시작일'),
    periodMonths: contract.period_months ?? 0,
    paymentMethod: contract.payment_method ?? '',
    contractDate: contract.contract_day,
    /*
     * ★★ 무상 달은 0원 청구서가 되고, 첫 달이 무상이면 **확정 시 수납을 만들지
     *    않는다.** 그 규칙은 전부 `planInvoices` 안에 있다.
     */
    freeMonths: contract.free_months,
    spaces: spaces.map((row) => ({
      seq: row.seq,
      contractSpaceId: row.contract_space_id,
      monthlyFee: row.monthly_fee,
      vatAmount: row.vat_amount,
      paymentAmount: row.payment_amount,
    })),
  });

  await insertInvoicePlans(client, {
    plans,
    contractId,
    companyId: contract.company_id,
    buildId: contract.build_id,
    actor,
    newId,
  });

  return { kind: 'created', invoiceCount: plans.length };
}

export type DepositOnConfirmResult =
  | { kind: 'recorded'; entries: number }
  /** 이미 장부가 있는 계약이다 — 확정 경로가 여럿이라 두 번 도는 길이 있다. */
  | { kind: 'already' }
  /** 예치금 0원 — 남길 것이 없다. */
  | { kind: 'none' }
  /** ★ 재계약인데 이전 계약에 장부가 없다. 아무것도 남기지 않았다 — 화면이 알린다. */
  | { kind: 'previous_unrecorded' }
  | { kind: 'no_contract' };

/**
 * 계약 확정 — 예치금 장부에 「받음」 또는 「이월」을 남긴다. **확정과 같은 트랜잭션이다.**
 *
 * 무엇을 남길지는 `planDepositOnConfirm`(shared)가 정한다. 날짜는 **계약일자**(없으면
 * 시작일)다 — 예치금은 계약서에 서명하며 내는 돈이다(전대차계약서 제4조 1항).
 *
 * ★ 재계약이면 이전 계약의 보유액을 넘겨받는다(이전 계약에는 「이월」 넘김이 남는다).
 *   이전 계약이 기간 만료로 끝나 「예치금 반환 대기」였어도 이월되면 대기에서 빠진다.
 */
export async function depositOnConfirm(
  client: ScopedClient,
  args: { contractId: string; actor: string; newId: () => string },
): Promise<DepositOnConfirmResult> {
  const { contractId, actor, newId } = args;

  const contract = await findBillingContract(client, contractId);
  if (!contract) return { kind: 'no_contract' };
  if ((await contractDepositState(client, contractId)).hasRecords) return { kind: 'already' };

  const spaces = await findBillingSpaces(client, contractId);
  const depositTotal = spaces.reduce((sum, row) => sum + row.deposit, 0);

  const previousId = contract.renewed_from_contract_id;
  const previousRow = previousId ? await findBillingContract(client, previousId) : null;
  const plan = planDepositOnConfirm({
    depositTotal,
    previous: previousRow ? await contractDepositState(client, previousRow.contract_id) : null,
  });
  if (plan.previousUnrecorded) return { kind: 'previous_unrecorded' };
  if (plan.current.length === 0) return { kind: 'none' };

  const entryOn = contract.contract_day ?? contract.start_day;
  for (const entry of plan.current) {
    await insertDepositEntry(client, {
      depositEntryId: newId(),
      buildId: contract.build_id,
      companyId: contract.company_id,
      contractId,
      kind: entry.kind,
      amount: entry.amount,
      entryOn,
      relatedContractId: entry.kind === 'carry_in' ? previousRow?.contract_id : null,
      memo: entry.kind === 'return' ? '재계약 — 예치금 차액 반환' : null,
      actor,
    });
  }
  if (previousRow) {
    for (const entry of plan.previous) {
      await insertDepositEntry(client, {
        depositEntryId: newId(),
        buildId: previousRow.build_id,
        companyId: previousRow.company_id,
        contractId: previousRow.contract_id,
        kind: entry.kind,
        amount: entry.amount,
        entryOn,
        relatedContractId: contractId,
        actor,
      });
    }
  }
  return { kind: 'recorded', entries: plan.current.length + plan.previous.length };
}

export type SettleOnTerminateResult =
  | { kind: 'settled'; changes: TerminationChanges }
  /** 종료일자가 원래 종료일과 같다 — 기간 만료·재계약이다. 청구서를 손대지 않는다. */
  | { kind: 'untouched' }
  /**
   * 청구서가 하나도 없는 계약이다. 이 기능이 생기기 **전에** 확정된 계약이 여기 온다.
   * 정산할 대상(청구·수납)이 없어 원장도 남기지 않는다 — 레거시도 같은 판단이었다.
   */
  | { kind: 'no_invoices' }
  | { kind: 'no_contract' };

/**
 * 계약 종료 — 남은 청구서를 취소하고, 해지 달을 일할로 낮추고, 정산 한 줄을 남긴다.
 *
 * ★ **환불 수납을 자동으로 만들지 않는다.** 정산 원장의 `net_amount` 가 얼마를
 *   돌려줄지를 말하고, 실제로 돈이 오가면 운영자가 수납으로 넣는다(환불은 음수 수납).
 *   자동으로 음수 수납을 박으면 **아직 안 보낸 돈이 보낸 것으로 기록된다.**
 *
 * ★ 종료일자가 원래 종료일보다 **뒤**면 `planTerminationChanges` 가 던진다.
 *   규칙이 없어서 멈추는 것이고, 라우트가 400 으로 바꿔 내보낸다.
 */
export async function settleOnTerminate(
  client: ScopedClient,
  args: { contractId: string; terminatedDay: string; actor: string; newId: () => string },
): Promise<SettleOnTerminateResult> {
  const { contractId, terminatedDay, actor, newId } = args;

  const contract = await findBillingContract(client, contractId);
  if (!contract) return { kind: 'no_contract' };

  const invoices = await listContractInvoices(client, contractId);
  if (invoices.length === 0) return { kind: 'no_invoices' };

  const spaces = await findBillingSpaces(client, contractId);
  const totalPaid = await sumContractPayments(client, contractId);

  const changes = planTerminationChanges({
    startDate: requireDay(contract.start_day, '계약 시작일'),
    endDate: requireDay(contract.end_day, '계약 종료일'),
    terminatedDate: requireDay(terminatedDay, '종료일자'),
    paymentMethod: contract.payment_method ?? '',
    /*
     * ★★★ 무상은 **두 곳에 동시에** 걸린다. 실이용료에서 무상 달이 빠지고
     *    (`computeTerminationSettlement`), 그 달은 무상 환수로 받는다
     *    (`computeClawback`). 둘 중 하나만 빠지면 같은 달을 두 번 받거나 아예 못 받는다.
     */
    freeMonths: contract.free_months,
    spaces: spaces.map(toAmounts),
    totalPaid,
    invoices: invoices.map((row) => ({
      invoiceId: row.invoice_id,
      yearMonth: row.year_month,
      status: row.status,
    })),
  });

  if (changes.untouched) return { kind: 'untouched' };

  await cancelInvoices(client, { invoiceIds: changes.cancelInvoiceIds, actor });

  if (changes.prorate) {
    const lines = await listInvoiceLines(client, changes.prorate.invoiceId);
    await applyProrate(client, {
      invoiceId: changes.prorate.invoiceId,
      supplyAmount: changes.prorate.supplyAmount,
      vatAmount: changes.prorate.vatAmount,
      totalAmount: changes.prorate.totalAmount,
      // ★ 줄도 같이 낮춘다. 안 그러면 줄 합계가 머리의 N 배로 남는다(호실 N행).
      lines: prorateInvoiceLines({
        lines: lines.map((line) => ({
          invoiceLineId: line.invoice_line_id,
          supplyAmount: line.supply_amount,
          vatAmount: line.vat_amount,
        })),
        supplyAmount: changes.prorate.supplyAmount,
        vatAmount: changes.prorate.vatAmount,
      }),
      actor,
    });
    /*
     * ★ 금액을 낮췄으니 상태를 다시 본다. 첫 달처럼 이미 완납된 장을 낮추면
     *   수납이 청구를 넘어서 `E`(납부완료)가 유지되고, 덜 낸 장이면 `P` 로 돌아온다.
     *   이 한 줄을 빼면 일할한 청구서가 「미납」으로 남는다.
     */
    await recalcInvoice(client, changes.prorate.invoiceId);
  }

  /*
   * ★★ 환수는 **정산 원장에만** 들어간다. 위에서 청구서를 취소하고 일할로 낮췄지만
   *    환수는 그 어느 쪽도 건드리지 않았다 — 이미 나간 청구서를 소급해 고치면
   *    「그때 얼마를 청구했는지」가 사라지고 수납과도 어긋난다.
   *    실제로 받는 것은 운영자가 수납으로 넣는다.
   */
  if (changes.settlement && changes.clawback) {
    await insertSettlement(client, {
      settlementId: newId(),
      buildId: contract.build_id,
      companyId: contract.company_id,
      contractId,
      terminateDay: terminatedDay,
      paymentMethod: contract.payment_method,
      totalPaid,
      settlement: changes.settlement,
      clawback: changes.clawback,
      actor,
    });
  }

  return { kind: 'settled', changes };
}
