import 'server-only';
import { headers } from 'next/headers';
import { isAppUserAgent } from '@swonbiz/shared/domain/app-client';

/**
 * 지금 요청이 앱(s02-app) 웹뷰에서 왔는가 — 앱 1단계 5-나 (대표 지시 2026-11-07)
 *
 * ★ **서버에서** UA 를 읽는다 — 그래서 레이아웃이 첫 렌더부터 셸을 감춘 채로 그린다.
 *   iframe 판정(`embeddedNow`)처럼 마운트 뒤에 알면 한 번 그렸다가 숨기는 깜빡임이 생긴다.
 * ★★ 화면 모양에만 쓴다 — 권한 판정에 쓰지 않는다(판정 규칙은 `@swonbiz/shared/domain/app-client`).
 */
export async function isInApp(): Promise<boolean> {
  const h = await headers();
  return isAppUserAgent(h.get('user-agent'));
}
