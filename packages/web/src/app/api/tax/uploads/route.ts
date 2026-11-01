import type { NextRequest } from 'next/server';
import { forwardGetJson, forwardUpload } from '@/lib/forward';
import { uploadQuery } from './uploadQuery';

/**
 * 세무 자료 올리기 — `GET /tax/uploads?month=` · `POST /tax/uploads?kind=` (Fastify) 로 넘긴다.
 * ★ 이 홉은 판정하지 않는다. 단체 범위 · 달 · 종류 · 엑셀 검사는 전부 Fastify 가 본다.
 * ★ 올리기 본문은 **엑셀 바이트 그대로**이고 원래 이름은 `X-File-Name`(URI 인코딩)으로 온다 — 기존 `forwardUpload` 를 쓴다.
 */
export async function GET(request: NextRequest) {
  const month = request.nextUrl.searchParams.get('month') ?? '';
  return forwardGetJson(`/tax/uploads?month=${encodeURIComponent(month)}`);
}

/** ★ 은행(1-5)은 `&account=&fileTp=` 도 그대로 넘긴다 — 판정은 Fastify 가 한다. */
export async function POST(request: NextRequest) {
  return forwardUpload(request, `/tax/uploads?${uploadQuery(request)}`);
}
