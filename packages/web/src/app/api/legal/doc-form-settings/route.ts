import type { NextRequest } from 'next/server';
import { forwardGetJson, forwardJson } from '@/lib/forward';

/**
 * 등기 설정 목록 — `GET /legal/doc-form-settings` (Fastify) 로 넘긴다.
 * ★ 이 홉은 판정하지 않는다. 운영사만 — 회사 세션은 Fastify 가 403.
 */
export async function GET() {
  return forwardGetJson('/legal/doc-form-settings');
}

/** 한 줄 저장(upsert) — 운영사만. 저장 규칙은 shared `doc-form-setting.ts`. 성공은 200 `{ item }`. */
export async function PUT(request: NextRequest) {
  return forwardJson(request, '/legal/doc-form-settings', 'PUT');
}
