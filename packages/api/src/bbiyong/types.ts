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
 * 재발급도 실패했다 — **되살릴 방법이 없으니 다시 로그인하라**는 안내.
 *
 * ★ web 의 `lib/forward.ts` 가 세션 없는 요청에 쓰는 문구와 **같은 문장**이다.
 *   사용자에게는 같은 상황이므로 문구가 달라야 할 이유가 없다.
 */
export const RELOGIN_MESSAGE = '세션이 만료되었습니다. 다시 로그인해 주세요';

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
 * 2단계 로그인 팝업(s030000010p1)은 아직 만들지 않는다 — 겸직 계정이 실제로 없다.
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
 * 삐용이 **HTTP 401** 을 줬다 — 실은 토큰이 만료·무효라는 뜻이다.
 *
 * ★★ 이것을 `BbiyongUnavailableError` 로 뭉개면 안 된다. 그게 2026-09-30 에 고친
 *    바로 그 증상이다: 토큰이 만료되면 화면에 「서버에 연결할 수 없습니다」가 떴다.
 *    삐용은 멀쩡히 살아 있는데 사용자는 네트워크를 의심하며 새로 고침을 반복했다.
 *
 * ★ 이 예외는 **바깥으로 새어나가지 않는 것이 정상이다.** `withFreshAccess` 가 받아서
 *   재발급(auth/re-issue)을 한 번 시도하고, 그래도 안 되면
 *   `BbiyongReloginRequiredError` 로 바꿔 던진다. 라우트가 이 예외를 직접 보게 되면
 *   재발급을 거치지 않은 호출 경로가 있다는 뜻이다.
 *
 * ★ 로그인(`sign-in`)은 이 예외를 쓰지 않는다 — 삐용은 로그인 실패를 **HTTP 200 +**
 *   **본문 result:'fail'** 로 준다. 401 이 오는 것은 토큰을 싣는 호출뿐이다.
 */
export class BbiyongTokenExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BbiyongTokenExpiredError';
  }
}

/**
 * 재발급까지 실패했다 — **세션을 되살릴 방법이 없다.** 다시 로그인해야 한다.
 *
 * ★ `BbiyongAuthError` 를 상속하므로 기존 401 번역 경로를 그대로 탄다. 다만 이것은
 *   「비밀번호가 틀렸다」가 아니라 「만료됐다」이므로 문구와 오류코드가 다르다
 *   (`session_expired`).
 *
 * ★★ 이 예외가 나가는 자리에서 **ERP 세션도 폐기한다**(`revoked_at`). 삐용 refresh 가
 *    죽었으면 그 ERP 세션(7일)으로는 삐용을 다시 부를 수 없다 — 살려 두면 사용자가
 *    같은 오류를 반복해서 만난다. 폐기하면 다음 요청이 곧바로 /login 으로 간다.
 */
export class BbiyongReloginRequiredError extends BbiyongAuthError {
  constructor(message: string = RELOGIN_MESSAGE) {
    super(message);
    this.name = 'BbiyongReloginRequiredError';
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
  constructor(
    message: string,
    /** 삐용이 HTTP 비정상(401 밖)으로 답했을 때 그 상태. 못 붙었거나 본문이 깨졌으면 없다. */
    readonly httpStatus?: number,
  ) {
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

  /**
   * access 토큰 재발급 — 새 access 토큰을 돌려준다. refresh 는 **회전하지 않는다.**
   *
   * ★★ **이 메서드가 인터페이스에 있는 이유**: 2026-09-30 까지 재발급은
   *    `HttpBbiyongAuth` 에만 있고 `BbiyongAuth` 에는 없어서, 어댑터 경계 바깥에서는
   *    **부를 수가 없었다.** 그래서 만들어만 두고 아무도 안 부르는 함수였고,
   *    토큰이 만료되면 화면에 「서버에 연결할 수 없습니다」가 떴다.
   *
   * ★ 만료 시각을 계산해서 미리 부르는 책임은 여기 없다 — `withFreshAccess` 가 진다.
   *   실패하면 `BbiyongReloginRequiredError` 를 던진다(되살릴 방법이 없다).
   */
  reIssue(accessToken: string, refreshToken: string): Promise<string>;

  /**
   * 내 메뉴(`GET /s021000000/my-menus`, 연동규격 §1-5) — **받은 토큰 그대로** 부른다.
   * 법무 회사 정보 「받기」가 삐용이 실어 온 토큰을 확인하는 자리다(2026-10-23).
   *
   * ★ 재발급하지 않는다 — ERP 가 가진 토큰이 아니다. 만료 · 무효(401)와 삐용의 업무 거절은
   *   `rejected` 다. 연결 · 규격 문제는 `BbiyongUnavailableError` 를 던진다.
   */
  myMenus(accessToken: string): Promise<MyMenusOutcome>;
}

/** 내 메뉴 결과 — `ok` 면 삐용 화면코드 목록(대문자 그대로). */
export type MyMenusOutcome = { kind: 'ok'; screens: string[] } | { kind: 'rejected' };

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

// =============================================================================
// 회사(단체) 등록 — 3-2. `POST /rest/v1/s021100010/erp-register-org` (회신 2026-10-14)
// =============================================================================

/**
 * 삐용에 보내는 회사+대표 등록 요청. **회사와 대표가 한 번의 호출로 함께 만들어진다.**
 *
 * ★★ 필드 구성의 근거는 `@swonbiz/shared` 의 `tenant-registration.ts` 다 — 항목마다
 *    `sink` 가 붙어 있고, `sink: 'bbiyong' | 'both'` 인 것만 여기 있다. 항목을 더하기
 *    전에 그 파일에서 `sink` 를 먼저 정한다. **삐용은 모르는 필드를 오류 없이 조용히
 *    버리므로**, 여기 없는 값을 넣어 두고 저장됐다고 믿는 것이 이 타입이 막는 사고다.
 *
 * ★ 일부러 **없는** 것들:
 *   · `zipCode`·`address`·`detailAddress` — 그 칸이 받는 것은 **대표자 자택 주소**이고
 *     삐용 `org010.ADDRESS` 는 사업장 주소다. 보내면 대표자 집 주소가 회사 주소로
 *     등록되고 세금계산서·계약서에 인쇄된다. **수정 API 도 없어 되돌릴 수 없다.**
 *   · `telNo`(회사 전화) — ERP 계약 폼에 전화 칸이 「연락처」 하나뿐이고 그것이
 *     대표 휴대전화(`hpNo`)다. 같은 값을 두 칸에 보내지 않는다. 선택 항목이다.
 *   · `pwd`·`org_tp`·`member_tp`·`mailAgentYn` — `NEVER_SENT` 참조.
 *   · `bizNumber` · 법인번호 · 업태 · 종목 — 등록에는 싣지 않고 회사 수정으로만 보낸다
 *     (sink `erp+patch`, 결정 2026-10-23 · `BbiyongOrgPatch`).
 */
export interface BbiyongOrgRequest {
  orgName: string;
  /** ★ `Z01`~`Z99`. 삐용이 이 Z 접두사로 「ERP 가 만든 회사」를 알아본다(회신 5). */
  orgCode: string;
  /** 대표자명. 삐용 계정을 받는 사람이고 세금계산서에 찍는 이름이다(같은 사람으로 못 박았다). */
  memberName: string;
  /** 대표 휴대전화. **숫자만** 보낸다. */
  hpNo: string;
  /** 대표 이메일 = 로그인 아이디. */
  email: string;
  /** 항상 `'KR'`. 운영자가 고르는 값이 아니다. */
  countryCode: 'KR';
  /**
   * 구독 모듈. ★★ **`['OFFICE', 'AUTHZ']` 고정이다**(삐용 회신 2026-10-01).
   *
   * 2026-10-01 전까지는 빈 배열이었다(회신 2) — ERP 서비스 5종이 삐용에서 `use_yn='N'`
   * 이었고, 켜지지 않은 코드를 보내면 **회사가 아예 만들어지지 않는다.** 회신으로
   * `OFFICE` 가 열렸고 `AUTHZ`(권한관리, 2026-09-27 추가)를 함께 보낸다.
   *
   * ★ 계약별로 고르지 않는다 — 지금 ERP 가 파는 것은 공유오피스 하나다. 계약마다
   *   서비스가 갈리면 그때 계약에서 읽어 온다(연동규격 §2-3 「계약한 서비스를 함께
   *   보낸다」 `[결정 Q3]`).
   * ★★ 쓸 수 없는 코드를 보내면 본문 `status: 400` 「○○(CODE) 은(는) 지금 선택할 수
   *    없는 서비스입니다」가 온다 — 회사는 만들어지지 않는다(연동규격 §2-4).
   */
  moduleCodes: readonly string[];
}

/**
 * ★★★ ERP 가 다루는 구독 모듈 — **이 한 줄이 정본이다.**
 *
 * 등록(`createOrg`) · 퇴실(`moduleOff`) · 재입주(`moduleOn`) **세 곳이 모두 이것을 본다.**
 * 2026-10-04 까지는 등록만 이 목록을 쓰고 퇴실·재입주는 `HttpBbiyongOrg` 안에 박힌
 * `OFFICE` 한 글자를 따로 들고 있었다 — 그래서 **등록은 둘을 켜는데 퇴실은 하나만 끄는**
 * 상태였다. 모듈이 늘거나 줄면 여기만 고친다.
 *
 * ★ `types.ts` 에 둔 이유: `orgLink`(등록 요청을 만드는 쪽)와 `HttpBbiyongOrg`(실제로
 *   보내는 쪽)가 **둘 다 이미 이 파일을 보고 있다.** 어느 한쪽에 두면 다른 쪽이 그쪽을
 *   import 해야 하고, 그건 방향이 이상한 의존이 된다.
 */
export const ORG_MODULE_CODES = ['OFFICE', 'AUTHZ'] as const;

/**
 * 등록 결과. **업무 실패는 예외가 아니라 결과다** — 호출자가 그걸 보고 다음 행동을 정한다.
 *
 * ★ 삐용 장애·토큰 만료는 여기 없다. 그것들은 `BbiyongUnavailableError` ·
 *   `BbiyongTokenExpiredError` 로 던져진다(인프라 문제와 업무 실패는 다른 일이다).
 */
export type CreateOrgOutcome =
  | {
      kind: 'created';
      orgId: number;
      orgCode: string;
      /**
       * 대표 회원번호 — 회사 등록 응답의 `data.memberId`(규격 2026-10-05 에 추가됐다).
       *
       * ★★ **반드시 저장한다**(`tb_s080_members.link_s020_member_id`). 삐용에서 대표는
       *    지울 수도 새로 만들 수도 없어서, 대표 정보를 고치는 유일한 길이 이 번호로
       *    보내는 `U` 다. 못 받아 두면 그 회사의 대표는 영원히 ERP 에서 못 고친다.
       *
       * ★ `null` 이면 **회사 등록 자체는 성공이다** — 거절로 바꾸지 않는다. 회사는
       *   이미 삐용에 있고, 여기서 실패로 돌리면 다음 시도가 다음 단체코드로 회사를
       *   하나 더 만든다(`orgLink.ts` 의 「알려진 구멍」과 같은 자리). 번호만 비는
       *   것이고, 그 사실은 대표 행의 실패 사유로 남는다.
       */
      memberId: number | null;
    }
  /**
   * 「이미 사용중인 단체코드입니다」 — 호출자가 **다음 번호로 다시 시도한다**.
   *
   * ★★ 삐용은 이 응답에 `data.orgId` 를 함께 준다. **그 값을 가져다 쓰지 않는다.**
   *    그 회사는 같은 코드를 이미 쓰는 **남의 회사**일 수 있고, 그 org_id 를 우리
   *    입주사에 연결하면 그 입주사가 남의 데이터를 보게 된다 — 격리의 뿌리가
   *    `link_s020_org_id` 하나다(`domain/org-code.ts` 의 `nextOrgCode` 주석).
   */
  | { kind: 'duplicate_code'; orgCode: string }
  /**
   * 삐용이 업무 실패로 답했다. `message` 는 **운영자에게 그대로 보여줄 문구**다 —
   * 삐용 내부 메시지를 그대로 흘리지 않는다.
   *
   * `retryable: false` 는 **같은 조건으로 다시 눌러도 안 풀린다**는 뜻이다. 권한이
   * 없거나(AUTHZ_DENY) 값이 규격에 안 맞는 경우다 — 계정이나 값을 바꿔야 한다.
   */
  | { kind: 'rejected'; message: string; retryable: boolean };

/**
 * 회사 등록 포트. mock / http 를 갈아 끼우는 자리다.
 *
 * ★★ `accessToken` 을 인자로 받는다 — **ERP 서버는 삐용 계정을 갖지 않는다**(결정 Q1).
 *    부르는 것은 **ERP 를 쓰는 운영사 직원의 자기 토큰**이고, 그 토큰에 「단체관리」
 *    (S021100010) 화면 권한이 있어야 한다. 서버끼리 쓰는 API 키는 만들지 않는다.
 *    토큰을 살려서 넘기는 일은 `session/bbiyongToken.ts` 의 `callBbiyong` 이 한다.
 */
/**
 * 퇴실 · 재입주 · 수정의 결과 (삐용 회신 2026-10-02).
 *
 * ★ 등록(`CreateOrgOutcome`)과 달리 **돌려받을 식별자가 없다.** 이미 그 회사가 누구인지
 *   알고 부르는 것이고(단체코드로 지목한다), 중복 재시도도 없다 — 코드를 새로 뽑지 않는다.
 *
 * ★★ 두 번 보내면 삐용이 거부한다(이미 꺼져 있다 / 이미 켜져 있다). 그것도 `rejected` 다 —
 *    ERP 가 미리 막지 않는다. 막으려면 「지금 삐용에서 켜져 있는가」를 ERP 가 따라 적어야
 *    하고, 그 사본은 반드시 어긋난다. 판정은 삐용이 한다.
 */
export type OrgOpOutcome =
  | { kind: 'ok' }
  /** `message` 는 **운영자에게 그대로 보여줄 문구**다. */
  | { kind: 'rejected'; message: string; retryable: boolean };

/**
 * 입주사 회사 정보 → 삐용 회사 수정(`erp-patch-org`, 결정 2026-10-23) — 회사명 · 사업자번호 · 법인번호 ·
 * 업태 · 종목. 번호는 **숫자만** 싣는다(삐용 회신 2026-10-23).
 *
 * ★★★ 주소 3칸은 **일부러 없다**(constants.ts) — ERP 계약 폼의 주소는 대표자 자택이다.
 * ★★ 값이 없는 칸은 **칸째 뺀다**(`undefined`). 빈 문자열(`""`)로 보내면 삐용 값이 지워진다 —
 *    되돌릴 수 없다. 운영자가 칸을 비워 저장해도 보내지 않는다(결정 2026-10-23).
 * ★ ERP 칸 → 이 모양은 `companies/companyOrgSync.ts` 한 곳에서 만든다.
 */
export interface BbiyongOrgPatch {
  orgCode: string;
  orgName?: string;
  bizNumber?: string;
  corpNumber?: string;
  businessType?: string;
  businessItem?: string;
}

/**
 * 법무 비입주사 회사 정보 → 삐용 회사 수정(같은 `erp-patch-org`, 결정 2026-10-22).
 * 맞추는 것은 **본점 주소 3칸 · 사업자번호 · 법인번호**뿐이다. 회사명 · 업태 · 종목은 보내지 않는다.
 *
 * ★★ 값이 없는 칸은 **칸째 뺀다**(`undefined`). 빈 문자열(`""`)로 보내면 삐용에 들어 있는 값이
 *    지워진다(`patchOrg` 머리말과 같은 경고) — 되돌릴 수 없다.
 * ★ 주소는 법무의 **본점**(`head_*`)이다. 대표자 자택(`ceo_*`)을 여기 넣지 않는다.
 * ★ 법무 칸 → 이 모양은 `legal/legalOrgSync.ts` 한 곳에서 만든다(번호 모양도 거기서 정한다).
 */
export interface BbiyongOrgLegalPatch {
  orgCode: string;
  zipCode?: string;
  address?: string;
  detailAddress?: string;
  bizNumber?: string;
  corpNumber?: string;
}

// =============================================================================
// 단체 조회 — 법무 서비스(S04)의 공용 회사 조회 팝업이 쓴다 (2026-10-09)
// =============================================================================

/**
 * 삐용 단체 한 곳. **조회 결과로만 쓰고 ERP DB 에 복사하지 않는다** — 회사 정본은 삐용 단체다.
 *
 * ★★ 삐용 단체 조회 API **규격이 아직 없다.** 이 모양은 ERP 가 필요한 것을 먼저 적은 것이고,
 *    규격이 오면 `HttpBbiyongOrg` 가 그 응답을 이 모양으로 옮긴다.
 */
export interface BbiyongOrgInfo {
  orgId: number;
  orgCode: string;
  orgName: string;
  /** 대표자명. 삐용이 안 주면 null. */
  repName: string | null;
  /**
   * 단체 상태. ★ **어휘가 정해지지 않았다**(규격 없음) — 해석하지 않고 그대로 보여 준다.
   *   규격이 오면 그때 코드로 묶는다.
   */
  status: string | null;
}

/**
 * 목록 조건. ★ 결과는 **「법무 서비스를 받은 회사」** 다(삐용 회신 2026-10-09) — 거르는 것은
 * 삐용 몫이고 ERP 는 받은 목록을 그대로 보여 준다. 단체코드 대역(Z 등)으로 거르지 않는다.
 */
export interface BbiyongOrgSearch {
  /** 회사명 일부. 빈 문자열이면 받은 목록 전부. */
  name: string;
}

/** 단건 조건 — 단체 ID 또는 단체코드 하나. */
export type BbiyongOrgKey = { orgId: number } | { orgCode: string };

/**
 * 조회 결과.
 *
 * ★ `unsupported` 는 **장애가 아니다** — 「삐용에 그 API 가 아직 없다」이다. 장애
 *   (`BbiyongUnavailableError`)로 던지면 화면에 「인증 서버에 연결할 수 없습니다」가 떠서
 *   삐용이 꺼진 것처럼 읽힌다.
 */
export type OrgLookupOutcome<T> =
  | { kind: 'ok'; value: T }
  /** `message` 는 운영자에게 그대로 보여줄 문구다. */
  | { kind: 'unsupported'; message: string };

export interface BbiyongOrg {
  createOrg(req: BbiyongOrgRequest, accessToken: string): Promise<CreateOrgOutcome>;
  /** 단체 목록 — 회사명 검색, 법무 서비스를 받은 회사(`BbiyongOrgSearch`). */
  listOrgs(search: BbiyongOrgSearch, accessToken: string): Promise<OrgLookupOutcome<BbiyongOrgInfo[]>>;
  /** 단체 한 곳 — 없으면 `value: null`. */
  getOrg(key: BbiyongOrgKey, accessToken: string): Promise<OrgLookupOutcome<BbiyongOrgInfo | null>>;
  /** 퇴실 — OFFICE 구독을 끈다. 계약이 종료될 때. */
  moduleOff(orgCode: string, accessToken: string): Promise<OrgOpOutcome>;
  /** 재입주 — OFFICE 구독을 다시 켠다. ★ 회사를 다시 만들지 않는다. */
  moduleOn(orgCode: string, accessToken: string): Promise<OrgOpOutcome>;
  /** 회사명 수정. ★ 주소는 보내지 않는다. */
  patchOrg(patch: BbiyongOrgPatch, accessToken: string): Promise<OrgOpOutcome>;
  /** 법무 비입주사 회사 정보 수정 — 본점 주소 · 사업자번호 · 법인번호, 값 있는 칸만(). */
  patchOrgLegal(patch: BbiyongOrgLegalPatch, accessToken: string): Promise<OrgOpOutcome>;
  /** 직원정보 — 신규·수정·삭제. ★ 대표는 `U` 만 보낸다(`BbiyongMemberRequest`). */
  sendMember(req: BbiyongMemberRequest, accessToken: string): Promise<MemberOpOutcome>;
}

// =============================================================================
// 직원정보 — `POST /rest/v1/s021100010/erp-member` (삐용 규격 2026-10-05)
// =============================================================================

/**
 * 구성원 한 명에 대한 한 번의 요청. **엔드포인트는 하나이고 `regTp` 가 가른다.**
 *
 * ★★★ **대표(`repYn: 'Y'`)는 `I` 와 `D` 가 거부된다.** 대표는 회사 등록으로만 생기고
 *    삐용에서 지울 수 없다 — 고치는 길은 `U` 하나뿐이다. 그 판정은 보내기 전에
 *    `memberSync.ts` 가 하고, 이 타입은 「무엇을 보냈는가」만 말한다.
 *
 * ★ `repYn` 은 **`I` 에서만 쓰는 칸이다**(규격). 그리고 ERP 가 `I` 를 보내는 것은
 *   직원뿐이므로 실제로 나가는 값은 늘 `'N'` 이다 — 그래도 칸을 지우지 않는다.
 *   삐용이 기본값을 어떻게 두는지 모르는 채 생략하면, 어느 날 대표로 만들어질 수 있다.
 */
export interface BbiyongMemberRequest {
  /** `I` 신규 · `U` 수정 · `D` 삭제. */
  regTp: 'I' | 'U' | 'D';
  /** 단체코드(`Z01`~`Z99`). 필수 — 어느 회사의 직원인지다. */
  orgCode: string;
  /**
   * 삐용 회원번호. ★ `I` 는 **보내지 않는다**(아직 없다), `U`·`D` 는 필수다.
   * 값의 출처는 `erp-member` 의 `I` 응답 또는 회사 등록 응답(대표)이다.
   */
  memberId?: number;
  /**
   * ★ `I`·`D` 는 늘 싣는다. `U` 는 **바뀐 칸만 · 값이 있을 때만** 싣는다(결정 2026-10-23) — 없으면
   *   칸째 뺀다(빈 문자열은 삐용 값을 지운다). `memberName`·`email`·`hpNo` 셋 다 같은 규칙이다.
   */
  memberName?: string;
  /** 로그인 아이디다. ★ 겹치면 삐용이 거절한다 — 그 문구를 운영자에게 그대로 보인다. */
  email?: string;
  /** 연락처. 선택 항목이고 **숫자만** 보낸다(회사 등록의 `hpNo` 와 같은 규칙). */
  hpNo?: string;
  /** 대표여부. ★ `I` 에서만 쓴다. ERP 가 보내는 `I` 는 직원뿐이라 늘 `'N'` 이다. */
  repYn?: 'Y' | 'N';
}

/**
 * 직원정보 한 번의 결과. **업무 실패는 예외가 아니라 결과다**(회사 등록과 같은 규칙).
 *
 * ★ `created` 는 `I` 에만 온다 — 그 번호를 저장하지 않으면 그 직원은 다음 저장에서
 *   또 `I` 로 나가고 삐용에 같은 사람이 둘 생긴다(이메일이 겹쳐 거절되므로 실제로는
 *   둘이 되지 않고 **영원히 대기로 남는다**).
 */
export type MemberOpOutcome =
  | { kind: 'created'; memberId: number }
  | { kind: 'ok' }
  | { kind: 'rejected'; message: string; retryable: boolean };

/** shadow 로그에 남길 요청 맥락. 판정에는 쓰지 않는다. */
export interface AclLogContext {
  route?: string;
  httpMethod?: string;
}
