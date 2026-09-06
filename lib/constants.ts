/**
 * ERP 전역 상수 — 미확정·하드코딩 값을 이 파일 한 곳으로 모은다.
 *
 * ★ 배치 안내: 이 파일은 Next.js 앱 스캐폴딩 전에 먼저 작성됐다(SPEC.md 참조 —
 * 현재 저장소에는 아직 src/app이 없다). 스캐폴딩 시 이 파일을 그대로
 * `src/lib/constants.ts`로 옮긴다. import 경로(`@/lib/constants`)는
 * SWONBIZ_PROJECT_STRUCTURE.md의 `lib/constants.ts` 규약과 동일하게 유지한다.
 *
 * 값이 확정되면 이 파일만 고친다. 화면·API 코드에 값을 직접 적지 않는다.
 */

// =============================================================================
// 삐용(bbiyong, s02) 연동 — 회신 전까지 Mock으로 개발한다
// =============================================================================
// ★ 아래 URL·경로는 전부 placeholder다. 삐용 팀 회신(⑦ 로그인 API 규격) 전까지
// 확정값이 아니다 — BBIYONG_MOCK=true일 때는 실제로 호출되지 않는다
// (lib/bbiyong/MockBbiyongAuth.ts가 대신 응답한다).

export const BBIYONG = {
  /** 삐용 백엔드 베이스 URL. 회신 전 placeholder. */
  BASE_URL: process.env.BBIYONG_BASE_URL ?? "https://bbiyong.s-wontech.co.kr",

  /** 1단계 로그인(이메일·비밀번호 확인) — BBIYONG-AUTH.md §4.2 */
  LOGIN_PATH: "/rest/v1/s021200010/sign-in",

  /** 2단계 로그인(조직 선택) — AUTH-02 겸직 지원 여부에 따라 사용 여부 결정(회신 ⑩) */
  LOGIN_ORG_SELECT_PATH: "/rest/v1/s021200010/sign-in-org",

  /** access 토큰 재발급 — GET 쿼리스트링 방식(BBIYONG-AUTH.md §2.4의 알려진 함정 1: 실패해도 HTTP 200) */
  REFRESH_PATH: "/rest/v1/auth/re-issue",

  /** 로그아웃 — refresh-token 헤더로 해당 세션 1건만 하드 삭제 */
  SIGN_OUT_PATH: "/rest/v1/s021200010/sign-out",

  /**
   * 권한 조회(회신 ⑫ 대기) — 접근 가능 화면 목록을 한 번에 받는 엔드포인트.
   * 규격 미확정. 확정되는 대로 이 값과 BbiyongAcl.HttpBbiyongAcl 구현을 함께 채운다.
   */
  AUTH_SCREENS_PATH: "/rest/v1/acl/screens",
} as const;

/** BbiyongAcl 어댑터 선택 스위치. 'mock' | 'http'. 기본은 mock(개발 안전). */
export const BBIYONG_ACL_MODE = (process.env.BBIYONG_ACL_MODE ?? "mock") as "mock" | "http";

/** true면 실제 삐용 로그인 API를 호출하지 않고 MockBbiyongAuth로 응답한다. */
export const BBIYONG_MOCK = process.env.BBIYONG_MOCK === "true";

// =============================================================================
// 회의실 예약 — 전사 기본값. 회의실별 override는 tb_s080_facilities 레코드가 우선
// =============================================================================
// null이 아니면 전사 기본값을 덮어쓴다(SWONBIZ_PROJECT_STRUCTURE.md §7 규약과 동일).

export const BOOKING = {
  OPEN_TIME: "09:00",
  CLOSE_TIME: "22:00",
  SLOT_MINUTES: 30,
  FREE_MINUTES_PER_DAY: 120,
  OVERAGE_FEE_PER_30MIN: 0, // 미확정
  MAX_CONSECUTIVE_SLOTS: 8, // 미확정
  BOOKABLE_DAYS_AHEAD: 30,
} as const;

// ★ 주의 — 기존 S-WonERP 앱의 lib/reservation-validation.ts는 운영시간을
// 06:00~24:00으로 하드코딩하고 있다(BACKEND_ANALYSIS.md §3-3). 이 상수와 값이
// 다르다. 재작성 시 반드시 이 BOOKING.OPEN_TIME/CLOSE_TIME을 참조하도록 고친다
// — 두 값이 다른 채로 남으면 화면과 서버가 다른 운영시간을 쓰게 된다.

// =============================================================================
// 계약
// =============================================================================

export const CONTRACT = {
  MAX_ITEMS: 10, // 계약 항목(호실·주차·사물함 등) 최대 행 수 — CONT-04/05
  MAX_USERS: 20, // 계약 사용자 최대 인원 — CONT-06
  EXPIRY_WARNING_DAYS: 90, // 만료 임박 경고 기준일
} as const;

// =============================================================================
// 계약서 출력 — 템플릿에 남아 있는 하드코딩 값의 임시 해소
// =============================================================================
// PROJECT.md "하드코딩된 값이 템플릿에 남아 있다" 항목. 조회 순서는
// 지점 담당자 → 조직 기본 담당자이며, 이 값은 그 조회가 실패했을 때의 최후
// 폴백이다. 실제 조회 로직(api/admin/spaces/managers, [A] 재사용)이 우선한다.

export const CONTRACT_DEFAULTS = {
  DEFAULT_MANAGER: "담당자명", // 지점 담당자 미등록 시 폴백 표시값
  DEFAULT_CENTER: "강남 삼성점", // 건물 미확정 상태에서의 폴백 표시값
} as const;
