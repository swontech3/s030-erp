/**
 * 세무(S05) 세무사 전달 서류(s050500010 · /tax/handoff) — 1-9 (2026-11-07 대표 지시 「답변 · 변경」).
 *
 * 규칙:
 *   종류      코드 TAX_HANDOFF_TP — T 부가세 납부만 동작, M 원천세 납부는 「준비 중」(인사 시스템 뒤)으로 막는다
 *   기간      부가세 조회의 신고 기간 계산 그대로(`tax-vat.ts` — 선택지 · 세는 범위 `vatRange`)
 *   엑셀      시트 아홉, 이 순서 — 매입 · 매출 · 카드 · 은행거래내역 · 이체내역 · 현금 · 국세 · 지방세 · 대출
 *             파일 이름 「세무자료_부가세_2026년3분기.xlsx」
 *   메일      제목 「[회사명] {기간} 부가세 신고 자료」 · 내용 「안녕하세요. 회사명 {기간} 부가세 신고 자료입니다.」 — 미리 채우고 고칠 수 있게(11-08 ⑧)
 *             받는 사람은 세무 설정의 세무사 메일 가운데 1~4 · 참조는 서버가 정한다(발송인이 대표자가 아니면 대표자)
 *   최종 발송 단체 · 종류 · 신고 기간마다 한 줄(224) — 성공할 때만 덮어쓴다. 이력 · 실패는 남기지 않는다(11-08 ⑧)
 *   남은 일   「미지정 N줄」 하나(부가세 조회와 같은 수 · 가장 이른 달)
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
/** 메일 제목 · 내용 글자 수 끝(11-08 ⑧ 권장안). */
export const HANDOFF_SUBJECT_MAX = 200;
export const HANDOFF_TEXT_MAX = 5000;

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
  /** 메일 제목 · 내용 — 팝업에서 고친 그대로(앞뒤 빈칸만 걷음). ★ 참조는 받지 않는다(서버가 정한다). */
  subject: string;
  text: string;
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
    if (to.length === 0) errors.push({ field: 'to', message: '받는 사람을 한 명 이상 선택하세요' });
    else if (to.length > HANDOFF_TO_MAX) errors.push({ field: 'to', message: `받는 사람은 ${HANDOFF_TO_MAX}명까지입니다` });
    else if (!to.every(isEmailShape)) errors.push({ field: 'to', message: '받는 사람 메일 형식이 올바르지 않습니다' });
  }
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  if (subject === '') errors.push({ field: 'subject', message: '제목을 넣으세요' });
  else if (subject.length > HANDOFF_SUBJECT_MAX) errors.push({ field: 'subject', message: `제목은 ${HANDOFF_SUBJECT_MAX}자까지입니다` });
  const mailText = typeof body.text === 'string' ? body.text.trim() : '';
  if (mailText === '') errors.push({ field: 'text', message: '내용을 넣으세요' });
  else if (mailText.length > HANDOFF_TEXT_MAX) {
    errors.push({ field: 'text', message: `내용은 ${HANDOFF_TEXT_MAX.toLocaleString('ko-KR')}자까지입니다` });
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { month: month!, tp, periodId: p!, to, subject, text: mailText } };
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

/** 제목 처음 값 「[회사명] 2026년 3분기 부가세 신고 자료」 — 회사명이 없으면 대괄호 없이. */
export function handoffSubject(companyName: string | null, p: VatPeriod): string {
  const name = companyName?.trim();
  return `${name ? `[${name}] ` : ''}${handoffPeriodLabel(p)} 부가세 신고 자료`;
}

/** 내용 처음 값 「안녕하세요. 회사명 2026년 3분기 부가세 신고 자료입니다.」 — 회사명이 없으면 빼고. */
export function handoffMailText(companyName: string | null, p: VatPeriod): string {
  const name = companyName?.trim();
  return `안녕하세요. ${name ? `${name} ` : ''}${handoffPeriodLabel(p)} 부가세 신고 자료입니다.`;
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

/** 최종 발송 한 줄(224) — 고른 종류 · 신고 기간의 마지막 성공. */
export interface HandoffLastView {
  /** `YYYY-MM-DD HH:MM`. */
  sentAt: string;
  recipients: string[];
  cc: string | null;
  fileName: string;
  sentBy: string;
  sentByName: string | null;
}

/** 사람 — 이름 · 메일. 삐용에서 얻지 못한 칸은 null. */
export interface HandoffPerson {
  name: string | null;
  email: string | null;
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
  /** 미지정이 있는 가장 이른 달 — [항목지정] 이 그 달 · 구분 「미지정」으로 연다(부가세 조회와 같다). */
  unassignedFirstMonth: string | null;
  /** 세무 설정의 세무사 메일. */
  recipients: TaxEmail[];
  companyName: string | null;
  /** 제목 · 내용 처음 값(`handoffSubject` · `handoffMailText`). */
  subject: string | null;
  mailText: string | null;
  fileName: string | null;
  /** 메일 발송 설정(SMTP)이 있는가 — 없으면 [메일 보내기]를 막는다. */
  mailReady: boolean;
  /** 발송인 — 로그인 사람(삐용). 보내는 이름 · 답장 주소(Reply-To)로 쓴다. */
  sender: HandoffPerson;
  /** 참조 — 발송인이 대표자가 아니면 대표자(삐용). 서버가 정한다. 없으면 null. */
  cc: HandoffPerson | null;
  /** 고른 종류 · 신고 기간의 최종 발송 — 없으면 null(미발송). */
  last: HandoffLastView | null;
}

/** 보내기 결과 — 성공이면 덮어쓴 최종 발송, 메일 서버 실패면 사유(저장하지 않는다). */
export type TaxHandoffSendResult = { ok: true; last: HandoffLastView } | { ok: false; message: string };
