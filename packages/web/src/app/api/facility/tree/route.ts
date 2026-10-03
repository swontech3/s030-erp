import { forwardGetJson } from '@/lib/forward';

/**
 * 센터 관리(s030100010)가 처음에 받는 것 — 건물 · 층 · 코드.
 *
 * ★ 호실·회의실은 층을 고른 뒤 따로 받는다(`floors/[id]/spaces`·`.../facilities`).
 *   한 응답에 전부 실으면 층을 옮길 때마다 72실을 다시 보낸다.
 */
export async function GET() {
  return forwardGetJson('/facility/tree');
}
