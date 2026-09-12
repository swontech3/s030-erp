/**
 * 화면 ID ↔ 라우트 중앙 매핑 — 단일 진실 공급원.
 *
 * web(라우팅·사이드바)과 api(화면코드 판정)가 둘 다 쓴다 — 복사본을 만들지 않는다.
 *
 * 규칙 (doc/SWONBIZ_PROJECT_STRUCTURE.md §1·§3)
 * - 화면 ID는 URL에 노출하지 않는다. `/no-access`이지 `/s0300000080`이 아니다.
 * - 팝업(`p{n}`)은 화면 ID를 갖되 라우트를 갖지 않으므로 이 표에 넣지 않는다.
 * - ★ `role` 필드를 두지 않는다. 사이드바 렌더와 접근 판정은 삐용이 준
 *   화면 목록만 쓴다(ACL-07′). 역할 필드가 생기는 순간 ERP가 역할로 판정하게 되고
 *   `doc/지시_ERP_로그인_권한관리.md` 1-6 위반이다.
 * - ★★ **화면 목록이 유일한 근거다.** ERP 는 `org_tp` 로도 `member_tp` 로도 판정하지
 *   않는다(회신 2026-09-12 §1·§5). 삐용이 org_tp · audience_tp · 구독 · 역할 넷을 함께
 *   보고 목록을 만들고, ERP 는 그 결과만 받는다. 화면별 대상 구분(`audience_tp`)은
 *   `doc/SWONBIZ_SCREEN_LIST.md` §1 에 있다 — 이 파일에는 두지 않는다.
 */

export type ScreenGroup = '000' | '010' | '020' | '030' | '040' | '050' | '060';

export interface ScreenMeta {
  /** 사용자에게 보이는 라우트. 라우트가 없는 화면(레이아웃 등)은 null. */
  route: string | null;
  name: string;
  group: ScreenGroup;
  /**
   * 인증 없이 접근 가능한 화면(050). **정보용 표시다** — 실제 제외 목록은
   * web/proxy.ts 의 matcher 와 api 의 라우트별 `config.public` 이고, 이 플래그를 읽는 코드는 없다.
   * 화면이 늘면 셋을 함께 고친다.
   */
  public?: true;
}

export const SCREENS = {
  // --- 000 공통 ---
  s0300000010: { route: '/login',          name: '로그인',          group: '000' },
  s0300000050: { route: null,              name: 'ERP 셸',          group: '000' }, // (erp)/layout.tsx — 라우트 없음
  s0300000060: { route: '/dashboard',      name: '대시보드',        group: '000' },
  s0300000070: { route: '/settings',       name: '설정',            group: '000' },
  s0300000080: { route: '/no-access',      name: '접근 권한 없음',  group: '000' },

  // --- 010 기준설정 ---
  s0300100010: { route: '/facility',       name: '센터 관리',       group: '010' },

  // --- 020 입주사관리 ---
  s0300200010: { route: '/tenants',        name: '입주사 목록',     group: '020' },
  s0300200020: { route: '/tenants/[id]',   name: '입주사 상세',     group: '020' },
  s0300200030: { route: '/tenants/contracts', name: '입주사·계약',  group: '020' },
  s0300200040: { route: '/contracts/[id]', name: '계약 폼',         group: '020' },

  // --- 050 공개 화면 (인증 없음) ---
  s0300500010: { route: '/',               name: '랜딩',            group: '050', public: true },
  s0300500060: { route: '/kiosk',          name: '회의실 현황판',   group: '050', public: true },

  // --- 060 공간운영 ---
  s0300600010: { route: '/booking',        name: '예약 현황',       group: '060' },
} as const satisfies Record<string, ScreenMeta>;

export type ScreenId = keyof typeof SCREENS;

/** 삐용이 준 화면 목록에 특정 화면이 있는가. */
export function has(screens: readonly string[], id: ScreenId): boolean {
  return screens.includes(id);
}

/**
 * 로그인 후 홈 분기 — `org_tp`가 아니라 화면 권한으로 판단한다.
 * (doc/ORG_ARCHITECTURE.md §3-4 / 지시_ERP_로그인_권한관리.md 1-6)
 */
export function homeRouteFor(screens: readonly string[]): string {
  if (screens.length === 0) return '/no-access';        // AUTH-13
  if (has(screens, 's0300000060')) return '/dashboard'; // 대시보드 권한 = 운영사
  if (has(screens, 's0300600010')) return '/booking';   // 예약 권한 = 입주사
  // 폴백 — 목록의 첫 "홈이 될 수 있는" 화면. (리뷰 2026-09-07)
  //   · `in` 이 아니라 hasOwn: 'toString' 같은 프로토타입 키가 화면으로 잡혀 undefined 를 돌려줬다
  //   · 인증 화면(000 로그인·접근권한없음)·공개 화면(050)·동적 세그먼트('/tenants/[id]')는 홈이 아니다
  const first = screens.find((s): s is ScreenId => Object.hasOwn(SCREENS, s) && isHomeCandidate(s as ScreenId));
  return first ? (SCREENS[first].route as string) : '/no-access';
}

function isHomeCandidate(id: ScreenId): boolean {
  // ★ SCREENS 는 `as const satisfies` 라 각 항목의 타입이 리터럴이고, public 을 쓰지 않은
  //   화면에는 그 키 자체가 없다. ScreenMeta 로 한 번 좁혀서 읽는다.
  const meta: ScreenMeta = SCREENS[id];
  if (meta.route === null || meta.route.includes('[')) return false;
  if (meta.public) return false;
  if (id === 's0300000010' || id === 's0300000080') return false;
  return true;
}
