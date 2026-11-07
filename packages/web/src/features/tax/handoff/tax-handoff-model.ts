/**
 * 세무사 전달 서류(s050500010) 화면 모델 — 불러오기 · 보내기 · 엑셀 주소(1-9).
 *
 * ★ 브라우저는 Fastify 에 직접 붙지 않는다 — `/api/tax/handoff/**`(Next 중계)를 부른다.
 * ★ 시트 · 기간 · 제목은 **서버가 정한다**(shared `tax-handoff.ts` · api `routes/taxHandoff.ts`). 화면은 결과만 그린다.
 * ★ 메일은 서버가 엑셀을 만들어 첨부해 보낸다 — 화면은 받는 사람만 넘긴다.
 */
import { handoffSearch, type HandoffQuery, type TaxHandoffResponse, type TaxHandoffSendResult } from '@swonbiz/shared/domain/tax-handoff';

export type { HandoffQuery, TaxHandoffResponse, TaxHandoffSendResult };

export class TaxHandoffError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'TaxHandoffError';
  }
}

async function call<T>(url: string, init: RequestInit, fallback: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store', ...init });
  } catch {
    throw new TaxHandoffError('서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요', 0);
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // 본문이 없을 수 있다
  }
  if (!res.ok) throw new TaxHandoffError(typeof body.message === 'string' ? body.message : fallback, res.status);
  return body as unknown as T;
}

export const loadHandoff = (q: HandoffQuery) =>
  call<TaxHandoffResponse>(`/api/tax/handoff${handoffSearch(q)}`, {}, '불러오지 못했습니다. 잠시 후 다시 시도해 주세요');

export const sendHandoff = (q: HandoffQuery & { periodId: string }, to: readonly string[]) =>
  call<TaxHandoffSendResult>(
    '/api/tax/handoff/send',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month: q.month, tp: q.tp, period: q.periodId, to }) },
    '메일을 보내지 못했습니다',
  );

export const exportHref = (q: HandoffQuery) => `/api/tax/handoff/export${handoffSearch(q)}`;
