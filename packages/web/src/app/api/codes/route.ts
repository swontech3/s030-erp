import { forwardGetJson } from '@/lib/forward';

/**
 * 계약 폼과 같은 코드 목록(`GET /codes`, 운영사 전용) — 화면이 브라우저에서 읽을 때.
 * 지금은 정산서가 입금 계좌(공통 코드 `DEPOSIT_ACCT`, 값은 설명 칸)를 읽으려고 부른다(2026-11-08).
 */
export async function GET() {
  return forwardGetJson('/codes');
}
