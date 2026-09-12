/**
 * ERP 세션 타입 — web(표시·라우팅)과 api(스코프 판정)가 둘 다 쓴다.
 *
 * 출처는 `tb_s080_auth_session` 한 곳이다(002 마이그레이션). 브라우저에는 불투명한
 * `erp_sid` 쿠키만 내려가고, 삐용 access·refresh 토큰은 서버에만 암호화 보관한다.
 *
 * 구현은 packages/api/src/session/store.ts (createSession · lookupSession · revokeSession).
 */

/**
 * 스코프 판정용 역할. **ERP가 스스로 정하는 권한이 아니다** —
 * 데이터 소유자 축(`company_id`)을 어떻게 적용할지만 가른다.
 * 화면 접근 판정은 삐용이 준 화면 목록으로 한다(ACL-07′).
 */
export type ScopeRole = 'operator' | 'tenant';

export interface ErpSession {
  /** 쿠키 원문이 아니라 SHA-256 해시. DB의 기본키와 같은 값. */
  erpSid: string;

  /** 삐용 memberId — 인증 주체. */
  s020MemberId: number;

  /** 삐용 orgId — 조직 식별자. JWT에는 없고 로그인 응답 본문에만 있다. */
  s020OrgId: number;

  // ★ orgTp 는 여기 없다(회신 2026-09-12 §2). 이 타입은 그대로 AclSubject 로 넘어가므로,
  //   필드가 남아 있으면 판정 코드가 런타임으로 그것을 읽을 수 있다. 표시용 orgTp 는
  //   `/auth/me` 의 display(삐용 getProfile 응답)에 있다. org_tp 컬럼 자체는
  //   tb_s080_auth_session 에 계속 저장한다 — S-WonERP 레거시 브리지가 읽는다.

  /**
   * ERP 입주사 식별자. `tb_s080_companies.link_s020_org_id = s020OrgId` 역조회 결과.
   *
   * ★ 연결이 없으면 `null`이고 그건 **빈 스코프**다 — 목록 API가 0건을 반환한다.
   *   예외를 던지거나 전체를 돌려주지 않는다(ORG_ARCHITECTURE.md §1-2).
   */
  companyId: string | null;

  /** 스코프 역할. RLS GUC `app.current_role`로 내려간다. */
  role: ScopeRole;

  expiresAt: Date;
  lastActiveAt: Date | null;
  // revokedAt 은 두지 않는다 — 폐기된 세션은 lookupSession 이 null 을 돌려주므로
  // 이 타입의 값이 존재하는 시점에는 언제나 "폐기되지 않음"이다.
}
