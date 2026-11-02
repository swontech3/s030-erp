/**
 * 자료 올리기(s050200010) 화면 모델 — 불러오기 · 미리보기 · 올리기 · 지우기 전 확인 · 지우기.
 *
 * ★ 브라우저는 Fastify 에 직접 붙지 않는다 — `/api/tax/uploads/**`(Next 중계)를 부른다.
 * ★ 엑셀 검사(형식 · 양식 · 매입/매출 · 줄 거르기)는 **서버가 한다**(shared `tax-uploads.ts`). 화면은 결과만 그린다.
 * ★ 엑셀은 바이트 그대로 보낸다 — 본문 형식은 확장자로 정하고(xls · xlsx · 4대보험만 csv), 원래 이름은 `X-File-Name`(URI 인코딩).
 */
import { tabOfFileKind } from '@swonbiz/shared/domain/tax-payments';
import type {
  TaxUploadDeleteResult,
  TaxUploadPreview,
  TaxUploadResult,
  TaxUploadsResponse,
} from '@swonbiz/shared/domain/tax-uploads';

export type { TaxUploadDeleteResult, TaxUploadPreview, TaxUploadResult, TaxUploadsResponse };

/** 자료 종류(TAX_KIND 코드값). 올릴 수 있는지는 서버가 카드마다 준다(`cards[].enabled`). */
export const KIND_INVOICE = 'INVOICE';
export const KIND_CASH = 'CASH';
/** 은행 입출금(1-5) — 올릴 때 계좌 · 파일 종류(거래내역 · 이체 내역)를 함께 보낸다. */
export const KIND_BANK = 'BANK';
export const BANK_FILE_TXN = 'TXN';
export const BANK_FILE_XFER = 'XFER';

/** 4대보험(1-6) — 올릴 때 보험 종류(NP · HI · EI · IA) · 고지 연월을 함께 보낸다. 본문은 CSV 도 된다. */
export const KIND_SOCIAL = 'SOCIAL';
export const KIND_LOAN = 'LOAN';
/** 국세 · 지방세(1-6) — 미리보기 표가 같다. */
export const PAY_KINDS: readonly string[] = ['NTAX', 'LTAX'];

/** 4대보험 파일을 올릴 때 고른 것 — 판정은 서버가 한다. */
export interface SocialChoice {
  insTp: string;
  noticeMonth: string;
}

/** 은행 파일을 올릴 때 고른 것 — 계좌는 세무 설정 계좌 id(서버가 그 단체 것인지 본다). */
export interface BankChoice {
  accountId: string;
  fileTp: string;
}
/** [보기]로 항목 지정 「이번 달 자료 전체」에 보낼 수 있는 파일 — 계산서 · 카드 · 현금(1-4). */
export const VIEWABLE_KINDS: readonly string[] = [KIND_INVOICE, 'CARD', KIND_CASH];

/**
 * [보기]가 갈 주소 — 계산서 · 카드 · 현금은 항목 지정 「이번 달 자료 전체」, 국세 · 지방세 · 4대보험 · 대출은
 * 세금 · 보험 납부 · 대출(1-7 — 탭은 서버가 파일 종류로 정한다). ★ 은행은 받을 화면(은행 짝 맞추기)이 없어 null(막는다).
 */
export function viewHrefOf(kind: string, month: string, fileId: string): string | null {
  const file = encodeURIComponent(fileId);
  if (VIEWABLE_KINDS.includes(kind)) return `/tax/classify?month=${month}&view=all&file=${file}`;
  if (tabOfFileKind(kind)) return `/tax/payments?month=${month}&file=${file}`;
  return null;
}

/** 표준 양식 내려받기 주소 — 지금은 현금 경비뿐(1-4). */
export const templateHref = (kind: string) => `/api/tax/uploads/template?kind=${encodeURIComponent(kind)}`;

/** 불러오기 · 올리기 실패. `status` 409 = 같은 파일. */
export class TaxUploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = 'TaxUploadError';
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { cache: 'no-store', ...init });
  } catch {
    throw new TaxUploadError('서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요', 0, null);
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // 본문이 없을 수 있다
  }
  if (!res.ok) {
    const message = typeof body.message === 'string' ? body.message : '처리하지 못했습니다. 잠시 후 다시 시도해 주세요';
    throw new TaxUploadError(message, res.status, typeof body.error === 'string' ? body.error : null);
  }
  return body as unknown as T;
}

const MIME_BY_EXT: Record<string, string> = {
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const CSV_MIME = 'text/csv';

/**
 * 고른 파일의 본문 형식 — .xls · .xlsx 가 아니면 null(결과서 「.xlsx · .xls · 한 번에 한 파일」).
 * `allowCsv` = 4대보험(1-6) — 통합징수포털 파일이 CSV 다.
 */
export function spreadsheetMimeOf(fileName: string, allowCsv = false): string | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (allowCsv && ext === 'csv') return CSV_MIME;
  return MIME_BY_EXT[ext] ?? null;
}

const fileInit = (file: File, mime: string): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': mime, 'x-file-name': encodeURIComponent(file.name) },
  body: file,
});

export const loadUploads = (month: string) =>
  call<TaxUploadsResponse>(`/api/tax/uploads?month=${encodeURIComponent(month)}`);

/** `?kind=` (+ 은행이면 `&account=&fileTp=`, 4대보험이면 `&insTp=&noticeMonth=`). */
const kindQuery = (kind: string, bank: BankChoice | null, social: SocialChoice | null) =>
  `kind=${encodeURIComponent(kind)}` +
  (bank ? `&account=${encodeURIComponent(bank.accountId)}&fileTp=${encodeURIComponent(bank.fileTp)}` : '') +
  (social ? `&insTp=${encodeURIComponent(social.insTp)}&noticeMonth=${encodeURIComponent(social.noticeMonth)}` : '');

export const previewUpload = (kind: string, file: File, mime: string, bank: BankChoice | null = null, social: SocialChoice | null = null) =>
  call<TaxUploadPreview>(`/api/tax/uploads/preview?${kindQuery(kind, bank, social)}`, fileInit(file, mime));

export const uploadFile = (kind: string, file: File, mime: string, bank: BankChoice | null = null, social: SocialChoice | null = null) =>
  call<TaxUploadResult>(`/api/tax/uploads?${kindQuery(kind, bank, social)}`, fileInit(file, mime));

const idsInit = (ids: string[]): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ids }),
});

/** 지우기 전 확인 — 지우기와 같은 계산(빠질 줄 · 겹쳤을 수 있는 파일), 지우지 않는다. */
export const checkDelete = (ids: string[]) => call<TaxUploadDeleteResult>('/api/tax/uploads/delete-check', idsInit(ids));

export const deleteFiles = (ids: string[]) => call<TaxUploadDeleteResult>('/api/tax/uploads/delete', idsInit(ids));

/** 「10.02 14:08」 — 올린 때(결과서 S05-02 4). */
export function shortStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 「09.01 09:10」 — 은행 거래일시(`YYYY-MM-DD HH:MM:SS`)를 미리보기 칸에. */
export const shortDateTime = (at: string): string => `${at.slice(5, 7)}.${at.slice(8, 10)} ${at.slice(11, 16)}`;

/** 금액 — 쉼표. */
export const won = (n: number): string => n.toLocaleString('ko-KR');
