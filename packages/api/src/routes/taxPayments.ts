/**
 * 세무 세금 · 4대보험 · 대출(s050300040, 세무 S05) — 1-7 (2026-11-02). 읽기만.
 *
 *   GET /tax/payments?month&tab&from&to&file          지금 탭의 줄 · 탭마다 줄 수 · 파일 띠 · 코드 이름
 *   GET /tax/payments/export?…(목록과 같은 주소)       지금 탭 거르기 결과를 엑셀로(ERP 공통 부품 `lib/xlsxExport.ts`)
 *
 * ★★★ 운영사 세션도 **자기 단체만** — `org_id = 세션 단체 ID` 를 직접 건다(`db/taxPayments.ts`). 역할로 403 을 내지 않는다.
 * ★ 남의 단체 · 없는 파일 · 이 화면 자료가 아닌 파일은 404(셋을 가르지 않는다).
 * ★ 자료 올리기 [보기]로 오면(`file`) 탭은 파일의 자료 종류로 정한다(`tabOfFileKind`).
 * ★ 2026-11-08 대표 수정 ⑥ — 메뉴 셋(세금 납부 · 4대보험 · 대출내역)이 이 API 하나를 함께 쓴다. tab=PAY 는 국세 + 지방세 한 목록
 *   (줄마다 kind), ins 는 4대보험 보험 거르기(건강보험은 장기요양 포함 — shared `filterSocialIns`). 시트 함수는 그대로.
 * ★ 국세 · 지방세 비용 여부는 저장하지 않는다 — 코드 「비용이 아닌 세목」(TAX_TAX_NOEXP) 이름과 견준다(`isExpenseTaxItem`).
 *   「처음 보는 세목」은 이 화면에서 보이지 않는다(1-7 결정 ③).
 */
import type { FastifyInstance } from 'fastify';
import type { ErpSession } from '@swonbiz/shared';
import { BANK_CATEGORY } from '@swonbiz/shared/domain/tax-settings';
import {
  TAX_LOAN_TP_CATEGORY,
  TAX_SOCIAL_INS_CATEGORY,
  TAX_TAX_NOEXP_CATEGORY,
  isExpenseTaxItem,
  socialTotals,
} from '@swonbiz/shared/domain/tax-pay-social-loan';
import {
  PAYMENT_TABS,
  PAYMENT_TAB_LABELS,
  PAY_ALL,
  TAX_PAY_SRC_CATEGORY,
  filterSocialIns,
  parsePaymentsQuery,
  paymentsExportFileName,
  paymentsRange,
  tabOfFileKind,
  type LoanTxnRow,
  type PaymentTab,
  type PaymentsQuery,
  type SocialInsRow,
  type TaxPaymentRow,
  type TaxPaymentsResponse,
} from '@swonbiz/shared/domain/tax-payments';
import type { TaxCodeName } from '@swonbiz/shared/domain/tax-uploads';
import { requireSession } from '../session/hook.ts';
import type { ScopedClient } from '../db/withCompanyScope.ts';
import { countPayments, findPaymentFile, listLoanTxns, listPayments, listSocialIns } from '../db/taxPayments.ts';
import { buildXlsx, sendXlsx, type XlsxSheet } from '../lib/xlsxExport.ts';
import { loadCodeNames, runOp, type TaxOp } from './taxUploads.ts';

const FILE_NOT_FOUND = { ok: false as const, status: 404 as const, error: 'not_found', message: '없는 파일입니다' };

const nameOf = (list: readonly TaxCodeName[], code: string) => list.find((c) => c.code === code)?.name ?? code;

/* ── 처리 ────────────────────────────────────────────────────────────────── */

export async function listPaymentsOp(client: ScopedClient, orgId: number, query: PaymentsQuery): Promise<TaxOp<TaxPaymentsResponse>> {
  let q = query;
  let file: TaxPaymentsResponse['file'] = null;
  if (query.fileId) {
    const f = await findPaymentFile(client, orgId, query.fileId);
    const tab = f ? tabOfFileKind(f.kind) : null;
    if (!f || !tab) return FILE_NOT_FOUND;
    q = { ...query, tab };
    file = { id: f.id, fileName: f.fileName };
  }

  const counts = Object.fromEntries(PAYMENT_TABS.map((t) => [t, 0])) as Record<PaymentTab, number>;
  for (const t of PAYMENT_TABS) {
    // 파일로 들어왔으면 그 파일의 탭만 센다(다른 탭은 0)
    if (q.fileId && t !== q.tab) continue;
    counts[t] = await countPayments(client, orgId, t, { range: paymentsRange({ ...q, tab: t }), fileId: q.fileId });
  }

  const names = await loadCodeNames(client, [TAX_TAX_NOEXP_CATEGORY, TAX_SOCIAL_INS_CATEGORY, TAX_LOAN_TP_CATEGORY, BANK_CATEGORY, TAX_PAY_SRC_CATEGORY]);
  const filter = { range: paymentsRange(q), fileId: q.fileId };
  let pays: TaxPaymentRow[] = [];
  let social: SocialInsRow[] = [];
  let loans: LoanTxnRow[] = [];
  if (q.tab === 'NTAX' || q.tab === 'LTAX' || q.tab === PAY_ALL) {
    const noExp = (names.get(TAX_TAX_NOEXP_CATEGORY) ?? []).map((c) => c.name);
    const kinds = q.tab === PAY_ALL ? (['NTAX', 'LTAX'] as const) : [q.tab];
    for (const kind of kinds) {
      const got = await listPayments(client, orgId, kind, filter);
      pays.push(...got.map((r) => ({ ...r, kind, expense: isExpenseTaxItem(r.taxItem, noExp) })));
    }
    // 세금 전체 — 납부일 최신순(같은 날은 국세 · 지방세 순, 각 표 안의 순서 그대로 — 안정 정렬)
    if (q.tab === PAY_ALL) pays = pays.sort((a, b) => b.payDate.localeCompare(a.payDate));
  } else if (q.tab === 'SOCIAL') {
    social = filterSocialIns(await listSocialIns(client, orgId, filter), q.ins);
  } else {
    loans = await listLoanTxns(client, orgId, filter);
  }

  return {
    ok: true,
    data: {
      query: q,
      counts,
      pays,
      social,
      loans,
      file,
      codes: {
        paySrcs: names.get(TAX_PAY_SRC_CATEGORY) ?? [],
        socialIns: names.get(TAX_SOCIAL_INS_CATEGORY) ?? [],
        loanTps: names.get(TAX_LOAN_TP_CATEGORY) ?? [],
        banks: names.get(BANK_CATEGORY) ?? [],
      },
    },
  };
}

/* ── 엑셀 시트 ───────────────────────────────────────────────────────────── */

const expenseLabel = (r: TaxPaymentRow) => (r.expense ? '비용' : '비용 아님');

/** 국세 · 지방세 시트 — 화면 표와 같은 칸. 국세는 가산금 · 수납관서 · 전자납부번호, 지방세는 귀속 연월 · 납부기관 · 납부방법 · 납세번호. */
export function payExportSheet(tab: 'NTAX' | 'LTAX', rows: readonly TaxPaymentRow[]): XlsxSheet<TaxPaymentRow> {
  const head = [
    { header: '납부일', value: (r: TaxPaymentRow) => r.payDate },
    { header: '세목', value: (r: TaxPaymentRow) => r.taxItem },
    { header: '비용 여부', value: expenseLabel },
    { header: '금액', value: (r: TaxPaymentRow) => r.amount },
  ];
  const columns =
    tab === 'NTAX'
      ? [
          ...head,
          { header: '가산금', value: (r: TaxPaymentRow) => r.penalty },
          { header: '수납관서', value: (r: TaxPaymentRow) => r.office },
          { header: '전자납부번호', value: (r: TaxPaymentRow) => r.payNo },
        ]
      : [
          ...head,
          { header: '귀속 연월', value: (r: TaxPaymentRow) => r.belongMonth },
          { header: '납부기관', value: (r: TaxPaymentRow) => r.office },
          { header: '납부방법', value: (r: TaxPaymentRow) => r.payMethod },
          { header: '납세번호', value: (r: TaxPaymentRow) => r.payNo },
        ];
  return { name: PAYMENT_TAB_LABELS[tab], columns, rows };
}

/** 4대보험 사람별 시트. ★ 가입자 번호(끝 4자리)는 엑셀에 넣지 않는다 — 화면과 같다(API 응답에는 있다, 직원 급여에서 씀). */
export function socialExportSheet(rows: readonly SocialInsRow[], insNames: readonly TaxCodeName[]): XlsxSheet<SocialInsRow> {
  return {
    name: PAYMENT_TAB_LABELS.SOCIAL,
    columns: [
      { header: '고지 연월', value: (r) => r.noticeMonth },
      { header: '보험 종류', value: (r) => nameOf(insNames, r.insTp) },
      { header: '이름', value: (r) => r.name },
      { header: '보수월액', value: (r) => r.payBase },
      { header: '금액', value: (r) => r.noticeAmount },
    ],
    rows,
  };
}

interface TotalLine {
  label: string;
  count: number;
  amount: number;
}

/** 4대보험 보험 종류별 합계 시트(결정 ④) — 코드 순서 · 사람 수(= 줄 수) · 금액 + 합계 줄. */
export function socialTotalsSheet(rows: readonly SocialInsRow[], insNames: readonly TaxCodeName[]): XlsxSheet<TotalLine> {
  const lines: TotalLine[] = socialTotals(rows).map((t) => ({ label: nameOf(insNames, t.insTp), count: t.count, amount: t.amount }));
  lines.push({ label: '합계', count: rows.length, amount: lines.reduce((n, l) => n + l.amount, 0) });
  return {
    name: '보험 종류별 합계',
    columns: [
      { header: '보험 종류', value: (r) => r.label },
      { header: '사람 수', value: (r) => r.count },
      { header: '금액', value: (r) => r.amount },
    ],
    rows: lines,
  };
}

/** 대출 「대출」 칸 — 「우리은행 · 끝 5678」. ★ 끝 4자리만. */
export const loanLabelOf = (r: Pick<LoanTxnRow, 'bankCode' | 'loanLast4'>, banks: readonly TaxCodeName[]): string =>
  `${nameOf(banks, r.bankCode)} · 끝 ${r.loanLast4}`;

/** 대출 거래 시트 — 거래일 · 대출 · 구분 · 거래종류 · 원금 · 이자 · 수수료 · 잔액. */
export function loanExportSheet(
  rows: readonly LoanTxnRow[],
  banks: readonly TaxCodeName[],
  loanTps: readonly TaxCodeName[],
): XlsxSheet<LoanTxnRow> {
  return {
    name: PAYMENT_TAB_LABELS.LOAN,
    columns: [
      { header: '거래일', value: (r) => r.txnDate },
      { header: '대출', value: (r) => loanLabelOf(r, banks) },
      { header: '구분', value: (r) => nameOf(loanTps, r.txnTp) },
      { header: '거래종류', value: (r) => r.txnType },
      { header: '원금', value: (r) => r.principal },
      { header: '이자', value: (r) => r.interest },
      { header: '수수료', value: (r) => r.fee },
      { header: '잔액', value: (r) => r.balance },
    ],
    rows,
  };
}

/**
 * 엑셀 시트 — 걸린 조건 결과(화면과 같은 줄). 세금 전체는 국세 · 지방세 두 시트(지금 시트 칸 그대로, 2026-11-08),
 * 4대보험은 사람별 + 보험 종류별 합계 두 시트, 대출은 하나.
 */
export function paymentsSheets(data: TaxPaymentsResponse): XlsxSheet<any>[] {
  const { query: q, codes } = data;
  if (q.tab === PAY_ALL) {
    return (['NTAX', 'LTAX'] as const).map((k) => payExportSheet(k, data.pays.filter((r) => r.kind === k)));
  }
  if (q.tab === 'NTAX' || q.tab === 'LTAX') return [payExportSheet(q.tab, data.pays)];
  if (q.tab === 'SOCIAL') return [socialExportSheet(data.social, codes.socialIns), socialTotalsSheet(data.social, codes.socialIns)];
  return [loanExportSheet(data.loans, codes.banks, codes.loanTps)];
}

/** 엑셀 — 지금 걸린 조건 결과. */
export async function exportPaymentsOp(
  client: ScopedClient,
  orgId: number,
  query: PaymentsQuery,
): Promise<TaxOp<{ fileName: string; bytes: Uint8Array }>> {
  const r = await listPaymentsOp(client, orgId, query);
  if (!r.ok) return r;
  return { ok: true, data: { fileName: paymentsExportFileName(r.data.query), bytes: buildXlsx(paymentsSheets(r.data)) } };
}

/* ── 라우트 ──────────────────────────────────────────────────────────────── */

/** 바꿔 끼울 수 있는 바깥 — 시험이 DB 없이 주소 · 400 · 404 를 본다. */
export interface TaxPaymentsDeps {
  list(session: ErpSession, query: PaymentsQuery): Promise<TaxOp<TaxPaymentsResponse>>;
  exportFile(session: ErpSession, query: PaymentsQuery): Promise<TaxOp<{ fileName: string; bytes: Uint8Array }>>;
}

const defaultDeps: TaxPaymentsDeps = {
  list: (session, query) => runOp(session, (c) => listPaymentsOp(c, session.s020OrgId, query)),
  exportFile: (session, query) => runOp(session, (c) => exportPaymentsOp(c, session.s020OrgId, query)),
};

const invalid = (errors: { field: string; message: string }[]) => ({ error: 'invalid_request', message: errors[0]!.message, errors });

export function registerTaxPaymentsRoutes(app: FastifyInstance, deps: TaxPaymentsDeps = defaultDeps): void {
  app.get<{ Querystring: Record<string, unknown> }>('/tax/payments', async (req, reply) => {
    const session = requireSession(req);
    reply.header('Cache-Control', 'no-store');
    const parsed = parsePaymentsQuery(req.query);
    if (!parsed.ok) return reply.code(400).send(invalid(parsed.errors));
    const r = await deps.list(session, parsed.value);
    if (!r.ok) return reply.code(r.status).send({ error: r.error, message: r.message });
    return reply.send(r.data);
  });

  app.get<{ Querystring: Record<string, unknown> }>('/tax/payments/export', async (req, reply) => {
    const session = requireSession(req);
    reply.header('Cache-Control', 'no-store');
    const parsed = parsePaymentsQuery(req.query);
    if (!parsed.ok) return reply.code(400).send(invalid(parsed.errors));
    const r = await deps.exportFile(session, parsed.value);
    if (!r.ok) return reply.code(r.status).send({ error: r.error, message: r.message });
    return sendXlsx(reply, r.data.fileName, r.data.bytes);
  });
}
