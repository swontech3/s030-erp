/**
 * 세무 세무사 전달 서류(s050500010, 세무 S05) — 1-9 (2026-11-07 대표 지시 「답변 · 변경」).
 *
 *   GET  /tax/handoff?month&tp&period           신고 기간 · 시트 아홉 미리보기 · 미지정 건 수 · 받는 사람 · 제목 · 메일 설정 · 보낸 이력
 *   GET  /tax/handoff/export?month&tp&period    시트 아홉 엑셀(ERP 공통 부품 `lib/xlsxExport.ts`) — 메일 설정과 상관없이 늘 된다
 *   POST /tax/handoff/send   { month, tp, period, to[] }   서버가 엑셀을 만들어 첨부해 보낸다(nodemailer) · 결과를 이력에 남긴다
 *
 * ★★★ 운영사 세션도 **자기 단체만** — 읽는 처리마다 `org_id = 세션 단체 ID` 를 직접 건다. 역할로 403 을 내지 않는다.
 * ★ 종류는 T 부가세 납부만 — M 원천세 납부는 주소 해석에서 400 「준비 중」(shared `tax-handoff.ts`).
 * ★ 기간은 부가세 조회 그대로(`vatOp` — 선택지 · 사업자 유형 · 세는 범위 `vatRange`). 미지정 건 수도 부가세 조회의 수.
 * ★ 시트는 지금 화면의 처리 · 시트 함수를 그대로 부른다 — 매입 · 매출 · 카드 · 현금은 항목 지정 「이번 달 자료 전체」(기간 직접 지정),
 *   국세 · 지방세 · 대출은 세금 · 4대보험 · 대출 화면(기간 직접 지정). 은행거래내역 · 이체내역 시트만 새로(화면이 아직 없다).
 * ★ 받는 사람은 세무 설정의 세무사 메일 가운데서만 — 다른 주소는 400(아무 주소로나 보내지 않는다).
 * ★ 메일 보내기는 트랜잭션 밖에서 한다 — 준비(읽기 · 엑셀) 한 번, 보내기, 이력 넣기 한 번. 실패도 사유와 함께 남긴다.
 */
import type { FastifyInstance } from 'fastify';
import type { ErpSession } from '@swonbiz/shared';
import { TAX_CARD_DEDUCT_CATEGORY, TAX_PAY_METHOD_CATEGORY, TAX_PROOF_CATEGORY } from '@swonbiz/shared/domain/tax-card-cash';
import type { TaxClassifyRow } from '@swonbiz/shared/domain/tax-classify';
import {
  HANDOFF_SHEETS,
  HANDOFF_TP_VAT,
  TAX_HANDOFF_TP_CATEGORY,
  handoffFileName,
  handoffMailBody,
  handoffRangeDates,
  handoffSubject,
  parseHandoffQuery,
  parseHandoffSend,
  type HandoffLogView,
  type HandoffQuery,
  type HandoffSend,
  type HandoffSheetKey,
  type HandoffSheetView,
  type TaxHandoffResponse,
  type TaxHandoffSendResult,
} from '@swonbiz/shared/domain/tax-handoff';
import type { LoanTxnRow, TaxPaymentRow } from '@swonbiz/shared/domain/tax-payments';
import type { TaxEmail } from '@swonbiz/shared/domain/tax-settings';
import { TAX_INV_CLASS_CATEGORY, TAX_INV_DIR_PURCHASE, TAX_INV_DIR_SALES, thisMonthOf, type TaxCodeName } from '@swonbiz/shared/domain/tax-uploads';
import { vatRange, type VatPeriod } from '@swonbiz/shared/domain/tax-vat';
import { requireSession } from '../session/hook.ts';
import type { ScopedClient } from '../db/withCompanyScope.ts';
import { listCategoryNames } from '../db/taxClassify.ts';
import { insertHandoffLog, listHandoffBankRows, listHandoffLogs, type HandoffBankRow, type NewHandoffLog } from '../db/taxHandoff.ts';
import { bbiyongAuth } from '../bbiyong/index.ts';
import { env } from '../env.ts';
import { buildXlsx, sendXlsx, type XlsxSheet } from '../lib/xlsxExport.ts';
import { MAIL_NOT_READY, createMailer, type Mailer } from '../lib/mailer.ts';
import { cardExportSheet, cashExportSheet, invoiceExportSheet, listClassifyOp } from './taxClassify.ts';
import { listPaymentsOp, loanExportSheet, payExportSheet } from './taxPayments.ts';
import { fillCompanyName, readTaxSettingsOp } from './taxSettings.ts';
import { vatOp } from './taxVat.ts';
import { loadCodeNames, runOp, type TaxOp } from './taxUploads.ts';

export type { HandoffBankRow, NewHandoffLog };

type HandoffFail = { ok: false; status: 400 | 404 | 409 | 503; error: string; message: string };
type HandoffOp<T> = { ok: true; data: T } | HandoffFail;

const NO_BIZ_TYPE: HandoffFail = { ok: false, status: 400, error: 'no_biz_type', message: '세무 설정에서 사업자 유형을 먼저 고르세요' };
const NO_RECIPIENT: HandoffFail = { ok: false, status: 400, error: 'no_recipient', message: '세무 설정에서 세무사 메일을 먼저 넣으세요' };
const NOT_RECIPIENT: HandoffFail = { ok: false, status: 400, error: 'not_recipient', message: '세무 설정에 없는 메일입니다' };
const NOT_READY: HandoffFail = { ok: false, status: 503, error: 'mail_not_ready', message: MAIL_NOT_READY };
const FAIL_REASON_MAX = 500;

/* ── 시트 ────────────────────────────────────────────────────────────────── */

/** 계좌 글자 — 세무 설정 별칭, 없으면 「끝 1234」. ★ 전체 번호는 내보내지 않는다. */
export function bankAccountLabel(alias: string | null, accountNo: string): string {
  return alias && alias.trim() !== '' ? alias.trim() : `끝 ${accountNo.slice(-4)}`;
}

/** 은행거래내역 — 거래일시 · 계좌 · 적요 · 상대 · 입금 · 출금 · 잔액 · 메모. */
export function bankTxnSheet(rows: readonly HandoffBankRow[]): XlsxSheet<HandoffBankRow> {
  return {
    name: '은행거래내역',
    columns: [
      { header: '거래일시', value: (r) => r.txnAt },
      { header: '계좌', value: (r) => bankAccountLabel(r.alias, r.accountNo) },
      { header: '적요', value: (r) => r.description },
      { header: '상대', value: (r) => r.counterparty },
      { header: '입금', value: (r) => r.inAmount },
      { header: '출금', value: (r) => r.outAmount },
      { header: '잔액', value: (r) => r.balance },
      { header: '메모', value: (r) => r.memo },
    ],
    rows,
  };
}

/** 이체내역 — 이체 칸이 붙은 출금 줄. 거래일시 · 계좌 · 받는 은행 · 받는 계좌 끝 4자리 · 받는분 · 금액 · 통장표시 두 칸(대표 결정 11-07). */
export function bankXferSheet(rows: readonly HandoffBankRow[]): XlsxSheet<HandoffBankRow> {
  return {
    name: '이체내역',
    columns: [
      { header: '거래일시', value: (r) => r.txnAt },
      { header: '계좌', value: (r) => bankAccountLabel(r.alias, r.accountNo) },
      { header: '받는 은행', value: (r) => r.xfer?.bank ?? null },
      { header: '받는 계좌 끝 4자리', value: (r) => r.xfer?.last4 ?? null },
      { header: '받는분', value: (r) => r.xfer?.holder ?? null },
      { header: '금액', value: (r) => r.outAmount },
      { header: '받는분 통장표시', value: (r) => r.xfer?.toMemo ?? null },
      { header: '보내는분 통장표시', value: (r) => r.xfer?.fromMemo ?? null },
    ],
    rows: rows.filter((r) => r.xfer !== null),
  };
}

export interface HandoffSources {
  /** 항목 지정 「이번 달 자료 전체」(기간 직접 지정)의 줄 — 계산서 · 카드 · 현금. */
  classify: readonly TaxClassifyRow[];
  classifyNames: {
    invDirs: readonly TaxCodeName[];
    invClasses: readonly TaxCodeName[];
    itemNames: readonly TaxCodeName[];
    deducts: readonly TaxCodeName[];
    payMethods: readonly TaxCodeName[];
    proofs: readonly TaxCodeName[];
    payMethodHeader: string;
    proofHeader: string;
  };
  bank: readonly HandoffBankRow[];
  ntax: readonly TaxPaymentRow[];
  ltax: readonly TaxPaymentRow[];
  loans: readonly LoanTxnRow[];
  banks: readonly TaxCodeName[];
  loanTps: readonly TaxCodeName[];
}

const SHEET_NAME: Readonly<Record<HandoffSheetKey, string>> = Object.fromEntries(HANDOFF_SHEETS.map((s) => [s.key, s.name])) as Record<HandoffSheetKey, string>;

/** 시트 아홉 — `HANDOFF_SHEETS` 순서 · 이름. 있는 시트 함수는 그대로 부르고 이름만 붙인다. */
export function buildHandoffSheets(src: HandoffSources): { key: HandoffSheetKey; sheet: XlsxSheet<any> }[] {
  const n = src.classifyNames;
  const inv = (dir: string) => src.classify.filter((r) => r.kind === 'INVOICE' && r.direction === dir);
  const named = <T>(key: HandoffSheetKey, sheet: XlsxSheet<T>) => ({ key, sheet: { ...sheet, name: SHEET_NAME[key] } });
  const invNames = { invDirs: n.invDirs, invClasses: n.invClasses, itemNames: n.itemNames };
  const built = [
    named('P', invoiceExportSheet(inv(TAX_INV_DIR_PURCHASE), { ...invNames, kindName: SHEET_NAME.P })),
    named('S', invoiceExportSheet(inv(TAX_INV_DIR_SALES), { ...invNames, kindName: SHEET_NAME.S })),
    named('CARD', cardExportSheet(src.classify.filter((r) => r.kind === 'CARD'), { kindName: SHEET_NAME.CARD, itemNames: n.itemNames, deducts: n.deducts })),
    named('BANK', bankTxnSheet(src.bank)),
    named('XFER', bankXferSheet(src.bank)),
    named('CASH', cashExportSheet(src.classify.filter((r) => r.kind === 'CASH'), {
      kindName: SHEET_NAME.CASH, itemNames: n.itemNames, invDirs: n.invDirs, payMethods: n.payMethods, proofs: n.proofs,
      payMethodHeader: n.payMethodHeader, proofHeader: n.proofHeader,
    })),
    named('NTAX', payExportSheet('NTAX', src.ntax)),
    named('LTAX', payExportSheet('LTAX', src.ltax)),
    named('LOAN', loanExportSheet(src.loans, src.banks, src.loanTps)),
  ];
  return built;
}

/** 미리보기 — 엑셀과 같은 값(칸 함수를 그대로 부른다). */
export function sheetView(key: HandoffSheetKey, sheet: XlsxSheet<any>): HandoffSheetView {
  return {
    key,
    name: sheet.name,
    columns: sheet.columns.map((c) => c.header),
    rows: sheet.rows.map((r) => sheet.columns.map((c) => c.value(r))),
  };
}

/* ── 읽기 ────────────────────────────────────────────────────────────────── */

interface Built {
  response: TaxHandoffResponse;
  /** 엑셀 시트 — 사업자 유형이 없으면 빈 목록. */
  sheets: XlsxSheet<any>[];
  periodFrom: string | null;
  periodTo: string | null;
}

/** `thisMonth` 은 이번 달 — 신고 기간 선택지 끝(부가세 조회와 같다). 검증 스크립트가 날짜를 고정하려고 넘긴다. */
export async function handoffOp(
  client: ScopedClient,
  orgId: number,
  q: HandoffQuery,
  opts: { mailReady: boolean; thisMonth?: string },
): Promise<TaxOp<Built>> {
  const vat = await vatOp(client, orgId, { month: q.month, periodId: q.periodId }, opts.thisMonth ?? thisMonthOf(new Date()));
  if (!vat.ok) return vat;
  const settings = await readTaxSettingsOp(client, orgId);
  const tpNames = (await loadCodeNames(client, [TAX_HANDOFF_TP_CATEGORY])).get(TAX_HANDOFF_TP_CATEGORY) ?? [];
  const logs = await listHandoffLogs(client, orgId);
  const { period } = vat.data;
  const base: TaxHandoffResponse = {
    query: { ...q, periodId: vat.data.query.periodId },
    tps: tpNames.map((t) => ({ ...t, ready: t.code === HANDOFF_TP_VAT })),
    period,
    periods: vat.data.periods,
    rangeLabel: vat.data.rangeLabel,
    sheets: [],
    unassignedCount: vat.data.vat?.unassignedCount ?? 0,
    recipients: settings.settings.taxEmails,
    companyName: settings.company.name,
    subject: null,
    fileName: null,
    mailReady: opts.mailReady,
    logs,
  };
  if (!period) return { ok: true, data: { response: base, sheets: [], periodFrom: null, periodTo: null } };

  const range = vatRange(period, q.month);
  const { from, to } = handoffRangeDates(range);
  const cls = await listClassifyOp(client, orgId, { month: q.month, view: 'all', kind: 'all', from, to, fileId: null });
  if (!cls.ok) return cls;
  const codes = await loadCodeNames(client, [TAX_INV_CLASS_CATEGORY, TAX_CARD_DEDUCT_CATEGORY, TAX_PAY_METHOD_CATEGORY, TAX_PROOF_CATEGORY]);
  const heads = await listCategoryNames(client, [TAX_PAY_METHOD_CATEGORY, TAX_PROOF_CATEGORY]);
  const payments = async (tab: 'NTAX' | 'LTAX' | 'LOAN') => {
    const r = await listPaymentsOp(client, orgId, { month: q.month, tab, from, to, fileId: null });
    if (!r.ok) throw new Error(r.message); // 파일 없이 부르므로 실패하지 않는다
    return r.data;
  };
  const ntax = await payments('NTAX');
  const ltax = await payments('LTAX');
  const loan = await payments('LOAN');

  const built = buildHandoffSheets({
    classify: cls.data.rows,
    classifyNames: {
      invDirs: cls.data.codes.invDirs,
      invClasses: codes.get(TAX_INV_CLASS_CATEGORY) ?? [],
      itemNames: cls.data.codes.itemNames,
      deducts: codes.get(TAX_CARD_DEDUCT_CATEGORY) ?? [],
      payMethods: codes.get(TAX_PAY_METHOD_CATEGORY) ?? [],
      proofs: codes.get(TAX_PROOF_CATEGORY) ?? [],
      payMethodHeader: heads.get(TAX_PAY_METHOD_CATEGORY) ?? TAX_PAY_METHOD_CATEGORY,
      proofHeader: heads.get(TAX_PROOF_CATEGORY) ?? TAX_PROOF_CATEGORY,
    },
    bank: await listHandoffBankRows(client, orgId, range),
    ntax: ntax.pays,
    ltax: ltax.pays,
    loans: loan.loans,
    banks: loan.codes.banks,
    loanTps: loan.codes.loanTps,
  });
  return {
    ok: true,
    data: {
      response: {
        ...base,
        sheets: built.map((b) => sheetView(b.key, b.sheet)),
        subject: handoffSubject(base.companyName, period),
        fileName: handoffFileName(period),
      },
      sheets: built.map((b) => b.sheet),
      periodFrom: from,
      periodTo: to,
    },
  };
}

/** 회사명이 비어 있으면 세션 회사명(삐용) — 세무 설정 화면과 같다. 삐용 호출은 트랜잭션 밖에서. ★ 실패는 빈 채로. */
async function withSessionName(session: ErpSession, r: TaxHandoffResponse): Promise<TaxHandoffResponse> {
  if (r.companyName && r.companyName.trim() !== '') return r;
  let name: string | null = null;
  try {
    name = (await bbiyongAuth.getProfile(session.s020MemberId))?.orgName || null;
  } catch {
    name = null;
  }
  const companyName = fillCompanyName({ source: 'none', name: r.companyName, bizNumber: null, corpNumber: null }, name).name;
  return { ...r, companyName, subject: r.period ? handoffSubject(companyName, r.period) : null };
}

/* ── 보내기 ──────────────────────────────────────────────────────────────── */

export interface HandoffPrepared {
  recipients: TaxEmail[];
  companyName: string | null;
  period: VatPeriod;
  rangeLabel: string;
  periodFrom: string;
  periodTo: string;
  fileName: string;
  bytes: Uint8Array;
  sheets: { name: string; count: number }[];
  rowCount: number;
  unassignedCount: number;
}

/** 바꿔 끼울 수 있는 부분 — 시험이 DB 없이 흐름을 본다. */
export interface HandoffSendParts {
  prepare(session: ErpSession, q: HandoffQuery): Promise<HandoffOp<HandoffPrepared>>;
  /** 보낸 사람 이름 — 삐용에서 읽는다, 못 읽으면 null. */
  senderName(session: ErpSession): Promise<string | null>;
  saveLog(session: ErpSession, log: NewHandoffLog): Promise<HandoffLogView>;
}

/**
 * 보내기 — 설정 없음 503 → 준비(읽기 · 엑셀) → 받는 사람 확인(세무 설정 메일만) → 보내기 → 이력(성공 / 실패 사유).
 * ★ 메일 서버 실패는 HTTP 실패가 아니다 — 이력을 남겼으므로 결과(ok false · 사유)로 돌려준다.
 */
export async function sendHandoff(session: ErpSession, body: HandoffSend, mailer: Mailer, parts: HandoffSendParts): Promise<HandoffOp<TaxHandoffSendResult>> {
  if (!mailer.ready) return NOT_READY;
  const p = await parts.prepare(session, body);
  if (!p.ok) return p;
  const d = p.data;
  if (d.recipients.length === 0) return NO_RECIPIENT;
  const allowed = new Set(d.recipients.map((r) => r.email));
  if (!body.to.every((e) => allowed.has(e))) return NOT_RECIPIENT;

  let failReason: string | null = null;
  try {
    await mailer.send({
      to: body.to,
      subject: handoffSubject(d.companyName, d.period),
      text: handoffMailBody({
        companyName: d.companyName, period: d.period, rangeLabel: d.rangeLabel, fileName: d.fileName, sheets: d.sheets,
        unassignedCount: d.unassignedCount,
      }),
      attachments: [{ filename: d.fileName, content: d.bytes }],
    });
  } catch (err) {
    const msg = err instanceof Error && err.message.trim() !== '' ? err.message.trim() : '알 수 없는 오류';
    failReason = msg.slice(0, FAIL_REASON_MAX);
  }
  const log = await parts.saveLog(session, {
    tp: body.tp, periodFrom: d.periodFrom, periodTo: d.periodTo, recipients: body.to, fileName: d.fileName, rowCount: d.rowCount,
    ok: failReason === null, failReason, sentBy: String(session.s020MemberId), sentByName: await parts.senderName(session),
  });
  return { ok: true, data: { ok: failReason === null, message: failReason === null ? null : `메일을 보내지 못했습니다 — ${failReason}`, log } };
}

/* ── 라우트 ──────────────────────────────────────────────────────────────── */

/** 바꿔 끼울 수 있는 바깥 — 시험이 DB 없이 주소 · 본문 · 400 · 503 을 본다. */
export interface TaxHandoffDeps {
  get(session: ErpSession, q: HandoffQuery): Promise<HandoffOp<TaxHandoffResponse>>;
  exportFile(session: ErpSession, q: HandoffQuery): Promise<HandoffOp<{ fileName: string; bytes: Uint8Array }>>;
  send(session: ErpSession, body: HandoffSend): Promise<HandoffOp<TaxHandoffSendResult>>;
}

const mailer = createMailer(env.smtp);

const buildOf = (session: ErpSession, q: HandoffQuery) =>
  runOp(session, (c) => handoffOp(c, session.s020OrgId, q, { mailReady: mailer.ready }));

const sendParts: HandoffSendParts = {
  prepare: async (session, q) => {
    const b = await buildOf(session, q);
    if (!b.ok) return b;
    const { response: r, sheets, periodFrom, periodTo } = b.data;
    if (!r.period || !r.fileName || !periodFrom || !periodTo) return NO_BIZ_TYPE;
    const named = await withSessionName(session, r);
    return {
      ok: true,
      data: {
        recipients: r.recipients, companyName: named.companyName, period: r.period, rangeLabel: r.rangeLabel ?? '',
        periodFrom, periodTo, fileName: r.fileName, bytes: buildXlsx(sheets),
        sheets: r.sheets.map((s) => ({ name: s.name, count: s.rows.length })),
        rowCount: r.sheets.reduce((n, s) => n + s.rows.length, 0), unassignedCount: r.unassignedCount,
      },
    };
  },
  senderName: async (session) => {
    try {
      return (await bbiyongAuth.getProfile(session.s020MemberId))?.memberName || null;
    } catch {
      return null;
    }
  },
  saveLog: async (session, log) => {
    const r = await runOp(session, async (c) => ({ ok: true as const, data: await insertHandoffLog(c, session.s020OrgId, log) }));
    if (!r.ok) throw new Error(r.message);
    return r.data;
  },
};

const defaultDeps: TaxHandoffDeps = {
  get: async (session, q) => {
    const b = await buildOf(session, q);
    return b.ok ? { ok: true, data: await withSessionName(session, b.data.response) } : b;
  },
  exportFile: async (session, q) => {
    const b = await buildOf(session, q);
    if (!b.ok) return b;
    if (!b.data.response.fileName) return NO_BIZ_TYPE;
    return { ok: true, data: { fileName: b.data.response.fileName, bytes: buildXlsx(b.data.sheets) } };
  },
  send: (session, body) => sendHandoff(session, body, mailer, sendParts),
};

const invalid = (errors: { field: string; message: string }[]) => ({ error: 'invalid_request', message: errors[0]!.message, errors });

export function registerTaxHandoffRoutes(app: FastifyInstance, deps: TaxHandoffDeps = defaultDeps): void {
  app.get<{ Querystring: Record<string, unknown> }>('/tax/handoff', async (req, reply) => {
    const session = requireSession(req);
    reply.header('Cache-Control', 'no-store');
    const parsed = parseHandoffQuery(req.query);
    if (!parsed.ok) return reply.code(400).send(invalid(parsed.errors));
    const r = await deps.get(session, parsed.value);
    if (!r.ok) return reply.code(r.status).send({ error: r.error, message: r.message });
    return reply.send(r.data);
  });

  app.get<{ Querystring: Record<string, unknown> }>('/tax/handoff/export', async (req, reply) => {
    const session = requireSession(req);
    reply.header('Cache-Control', 'no-store');
    const parsed = parseHandoffQuery(req.query);
    if (!parsed.ok) return reply.code(400).send(invalid(parsed.errors));
    const r = await deps.exportFile(session, parsed.value);
    if (!r.ok) return reply.code(r.status).send({ error: r.error, message: r.message });
    return sendXlsx(reply, r.data.fileName, r.data.bytes);
  });

  app.post<{ Body: unknown }>('/tax/handoff/send', async (req, reply) => {
    const session = requireSession(req);
    reply.header('Cache-Control', 'no-store');
    const parsed = parseHandoffSend(req.body);
    if (!parsed.ok) return reply.code(400).send(invalid(parsed.errors));
    const r = await deps.send(session, parsed.value);
    if (!r.ok) return reply.code(r.status).send({ error: r.error, message: r.message });
    return reply.send(r.data);
  });
}
