/**
 * MockBbiyongAuth — 삐용 로그인 API 회신 ⑦ 이 오기 전까지 쓰는 대역.
 *
 * 지시서 2-8 의 Mock 계정 4종을 그대로 구현한다. 이 4개로 페이즈 1 완료 기준의
 * 홈 분기(admin·operator → /dashboard, tenant → /booking, noaccess → /no-access)를
 * 전부 확인할 수 있다. 2026-10-09 에 비입주사(nontenant → /legal/corp-changes)를 더했다.
 *
 * ★ org_tp 어휘는 **'S'(시스템운영사) · 'N'(일반)** 두 값뿐이다(회신 2026-09-12).
 *   운영사는 에스원테크 한 곳(orgId=1)이고, ERP 입주사는 org_tp 로 표현하지 않는다 —
 *   입주 여부는 ERP 입주계약의 기간으로 계산한다. 같은 회사가 상담→서비스→입주→퇴실로
 *   옮겨다니므로 유형으로 두면 값을 계속 바꿔야 하고 이력이 끊긴다.
 *
 * ★ 비밀번호는 계정마다 다르지 않다. `MOCK_PASSWORD` 하나이고, 틀리면 실패한다 —
 *   로그인 화면의 에러 표시(showError)를 실제로 띄워 볼 수 있어야 하기 때문이다.
 *   비밀번호가 무엇이든 통과시키면 그 경로가 죽은 코드로 남는다.
 */
import type { ScopeRole } from '@swonbiz/shared';
import {
  BbiyongAuthError,
  INVALID_CREDENTIALS_MESSAGE,
  type BbiyongAuth,
  type BbiyongLoginResult,
  type BbiyongProfile,
} from './types.ts';

/** 개발용 고정 비밀번호. 실제 삐용 연동으로 바뀌면 사라진다. */
export const MOCK_PASSWORD = 'erp1234!';

interface MockAccount extends Omit<BbiyongLoginResult, 'accessToken' | 'refreshToken'> {
  email: string;
  /** 이 계정이 접근 가능한 화면. MockBbiyongAcl 이 같은 표를 본다. */
  screens: string[];
  /**
   * 데이터 스코프. ★ **orgTp 에서 유도하지 않는다 — 계정마다 명시한다**(회신 2026-09-12 §1).
   * 실연동에서는 삐용 권한 조회 응답이 이 값을 준다. Mock 은 그 자리를 이 필드로 대신한다.
   */
  scope: ScopeRole;
  /**
   * 삐용 단체코드 — **회사 단체에만** 적는다. `MockBbiyongOrg` 의 단체 조회가 이 표를 읽는다
   * (같은 회사를 두 곳에 적지 않는다 — `MockBbiyongAcl` 이 화면 목록을 끌어오는 것과 같은 이유).
   *
   * ★ Z97~Z99 를 쓴다. ERP 채번은 Z01 부터 올라가므로 끝 번호대가 개발 중에 겹치지 않고,
   *   겹치더라도 `MockBbiyongOrg.createOrg` 가 이 코드를 「이미 있음」으로 돌려줘 다음 번호로 간다.
   * ★ 운영사(orgId 1)에는 적지 않는다 — 운영사 단체는 「법무 서비스를 받은 회사」가 아니라 조회 목록에
   *   나오면 안 된다. 실물은 삐용이 거르고(회신 2026-10-09), mock 은 여기 적지 않는 것으로 맞춘다.
   */
  orgCode?: string;
}

/**
 * ★ orgId 는 삐용 쪽 식별자이고, tenant 계정의 9001 은
 *   `tb_s080_companies.link_s020_org_id = 9001` 로 연결돼 있어야 companyId 가 해석된다.
 *   연결 시드는 `node scripts/seed-mock-link.js` 가 넣는다.
 *   noaccess 계정(9002)은 **일부러 연결하지 않는다** — companyId = null 이 예외가 아니라
 *   빈 스코프(목록 0건)라는 것을 확인하는 계정이다(ORG §1-2).
 */
export const MOCK_ACCOUNTS: readonly MockAccount[] = [
  {
    email: 'admin@s-wontech.co.kr',
    memberId: 1001,
    orgId: 1,
    orgTp: 'S',
    memberName: '김대표',
    orgName: '에스원비즈',
    scope: 'operator',
    // ★ s030200030·s030200040·s030200080 은 운영사 전용(audience_tp='P')이다.
    //   입주사 계정에는 넣지 않는다 — 문의 관리(080)에는 남의 이름·연락처가 모여 있다.
    //   계약 폼(s030200040)은 사이드바에 없고 계약 상세·목록에서 들어가지만, 목록에 없으면
    //   requireScreen 이 /no-access 로 돌려보낸다 — 넣지 않으면 화면이 아예 열리지 않는다.
    // ★ s030100010 센터 관리 · s030100020 표양식 관리 · s030100030 코드 관리는 **운영사 전용**이다 — 입주사 계정에는
    //   넣지 않는다. 호실 요금·건물주 계좌가 모이고(센터), 코드는 ERP 전체가 읽는 기준자료다.
    // ★ s040200010 법인변경(법무 서비스 S04, 2026-10-09) — 운영사는 전체 건을 본다.
    //   s040200011 법인변경 상세(2026-10-10)는 목록과 늘 함께 준다 — 없으면 상세가 열리지 않는다.
    screens: ['s030000050', 's030000060', 's030100010', 's030100020', 's030100030', 's030200030', 's030200040', 's030200070', 's030200080', 's030600010', 's040200010', 's040200011'],
  },
  {
    email: 'operator@s-wontech.co.kr',
    memberId: 1002,
    orgId: 1,
    orgTp: 'S',
    memberName: '박운영',
    orgName: '에스원비즈',
    scope: 'operator',
    // ★ admin 계정과 같은 목록이다(위 주석 참조) — 센터 관리·표양식 관리·코드 관리·법인변경 포함.
    screens: ['s030000050', 's030000060', 's030100010', 's030100020', 's030100030', 's030200030', 's030200040', 's030200070', 's030200080', 's030600010', 's040200010', 's040200011'],
  },
  {
    email: 'tenant@test.com',
    memberId: 2001,
    orgId: 9001,
    orgTp: 'N',
    memberName: '홍길동',
    orgName: '주식회사 비앤케이넷',
    scope: 'tenant',
    screens: ['s030000050', 's030600010'],
    orgCode: 'Z97',
  },
  {
    email: 'noaccess@test.com',
    memberId: 2002,
    orgId: 9002,
    orgTp: 'N',
    memberName: '무권한',
    orgName: '미구독 회사',
    // 연결(link_s020_org_id)이 없어 companyId 가 null 로 해석된다 = 빈 스코프.
    scope: 'tenant',
    screens: [],
    orgCode: 'Z98',
  },
  {
    /**
     * 비입주사 — 운영사가 삐용에 등록하고 법무 화면만 준 회사(법무 서비스 S04, 2026-10-09).
     *
     * ★ `tb_s080_companies` 에 연결이 **없다**(시드하지 않는다). 그래서 companyId 는 null 이고
     *   ERP 자료는 하나도 안 보인다. 법무 표는 단체 ID(9003)로 갈리므로 자기 건만 본다.
     * ★ 셸(s030000050) + 법인변경(s040200010 · 상세 s040200011)뿐이다. 회의실 예약은 입주사 화면이라 없다.
     */
    email: 'nontenant@test.com',
    memberId: 2003,
    orgId: 9003,
    orgTp: 'N',
    memberName: '이법무',
    orgName: '주식회사 한빛법인',
    scope: 'tenant',
    screens: ['s030000050', 's040200010', 's040200011'],
    orgCode: 'Z99',
  },
];

export function findMockAccount(memberId: number): MockAccount | undefined {
  return MOCK_ACCOUNTS.find((a) => a.memberId === memberId);
}

export class MockBbiyongAuth implements BbiyongAuth {
  async signIn(email: string, password: string): Promise<BbiyongLoginResult> {
    const account = MOCK_ACCOUNTS.find((a) => a.email === email.trim().toLowerCase());

    // ★ 계정이 없는 경우와 비밀번호가 틀린 경우의 메시지를 구분하지 않는다.
    //   구분하면 어떤 이메일이 가입돼 있는지 밖에서 확인할 수 있다(계정 열거).
    if (!account || password !== MOCK_PASSWORD) {
      throw new BbiyongAuthError(INVALID_CREDENTIALS_MESSAGE);
    }

    return {
      memberId: account.memberId,
      orgId: account.orgId,
      orgTp: account.orgTp,
      memberName: account.memberName,
      orgName: account.orgName,
      // 실제 삐용 JWT 자리. 형식만 흉내 낸 문자열이고, 이 값도 암호화해서 저장한다 —
      // 암호화·복호화 경로를 mock 단계에서 같이 태워야 회신 후에 처음 돌리는 일이 없다.
      accessToken: `mock-access.${account.memberId}.${Date.now()}`,
      refreshToken: `mock-refresh.${account.memberId}.${Date.now()}`,
    };
  }

  async getProfile(memberId: number): Promise<BbiyongProfile | null> {
    const account = findMockAccount(memberId);
    if (!account) return null;
    return { memberName: account.memberName, orgName: account.orgName, orgTp: account.orgTp };
  }

  async signOut(_refreshToken: string): Promise<void> {
    // 삐용 세션 테이블이 없으므로 할 일이 없다. 실제 구현은 refresh-token 헤더로
    // POST /rest/v1/s021200010/sign-out 을 호출한다.
  }

  /**
   * 재발급 — mock 토큰은 **만료되지 않는다.**
   *
   * ★ mock 토큰은 JWT 가 아니므로 `exp` 가 없다. `isAccessTokenExpired` 가 "모른다"로
   *   판정해 `false` 를 돌려주므로, MOCK 모드에서는 선검사가 재발급을 부르지 않는다.
   *   삐용을 부르지 않으니 401 도 오지 않는다 — 즉 **MOCK 에서는 이 메서드가 돌지 않는다.**
   *   그래도 구현해 두는 이유는 인터페이스를 만족시켜야 하고, 어느 날 누가
   *   `withFreshAccess` 를 mock 위에서 시험할 때 던지지 않아야 하기 때문이다.
   */
  async reIssue(_accessToken: string, refreshToken: string): Promise<string> {
    const memberId = refreshToken.split('.')[1] ?? '0';
    return `mock-access.${memberId}.${Date.now()}`;
  }
}
