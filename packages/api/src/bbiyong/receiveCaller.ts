/**
 * 「받기」(삐용 → ERP) 공통 — **부르는 쪽 확인**(2026-10-23, 넓힘 2026-10-25). 법무 회사 정보 · 입주사 회사 ·
 * 입주사 직원 받기가 같은 규칙을 쓴다.
 *
 *   · 실어 온 삐용 토큰(`Authorization: Bearer`)으로 삐용 「내 메뉴」(`my-menus`)를 부른다.
 *     공통 코드 `BBIYONG_EDIT_GRANT` 의 `OPERATOR` 줄 이름(`화면코드:키`, 예 `S021100010:F002` — 단체관리의 수정 키)이
 *     내 메뉴에 **화면과 키 둘 다** 있으면 **운영사** — 받는다(좁힘 2026-11-08, 삐용팀 요청).
 *     단체관리가 「보기」뿐이면 · 키 없는 옛 문자열 모양이면 · 코드 줄이 없거나 모양이 틀리면 운영사로 보지 않는다
 *     (안전한 쪽) — 다음 규칙으로 넘어간다. 회사 조회(org-lookup)는 이 규칙을 쓰지 않는다(단체관리만 있으면 된다)
 *   · 운영사가 아니면 「지금 계정의 단체」(`my-orgs` 의 `current:true` 줄)를 부르고, 그 단체가
 *     **대상 회사의 단체**와 같을 때만 받는다. 대상은 받기마다 다르다(본문 `orgId` · 직원이 속한 회사).
 *     대상을 고를 때 내 메뉴(키 포함)를 넘긴다 — 직원 받기는 직원이 ERP 에 없을 때 키를 본다(2026-10-25)
 *   · 그 밖(토큰 없음 · 거절 · 대상을 모름 · 다른 회사)은 403(연동규격 Q1 — 새 열쇠 · 새 삐용 API 를
 *     만들지 않는다). 삐용에 못 붙으면 503
 *   · 모의 모드는 모의 계정의 `bbiyongMenus` · `orgId` 로 같은 확인(`MockBbiyongAuth.myMenus` · `myOrg`)
 *
 * ★ 토큰을 본문보다 **먼저** 본다 — 확인 안 된 쪽에 칸 오류를 알려 주지 않는다. 대상은 운영사가 아닐 때만
 *   묻는다(`targetOrgId` 는 그때 부른다).
 */
import { BbiyongUnavailableError, type MyMenusOutcome, type MyOrgOutcome } from './types.ts';
import { hasEditGrant, parseEditGrant } from '../legal/companyEditGrant.ts';

/** 부르는 쪽 확인에 쓰는 삐용 — 받은 토큰 그대로(`BbiyongAuth.myMenus` · `BbiyongAuth.myOrg`) — 와 운영사 키. */
export interface ReceiveCallerDeps {
  myMenus(accessToken: string): Promise<MyMenusOutcome>;
  myOrg(accessToken: string): Promise<MyOrgOutcome>;
  /** 공통 코드 `BBIYONG_EDIT_GRANT` 의 `OPERATOR` 줄 이름(`화면코드:키`). 없으면 null(→ 아무도 운영사가 아니다). */
  operatorGrantName(): Promise<string | null>;
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
 * @param targetOrgId 대상 회사의 삐용 단체 ID. 모르면 null(→ 운영사만 받는다). 받는 값은 이 토큰의 내 메뉴
 * @param label 로그에 남길 받기 이름(예: 「법무 회사 정보 받기」)
 */
export async function checkReceiveCaller(
  authorization: string | undefined,
  deps: ReceiveCallerDeps,
  targetOrgId: (menus: MyMenusOutcome) => Promise<number | null>,
  label: string,
): Promise<CallerRefused | null> {
  const token = bearerOf(authorization);
  if (token === null) return REFUSED_403;

  let menus: MyMenusOutcome;
  let org: MyOrgOutcome;
  try {
    menus = await deps.myMenus(token);
    if (menus.kind !== 'ok') return REFUSED_403;
    const operator = parseEditGrant(await deps.operatorGrantName());
    if (operator !== null && hasEditGrant(menus, operator)) return null;
    org = await deps.myOrg(token);
  } catch (err) {
    if (!(err instanceof BbiyongUnavailableError)) throw err;
    console.error(`[bbiyong] ${label} — 부르는 쪽 확인 실패: ${err.message}`);
    return REFUSED_503;
  }
  if (org.kind !== 'ok') return REFUSED_403;

  const target = await targetOrgId(menus);
  return target !== null && target === org.orgId ? null : REFUSED_403;
}
