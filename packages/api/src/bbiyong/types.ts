/**
 * 삐용 연동 어댑터 인터페이스 — **삐용 규격이 바뀌어도 여기까지만 바뀐다.**
 *
 * 회신 ⑦(로그인 API 규격)·⑫(권한 조회 API 규격)이 아직 오지 않았다. 그래서
 * 페이즈 1 은 Mock 구현으로 완주하고, 회신이 오면 `HttpBbiyongAuth` /
 * `HttpBbiyongAcl` 한 쌍만 새로 써서 갈아 끼운다. 이 인터페이스를 넘어
 * 삐용의 응답 모양이 다른 파일로 새어나가지 않게 한다.
 */
import type { ScopeRole } from '@swonbiz/shared';

/** 삐용 로그인 성공 시 ERP 가 실제로 쓰는 값만 추린 것. */
export interface BbiyongLoginResult {
  /** 인증 주체. `tb_s080_auth_session.bbiyong_member_id`. */
  memberId: number;
  /** 조직 식별자. ★ JWT 에는 없고 로그인 **응답 본문에만** 있다(ORG §3-2). */
  orgId: number;
  /** 'S' = 운영사. **표시 전용**이며 접근 판정에 쓰지 않는다(지시문 1-6). */
  orgTp: string;
  /** 헤더의 "홍길동 (에스원테크)" 표시용. */
  memberName: string;
  orgName: string;
  accessToken: string;
  refreshToken: string;
}

/**
 * 로그인 실패 시 화면에 뜨는 문구. **하나뿐이다.**
 *
 * ★ 삐용은 "이메일 없음"과 "비밀번호 틀림"을 둘 다 A005 로 준다(회신 ⑦ §7) —
 *   계정 존재 여부를 노출하지 않으려는 의도다. ERP 도 구분하려 하지 않는다.
 *   삐용의 `massage` 를 그대로 화면에 흘리지도 않는다: 삐용 문구가 바뀌면 ERP 화면이
 *   같이 바뀌고, 언젠가 내부 사정이 적힌 문구가 사용자에게 간다.
 */
export const INVALID_CREDENTIALS_MESSAGE = '이메일 또는 비밀번호가 올바르지 않습니다';

/** 겸직 계정 안내. 2단계 로그인 팝업을 만들기 전까지 이 문구가 유일한 출구다. */
export const ORG_SELECT_MESSAGE =
  '이 계정은 여러 단체에 소속되어 있습니다. 삐용에서 로그인한 뒤 다시 시도해 주세요.';

/**
 * 로그인 실패. **삐용은 실패해도 HTTP 200 을 준다**(BBIYONG-AUTH.md §2.4 함정 1) —
 * `body.status !== 200` 을 검사하는 책임은 어댑터 구현체에 있고, 바깥은 이 예외만 본다.
 */
export class BbiyongAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BbiyongAuthError';
  }
}

/**
 * 겸직 계정 — 같은 이메일이 여러 단체에 있어 삐용이 토큰 대신 **단체 선택 목록**을 준 경우.
 *
 * ★ 조용히 실패하면 안 된다(회신 ⑦ §4). 자격 증명은 맞았는데 단체를 못 고른 상태이므로
 *   "이메일 또는 비밀번호가 올바르지 않습니다"로 뭉개면 사용자는 영원히 못 들어온다.
 *   `BbiyongAuthError` 를 상속하므로 라우트의 401 번역은 그대로 타고, 메시지만 다르다.
 *
 * 2단계 로그인 팝업(s0300000010p1)은 아직 만들지 않는다 — 겸직 계정이 실제로 없다.
 * 이 예외가 서버 로그에 찍히면 그때가 팝업을 만들 때다.
 */
export class BbiyongOrgSelectRequiredError extends BbiyongAuthError {
  constructor(
    message: string,
    /** 후보 개수만 남긴다. ★ selectToken 은 3분 유효이고 보관하지 않는다. */
    readonly candidateCount: number,
  ) {
    super(message);
    this.name = 'BbiyongOrgSelectRequiredError';
  }
}

/**
 * 삐용에 못 붙었거나 응답이 규격이 아니다. **인증 실패가 아니다** —
 * 이것을 401 로 번역하면 삐용 장애가 "비밀번호가 틀렸습니다"로 보인다.
 *
 * ★ 이 예외의 message 에는 URL·토큰·비밀번호가 들어가지 않는다. undici 는 실패한 요청
 *   URL 을 그대로 붙여 던지고, `/re-issue` 의 URL 에는 토큰 2개가 쿼리스트링으로 실려 있다.
 */
export class BbiyongUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BbiyongUnavailableError';
  }
}

/**
 * 헤더에 찍는 표시값. **표시 전용이다** — 이 값으로 메뉴를 열고 닫지 않는다(지시문 1-6).
 */
export interface BbiyongProfile {
  memberName: string;
  orgName: string;
  orgTp: string;
}

export interface BbiyongAuth {
  signIn(email: string, password: string): Promise<BbiyongLoginResult>;
  /** 삐용 세션 1건 삭제. 실패해도 ERP 로그아웃은 계속 진행한다(ORG §3-5). */
  signOut(refreshToken: string): Promise<void>;
  /**
   * 회원 표시정보 조회.
   *
   * ★ 이 값을 ERP DB 에 복사해 두지 않는다. 삐용에서 이름이 바뀌면 ERP 만 옛 이름을
   *   들고 있게 되고, 그건 추적이 안 되는 종류의 어긋남이다. 매번 물어보고, 비용이
   *   문제가 되면 그때 캐시한다.
   *
   * TODO(회신 ⑦): 삐용 회원조회 엔드포인트 규격 미확정. HttpBbiyongAuth 를 쓸 때
   *   이 메서드가 무엇을 부를지 정해야 한다 — 없으면 로그인 응답을 세션에 얹는 쪽으로 간다.
   */
  getProfile(memberId: number): Promise<BbiyongProfile | null>;
}

/** 동작 어휘 4종 — ACL-10. APPROVE·EXPORT 는 쓰지 않는다. 런타임 검사와 타입이 한 원천이다. */
export const ACL_ACTIONS = ['VIEW', 'CREATE', 'UPDATE', 'DELETE'] as const;
export type AclAction = (typeof ACL_ACTIONS)[number];

/**
 * 권한 판정의 입력. 세션 전체가 아니라 삐용이 아는 식별자만 넘긴다.
 *
 * ★★ `orgTp` 도 `memberTp` 도 **일부러 없다.** 판정 입력에 없으면 구현체가 그 값으로
 *    판정하는 코드를 **물리적으로 쓸 수 없다**(회신 2026-09-12 §2). orgTp 는 2026-09-12
 *    제거됐다 — getScope 가 'S' 를 보고 operator 로 올려 주던 RLS 전체열람 스위치였다.
 *    표시용 orgTp 가 필요하면 `BbiyongProfile` 에 있다. 판정 입력과 표시 입력을 같은
 *    타입에 두지 않는다.
 *
 * ★★ ERP 는 member_tp 로도 판정하지 않는다 —
 *    org_tp 와 같은 이유다(회신 2026-09-12 §5). 운영사 안에서 대표만 볼 화면(보증금 정산
 *    등)이 있으면 **삐용이 그 화면을 '사원' 역할의 목록에서 빼는 것**으로 처리하고,
 *    ERP 는 받은 화면 목록만 본다. 이 필드를 여기에 추가하는 순간 판정 자리가 둘이 되고,
 *    어느 날 하나만 고쳐진다.
 */
export interface AclSubject {
  s020MemberId: number;
  s020OrgId: number;
}

export interface AclScope {
  role: ScopeRole;
  companyId: string | null;
}

export interface BbiyongAcl {
  /**
   * 접근 가능 화면 목록. 사이드바 렌더와 홈 분기가 **이것만** 본다(ACL-07′).
   * ERP 가 역할을 보고 거르지 않는다.
   */
  listScreens(subject: AclSubject): Promise<string[]>;

  /**
   * 화면 접근 판정. **1단계는 shadow — 항상 true 를 반환하고 기록만 남긴다.**
   * 차단은 3단계에서 켠다(SPEC 요구사항 15).
   */
  canAccess(screenCode: string, action: AclAction, subject: AclSubject, ctx?: AclLogContext): Promise<boolean>;

  /**
   * 데이터 스코프. ★ **shadow 대상이 아니다** — 1단계부터 예외 없이 강제한다.
   * shadow 로 두면 8월 명부 유출이 그대로 재현된다(지시서 1장).
   *
   * ★★ **scope 는 ERP 가 판정하지 않는다. 삐용 권한 조회 응답이 준다**(회신 ⑫).
   *    구현체가 하는 일은 받은 scope 를 그대로 돌려주는 것뿐이다 — `HttpBbiyongAcl` 은
   *    응답의 scope 를 그대로 쓰고, `MockBbiyongAcl` 은 계정표에 박아 둔 값을 쓴다.
   *    orgTp 로 유도하던 코드가 2026-09-12 제거됐다 — RLS 전체열람 스위치였다.
   *
   * `companyId` 는 `link_s020_org_id` 역조회 결과다. tenant 는 이 값으로 잠기고,
   * null 이면 **빈 스코프**다(전체가 아니다).
   */
  getScope(subject: AclSubject, companyId: string | null): AclScope;
}

/** shadow 로그에 남길 요청 맥락. 판정에는 쓰지 않는다. */
export interface AclLogContext {
  route?: string;
  httpMethod?: string;
}
