/**
 * 부가세 조회(s050400020) 화면 모델 — 불러오기 · 엑셀 주소(1-8).
 *
 * ★ 브라우저는 Fastify 에 직접 붙지 않는다 — `/api/tax/vat/**`(Next 중계)를 부른다.
 * ★ 신고 기간 · 계산은 **서버가 한다**(shared `tax-vat.ts`). 화면은 결과만 그린다.
 */
import { vatSearch, type TaxVatResponse, type VatQuery } from '@swonbiz/shared/domain/tax-vat';

export type { TaxVatResponse, VatQuery };

export class TaxVatError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'TaxVatError';
  }
}

export async function loadVat(q: VatQuery): Promise<TaxVatResponse> {
  let res: Response;
  try {
    res = await fetch(`/api/tax/vat${vatSearch(q)}`, { cache: 'no-store' });
  } catch {
    throw new TaxVatError('서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요', 0);
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // 본문이 없을 수 있다
  }
  if (!res.ok) {
    throw new TaxVatError(typeof body.message === 'string' ? body.message : '불러오지 못했습니다. 잠시 후 다시 시도해 주세요', res.status);
  }
  return body as unknown as TaxVatResponse;
}

export const exportHref = (q: VatQuery) => `/api/tax/vat/export${vatSearch(q)}`;
