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

export class MockBbiyongAcl implements BbiyongAcl {
  async listScreens(subject: AclSubject): Promise<string[]> {
    const account = findMockAccount(subject.s020MemberId);
    if (!account) {
      // 세션은 있는데 mock 계정표에 없다 = 목록을 못 받은 상태. 조용히 빈 배열을 주되
      // 비정상으로 기록한다. 빈 배열이면 홈 분기가 /no-access 로 보낸다(AUTH-13).
      await writeShadowLog({
        s020MemberId: subject.s020MemberId,
        s020OrgId: subject.s020OrgId,
        screenCode: null,
        action: null,
        verdict: 'NO_GRANT_LIST',
        enforced: false,
      });
      return [];
    }
    return [...account.screens];
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
    if (account?.scope === 'operator') return { role: 'operator', companyId: null };
    return { role: 'tenant', companyId };
  }
}
