import type { NextRequest } from 'next/server';
import { forwardGetJson, forwardJson } from '@/lib/forward';

/**
 * 사업목적 카탈로그 목록 — `GET /legal/biz-purposes` (Fastify) 로 넘긴다. 조건(`q` · `includeInactive`)은 주소 그대로.
 *
 * ★ 이 홉은 판정하지 않는다. 로그인한 모든 사용자가 부른다(030 관리 화면 · 법인변경 상세의 고르기 팝업).
 *   회사 세션은 사용 중인 줄만 받는다 — Fastify 와 041 RLS 가 가른다.
 */
export async function GET(request: NextRequest) {
  const qs = request.nextUrl.searchParams.toString();
  return forwardGetJson(`/legal/biz-purposes${qs ? `?${qs}` : ''}`);
}

/** 추가 `{ text }` — 운영사만(회사는 Fastify 가 403). 같은 문구는 409. 성공은 201 `{ item }`. */
export async function POST(request: NextRequest) {
  return forwardJson(request, '/legal/biz-purposes', 'POST');
}
