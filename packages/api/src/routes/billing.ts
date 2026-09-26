/**
 * 청구·납부 라우트 — 청구 1단계.
 *
 * `routes/contracts.ts` 와 같은 규칙이다. 판정은 `@swonbiz/shared/domain` 의 순수
 * 함수가 하고, 이 파일은 배선만 한다.
 *
 * =============================================================================
 * ★ 청구서를 **만드는 API 가 없다.** 계약 확정이 만든다
 * =============================================================================
 * 청구서는 계약을 확정할 때 계약기간 전체가 한 번에 만들어지고
 * (`billing/contractBilling.ts`), 계약을 종료할 때 취소·일할된다.
 * 사람이 손으로 만드는 길을 열면 계약과 청구서가 어긋날 수 있고, 그 어긋남은
 * 아무도 안 본다. 바뀌는 것은 **수납뿐**이다.
 *
 * =============================================================================
 * ★★ 쓰기는 운영사 전용, 조회는 입주사도 한다
 * =============================================================================
 * 수납을 넣는 것은 운영 업무다. 조회는 자기 청구서를 보는 것이라 열어 둔다 —
 * 남의 것은 RLS 가 `company_id` 로 이미 거른다(021). 없는 것과 볼 수 없는 것을
 * 구분하지 않고 둘 다 404 다.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { parseDay } from '@swonbiz/shared/domain/day';
import { requireSession } from '../session/hook.ts';
import { withCompanyScope, type CompanyScope } from '../db/withCompanyScope.ts';
import {
  deletePayment,
  findContractSettlement,
  findInvoice,
  findPayment,
  findSettlementInvoice,
  insertPayment,
  listBillingInvoices,
  listCompanySettlements,
  listContractInvoices,
  listInvoiceLines,
  listInvoicePayments,
  markSettlementProcessed,
  recalcInvoice,
  updatePayment,
  type BillingListRow,
  type SettlementRow,
} from '../db/invoices.ts';

/** 수납을 쓸 수 있는 역할. 조회는 입주사도 한다. */
const WRITE_ROLE = 'operator';

/** 코드 `PAY_METHOD` — B 계좌이체 / C 카드 결제. DB 의 CHECK 와 같은 목록이다. */
const PAY_METHODS = ['B', 'C'] as const;

interface PaymentBody {
  /** `YYYY-MM-DD`. */
  paidOn?: string;
  amount?: number;
  payMethod?: string;
  memo?: string | null;
}

type ParsedPayment = { paidOn: string; amount: number; payMethod: string; memo: string | null };

/**
 * 수납 본문을 읽는다. 틀리면 던진다 — 라우트가 400 으로 바꾼다.
 *
 * ★★ **음수를 막지 않는다.** 환불이 음수 수납이다. 막는 것은 0 뿐이고, 그건
 *    「아무 일도 없었다」는 줄이라 기록이 아니다. DB 에도 같은 CHECK 가 있다.
 */
function parsePaymentBody(body: PaymentBody | undefined): ParsedPayment {
  const paidOn = String(body?.paidOn ?? '');
  if (parseDay(paidOn) === null) {
    throw new RangeError(`입금일이 올바르지 않습니다 (YYYY-MM-DD): ${paidOn || '(없음)'}`);
  }

  const amount = Number(body?.amount);
  if (!Number.isInteger(amount)) {
    throw new RangeError('금액은 정수여야 합니다');
  }
  if (amount === 0) {
    throw new RangeError('금액이 0인 수납은 기록하지 않습니다 — 환불이면 음수로 넣습니다');
  }

  const payMethod = String(body?.payMethod ?? 'B');
  if (!(PAY_METHODS as readonly string[]).includes(payMethod)) {
    throw new RangeError(`결제수단은 B(계좌이체) 또는 C(카드)여야 합니다: ${payMethod}`);
  }

  const memo = typeof body?.memo === 'string' && body.memo.trim() !== '' ? body.memo.trim() : null;
  return { paidOn, amount, payMethod, memo };
}

const notFound = (reply: FastifyReply, what: string) =>
  reply.code(404).send({ error: 'not_found', message: `${what}를 찾을 수 없습니다` });

function asBadRequest(err: unknown, reply: FastifyReply): FastifyReply | never {
  if (err instanceof RangeError) {
    return reply.code(400).send({ error: 'invalid_request', message: err.message });
  }
  throw err;
}

function scopeOf(session: { role: string; companyId: string | null }): CompanyScope {
  return { role: session.role as CompanyScope['role'], companyId: session.companyId };
}

const forbidden = (reply: FastifyReply) =>
  reply.code(403).send({ error: 'forbidden', message: '청구 화면은 운영사만 볼 수 있습니다' });

/** 청구 목록 한 줄의 응답 모양 — 월별 청구와 입주사 청구 탭이 같은 모양을 쓴다. */
function toBillingItem(row: BillingListRow) {
  return {
    invoiceId: row.invoice_id,
    companyId: row.company_id,
    companyName: row.company_name,
    contractId: row.contract_id,
    yearMonth: row.year_month,
    dueDate: row.due_day,
    totalAmount: row.total_amount,
    paidAmount: row.paid_amount,
    outstanding: row.total_amount - row.paid_amount,
    /** ★ 저장값 P/E/C 그대로다. 화면 상태는 `displayInvoiceStatus` 가 정한다. */
    status: row.status,
    roomNames: row.room_names ?? '',
    isFree: row.has_free,
    freeSupply: row.free_supply,
  };
}

function toSettlement(row: SettlementRow) {
  return {
    settlementId: row.settlement_id,
    contractId: row.contract_id,
    terminateDate: row.terminate_day,
    paymentMethod: row.payment_method,
    startDate: row.start_day,
    endDate: row.end_day,
    roomNames: row.room_names ?? '',
    totalPaid: row.total_paid,
    usageCharge: row.usage_charge,
    depositReturn: row.deposit_return,
    discountClawback: row.discount_clawback,
    freeClawback: row.free_clawback,
    /** 양수 = 환불 / 음수 = 추가청구. */
    netAmount: row.net_amount,
    settleType: row.settle_type,
    /** ★ 청구서에 들어가는 몫 = 총수납 − 실이용료. 나머지(예치금·환수)는 원장에만 남는다. */
    rentNet: row.total_paid - row.usage_charge,
    processed: row.processed_day
      ? {
          processedOn: row.processed_day,
          amount: row.processed_amount ?? 0,
          method: row.processed_method ?? 'B',
          memo: row.processed_memo ?? '',
          paymentId: row.processed_payment_id,
        }
      : null,
  };
}

/** 두 번 처리하려 했다 — 트랜잭션을 되돌리려고 던진다. */
class AlreadyProcessed extends Error {}

/** `YYYY-MM`. 틀리면 `null`. */
function parseYearMonth(value: unknown): string | null {
  const s = String(value ?? '');
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(s) ? s : null;
}

export function registerBillingRoutes(app: FastifyInstance): void {
  /* ── 월별 청구 (s0300200070) ─────────────────────────────────────────────
     ★ 운영사 전용. 남의 입주사 청구액이 한 화면에 모이는 자리다 — RLS 가 입주사
       세션을 자기 것으로 좁히긴 하지만, 화면 자체가 운영 업무라 403 으로 닫는다. */
  app.get<{ Querystring: { yearMonth?: string } }>('/billing/invoices', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== WRITE_ROLE) return forbidden(reply);

    const yearMonth = parseYearMonth(req.query.yearMonth);
    if (!yearMonth) {
      return reply.code(400).send({ error: 'invalid_request', message: '청구 월은 YYYY-MM 이어야 합니다' });
    }
    const rows = await withCompanyScope(scopeOf(session), (client) =>
      listBillingInvoices(client, { yearMonth, companyId: null }),
    );
    return reply.send({ yearMonth, invoices: rows.map(toBillingItem) });
  });

  /* ── 입주사 청구 탭 (s0300200030 오른쪽) — 청구서 전부 + 정산 원장 ─────── */
  app.get<{ Params: { id: string } }>('/companies/:id/billing', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== WRITE_ROLE) return forbidden(reply);

    const found = await withCompanyScope(scopeOf(session), async (client) => {
      const [invoices, settlements] = await Promise.all([
        listBillingInvoices(client, { yearMonth: null, companyId: req.params.id }),
        listCompanySettlements(client, req.params.id),
      ]);
      return { invoices, settlements };
    });
    return reply.send({
      invoices: found.invoices.map(toBillingItem),
      settlements: found.settlements.map(toSettlement),
    });
  });

  /* ── 정산 처리 ────────────────────────────────────────────────────────────
     ★★★ 두 곳에 나누어 쓴다 — **한 트랜잭션이다**(023 머리말, 2026-09-26 결정).
       · 청구서    이용료 차액(총수납 − 실이용료)만 수납으로 넣는다 — 청구서마다 남은 금액만큼.
                   미납이면 양수(받음), 과납·취소된 장의 선납이면 음수(환불). 아래 본문 참조
       · 정산 원장  실제로 주고받은 금액 전체 — 예치금 반환·환수를 처리했다는 기록
       순정산금을 통째로 청구서에 넣으면 청구서가 「미납」으로 보이고 월별 미수금에
       예치금·환수가 섞인다. */
  app.post<{ Params: { id: string }; Body: PaymentBody }>(
    '/contracts/:id/settlement/process',
    async (req, reply) => {
      const session = requireSession(req);
      if (session.role !== WRITE_ROLE) {
        return reply.code(403).send({ error: 'forbidden', message: '정산 처리는 운영사만 할 수 있습니다' });
      }

      const processedOn = String(req.body?.paidOn ?? '');
      if (parseDay(processedOn) === null) {
        return reply.code(400).send({
          error: 'invalid_request',
          message: `처리일이 올바르지 않습니다 (YYYY-MM-DD): ${processedOn || '(없음)'}`,
        });
      }
      // ★ 실제 주고받은 금액은 0 도 된다 — 순정산금이 0 인 정산도 「처리했다」는 기록은 남긴다.
      const amount = Number(req.body?.amount);
      if (!Number.isInteger(amount)) {
        return reply.code(400).send({ error: 'invalid_request', message: '금액은 정수여야 합니다' });
      }
      const method = String(req.body?.payMethod ?? 'B');
      if (!(PAY_METHODS as readonly string[]).includes(method)) {
        return reply
          .code(400)
          .send({ error: 'invalid_request', message: '방법은 B(계좌이체) 또는 C(카드)여야 합니다' });
      }
      const memo =
        typeof req.body?.memo === 'string' && req.body.memo.trim() !== '' ? req.body.memo.trim() : null;
      const actor = String(session.s020MemberId);

      type Outcome =
        | { kind: 'not_found' }
        | { kind: 'already' }
        | { kind: 'mismatch'; moved: number; rentNet: number }
        | { kind: 'ok'; paymentId: string | null };

      let result: Outcome;
      try {
        result = await withCompanyScope(scopeOf(session), async (client): Promise<Outcome> => {
          const settlement = await findContractSettlement(client, req.params.id);
          if (!settlement) return { kind: 'not_found' };
          if (settlement.processed_day) return { kind: 'already' };

          const rentNet = settlement.total_paid - settlement.usage_charge;

          /*
           * ★★★ 이용료 차액은 **청구서마다 남은 금액만큼** 나누어 넣는다 (2026-09-26 결정).
           *   · 살아 있는 장(P/E) — 청구 − 수납. 미납이면 양수(받음), 과납이면 음수(환불)
           *   · 취소된 장(C)       — 미리 받은 수납이 있으면 그만큼 음수(돌려줌)
           *   처리 후 살아 있는 장은 전부 납부완료, 취소된 장은 수납 합계 0 이 된다.
           *
           * 해지 달 한 장에 통째로 넣으면 앞 달 미납이 있을 때 해지 달은 과납, 앞 달은
           * 미납으로 남는다 — 청구서 상태가 틀린다. 미납·과납이 없는 보통 경우에는 해지 달
           * 한 장에만 들어가서 결과가 같다.
           *
           * ★ 나눈 합계가 이용료 차액과 다르면 **막는다.** 청구서와 정산 원장이 서로 다른
           *   계약을 말하고 있다는 뜻이고(정산 뒤에 수납이 들어왔거나 손으로 고쳤다),
           *   어느 쪽이 맞는지는 사람이 봐야 한다.
           */
          const invoices = await listContractInvoices(client, settlement.contract_id);
          const moves = invoices
            .map((inv) => ({
              inv,
              amount: inv.status === 'C' ? -inv.paid_amount : inv.total_amount - inv.paid_amount,
            }))
            .filter((m) => m.amount !== 0);
          const moved = moves.reduce((sum, m) => sum + m.amount, 0);
          if (moved !== -rentNet) return { kind: 'mismatch', moved, rentNet };

          // ★ 원장에 잇는 수납은 **해지 달 장**의 것이다(없으면 마지막으로 넣은 것).
          const termSheet = await findSettlementInvoice(client, {
            contractId: settlement.contract_id,
            terminateDay: settlement.terminate_day,
          });
          let paymentId: string | null = null;
          for (const m of moves) {
            const id = randomUUID();
            await insertPayment(client, {
              paymentId: id,
              buildId: m.inv.build_id,
              companyId: m.inv.company_id,
              invoiceId: m.inv.invoice_id,
              paidOn: processedOn,
              amount: m.amount,
              payMethod: method,
              memo: m.amount < 0 ? '중도해지 정산 — 이용료 과납분 환불' : '중도해지 정산 — 이용료 미납분 수령',
              actor,
            });
            // 같은 트랜잭션이다 — 수납만 들어가고 청구 상태가 안 바뀌는 일이 없다.
            await recalcInvoice(client, m.inv.invoice_id);
            if (paymentId === null || m.inv.invoice_id === termSheet?.invoice_id) paymentId = id;
          }

          const marked = await markSettlementProcessed(client, {
            settlementId: settlement.settlement_id,
            processedOn,
            amount,
            method,
            memo,
            paymentId,
            actor,
          });
          // ★ 그 사이 다른 사람이 처리했다. 던져서 위의 수납까지 되돌린다.
          if (!marked) throw new AlreadyProcessed();
          return { kind: 'ok', paymentId };
        });
      } catch (err) {
        if (!(err instanceof AlreadyProcessed)) throw err;
        result = { kind: 'already' };
      }

      if (result.kind === 'not_found') return notFound(reply, '정산 원장');
      if (result.kind === 'already') {
        return reply.code(409).send({ error: 'already_processed', message: '이미 처리된 정산입니다' });
      }
      if (result.kind === 'mismatch') {
        const fmt = (n: number) => n.toLocaleString('ko-KR');
        return reply.code(409).send({
          error: 'settlement_mismatch',
          message:
            `청구서의 남은 금액 합계(${fmt(result.moved)}원)가 정산의 이용료 차액(${fmt(-result.rentNet)}원)과 ` +
            '맞지 않아 처리하지 않았습니다. 정산 뒤에 들어온 수납이 있는지 [내역]에서 확인해 주세요',
        });
      }
      return reply.send({ paymentId: result.paymentId });
    },
  );

  /* ── 계약의 청구서 목록 ──────────────────────────────────────────────────
     ★ 화면은 아직 없다. 청구서는 계약 확정이 만들기 때문에 **찾을 길**이 필요하고,
       검증도 이 엔드포인트로 한다. */
  app.get<{ Params: { id: string } }>('/contracts/:id/invoices', async (req, reply) => {
    const session = requireSession(req);
    const rows = await withCompanyScope(scopeOf(session), (client) =>
      listContractInvoices(client, req.params.id),
    );
    return reply.send(
      rows.map((row) => ({
        invoiceId: row.invoice_id,
        yearMonth: row.year_month,
        dueDate: row.due_day,
        supplyAmount: row.supply_amount,
        vatAmount: row.vat_amount,
        totalAmount: row.total_amount,
        paidAmount: row.paid_amount,
        outstanding: row.total_amount - row.paid_amount,
        status: row.status,
      })),
    );
  });

  /* ── 청구서 한 장 — 줄과 수납까지 ──────────────────────────────────────── */
  app.get<{ Params: { id: string } }>('/invoices/:id', async (req, reply) => {
    const session = requireSession(req);
    const found = await withCompanyScope(scopeOf(session), async (client) => {
      const invoice = await findInvoice(client, req.params.id);
      if (!invoice) return null;
      const [lines, payments] = await Promise.all([
        listInvoiceLines(client, invoice.invoice_id),
        listInvoicePayments(client, invoice.invoice_id),
      ]);
      return { invoice, lines, payments };
    });
    if (!found) return notFound(reply, '청구서');

    return reply.send({
      invoiceId: found.invoice.invoice_id,
      companyId: found.invoice.company_id,
      contractId: found.invoice.contract_id,
      yearMonth: found.invoice.year_month,
      dueDate: found.invoice.due_day,
      supplyAmount: found.invoice.supply_amount,
      vatAmount: found.invoice.vat_amount,
      totalAmount: found.invoice.total_amount,
      paidAmount: found.invoice.paid_amount,
      outstanding: found.invoice.total_amount - found.invoice.paid_amount,
      status: found.invoice.status,
      lines: found.lines.map((line) => ({
        invoiceLineId: line.invoice_line_id,
        seq: line.seq,
        payItem: line.pay_item,
        contractSpaceId: line.contract_space_id,
        /**
         * ★ 무상 달의 줄인가. 금액은 0 이지만 `unitPrice` 에 **얼마짜리를 무상으로
         *   줬는지**가 남아 있다 — 화면이 「무상」이라고 쓸 근거다.
         */
        isFree: line.is_free,
        roomName: line.room_name ?? '',
        quantity: line.quantity,
        unitPrice: line.unit_price,
        supplyAmount: line.supply_amount,
        vatAmount: line.vat_amount,
        totalAmount: line.total_amount,
      })),
      payments: found.payments.map((p) => ({
        paymentId: p.payment_id,
        paidOn: p.paid_day,
        amount: p.amount,
        payMethod: p.pay_method,
        memo: p.memo ?? '',
      })),
    });
  });

  /* ── 수납 입력 ─────────────────────────────────────────────────────────── */
  app.post<{ Params: { id: string }; Body: PaymentBody }>(
    '/invoices/:id/payments',
    async (req, reply) => {
      const session = requireSession(req);
      if (session.role !== WRITE_ROLE) {
        return reply.code(403).send({ error: 'forbidden', message: '수납 입력은 운영사만 할 수 있습니다' });
      }

      let input: ParsedPayment;
      try {
        input = parsePaymentBody(req.body);
      } catch (err) {
        return asBadRequest(err, reply);
      }

      const result = await withCompanyScope(scopeOf(session), async (client) => {
        const invoice = await findInvoice(client, req.params.id);
        if (!invoice) return { kind: 'not_found' as const };

        /*
         * ★ 취소된 청구서에는 수납하지 않는다. 취소는 「받지 않기로 했다」는 뜻이고,
         *   거기에 돈이 들어왔다면 그건 다른 장에 넣어야 할 돈이다.
         *   ★ `computeStoredStatus` 가 취소를 보존하므로 수납을 넣어도 상태는 C 로
         *     남는다 — 즉 **합계만 늘고 아무도 못 알아채는** 상태가 된다. 그래서 막는다.
         */
        if (invoice.status === 'C') return { kind: 'cancelled' as const };

        const paymentId = randomUUID();
        await insertPayment(client, {
          paymentId,
          buildId: invoice.build_id,
          companyId: invoice.company_id,
          invoiceId: invoice.invoice_id,
          ...input,
          actor: String(session.s020MemberId),
        });
        // 같은 트랜잭션이다 — 수납만 들어가고 청구 상태가 안 바뀌는 일이 없다.
        await recalcInvoice(client, invoice.invoice_id);
        return { kind: 'ok' as const, paymentId };
      });

      if (result.kind === 'not_found') return notFound(reply, '청구서');
      if (result.kind === 'cancelled') {
        return reply.code(409).send({
          error: 'invoice_cancelled',
          message: '취소된 청구서에는 수납할 수 없습니다',
        });
      }
      return reply.code(201).send({ paymentId: result.paymentId });
    },
  );

  /* ── 수납 수정 ─────────────────────────────────────────────────────────── */
  app.patch<{ Params: { id: string }; Body: PaymentBody }>('/payments/:id', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== WRITE_ROLE) {
      return reply.code(403).send({ error: 'forbidden', message: '수납 수정은 운영사만 할 수 있습니다' });
    }

    let input: ParsedPayment;
    try {
      input = parsePaymentBody(req.body);
    } catch (err) {
      return asBadRequest(err, reply);
    }

    const result = await withCompanyScope(scopeOf(session), async (client) => {
      const payment = await findPayment(client, req.params.id);
      if (!payment) return { kind: 'not_found' as const };

      await updatePayment(client, {
        paymentId: payment.payment_id,
        ...input,
        actor: String(session.s020MemberId),
      });
      await recalcInvoice(client, payment.invoice_id);
      return { kind: 'ok' as const };
    });

    if (result.kind === 'not_found') return notFound(reply, '수납 내역');
    return reply.send({ paymentId: req.params.id });
  });

  /* ── 수납 삭제 ─────────────────────────────────────────────────────────── */
  app.delete<{ Params: { id: string } }>('/payments/:id', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== WRITE_ROLE) {
      return reply.code(403).send({ error: 'forbidden', message: '수납 삭제는 운영사만 할 수 있습니다' });
    }

    const result = await withCompanyScope(scopeOf(session), async (client) => {
      const payment = await findPayment(client, req.params.id);
      if (!payment) return { kind: 'not_found' as const };

      await deletePayment(client, payment.payment_id);
      // ★ 지운 뒤에 다시 센다. 빼먹으면 지운 돈이 합계에 남아 완납으로 보인다.
      await recalcInvoice(client, payment.invoice_id);
      return { kind: 'ok' as const };
    });

    if (result.kind === 'not_found') return notFound(reply, '수납 내역');
    return reply.send({ ok: true });
  });
}
