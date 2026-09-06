/**
 * ERP 세션 타입 — web(표시·라우팅)과 api(스코프 판정)가 둘 다 쓴다.
 *
 * 출처는 `tb_s080_auth_session` 한 곳이다(002 마이그레이션). 브라우저에는 불투명한
 * `erp_sid` 쿠키만 내려가고, 삐용 access·refresh 토큰은 서버에만 암호화 보관한다.
 *
 * 구현은 페이즈 1의 2-8에서 채운다. 여기 있는 것은 모양뿐이다.
 */

/** 삐용 조직 구분. 'S' = 운영사(에스원비즈), 그 외 = 입주사. */
export type OrgTp = 'S' | (string & {});

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

  /** 삐용 orgTp. **표시 전용**(헤더의 "홍길동 (에스원테크)")으로만 쓴다. */
  orgTp: OrgTp;

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
  revokedAt: Date | null;
}

/** 세션이 지금 쓸 수 있는 상태인가. */
export function isSessionUsable(s: ErpSession, now: Date = new Date()): boolean {
  return s.revokedAt === null && s.expiresAt.getTime() > now.getTime();
}
