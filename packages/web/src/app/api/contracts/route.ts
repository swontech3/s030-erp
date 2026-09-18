import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward';

/**
 * 계약 등록 — `POST /contracts`(4-3)로 넘긴다.
 *
 * 화면이 계산한 금액을 그대로 보내도 **서버가 다시 계산한다.** 그게 설계다
 * (`buildContractWrite` → `reconcileRowAmounts`). 어긋나면 서버 값이 저장되고
 * 경고가 로그에 남는다.
 */
export async function POST(request: NextRequest) {
  return forwardJson(request, '/contracts', 'POST');
}
