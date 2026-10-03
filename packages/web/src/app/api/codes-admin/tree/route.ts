import { forwardGetJson } from '@/lib/forward';

/**
 * 코드 관리(s030100030)가 처음에 받는 것 — 분류 전체 + 파티션 전체.
 *
 * ★ 코드값(118행)은 따로 받는다(`[category]/[useTp]/lines`). 한 응답에 전부 실으면
 *   파티션을 옮길 때마다 다 다시 보낸다(센터 관리의 트리와 같은 이유).
 */
export async function GET() {
  return forwardGetJson('/codes-admin/tree');
}
