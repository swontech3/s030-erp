/**
 * MockBbiyongAcl — 권한 조회 API 규격(회신 ⑫)이 오기 전까지 쓰는 대역.
 *
 * ★ 이 파일의 존재 이유가 "회신을 기다리지 않는 것"이다. 삐용이 화면 목록
 *   엔드포인트를 주면 `HttpBbiyongAcl` 하나만 새로 쓰고, 나머지 코드는 손대지 않는다.
 *
 * 3가지가 서로 다른 규칙을 따른다 — 섞으면 안 된다.
 *   listScreens  : 삐용이 준 목록 그대로. ERP 가 역할로 거르지 않는다(ACL-07′)
 *   canAccess    : **1단계 shadow — 항상 true.** 목록에 없으면 DENY 로 기록만 한다
 *   getScope     : **shadow 아님.** 1단계부터 강제. 여기가 뚫리면 명부가 샌다
 */
import { findMockAccount } from './MockBbiyongAuth.ts';
import { writeShadowLog } from '../db/shadowLog.ts';
import type { AclAction, AclLogContext, AclScope, AclSubject, BbiyongAcl } from './types.ts';

/* ══════════════════════════════════════════════════════════════════════════
   ★★★ 임시 — 실연동 로그인으로 화면을 열어 보기 위한 자리. 지울 것이다
   ══════════════════════════════════════════════════════════════════════════
   `BBIYONG_MOCK=false` 로 **실제 삐용 계정**으로 로그인하면 회원번호가 mock 계정표
   (1001·1002·2001·2002)에 없다. 그러면 `listScreens` 가 빈 배열을, `getScope` 가
   `tenant` 를 주어 **화면이 하나도 안 열린다**(2026-10-04 실측 — 운영사 라우트는 403).

   ★★ **사람이 아니라 단체(org)로 가른다**(2026-10-04 결정). 처음에는 회원번호
      둘(최현수 1 · 이정희 34)만 적었는데, 그러면 **입주사 직원이 로그인할 때마다
      이름을 더해야 한다** — 입주사도 직원도 계속 바뀌므로 유지될 수 없는 방식이다.
      `AclSubject` 에 `s020OrgId` 가 있어 단체로 가르는 데 아무것도 더 필요 없다.

        orgId === 1 (에스원테크, 운영사)  → 운영사 화면
        그 밖의 org                        → 입주사 기본 화면

   ★ 사람별 구분이 없다. 같은 회사면 누구나 같은 화면을 본다 — 그래서 **임시**다.

   ★★ **권한 실연결(`HttpBbiyongAcl` · 회신 ⑫ · `GET /rest/v1/s021000000/my-menus`)이
      되면 이 블록을 통째로 지운다.** 그때는 삐용이 사람마다 화면 목록을 준다.
      이 파일 자체가 그때 사라진다.

   ★ 화면 목록을 여기 **다시 적지 않는다.** mock 계정(운영사 1002 · 입주사 2001)에서
     그대로 끌어온다 — 두 벌이면 화면이 늘 때 한쪽만 늘고, 「운영사인데 안 보이는
     화면」이 생긴다.

   ★ mock **계정표(`MOCK_ACCOUNTS`)에는 더하지 않았다.** 거기 넣으면 `BBIYONG_MOCK=true`
     로 되돌렸을 때 실제 이메일이 **고정 비밀번호로 로그인되는 계정**이 되어 버린다.
     여기는 권한 판정만 하는 자리이고, 로그인은 삐용이 한다.

   ★ mock 계정은 **이 규칙보다 먼저** 본다. 안 그러면 `noaccess@test.com`(org 9002,
     화면 0개로 빈 스코프를 확인하는 계정)이 입주사 화면을 받아 버리고, 그 계정으로
     지키던 것이 사라진다(`verify-2-8` A1).

   ★ 연결(`link_s020_org_id`)이 없는 org 는 `companyId` 가 null 이라 RLS 가 0건을
     준다 — 메뉴는 보여도 **남의 자료가 보이지는 않는다**(fail-closed).
   ══════════════════════════════════════════════════════════════════════════ */

/** 운영사 단체. 에스원테크 한 곳이다(`MockBbiyongAuth` 머리말 · 회신 2026-09-12). */
const OPERATOR_ORG_ID = 1;

/** 화면 목록은 mock 계정에서 끌어온다 — 두 벌로 적지 않는다(위 ★). */
const screensOf = (memberId: number): string[] => [...(findMockAccount(memberId)?.screens ?? [])];

/** ★ 임시 — mock 계정표에 없는 **실제 삐용 계정**을 단체로 가른다. 위 블록과 함께 지운다. */
function tempScreensForOrg(orgId: number): string[] {
  return orgId === OPERATOR_ORG_ID ? screensOf(1002) : screensOf(2001);
}

/** ★ 임시 — 같은 규칙의 스코프 판정. 화면만 주고 스코프를 안 주면 라우트가 403 이다. */
function tempScopeForOrg(orgId: number, companyId: string | null): AclScope {
  return orgId === OPERATOR_ORG_ID
    ? { role: 'operator', companyId: null }
    : { role: 'tenant', companyId };
}

export class MockBbiyongAcl implements BbiyongAcl {
  async listScreens(subject: AclSubject): Promise<string[]> {
    const account = findMockAccount(subject.s020MemberId);
    if (account) return [...account.screens];

    /*
     * mock 계정표에 없다 = **실제 삐용 계정**이다(`BBIYONG_MOCK=false`).
     *
     * ★ 기록은 **그대로 남긴다.** 「목록을 못 받았다」는 사실은 여전히 참이고, 아래의
     *   단체 기준 화면은 삐용이 준 것이 아니라 ERP 가 임시로 지어낸 것이다. 이 줄이
     *   남아 있어야 나중에 「누가 임시 규칙으로 들어왔나」를 셀 수 있다.
     */
    await writeShadowLog({
      s020MemberId: subject.s020MemberId,
      s020OrgId: subject.s020OrgId,
      screenCode: null,
      action: null,
      verdict: 'NO_GRANT_LIST',
      enforced: false,
    });

    /*
     * ★ 임시 — 예전에는 여기서 **빈 배열**을 주었고(홈 분기가 /no-access 로 보낸다,
     *   AUTH-13), 그래서 실제 계정으로는 화면이 하나도 안 열렸다. 권한 실연결 전까지만
     *   단체로 갈라 화면을 준다(파일 머리말). 그때 이 return 만 `[]` 로 되돌리면 된다.
     */
    return tempScreensForOrg(subject.s020OrgId);
  }

  /**
   * ★★ 1단계 shadow — **항상 true 를 반환한다.**
   *
   * 목록에 없는 화면이어도 통과시키고 DENY 로 기록만 남긴다. 지금 차단하면 삐용
   * 마스터에 화면이 등록되기 전(회신 ⑮ 대기)이라 정상 사용자가 전부 막힌다.
   * 3단계에서 `enforced` 를 켤 때 이 return 만 바뀐다.
   */
  async canAccess(
    screenCode: string,
    action: AclAction,
    subject: AclSubject,
    ctx?: AclLogContext,
  ): Promise<boolean> {
    const screens = await this.listScreens(subject);
    if (!screens.includes(screenCode)) {
      // 기록은 기다리지 않는다(리뷰 L6) — writeShadowLog 가 스스로 실패를 삼키고, 화면 렌더가
      // 로그 INSERT 지연을 떠안을 이유가 없다.
      void writeShadowLog({
        s020MemberId: subject.s020MemberId,
        s020OrgId: subject.s020OrgId,
        screenCode,
        action,
        verdict: 'DENY',
        route: ctx?.route ?? null,
        httpMethod: ctx?.httpMethod ?? null,
        enforced: false, // 1단계에서는 막지 않는다
      });
    }
    // ALLOW 는 기록하지 않는다(ORG §4-5).
    return true;
  }

  /**
   * ★★★ 데이터 스코프 — **shadow 대상이 아니다.**
   *
   * ★★ scope 는 ERP 가 판정하지 않는다. 삐용 권한 조회 응답이 준다(회신 ⑫).
   *    orgTp 로 유도하던 코드가 2026-09-12 제거됐다 — **RLS 전체열람 스위치였다**
   *    (org_tp='S' → role 'operator' → app.current_role → erp_is_operator() → 6테이블 전체 행).
   *    Mock 은 그 자리를 계정표의 `scope` 필드로 대신한다 — 유도하지 않고 계정마다 박아 둔다.
   *
   * ★ operator 는 companyId 를 갖지 않는다(전체 스코프). tenant 는 넘어온 companyId 그대로이고,
   *   연결이 없어 null 이면 그건 예외가 아니라 **빈 스코프**다 — 목록 API 가 0건을 반환한다.
   *   여기서 "null 이면 전체"로 처리하는 순간 8월 명부 유출이 그대로 재현된다.
   * ★ 계정표에 없는 주체는 tenant 로 닫는다(fail-closed).
   */
  getScope(subject: AclSubject, companyId: string | null): AclScope {
    const account = findMockAccount(subject.s020MemberId);
    if (account) {
      return account.scope === 'operator'
        ? { role: 'operator', companyId: null }
        : { role: 'tenant', companyId };
    }

    /*
     * ★ 임시 — 실제 삐용 계정. `listScreens` 와 **같은 규칙**으로 가른다(파일 머리말).
     *   화면만 주고 스코프를 안 주면 사이드바는 보이는데 운영사 전용 라우트가 전부
     *   403 이다 — 2026-10-04 에 실제로 그 상태였다.
     *   예전 동작은 `return { role: 'tenant', companyId }` 였고, 권한 실연결되면 그리 돌린다.
     */
    return tempScopeForOrg(subject.s020OrgId, companyId);
  }
}
