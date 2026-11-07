/**
 * 내 청구서 — `GET /my/invoices?from=YYYY-MM&to=YYYY-MM` (s030200090 · 앱 1단계 7-나 · 대표 지시 2026-11-08).
 *
 * =============================================================================
 * ★★★ 입주사 세션만 — 운영사는 403
 * =============================================================================
 * 입주사가 **자기 회사** 청구서를 보는 주소다. 운영사는 청구 화면(/billing · s030200070)에서 본다 —
 * 같은 일을 하는 길을 둘 두지 않는다. 회사 거르기는 기존 RLS(`erp_company_scope`)가 하고,
 * SQL 이 `company_id` 를 한 번 더 건다(`db/invoices.ts` `listCompanyInvoicesInRange`).
 *
 * ★ 보기 전용이다. 쓰는 주소가 없다 — 청구 · 수납 처리는 운영사 `/billing` 한 곳(`routes/billing.ts`).
 * ★ 회사 연결이 없는 입주사(삐용 단체만 있고 ERP 입주사 연결이 없다)는 빈 목록이다 — 예외가 아니라 0건
 *   (ORG_ARCHITECTURE.md §1-2). DB 를 부르지 않는다.
 * ★ 판정(미납 · 합계 · 달별 묶음 · 미납 띠)은 화면이 shared `domain/my-invoices` 로 한다. 이 파일은 배선만.
 * ★ 응답에는 화면에 필요한 여섯 칸만 싣는다 — 회사 · 계약 · 건물 번호는 내보내지 않는다.
 */
import type { FastifyInstance } from 'fastify';
import type { ErpSession } from '@swonbiz/shared';
import { requireSession } from '../session/hook.ts';
import { scopeOfSession, withCompanyScope } from '../db/withCompanyScope.ts';
import { listCompanyInvoicesInRange, type InvoiceRow } from '../db/invoices.ts';

/** 바꿔 끼울 수 있는 바깥 — 시험이 DB 없이 권한 · 기간 · 응답 모양을 본다. */
export interface MyInvoicesDeps {
  /** 세션의 회사(`companyId` 가 있을 때만 부른다) 청구서 — 청구 달 `from` ~ `to`. */
  listMyInvoices(session: ErpSession, from: string, to: string): Promise<InvoiceRow[]>;
}

const defaultDeps: MyInvoicesDeps = {
  listMyInvoices: (session, from, to) =>
    withCompanyScope(scopeOfSession(session), (client) =>
      listCompanyInvoicesInRange(client, session.companyId as string, from, to),
    ),
};

/** 한 번에 받을 수 있는 가장 긴 기간(달 수, 양 끝 포함). 화면은 13개월(지난 12 + 이번 달)을 부른다. */
const MAX_MONTHS = 24;

const FORBIDDEN = {
  error: 'forbidden',
  message: '내 청구서는 입주사 화면입니다. 운영사는 청구 화면(/billing)에서 봅니다',
} as const;

/** `YYYY-MM` → 달 번호. 틀리면 `null`. */
function monthIndex(value: unknown): number | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(value ?? ''));
  return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null;
}

export function registerMyInvoicesRoutes(app: FastifyInstance, deps: MyInvoicesDeps = defaultDeps): void {
  app.get<{ Querystring: { from?: string; to?: string } }>('/my/invoices', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== 'tenant') return reply.code(403).send(FORBIDDEN);

    const a = monthIndex(req.query.from);
    const b = monthIndex(req.query.to);
    if (a === null || b === null || a > b || b - a + 1 > MAX_MONTHS) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: `기간은 from ≤ to 인 YYYY-MM 둘이고, ${MAX_MONTHS}개월을 넘지 않아야 합니다`,
      });
    }

    if (session.companyId === null) return reply.send({ invoices: [] });

    const rows = await deps.listMyInvoices(session, req.query.from as string, req.query.to as string);
    return reply.send({
      invoices: rows.map((row) => ({
        invoiceId: row.invoice_id,
        yearMonth: row.year_month,
        dueDate: row.due_day,
        totalAmount: row.total_amount,
        paidAmount: row.paid_amount,
        status: row.status,
      })),
    });
  });
}
