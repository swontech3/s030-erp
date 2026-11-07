/**
 * 세무(S05) 세무사 전달 서류(s050500010 · /tax/handoff) — 1-9 (2026-11-07 대표 지시 「답변 · 변경」).
 *
 * 규칙:
 *   종류      코드 TAX_HANDOFF_TP — T 부가세 납부만 동작, M 원천세 납부는 「준비 중」(인사 시스템 뒤)으로 막는다
 *   기간      부가세 조회의 신고 기간 계산 그대로(`tax-vat.ts` — 선택지 · 세는 범위 `vatRange`)
 *   엑셀      시트 아홉, 이 순서 — 매입 · 매출 · 카드 · 은행거래내역 · 이체내역 · 현금 · 국세 · 지방세 · 대출
 *             파일 이름 「세무자료_부가세_2026년3분기.xlsx」
 *   메일      제목 「[회사명] {기간} 부가세 신고 자료」 · 받는 사람은 세무 설정의 세무사 메일 가운데 1~4
 *   남은 일   「미지정 N줄」 하나(부가세 조회와 같은 수)
 * ★ 시트를 만들고 메일을 보내는 일은 api 가 한다. 여기는 주소 · 본문 · 이름 · 글자만.
 */
import type { TaxEmail } from './tax-settings.ts';
import { isEmailShape } from './tax-number.ts';
import { parseMonth, type TaxCodeName, type TaxFieldError } from './tax-uploads.ts';
import type { VatPeriod } from './tax-vat.ts';

export const TAX_HANDOFF_TP_CATEGORY = 'TAX_HANDOFF_TP';
/** 부가세 납부 — 지금 동작하는 종류. */
export const HANDOFF_TP_VAT = 'T';
/** 원천세 납부 — 준비 중(인사 시스템 뒤). */
export const HANDOFF_TP_WH = 'M';
export const HANDOFF_TPS = [HANDOFF_TP_VAT, HANDOFF_TP_WH] as const;
export type HandoffTp = (typeof HANDOFF_TPS)[number];
export const HANDOFF_WH_NOT_READY = '원천세 납부는 준비 중입니다 — 인사 시스템 뒤에 엽니다';
/** 받는 사람 최대 — 세무 설정의 세무사 메일 최대 개수와 같다(2026-11-07 3 → 4, 219). */
export const HANDOFF_TO_MAX = 4;

/* ── 시트 ────────────────────────────────────────────────────────────────── */

export const HANDOFF_SHEETS = [
  { key: 'P', name: '매입' },
  { key: 'S', name: '매출' },
  { key: 'CARD', name: '카드' },
  { key: 'BANK', name: '은행거래내역' },
  { key: 'XFER', name: '이체내역' },
  { key: 'CASH', name: '현금' },
  { key: 'NTAX', name: '국세' },
  { key: 'LTAX', name: '지방세' },
  { key: 'LOAN', name: '대출' },
] as const;
export type HandoffSheetKey = (typeof HANDOFF_SHEETS)[number]['key'];

/* ── 주소 ────────────────────────────────────────────────────────────────── */

export interface HandoffQuery {
  month: string;
  tp: HandoffTp;
  /** 고른 신고 기간 — 없으면 작업할 달이 든 기간. */
  periodId: string | null;
}

export type HandoffQueryParsed = { ok: true; value: HandoffQuery } | { ok: false; errors: TaxFieldError[] };

const PERIOD_RE = /^\d{4}-(Q[1-4]|H[12])$/;
const text = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

function tpErrors(raw: unknown, errors: TaxFieldError[]): HandoffTp {
  const tp = text(raw) ?? HANDOFF_TP_VAT;
  if (tp === HANDOFF_TP_WH) errors.push({ field: 'tp', message: HANDOFF_WH_NOT_READY });
  else if (tp !== HANDOFF_TP_VAT) errors.push({ field: 'tp', message: '전달 종류가 올바르지 않습니다' });
  return tp as HandoffTp;
}

export function parseHandoffQuery(raw: Record<string, unknown>): HandoffQueryParsed {
  const errors: TaxFieldError[] = [];
  const month = parseMonth(raw.month);
  if (!month) errors.push({ field: 'month', message: '작업할 달은 YYYY-MM 입니다' });
  const tp = tpErrors(raw.tp, errors);
  const p = text(raw.period);
  if (p !== null && !PERIOD_RE.test(p)) errors.push({ field: 'period', message: '신고 기간이 올바르지 않습니다' });
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { month: month!, tp, periodId: p } };
}

export function handoffSearch(q: HandoffQuery): string {
  const p = new URLSearchParams({ month: q.month, tp: q.tp });
  if (q.periodId) p.set('period', q.periodId);
  return `?${p.toString()}`;
}

/* ── 보내기 본문 ─────────────────────────────────────────────────────────── */

export interface HandoffSend extends HandoffQuery {
  periodId: string;
  /** 받는 사람 — 겹친 것은 하나로. 세무 설정의 메일인지는 서버가 설정을 읽고 본다. */
  to: string[];
}

export type HandoffSendParsed = { ok: true; value: HandoffSend } | { ok: false; errors: TaxFieldError[] };

export function parseHandoffSend(raw: unknown): HandoffSendParsed {
  const body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const errors: TaxFieldError[] = [];
  if (!raw || typeof raw !== 'object') errors.push({ field: 'body', message: '본문이 올바르지 않습니다' });
  const month = parseMonth(body.month);
  if (!month) errors.push({ field: 'month', message: '작업할 달은 YYYY-MM 입니다' });
  const tp = tpErrors(body.tp, errors);
  const p = text(body.period);
  if (p === null || !PERIOD_RE.test(p)) errors.push({ field: 'period', message: '신고 기간이 올바르지 않습니다' });
  let to: string[] = [];
  if (!Array.isArray(body.to) || body.to.some((v) => typeof v !== 'string')) {
    errors.push({ field: 'to', message: '받는 사람이 올바르지 않습니다' });
  } else {
    to = [...new Set((body.to as string[]).map((v) => v.trim()))];
    if (to.length === 0) errors.push({ field: 'to', message: '받는 사람을 한 명 이상 고르세요' });
    else if (to.length > HANDOFF_TO_MAX) errors.push({ field: 'to', message: `받는 사람은 ${HANDOFF_TO_MAX}명까지입니다` });
    else if (!to.every(isEmailShape)) errors.push({ field: 'to', message: '받는 사람 메일 형식이 올바르지 않습니다' });
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { month: month!, tp, periodId: p!, to } };
}

/* ── 이름 · 글자 ─────────────────────────────────────────────────────────── */

/** 「2026년 3분기」 · 「2026년 2기」. */
export function handoffPeriodLabel(p: VatPeriod): string {
  const [y, part] = p.id.split('-') as [string, string];
  return `${y}년 ${part.slice(1)}${part.startsWith('Q') ? '분기' : '기'}`;
}

/** 「세무자료_부가세_2026년3분기.xlsx」. */
export function handoffFileName(p: VatPeriod): string {
  return `세무자료_부가세_${handoffPeriodLabel(p).replace(' ', '')}.xlsx`;
}

/** 「[회사명] 2026년 3분기 부가세 신고 자료」 — 회사명이 없으면 대괄호 없이. */
export function handoffSubject(companyName: string | null, p: VatPeriod): string {
  const name = companyName?.trim();
  return `${name ? `[${name}] ` : ''}${handoffPeriodLabel(p)} 부가세 신고 자료`;
}

export interface HandoffMailBodyInput {
  companyName: string | null;
  period: VatPeriod;
  /** 센 범위 「7~9월」. */
  rangeLabel: string;
  fileName: string;
  sheets: readonly { name: string; count: number }[];
  unassignedCount: number;
}

/** 본문 — 시안 S05-10 메일 미리보기 꼴(인사 · 첨부 · 남은 일). */
export function handoffMailBody(i: HandoffMailBodyInput): string {
  const name = i.companyName?.trim();
  return [
    `${name ? `안녕하세요, ${name}입니다.` : '안녕하세요.'} ${handoffPeriodLabel(i.period)}(${i.rangeLabel}) 부가세 신고 자료를 보내 드립니다.`,
    `첨부: ${i.fileName} — ${i.sheets.map((s) => `${s.name} ${s.count.toLocaleString('ko-KR')}줄`).join(' · ')}`,
    i.unassignedCount > 0 ? `아직 남은 일: 미지정 ${i.unassignedCount.toLocaleString('ko-KR')}줄` : '남은 일 없음',
  ].join('\n');
}

/** 이력의 기간 — 「2026-07 ~ 2026-09」, 한 달이면 「2026-07」. */
export function handoffLogPeriodLabel(from: string, to: string): string {
  const a = from.slice(0, 7);
  const b = to.slice(0, 7);
  return a === b ? a : `${a} ~ ${b}`;
}

/** 세는 범위 [첫날, 끝 다음 날) → 첫날 · 끝날 — 항목 지정 · 납부 화면의 「기간 직접 지정」(from · to) 꼴. */
export function handoffRangeDates(range: readonly [string, string]): { from: string; to: string } {
  const d = new Date(`${range[1]}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return { from: range[0], to: d.toISOString().slice(0, 10) };
}

/* ── 응답 ────────────────────────────────────────────────────────────────── */

/** 칸 값 — 엑셀과 같은 값(숫자는 숫자, 빈 칸은 null). */
export type HandoffCell = string | number | null;

export interface HandoffSheetView {
  key: HandoffSheetKey;
  name: string;
  columns: string[];
  rows: HandoffCell[][];
}

export interface HandoffLogView {
  id: string;
  /** `YYYY-MM-DD HH:MM`. */
  sentAt: string;
  tp: string;
  periodFrom: string;
  periodTo: string;
  recipients: string[];
  fileName: string;
  rowCount: number;
  ok: boolean;
  failReason: string | null;
  sentBy: string;
  sentByName: string | null;
}

export interface TaxHandoffResponse {
  /** 기간을 고르지 않았으면 periodId 가 작업할 달이 든 기간으로 채워져 있다. 사업자 유형이 없으면 null. */
  query: HandoffQuery;
  /** 종류 선택지 — 코드 표 순서. ready 가 false 면 「준비 중」으로 막는다. */
  tps: (TaxCodeName & { ready: boolean })[];
  /** 사업자 유형이 없으면 null — 화면은 세무 설정 안내만 그린다. */
  period: VatPeriod | null;
  periods: VatPeriod[];
  rangeLabel: string | null;
  sheets: HandoffSheetView[];
  unassignedCount: number;
  /** 세무 설정의 세무사 메일. */
  recipients: TaxEmail[];
  companyName: string | null;
  subject: string | null;
  fileName: string | null;
  /** 메일 발송 설정(SMTP)이 있는가 — 없으면 [메일 보내기]를 막는다. */
  mailReady: boolean;
  logs: HandoffLogView[];
}

export interface TaxHandoffSendResult {
  ok: boolean;
  /** 실패면 사유. */
  message: string | null;
  log: HandoffLogView;
}
