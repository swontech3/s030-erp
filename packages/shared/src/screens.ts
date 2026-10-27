/**
 * 화면 ID ↔ 라우트 중앙 매핑 — 단일 진실 공급원.
 *
 * web(라우팅·사이드바)과 api(화면코드 판정)가 둘 다 쓴다 — 복사본을 만들지 않는다.
 *
 * 규칙 (doc/SWONBIZ_PROJECT_STRUCTURE.md §1·§3)
 * - 화면 ID = 시스템 코드 3자리 + 그룹 3자리 + 순번 4자리 = **10자리** (+ 팝업 `p{n}`).
 *   시스템 코드는 셋이다 — `s03` SwonBiz ERP, `s04` **법무 서비스**(2026-10-09), `s05` **세무 서비스**(2026-10-25).
 *   ★ 그룹 번호는 **시스템 코드와 함께 읽는다.** `s03`+`020` 은 입주사관리, `s04`+`020` 은
 *     법인변경이다. 같은 숫자라도 다른 그룹이다.
 *   ★ 순번은 프로그램마다 10씩, 관련 화면(상세 등)은 1씩 끼운다(`s040200010` → `s040200011`).
 *   ★★ 시스템 코드를 더하면 `api/src/routes/acl.ts` 의 `SCREEN_CODE` 정규식도 같이 본다 —
 *      빠지면 그 시스템의 모든 화면 확인 요청이 400 이다(2026-10-02 에 실제로 그랬다).
 * - 화면 ID는 URL에 노출하지 않는다. `/no-access`이지 `/s030000080`이 아니다.
 * - 팝업(`p{n}`)은 화면 ID를 갖되 라우트를 갖지 않으므로 이 표에 넣지 않는다.
 * - ★ `role` 필드를 두지 않는다. 사이드바 렌더와 접근 판정은 삐용이 준
 *   화면 목록만 쓴다(ACL-07′). 역할 필드가 생기는 순간 ERP가 역할로 판정하게 되고
 *   `doc/지시_ERP_로그인_권한관리.md` 1-6 위반이다.
 * - ★★ **화면 목록이 유일한 근거다.** ERP 는 `org_tp` 로도 `member_tp` 로도 판정하지
 *   않는다(회신 2026-09-12 §1·§5). 삐용이 org_tp · audience_tp · 구독 · 역할 넷을 함께
 *   보고 목록을 만들고, ERP 는 그 결과만 받는다. 화면별 대상 구분(`audience_tp`)은
 *   `doc/SWONBIZ_SCREEN_LIST.md` §1 에 있다 — 이 파일에는 두지 않는다.
 */

/**
 * 그룹 3자리. **시스템 코드와 함께 읽는다**(머리말).
 *   s03 — 000 공통 · 010 기준설정 · 020 입주사관리 · 030 세무 · 040 법무(옛 자리) · 050 공개 · 060 공간운영
 *   s04 — 010 법인설립 · 020 법인변경 · 030 사업목적(공용 카탈로그) · 090 설정(등기 양식 설정)
 */
export type ScreenGroup = '000' | '010' | '020' | '030' | '040' | '050' | '060' | '090';

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
  s030000010: { route: '/login',          name: '로그인',          group: '000' },
  s030000050: { route: null,              name: 'ERP 셸',          group: '000' }, // (erp)/layout.tsx — 라우트 없음
  s030000060: { route: '/dashboard',      name: '대시보드',        group: '000' },
  s030000070: { route: '/settings',       name: '설정',            group: '000' },
  s030000080: { route: '/no-access',      name: '접근 권한 없음',  group: '000' },

  // --- 010 기준설정 ---
  s030100010: { route: '/facility',       name: '센터 관리',       group: '010' },
  /**
   * 표양식 관리 — 서류 양식(법무 제출 양식 · 재직증명서 같은 직원 서류)을 등록·수정하고,
   * 일반 서류는 그 양식으로 뽑는다(2026-10-07).
   *
   * ★ **운영사 전용(audience_tp='P')** 이다. `requireScreen` + Fastify `/form-templates/**`
   *   의 `role !== 'operator'` 403 두 겹(코드 관리와 같다).
   * ★★ **양식 편집은 이 화면, 법무 서류 출력은 법무 서비스(S04)다**(결정 2026-10-09 — 10-07 의
   *    「문서를 뽑는 곳은 이 화면 하나」를 고쳤다). 법무 서류는 회사가 직접 로그인해 뽑는데,
   *    이 화면은 운영사 전용이라 회사가 들어올 수 없다. 그래서 법무 양식(`isLegalForm`)은
   *    여기서 [인쇄] 를 막는다. 일반 서류(재직증명서 등)는 그대로 여기서 뽑는다.
   * ★ 양식 편집 페이지(`/forms/[id]`)도 **이 화면 코드로** 연다 — 별도 화면 ID 를 받지 않았다.
   *   계약 폼(s030200040)처럼 따로 등록할지는 삐용 화면 시드 때 정한다.
   */
  s030100020: { route: '/forms',          name: '표양식 관리',     group: '010' },
  /**
   * 코드 관리 — ERP 전체가 읽는 기준자료(분류 · 파티션 · 코드값)를 다루는 화면.
   *
   * ★ **운영사 전용(audience_tp='P')** 이다. `requireScreen` 이 주소 직접 접근을 막고,
   *   Fastify 쪽 `/codes-admin/**` 가 `role !== 'operator'` 를 403 으로 막는다 — 두 겹이다.
   * ★ 이름이 곧 사이드바 문구다 — 「코드 관리」.
   * ★★ 소비용 조회(`GET /codes`)와 **다른 화면이다.** 계약 폼은 코드를 읽기만 하고,
   *    고치는 자리는 이 화면 하나다(CLAUDE.md 「한 업무는 한 화면에서」).
   */
  s030100030: { route: '/codes',          name: '코드 관리',       group: '010' },

  // --- 020 입주사관리 ---
  s030200010: { route: '/tenants',        name: '입주사 목록',     group: '020' },
  s030200020: { route: '/tenants/[id]',   name: '입주사 상세',     group: '020' },
  s030200030: { route: '/tenants/contracts', name: '입주사·계약',  group: '020' },
  s030200040: { route: '/contracts/[id]', name: '계약 폼',         group: '020' },
  // ★ 시안(ErpTenants 「청구」)과 화면 목록(SWONBIZ_SCREEN_LIST)은 3차였지만 청구 1단계와 함께 당겼다.
  //   **삐용 화면 시드 2차 제출 대상**이다(BBIYONG_SCREEN_SEED_1.md §0-1).
  // ★ 이름이 곧 사이드바 문구다 — 시안 사이드바가 「청구」다(화면 목록 이름은 「월별 청구 관리」).
  s030200070: { route: '/billing',        name: '청구',            group: '020' },
  /**
   * 문의상담관리 — 고객이 남긴 문의에 운영자가 답하는 화면(s030500070 의 뒷면).
   *
   * ★ **운영사 전용(audience_tp='P')** 이다. 이름·연락처·이메일·본문이 한 화면에 모인다 —
   *   `requireScreen` 이 URL 직접 접근을 막고, `/admin/inquiries` 는 Fastify 가 403 으로 막는다.
   * ★ 고객 화면 셋(050)은 삐용 시드에 올리지 않지만 **이 화면은 등록 대상**이다
   *   (`doc/BBIYONG_SCREEN_SEED_1.md` §0-1 · 모듈 OFFICE).
   * ★ 이름이 곧 사이드바 문구이자 화면 제목이다 — 「문의상담관리」(2026-09-28 개칭).
   */
  s030200080: { route: '/inquiry-admin',  name: '문의상담관리',    group: '020' },

  // --- 050 공개 화면 (인증 없음) ---
  s030500010: { route: '/',               name: '랜딩',            group: '050', public: true },
  s030500060: { route: '/kiosk',          name: '회의실 현황판',   group: '050', public: true },
  /**
   * ★ 문의상담 셋은 **팝업이 아니라 페이지**라 이 표에 있다.
   *   「팝업(p{n})은 넣지 않는다」는 규칙의 이유는 **라우트가 없어서**인데(머리말),
   *   이 둘은 주소가 있다 — 모달이 아니라 별도 페이지로 만들기로 한 시안의 결정이다
   *   (`inquiry-board/01-flow.md` 「화면 형태」). 라우트가 있으면 여기 적는다.
   * ★ 셋 다 공개 화면이라 삐용 화면 마스터에는 **등록하지 않는다**(회신 ⑨).
   */
  s030500070:   { route: '/inquiry',      name: '문의상담',        group: '050', public: true },
  s030500070p1: { route: '/inquiry/new',  name: '문의하기',        group: '050', public: true },
  s030500070p2: { route: '/inquiry/[id]', name: '문의 보기',       group: '050', public: true },

  // --- 060 공간운영 ---
  // ★ 이름이 곧 사이드바 문구다 — 화면이 하는 일이 「회의실 예약」이다(2026-09-26 개칭).
  //   화면 목록·삐용 시드의 「회의실 예약 현황」도 같이 고쳤다.
  s030600010: { route: '/booking',        name: '회의실 예약',     group: '060' },

  // ═══ s04 법무 서비스 (2026-10-09) ═══════════════════════════════════════════
  // ★ 회사 정본은 삐용 단체다. 법무는 회사를 만들지 않고, 삐용 단체 ID 로 법무 업무만 보관한다
  //   (037). 운영사는 전체 건을, 회사는 자기 건만 본다 — RLS `erp_org_scope` 가 가른다.
  // ★ 삐용에는 「서비스(법무) → 기능 → 화면」 3단으로 등록한다. 화면이 열리려면 **회사가 그
  //   기능을 배포받고 + 사용자가 화면을 부여받아야** 한다(삐용 회신 2026-10-09). 기능 구분 제안은
  //   화면 목록 문서 §2-1.

  // --- 010 법인설립 ---
  /**
   * 법인설립 목록(10-4, 2026-10-11) — 주식회사 · 발기설립. 줄을 누르면 상세(s040100020)로 간다.
   * ★ 운영사 · 회사가 함께 쓴다(RLS 042). 운영사가 삐용에 먼저 등록한 단체로만 시작한다.
   * ★ 사이드바 순서가 이 표의 선언 순서라 법인변경보다 위에 둔다(그룹 순서 010 → 020).
   */
  s040100010: { route: '/legal/incorporations', name: '법인설립', group: '010' },
  /**
   * 법인설립 상세 — 회사 · 자본·주식 · 설립 정보 · 사람 · 사업목적 · 상태 전이 · 삭제(10-4). 서류 출력은 10-5.
   * ★ 법인변경 상세와 같은 방식이다 — **사이드바에 없고** 목록에서 들어온다. 삐용에 목록(s040100010)과
   *   **함께** 등록해야 열린다. 순번은 결정(2026-10-11)대로 020 이다(법인변경의 011 과 다르다).
   */
  s040100020: { route: '/legal/incorporations/[id]', name: '법인설립 상세', group: '010' },

  // --- 020 법인변경 ---
  /**
   * 법인변경 목록 — 목록 조회(2단계) + [새 건](3단계, 2026-10-10). 줄을 누르면 상세(s040200011)로 간다.
   * ★ 서류 출력 팝업은 상세의 `p{n}` 으로 붙일 예정이다(순번 1씩 끼움).
   */
  s040200010: { route: '/legal/corp-changes', name: '법인변경',   group: '020' },
  /**
   * 법인변경 상세 — 기본정보 · 변경 내용 · 임원(3단계, 2026-10-10). 상태 전이 · 서류 출력은 4단계 이후.
   * ★ 계약 목록 → 계약 폼(s030200040)과 같은 방식이다 — **사이드바에 없고** 목록에서 들어온다.
   *   그래도 화면 목록에 없으면 `requireScreen` 이 `/no-access` 로 돌려보낸다. 삐용에 이 화면을
   *   목록(s040200010)과 **함께** 등록해야 한다(서비스 → 기능 → 화면 3단).
   */
  s040200011: { route: '/legal/corp-changes/[id]', name: '법인변경 상세', group: '020' },

  // --- 030 사업목적 ---
  /**
   * 사업목적 — 공용 카탈로그(문구)의 추가 · 수정 · 사용 끄기(2026-10-11, 041).
   * ★ **운영사 전용** 관리 화면이다(결정 2026-10-11). 회사 사용자는 이 화면을 열지 않고, 법인변경
   *   (목적변경) · 설립 화면의 「사업목적 고르기」 팝업으로 **사용 중인 문구만** 읽어 고른다 —
   *   카탈로그를 고치는 자리는 이 화면 하나다(한 업무는 한 화면).
   */
  s040300010: { route: '/legal/biz-purposes', name: '사업목적', group: '030' },

  // --- 090 설정 ---
  /**
   * 설정 — 등기 설정(`tb_s080_doc_form_settings`)의 표시명 · 양식호수 · 등기의 목적/사유 · 등기할 사항 ·
   * 세금 · 첨부서면을 구분별로 고친다(2026-10-18). 설립 세금(세율 · 최소액 · 배수 · 수수료)도 여기다.
   * ★ **운영사 전용**이다. `requireScreen` + Fastify `/legal/doc-form-settings` 의 `role !== 'operator'` 403
   *   두 겹(표에 RLS 가 없다 — 쓰기를 막는 것은 라우트다).
   * ★ 등기 설정을 고치는 자리는 이 화면 하나다(한 업무는 한 화면). 출력은 읽기만 한다.
   */
  s040900010: { route: '/legal/doc-form-settings', name: '설정', group: '090' },

  // ═══ s05 세무 서비스 (2026-10-25) ═══════════════════════════════════════════
  // --- 000 이번 달 할 일 ---
  // ★ 1-0 은 빈 껍데기다 — 제목과 「준비 중」 한 줄만(doc/tax-service/).
  s050000010: { route: '/tax/this-month', name: '이번 달 할 일', group: '000' },

  // --- 010 기초 ---
  /**
   * 세무 설정 — 사업자 유형 · 세무사 메일 · 계좌 · 카드 · 쓰지 않는 자료 · 원천세 신고 주기(201 · 202).
   * 회사 기본정보는 보기만 한다(ERP · 법무 표를 법무 `readCompanySource` 로 읽는다).
   * ★ 운영사 · 회사 모두 **자기 단체만** — Fastify `/tax/settings` 가 org_id = 세션 단체 ID 를 직접 건다.
   */
  s050100010: { route: '/tax/settings', name: '세무 설정', group: '010' },
  /**
   * 거래처 — 매입 · 매출로 나누지 않는 한 목록. 업로드 때 사업자번호로 자동으로 생긴다(203 · 204, 1-2).
   * 고치기 · 합치기는 팝업이다(화면 번호 없음).
   */
  s050100020: { route: '/tax/vendors', name: '거래처', group: '010' },

  // --- 020 자료 모으기 ---
  /**
   * 자료 올리기 — 세무 전용 엑셀 창구. 1-2 는 홈택스 전자세금계산서 매입 · 매출만 동작한다(나머지 카드는 「준비 중」).
   * 미리보기는 팝업이다(화면 번호 없음).
   */
  s050200010: { route: '/tax/uploads', name: '자료 올리기', group: '020' },
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
  if (has(screens, 's030000060')) return '/dashboard'; // 대시보드 권한 = 운영사
  if (has(screens, 's030600010')) return '/booking';   // 예약 권한 = 입주사
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
  if (id === 's030000010' || id === 's030000080') return false;
  return true;
}
