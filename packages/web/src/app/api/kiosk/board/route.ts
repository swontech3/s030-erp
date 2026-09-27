import { type NextRequest } from 'next/server';
import { forwardPublicGetJson } from '@/lib/forward';

/**
 * 회의실 현황판 한 판 (s0300500060) — `GET /kiosk/board?room=…`.
 *
 * ★★ **인증이 없다.** 벽에 걸린 태블릿이 30초마다 부르는 유일한 주소다.
 *    응답에는 시각과 회의실 이름뿐이다 — 회사명·제목·예약자는 서버에서부터 오지 않는다
 *    (`api/src/routes/kiosk.ts` 머리말 · 026).
 * ★ 캐시하지 않는다. 30초 폴링이 캐시된 판을 받으면 취소된 예약이 남는다.
 */
export async function GET(request: NextRequest) {
  const room = request.nextUrl.searchParams.get('room') ?? '';
  return forwardPublicGetJson(`/kiosk/board?room=${encodeURIComponent(room)}`);
}
