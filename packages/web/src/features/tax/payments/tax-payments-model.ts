/**
 * 세금 · 보험 납부 · 대출(s050300040) 화면 모델 — 불러오기 · 엑셀 주소(1-7).
 *
 * ★ 브라우저는 Fastify 에 직접 붙지 않는다 — `/api/tax/payments/**`(Next 중계)를 부른다.
 * ★ 주소 검사(달 · 탭 · 기간 · 파일 · 단체)는 **서버가 한다**(shared `tax-payments.ts`). 화면은 결과만 그린다.
 */
import { paymentsSearch, type PaymentsQuery, type TaxPaymentsResponse } from '@swonbiz/shared/domain/tax-payments';

export type { PaymentsQuery, TaxPaymentsResponse };

export class TaxPaymentsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'TaxPaymentsError';
  }
}

export async function loadPayments(q: PaymentsQuery): Promise<TaxPaymentsResponse> {
  let res: Response;
  try {
    res = await fetch(`/api/tax/payments${paymentsSearch(q)}`, { cache: 'no-store' });
  } catch {
    throw new TaxPaymentsError('서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요', 0);
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // 본문이 없을 수 있다
  }
  if (!res.ok) {
    throw new TaxPaymentsError(typeof body.message === 'string' ? body.message : '불러오지 못했습니다. 잠시 후 다시 시도해 주세요', res.status);
  }
  return body as unknown as TaxPaymentsResponse;
}

export const exportHref = (q: PaymentsQuery) => `/api/tax/payments/export${paymentsSearch(q)}`;
