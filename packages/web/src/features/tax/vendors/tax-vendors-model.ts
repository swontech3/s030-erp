/**
 * 거래처(s050100020) 화면 모델 — 불러오기 · 고치기 · 주거래처/일반 · 합치기 · 지우기.
 *
 * ★ 브라우저는 Fastify 에 직접 붙지 않는다 — `/api/tax/vendors/**`(Next 중계)를 부른다.
 * ★ 본문 검사(번호 자리수 · 구분 코드 · 합치기 대상)는 **서버가 한다**(shared `tax-uploads.ts`). 화면은 칸별 오류를 그린다.
 *   예외는 사업자번호 끝자리 — 저장을 막지 않는 **경고**라 화면이 칠 때마다 shared 같은 함수로 미리 보인다(결정 3).
 */
import type { TaxFieldError, TaxVendorView, TaxVendorsResponse } from '@swonbiz/shared/domain/tax-uploads';

export type { TaxFieldError, TaxVendorView, TaxVendorsResponse };

export class TaxVendorError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errors: TaxFieldError[],
  ) {
    super(message);
    this.name = 'TaxVendorError';
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { cache: 'no-store', ...init });
  } catch {
    throw new TaxVendorError('서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요', 0, []);
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // 본문이 없을 수 있다
  }
  if (!res.ok) {
    const message = typeof body.message === 'string' ? body.message : '처리하지 못했습니다. 잠시 후 다시 시도해 주세요';
    throw new TaxVendorError(message, res.status, Array.isArray(body.errors) ? (body.errors as TaxFieldError[]) : []);
  }
  return body as unknown as T;
}

const json = (method: 'POST' | 'PATCH', body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const loadVendors = (month: string) =>
  call<TaxVendorsResponse>(`/api/tax/vendors?month=${encodeURIComponent(month)}`);

export const editVendor = (id: string, name: string, bizNo: string) =>
  call<{ vendor: TaxVendorView }>(`/api/tax/vendors/${encodeURIComponent(id)}`, json('PATCH', { name, bizNo }));

export const setVendorType = (ids: string[], tp: string) => call<{ updated: number }>('/api/tax/vendors/type', json('POST', { ids, tp }));

export const mergeVendors = (keepId: string, ids: string[]) =>
  call<{ vendor: TaxVendorView; movedRows: number }>('/api/tax/vendors/merge', json('POST', { keepId, ids }));

export const deleteVendors = (ids: string[]) => call<{ deleted: number }>('/api/tax/vendors/delete', json('POST', { ids }));
