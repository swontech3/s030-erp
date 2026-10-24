import type { NextRequest } from 'next/server';
import { forwardGetJson, forwardJson } from '@/lib/forward';

/**
 * 표양식 관리(s030100020) — 양식 목록 + 종류 선택지(코드 `LAW_DOC_TP`).
 *
 * ★ 정의(JSON)는 싣지 않는다 — 고른 양식만 `[id]` 로 받는다.
 */
export async function GET() {
  return forwardGetJson('/form-templates');
}

/** 양식 등록 — 편집 페이지(`/forms/new`)의 첫 [저장]. ★ 정의는 API 가 검사한다. */
export async function POST(request: NextRequest) {
  return forwardJson(request, '/form-templates', 'POST');
}
