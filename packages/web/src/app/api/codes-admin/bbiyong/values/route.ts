import type { NextRequest } from 'next/server';
import { forwardGetJson, forwardJson } from '@/lib/forward';

/** 삐용 주인 코드의 값 목록(사용 안 함 줄도) · 추가 · 수정(이름 · 순서만) — 2026-11-18. 고칠 수 있는지는 삐용이 정한다. */
export async function GET(request: NextRequest) {
  const q = new URLSearchParams();
  for (const k of ['category', 'cdTp']) {
    const v = request.nextUrl.searchParams.get(k);
    if (v !== null) q.set(k, v);
  }
  return forwardGetJson(`/codes-admin/bbiyong/values?${q.toString()}`);
}

export async function POST(request: NextRequest) {
  return forwardJson(request, '/codes-admin/bbiyong/values', 'POST');
}

export async function PATCH(request: NextRequest) {
  return forwardJson(request, '/codes-admin/bbiyong/values', 'PATCH');
}
