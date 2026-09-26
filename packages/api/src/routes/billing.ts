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
  findInvoice,
  findPayment,
  insertPayment,
  listContractInvoices,
  listInvoiceLines,
  listInvoicePayments,
  recalcInvoice,
  updatePayment,
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

export function registerBillingRoutes(app: FastifyInstance): void {
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
