/**
 * 자료 올리기(s050200010) 화면 모델 — 불러오기 · 미리보기 · 올리기 · 지우기 전 확인 · 지우기.
 *
 * ★ 브라우저는 Fastify 에 직접 붙지 않는다 — `/api/tax/uploads/**`(Next 중계)를 부른다.
 * ★ 엑셀 검사(형식 · 양식 · 매입/매출 · 줄 거르기)는 **서버가 한다**(shared `tax-uploads.ts`). 화면은 결과만 그린다.
 * ★ 엑셀은 바이트 그대로 보낸다 — 본문 형식은 확장자로 정하고(xls · xlsx), 원래 이름은 `X-File-Name`(URI 인코딩).
 */
import type {
  TaxUploadDeleteResult,
  TaxUploadPreview,
  TaxUploadResult,
  TaxUploadsResponse,
} from '@swonbiz/shared/domain/tax-uploads';

export type { TaxUploadDeleteResult, TaxUploadPreview, TaxUploadResult, TaxUploadsResponse };

/** 1-2 에서 올릴 수 있는 자료 종류(TAX_KIND 코드값). 나머지 카드는 「준비 중」. */
export const KIND_INVOICE = 'INVOICE';

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

/** 고른 파일의 본문 형식 — .xls · .xlsx 가 아니면 null(결과서 「.xlsx · .xls · 한 번에 한 파일」). */
export function spreadsheetMimeOf(fileName: string): string | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  return MIME_BY_EXT[ext] ?? null;
}

const fileInit = (file: File, mime: string): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': mime, 'x-file-name': encodeURIComponent(file.name) },
  body: file,
});

export const loadUploads = (month: string) =>
  call<TaxUploadsResponse>(`/api/tax/uploads?month=${encodeURIComponent(month)}`);

export const previewUpload = (kind: string, file: File, mime: string) =>
  call<TaxUploadPreview>(`/api/tax/uploads/preview?kind=${encodeURIComponent(kind)}`, fileInit(file, mime));

export const uploadFile = (kind: string, file: File, mime: string) =>
  call<TaxUploadResult>(`/api/tax/uploads?kind=${encodeURIComponent(kind)}`, fileInit(file, mime));

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

/** 금액 — 쉼표. */
export const won = (n: number): string => n.toLocaleString('ko-KR');
