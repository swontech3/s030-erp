/**
 * MockBbiyongAuth — 삐용 로그인 API 회신 ⑦ 이 오기 전까지 쓰는 대역.
 *
 * 지시서 2-8 의 Mock 계정 4종을 그대로 구현한다. 이 4개로 페이즈 1 완료 기준의
 * 홈 분기(admin·operator → /dashboard, tenant → /booking, noaccess → /no-access)를
 * 전부 확인할 수 있다.
 *
 * ★ 비밀번호는 계정마다 다르지 않다. `MOCK_PASSWORD` 하나이고, 틀리면 실패한다 —
 *   로그인 화면의 에러 표시(showError)를 실제로 띄워 볼 수 있어야 하기 때문이다.
 *   비밀번호가 무엇이든 통과시키면 그 경로가 죽은 코드로 남는다.
 */
import { BbiyongAuthError, type BbiyongAuth, type BbiyongLoginResult, type BbiyongProfile } from './types.ts';

/** 개발용 고정 비밀번호. 실제 삐용 연동으로 바뀌면 사라진다. */
export const MOCK_PASSWORD = 'erp1234!';

interface MockAccount extends Omit<BbiyongLoginResult, 'accessToken' | 'refreshToken'> {
  email: string;
  /** 이 계정이 접근 가능한 화면. MockBbiyongAcl 이 같은 표를 본다. */
  screens: string[];
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
    screens: ['s0300000050', 's0300000060', 's0300600010'],
  },
  {
    email: 'operator@s-wontech.co.kr',
    memberId: 1002,
    orgId: 1,
    orgTp: 'S',
    memberName: '박운영',
    orgName: '에스원비즈',
    screens: ['s0300000050', 's0300000060', 's0300600010'],
  },
  {
    email: 'tenant@test.com',
    memberId: 2001,
    orgId: 9001,
    orgTp: 'C',
    memberName: '홍길동',
    orgName: '주식회사 비앤케이넷',
    screens: ['s0300000050', 's0300600010'],
  },
  {
    email: 'noaccess@test.com',
    memberId: 2002,
    orgId: 9002,
    orgTp: 'C',
    memberName: '무권한',
    orgName: '미구독 회사',
    screens: [],
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
      throw new BbiyongAuthError('이메일 또는 비밀번호가 올바르지 않습니다');
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
}
