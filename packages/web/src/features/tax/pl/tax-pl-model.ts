/**
 * 월별 손익(s050400010) 화면 모델 — 불러오기(1-8).
 *
 * ★ 브라우저는 Fastify 에 직접 붙지 않는다 — `/api/tax/pl`(Next 중계)를 부른다.
 * ★ 계산은 **서버가 한다**(shared `tax-pl.ts`). 화면은 결과만 그린다.
 */
import type { TaxPlResponse } from '@swonbiz/shared/domain/tax-pl';

export type { TaxPlResponse };

export class TaxPlError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'TaxPlError';
  }
}

export async function loadPl(month: string): Promise<TaxPlResponse> {
  let res: Response;
  try {
    res = await fetch(`/api/tax/pl?month=${encodeURIComponent(month)}`, { cache: 'no-store' });
  } catch {
    throw new TaxPlError('서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요', 0);
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // 본문이 없을 수 있다
  }
  if (!res.ok) {
    throw new TaxPlError(typeof body.message === 'string' ? body.message : '불러오지 못했습니다. 잠시 후 다시 시도해 주세요', res.status);
  }
  return body as unknown as TaxPlResponse;
}
