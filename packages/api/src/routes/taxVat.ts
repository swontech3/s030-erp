/**
 * 세무 부가세 조회(s050400020, 세무 S05) — 1-8 (2026-11-05). 읽기만.
 *
 *   GET /tax/vat?month&period          신고 기간 · 선택지 · 달마다 표 + 합계(납부세액 예상) · 미지정 건 수 · 미지정이 있는 가장 이른 달
 *   GET /tax/vat/export?month&period   엑셀 — 맨 앞 「부가세 요약」(화면 표와 같은 칸, 11-08 ⑦) + 매출 · 매입 명세(결정 11)
 *                                      (ERP 공통 부품 `lib/xlsxExport.ts`)
 * ★ 11-08 ⑦ — 「공제가 안 될 수 있는 매입」 계산을 지웠다(코드 표 TAX_NODEDUCT_ITEM · DB 는 그대로).
 *
 * ★★★ 운영사 세션도 **자기 단체만** — `org_id = 세션 단체 ID` 를 직접 건다(`db/taxVat.ts`). 역할로 403 을 내지 않는다.
 * ★ 계산은 shared `tax-vat.ts`(`buildVat` · `vatLedger`) 한 곳. 신고 기간은 세무 설정의 사업자 유형으로 계산한다(결정 9).
 * ★ 사업자 유형이 없으면 화면은 세무 설정 안내만 — 엑셀은 400. 사업자 유형과 맞지 않는 기간도 400.
 */
import type { FastifyInstance } from 'fastify';
import type { ErpSession } from '@swonbiz/shared';
import { TAX_BIZ_TP_CATEGORY } from '@swonbiz/shared/domain/tax-settings';
import { TAX_CARD_DEDUCT_CATEGORY } from '@swonbiz/shared/domain/tax-card-cash';
import {
  buildVat,
  parseVatQuery,
  vatExportFileName,
  vatLedger,
  vatPeriodById,
  vatPeriodOf,
  vatPeriodMonths,
  vatPeriodOptions,
  vatRange,
  vatRangeLabel,
  type TaxVatResponse,
  type VatAmounts,
  type VatLedgerRow,
  type VatMonthRow,
  type VatQuery,
} from '@swonbiz/shared/domain/tax-vat';
import { thisMonthOf, type TaxCodeName } from '@swonbiz/shared/domain/tax-uploads';
import { requireSession } from '../session/hook.ts';
import type { ScopedClient } from '../db/withCompanyScope.ts';
import { readVatSources } from '../db/taxVat.ts';
import { buildXlsx, sendXlsx, type XlsxSheet } from '../lib/xlsxExport.ts';
import { loadItems } from './taxClassify.ts';
import { loadCodeNames, runOp, type TaxOp } from './taxUploads.ts';

const BAD_PERIOD = { ok: false as const, status: 400 as const, error: 'invalid_request', message: '신고 기간이 올바르지 않습니다' };
const NO_BIZ_TYPE = {
  ok: false as const, status: 400 as const, error: 'no_biz_type', message: '세무 설정에서 사업자 유형을 먼저 고르세요',
};

/** `thisMonth` 은 이번 달 — 선택지 끝(11-06). 검증 스크립트가 날짜를 고정하려고 넘긴다. */
export async function vatOp(
  client: ScopedClient,
  orgId: number,
  query: VatQuery,
  thisMonth: string = thisMonthOf(new Date()),
): Promise<TaxOp<TaxVatResponse>> {
  const { bizType } = await loadItems(client, orgId);
  const names = await loadCodeNames(client, [TAX_BIZ_TP_CATEGORY]);
  const bizTypeName = (names.get(TAX_BIZ_TP_CATEGORY) ?? []).find((b) => b.code === bizType)?.name ?? null;
  const period = query.periodId ? vatPeriodById(bizType, query.periodId) : vatPeriodOf(bizType, query.month);
  const empty = { query, bizType, bizTypeName, period: null, periods: [], rangeLabel: null, vat: null };
  if (!period) return query.periodId && bizType ? BAD_PERIOD : { ok: true, data: empty };
  // 고를 수 있는 기간(최근 3년 · 이번 달까지 시작)만 받는다
  const periods = vatPeriodOptions(bizType, query.month, thisMonth);
  if (!periods.some((p) => p.id === period.id)) return BAD_PERIOD;

  const range = vatRange(period, query.month);
  const src = await readVatSources(client, orgId, range);
  return {
    ok: true,
    data: {
      query: { ...query, periodId: period.id },
      bizType,
      bizTypeName,
      period,
      periods,
      rangeLabel: vatRangeLabel(range),
      vat: buildVat(src, { range, months: vatPeriodMonths(period) }),
    },
  };
}

const SOURCE_LABEL: Readonly<Record<VatLedgerRow['source'], string>> = { INVOICE: '계산서', CARD: '카드' };

/** 매출 · 매입 시트(결정 11) — 작성일 · 거래처 · 사업자번호 · 공급가액 · 세액 · 자료 · 공제 여부(카드만, 코드 이름). */
export function vatLedgerSheet(name: string, rows: readonly VatLedgerRow[], deductNames: readonly TaxCodeName[]): XlsxSheet<VatLedgerRow> {
  return {
    name,
    columns: [
      { header: '작성일', value: (r) => r.date },
      { header: '거래처', value: (r) => r.partner },
      { header: '사업자번호', value: (r) => r.bizNo },
      { header: '공급가액', value: (r) => r.supply },
      { header: '세액', value: (r) => r.tax },
      { header: '자료', value: (r) => SOURCE_LABEL[r.source] },
      { header: '공제 여부', value: (r) => (r.vatDeduct === null ? null : (deductNames.find((d) => d.code === r.vatDeduct)?.name ?? r.vatDeduct)) },
    ],
    rows,
  };
}

/** 「부가세 요약」 한 줄 — 달 줄(`2026-07`) 또는 합계 줄. 아직 오지 않은 달은 amounts 가 null(모든 칸 빈칸). */
interface VatSummaryLine {
  label: string;
  amounts: VatAmounts | null;
}

const amountCol = (header: string, key: keyof VatAmounts) => ({
  header,
  value: (r: VatSummaryLine) => (r.amounts === null ? null : r.amounts[key]),
});

/** 「부가세 요약」 시트(11-08 ⑦) — 화면 표와 같은 칸 · 같은 줄(달마다 + 합계). 머리는 한 줄로 「매출액 공급가액」처럼 붙여 쓴다. */
export function vatSummarySheet(months: readonly VatMonthRow[], total: VatAmounts): XlsxSheet<VatSummaryLine> {
  return {
    name: '부가세 요약',
    columns: [
      { header: '월', value: (r) => r.label },
      amountCol('매출액 공급가액', 'salesSupply'),
      amountCol('매출액 부가세액', 'salesTax'),
      amountCol('매출액 합계', 'salesTotal'),
      amountCol('매입액 공급가액', 'purchaseSupply'),
      amountCol('매입액 부가세액', 'purchaseTax'),
      amountCol('매입액 합계', 'purchaseTotal'),
      amountCol('카드 경비 공급가액', 'cardSupply'),
      amountCol('카드 경비 부가세액', 'cardTax'),
      amountCol('카드 경비 합계', 'cardTotal'),
      amountCol('납부세액', 'payable'),
    ],
    rows: [...months.map((m) => ({ label: m.month, amounts: m.amounts })), { label: '합계', amounts: total }],
  };
}

/** 엑셀 — 맨 앞 「부가세 요약」(화면 표 그대로) + 화면과 같은 기간 · 범위의 매출 · 매입 명세. */
export async function exportVatOp(
  client: ScopedClient,
  orgId: number,
  query: VatQuery,
): Promise<TaxOp<{ fileName: string; bytes: Uint8Array }>> {
  const r = await vatOp(client, orgId, query);
  if (!r.ok) return r;
  const { period, vat } = r.data;
  if (!period || !vat) return NO_BIZ_TYPE;
  const range = vatRange(period, query.month);
  const ledger = vatLedger(await readVatSources(client, orgId, range), range);
  const deduct = (await loadCodeNames(client, [TAX_CARD_DEDUCT_CATEGORY])).get(TAX_CARD_DEDUCT_CATEGORY) ?? [];
  const bytes = buildXlsx([
    vatSummarySheet(vat.months, vat.total),
    vatLedgerSheet('매출', ledger.sales, deduct),
    vatLedgerSheet('매입', ledger.purchases, deduct),
  ]);
  return { ok: true, data: { fileName: vatExportFileName(period), bytes } };
}

/** 바꿔 끼울 수 있는 바깥 — 시험이 DB 없이 주소 · 400 을 본다. */
export interface TaxVatDeps {
  get(session: ErpSession, query: VatQuery): Promise<TaxOp<TaxVatResponse>>;
  exportFile(session: ErpSession, query: VatQuery): Promise<TaxOp<{ fileName: string; bytes: Uint8Array }>>;
}

const defaultDeps: TaxVatDeps = {
  get: (session, query) => runOp(session, (c) => vatOp(c, session.s020OrgId, query)),
  exportFile: (session, query) => runOp(session, (c) => exportVatOp(c, session.s020OrgId, query)),
};

const invalid = (errors: { field: string; message: string }[]) => ({ error: 'invalid_request', message: errors[0]!.message, errors });

export function registerTaxVatRoutes(app: FastifyInstance, deps: TaxVatDeps = defaultDeps): void {
  app.get<{ Querystring: Record<string, unknown> }>('/tax/vat', async (req, reply) => {
    const session = requireSession(req);
    reply.header('Cache-Control', 'no-store');
    const parsed = parseVatQuery(req.query);
    if (!parsed.ok) return reply.code(400).send(invalid(parsed.errors));
    const r = await deps.get(session, parsed.value);
    if (!r.ok) return reply.code(r.status).send({ error: r.error, message: r.message });
    return reply.send(r.data);
  });

  app.get<{ Querystring: Record<string, unknown> }>('/tax/vat/export', async (req, reply) => {
    const session = requireSession(req);
    reply.header('Cache-Control', 'no-store');
    const parsed = parseVatQuery(req.query);
    if (!parsed.ok) return reply.code(400).send(invalid(parsed.errors));
    const r = await deps.exportFile(session, parsed.value);
    if (!r.ok) return reply.code(r.status).send({ error: r.error, message: r.message });
    return sendXlsx(reply, r.data.fileName, r.data.bytes);
  });
}
