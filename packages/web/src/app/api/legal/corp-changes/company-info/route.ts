import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward';

/**
 * 비입주사 법무 회사 정보 저장 — **단체 기준**, 건과 무관(회사 단위). 회사당 1행, 없으면 만든다.
 * 임시 모드(건이 아직 없음)에서도 바로 저장된다(결정 2026-10-10).
 *
 * ★ 이 홉은 판정하지 않는다. 회사 세션이 남의 단체를 적으면 403, 입주사 단체면 409 — Fastify 가 낸다.
 * ★ `[id]` 보다 고정 경로가 먼저 잡힌다 — `company-info` 라는 건 ID 로 새지 않는다.
 */
export async function PUT(request: NextRequest) {
  return forwardJson(request, '/legal/corp-changes/company-info', 'PUT');
}
