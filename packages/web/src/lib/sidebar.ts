import { SCREENS, type ScreenId, type ScreenMeta } from '@swonbiz/shared';
import type { IconName } from '@/components/ds';

/**
 * 사이드바 조립 — **삐용이 준 화면 목록만 그린다**(ACL-07′, 지시문 2-9).
 *
 * ★ ERP 가 역할을 보고 거르지 않는다. 이 파일에는 `org_tp` 도 `role` 도 없다.
 *   입력은 화면 ID 배열 하나이고, 하는 일은 그것을 라우트·이름·아이콘으로 해석하는 것뿐이다.
 *   판정이 여기로 새어 들어오면 진실원이 둘이 된다.
 */

/**
 * 화면 ID → 사이드바 아이콘.
 *
 * ★ `Record<ScreenId, ...>` 라 **screens.ts 에 화면을 추가하면 여기도 컴파일 에러**가 난다.
 *   빠뜨린 화면이 아이콘 없이 조용히 렌더되는 것보다 낫다.
 * ★ `null` 은 "사이드바에 뜨지 않는 화면"이라는 뜻이다 — 인증 화면(000 로그인·접근권한없음),
 *   공개 화면(050), 라우트가 없는 셸이 여기 해당한다. 삐용이 실수로 이 화면들을 목록에
 *   담아 보내도 사이드바에는 나타나지 않는다.
 */
const SIDEBAR_ICONS: Record<ScreenId, IconName | null> = {
  s030000010: null, // 로그인 — 셸 밖
  s030000050: null, // ERP 셸 자신 — 라우트 없음
  s030000060: 'layout-dashboard',
  s030000070: 'settings',
  s030000080: null, // 접근 권한 없음 — 셸 밖
  s030100010: 'door-open',
  s030100020: 'file-text', // 표양식 관리 — 서류 양식
  // ★ 코드 관리 — 기준자료라 톱니다. 설정(s030000070)과 같은 아이콘이지만 그쪽은
  //   운영사 설정이고 이쪽은 ERP 전체가 읽는 코드다. 아이콘 목록에 더 맞는 것이 없다.
  s030100030: 'settings',
  s030200010: 'building-2',
  s030200020: null, // 입주사 상세 — 목록에서 들어간다. 사이드바 항목이 아니다
  s030200030: 'file-pen-line',
  s030200040: null, // 계약 폼 — 상세에서 들어간다
  s030200070: 'receipt',
  s030200080: 'message-square-text',
  s030500010: null, // 랜딩 — 공개 화면
  s030500060: null, // 회의실 현황판 — 공개 화면(키오스크)
  s030500070: null, // 문의상담 목록 — 공개 화면
  s030500070p1: null, // 문의하기 — 공개 화면
  s030500070p2: null, // 문의 보기 — 공개 화면
  s030600010: 'calendar-check',
  // ★ 법무 서비스(s04). 저울 — 법무를 가리키는 아이콘이 이것 하나다.
  s040200010: 'scale', // 법인변경
  s040200011: null, // 법인변경 상세 — 목록에서 들어간다
};

export interface NavItem {
  screenId: ScreenId;
  route: string;
  name: string;
  icon: IconName;
}

/**
 * 삐용 화면 목록 → 사이드바 항목.
 *
 * 정렬은 **screens.ts 의 선언 순서**를 따른다. 삐용 응답 순서를 그대로 쓰면 응답이
 * 바뀔 때마다 메뉴 순서가 흔들린다 — 순서는 ERP 화면 체계(그룹 000→060)의 문제다.
 * 모르는 화면 ID(삐용에만 있고 ERP 에 없는 것)는 조용히 버린다.
 */
export function buildNavItems(screens: readonly string[]): NavItem[] {
  const granted = new Set(screens);
  const items: NavItem[] = [];

  for (const [id, meta] of Object.entries(SCREENS) as [ScreenId, ScreenMeta][]) {
    if (!granted.has(id)) continue; // Set 이라 프로토타입 키('toString')는 애초에 못 들어온다
    const icon = SIDEBAR_ICONS[id];
    if (!icon || meta.route === null) continue;
    items.push({ screenId: id, route: meta.route, name: meta.name, icon });
  }
  return items;
}

/** 현재 경로에 해당하는 화면 이름. 헤더 제목에 쓴다. */
export function screenNameForPath(pathname: string): string {
  for (const [id, meta] of Object.entries(SCREENS) as [ScreenId, ScreenMeta][]) {
    if (meta.route === pathname) return SCREENS[id].name;
  }
  return '';
}

/**
 * 사이드바 접힘 상태 쿠키.
 *
 * ★★ localStorage 가 아니라 쿠키인 이유 — 서버가 첫 렌더에 읽어야 하기 때문이다.
 *    localStorage 는 서버가 못 읽어서 첫 렌더가 항상 "펼침"으로 나가고, 브라우저가
 *    붙으면서 "접힘"으로 바뀐다. React 가 hydration 오류로 잡거나, 조용히 넘어가도
 *    **새로고침할 때마다 사이드바가 한 번 깜빡인다.**
 *
 * ★ HttpOnly 가 아니다 — 클라이언트가 토글할 때 직접 써야 한다. 세션이 아니라
 *   화면 상태값이므로 노출돼도 잃을 것이 없다.
 */
export const SIDEBAR_COOKIE = 'sidebar_collapsed';

/** 1년. 접힘 상태는 오래 유지되는 편이 자연스럽다. */
export const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
