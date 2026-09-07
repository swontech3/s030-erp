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

export type AclAction = 'VIEW' | 'CREATE' | 'UPDATE' | 'DELETE';

/** 권한 판정의 입력. 세션 전체가 아니라 삐용이 아는 식별자만 넘긴다. */
export interface AclSubject {
  s020MemberId: number;
  s020OrgId: number;
  orgTp: string;
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
   */
  getScope(subject: AclSubject, companyId: string | null): AclScope;
}

/** shadow 로그에 남길 요청 맥락. 판정에는 쓰지 않는다. */
export interface AclLogContext {
  route?: string;
  httpMethod?: string;
}
