/**
 * 「받기」(삐용 → ERP) 공통 — **부르는 쪽 확인**(2026-10-23). 법무 회사 정보 · 입주사 회사 · 입주사 직원
 * 받기가 같은 규칙을 쓴다.
 *
 *   · 실어 온 삐용 토큰(`Authorization: Bearer`)으로 삐용 「내 메뉴」(`my-menus`)를 부르고, 목록에
 *     단체관리(`S021100010`)가 있을 때만 받는다. 토큰이 없거나 거절되면 403(연동규격 Q1 — 새 열쇠 ·
 *     새 삐용 API 를 만들지 않는다). 삐용에 못 붙으면 503
 *   · 모의 모드는 모의 계정의 `bbiyongMenus` 로 같은 확인(`MockBbiyongAuth.myMenus`)
 *
 * ★ 토큰을 본문보다 **먼저** 본다 — 확인 안 된 쪽에 칸 오류를 알려 주지 않는다.
 */
import { BbiyongUnavailableError, type MyMenusOutcome } from './types.ts';

/** 이 화면이 내 메뉴에 있어야 받는다 — 회사 등록 · 수정과 같은 단체관리 권한(연동규격 §2-2). */
export const RECEIVE_REQUIRED_MENU = 'S021100010';

export type CallerRefused =
  | { status: 403; body: { error: 'forbidden'; message: string } }
  | { status: 503; body: { error: 'bbiyong_unavailable'; message: string } };

const FORBIDDEN = '삐용 단체관리 권한이 있는 토큰이 아닙니다';

/** `Authorization: Bearer <토큰>` 에서 토큰. 없으면 null. */
export function bearerOf(header: string | undefined): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '');
  return m ? m[1]! : null;
}

/**
 * 부르는 쪽을 확인한다. 받아도 되면 null, 아니면 그대로 돌려줄 응답.
 * @param label 로그에 남길 받기 이름(예: 「법무 회사 정보 받기」)
 */
export async function checkReceiveCaller(
  authorization: string | undefined,
  myMenus: (accessToken: string) => Promise<MyMenusOutcome>,
  label: string,
): Promise<CallerRefused | null> {
  const token = bearerOf(authorization);
  if (token === null) return { status: 403, body: { error: 'forbidden', message: FORBIDDEN } };

  let menus: MyMenusOutcome;
  try {
    menus = await myMenus(token);
  } catch (err) {
    if (!(err instanceof BbiyongUnavailableError)) throw err;
    console.error(`[bbiyong] ${label} — 내 메뉴 확인 실패: ${err.message}`);
    return { status: 503, body: { error: 'bbiyong_unavailable', message: '삐용 권한 확인이 끝나지 않았습니다. 잠시 후 다시 보내 주세요' } };
  }
  if (menus.kind !== 'ok' || !menus.screens.includes(RECEIVE_REQUIRED_MENU)) {
    return { status: 403, body: { error: 'forbidden', message: FORBIDDEN } };
  }
  return null;
}
