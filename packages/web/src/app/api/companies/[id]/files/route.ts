import type { NextRequest } from 'next/server';
import { forwardGetJson, forwardUpload } from '@/lib/forward';

/**
 * 첨부 서류 — 목록과 업로드 (CONT-17).
 *
 * ★ 운영사 전용이다. 입주사 세션이면 Fastify 가 403 을 낸다 — **이 홉은 판정하지 않는다.**
 *   여기서 한 번 더 판정하면 규칙이 두 벌이 되고, 둘이 갈리는 순간 한쪽만 막는다.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardGetJson(`/companies/${encodeURIComponent(id)}/files`);
}

/**
 * 업로드. 본문은 **파일 바이트 그대로**이고, 종류는 `?purpose=`, 원본 이름은
 * `X-File-Name` 헤더로 온다.
 *
 * ★ 같은 종류가 이미 있으면 **바꾼다**(옛 실물까지 지운다). 그 순서는 Fastify 의
 *   `routes/files.ts` 머리말에 적혀 있다.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const purpose = request.nextUrl.searchParams.get('purpose') ?? '';
  return forwardUpload(
    request,
    `/companies/${encodeURIComponent(id)}/files?purpose=${encodeURIComponent(purpose)}`,
  );
}
