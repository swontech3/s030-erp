/**
 * 「받기」(삐용 → ERP) 공통 — **부르는 쪽 확인**(2026-10-23, 넓힘 2026-10-25). 법무 회사 정보 · 입주사 회사 ·
 * 입주사 직원 받기가 같은 규칙을 쓴다.
 *
 *   · 실어 온 삐용 토큰(`Authorization: Bearer`)으로 삐용 「내 메뉴」(`my-menus`)를 부른다.
 *     목록에 단체관리(`S021100010`)가 있으면 **운영사** — 받는다
 *   · 운영사가 아니면 「지금 계정의 단체」(`my-orgs` 의 `current:true` 줄)를 부르고, 그 단체가
 *     **대상 회사의 단체**와 같을 때만 받는다. 대상은 받기마다 다르다(본문 `orgId` · 직원이 속한 회사)
 *   · 그 밖(토큰 없음 · 거절 · 대상을 모름 · 다른 회사)은 403(연동규격 Q1 — 새 열쇠 · 새 삐용 API 를
 *     만들지 않는다). 삐용에 못 붙으면 503
 *   · 모의 모드는 모의 계정의 `bbiyongMenus` · `orgId` 로 같은 확인(`MockBbiyongAuth.myMenus` · `myOrg`)
 *
 * ★ 토큰을 본문보다 **먼저** 본다 — 확인 안 된 쪽에 칸 오류를 알려 주지 않는다. 대상은 운영사가 아닐 때만
 *   묻는다(`targetOrgId` 는 그때 부른다).
 */
import { BbiyongUnavailableError, type MyMenusOutcome, type MyOrgOutcome } from './types.ts';

/** 이 화면이 내 메뉴에 있으면 운영사로 받는다 — 회사 등록 · 수정과 같은 단체관리 권한(연동규격 §2-2). */
export const RECEIVE_REQUIRED_MENU = 'S021100010';

/** 부르는 쪽 확인에 쓰는 삐용 — 받은 토큰 그대로(`BbiyongAuth.myMenus` · `BbiyongAuth.myOrg`). */
export interface ReceiveCallerDeps {
  myMenus(accessToken: string): Promise<MyMenusOutcome>;
  myOrg(accessToken: string): Promise<MyOrgOutcome>;
}

export type CallerRefused =
  | { status: 403; body: { error: 'forbidden'; message: string } }
  | { status: 503; body: { error: 'bbiyong_unavailable'; message: string } };

const FORBIDDEN = '운영사이거나 그 회사의 토큰이 아닙니다';

const REFUSED_403: CallerRefused = { status: 403, body: { error: 'forbidden', message: FORBIDDEN } };
const REFUSED_503: CallerRefused = {
  status: 503,
  body: { error: 'bbiyong_unavailable', message: '삐용 권한 확인이 끝나지 않았습니다. 잠시 후 다시 보내 주세요' },
};

/** `Authorization: Bearer <토큰>` 에서 토큰. 없으면 null. */
export function bearerOf(header: string | undefined): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '');
  return m ? m[1]! : null;
}

/**
 * 부르는 쪽을 확인한다. 받아도 되면 null, 아니면 그대로 돌려줄 응답.
 * @param targetOrgId 대상 회사의 삐용 단체 ID. 모르면 null(→ 운영사만 받는다)
 * @param label 로그에 남길 받기 이름(예: 「법무 회사 정보 받기」)
 */
export async function checkReceiveCaller(
  authorization: string | undefined,
  deps: ReceiveCallerDeps,
  targetOrgId: () => Promise<number | null>,
  label: string,
): Promise<CallerRefused | null> {
  const token = bearerOf(authorization);
  if (token === null) return REFUSED_403;

  let menus: MyMenusOutcome;
  let org: MyOrgOutcome;
  try {
    menus = await deps.myMenus(token);
    if (menus.kind !== 'ok') return REFUSED_403;
    if (menus.screens.includes(RECEIVE_REQUIRED_MENU)) return null;
    org = await deps.myOrg(token);
  } catch (err) {
    if (!(err instanceof BbiyongUnavailableError)) throw err;
    console.error(`[bbiyong] ${label} — 부르는 쪽 확인 실패: ${err.message}`);
    return REFUSED_503;
  }
  if (org.kind !== 'ok') return REFUSED_403;

  const target = await targetOrgId();
  return target !== null && target === org.orgId ? null : REFUSED_403;
}
