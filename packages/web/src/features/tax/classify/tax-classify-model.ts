/**
 * 거래 분류(s050300010) 화면 모델 — 불러오기 · 확정 · 엑셀 주소.
 *
 * ★ 브라우저는 Fastify 에 직접 붙지 않는다 — `/api/tax/classify/**`(Next 중계)를 부른다.
 * ★ 주소 · 본문 검사(달 · 기간 · 항목 코드 · 매출 막기 · 단체)는 **서버가 한다**(shared `tax-classify.ts`). 화면은 결과만 그린다.
 */
import { classifySearch, type ClassifyConfirmRow, type ClassifyQuery, type TaxClassifyResponse } from '@swonbiz/shared/domain/tax-classify';
import type { TaxFieldError } from '@swonbiz/shared/domain/tax-uploads';

export type { ClassifyQuery, TaxClassifyResponse };

export class TaxClassifyError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errors: TaxFieldError[],
  ) {
    super(message);
    this.name = 'TaxClassifyError';
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { cache: 'no-store', ...init });
  } catch {
    throw new TaxClassifyError('서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요', 0, []);
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // 본문이 없을 수 있다
  }
  if (!res.ok) {
    const message = typeof body.message === 'string' ? body.message : '처리하지 못했습니다. 잠시 후 다시 시도해 주세요';
    throw new TaxClassifyError(message, res.status, Array.isArray(body.errors) ? (body.errors as TaxFieldError[]) : []);
  }
  return body as unknown as T;
}

export const loadClassify = (q: ClassifyQuery) => call<TaxClassifyResponse>(`/api/tax/classify${classifySearch(q)}`);

export const confirmRows = (rows: ClassifyConfirmRow[]) =>
  call<{ confirmed: number }>('/api/tax/classify/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows }),
  });

export const exportHref = (q: ClassifyQuery) => `/api/tax/classify/export${classifySearch(q)}`;

/** `2026-09-25` → 「09.25」(시안 날짜 칸). */
export const shortDate = (date: string): string => `${date.slice(5, 7)}.${date.slice(8, 10)}`;
