import { forwardGetJson } from '@/lib/forward';

/** 삐용 주인 코드의 종류 목록(2026-11-18) — 삐용 화면 API 로 넘긴다. 볼 수 있는지는 삐용이 정한다. */
export async function GET() {
  return forwardGetJson('/codes-admin/bbiyong/types');
}
