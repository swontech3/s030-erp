/**
 * 삐용 직원정보 연동을 **실제로 돌리는 자리** — `syncMembers` 에 DB 와 토큰을 붙인다.
 *
 * =============================================================================
 * ★★★ 구성원 저장 트랜잭션 **밖**에서 돈다
 * =============================================================================
 * `PUT /companies/:id/members` 는 명부를 한 트랜잭션으로 고치고 **커밋한다.** 이
 * 함수는 그 뒤에 불린다 — 회사 등록(`registerOrg.ts`)과 같은 규칙이고 근거도 같다:
 *
 *   ① 삐용 장애로 구성원 저장이 막히면 운영 업무가 멈춘다
 *   ② 삐용에 직원을 만든 뒤 ERP 커밋이 실패하면 **삐용에 고아 회원**이 남는다
 *   ③ HTTP 왕복(최대 20명)동안 구성원 행의 락을 잡고 있게 된다
 *
 * ★★ 그래서 이 함수도 **긴 트랜잭션을 열지 않는다.** 읽기 · 삐용 호출 · 쓰기가 각각
 *    짧은 트랜잭션이다(`MemberSyncStore` 의 메서드마다 하나).
 *
 * =============================================================================
 * ★ 스코프는 운영사다
 * =============================================================================
 * 구성원은 운영사 업무다(`routes/companies.ts` 는 `role !== 'operator'` 를 403 으로
 * 막는다). 여기서 입주사 스코프로 열면 RLS 가 **조용히 0행**을 주고, 보낼 것이 없다고
 * 판단해 버린다 — 틀렸는데 성공으로 보이는 모양이다.
 *
 * ★ `registerOrg.ts` 의 `OPERATOR_SCOPE` 와 같은 값이다. 한 곳에 모으지 않은 것은
 *   두 파일이 서로를 import 하게 되기 때문이고, 상수 한 줄이라 베끼는 쪽이 낫다.
 */
import type { ErpSession } from '@swonbiz/shared';
import { withCompanyScope, type CompanyScope } from '../db/withCompanyScope.ts';
import {
  readMemberSyncTargets,
  saveMemberLinked,
  saveMemberPending,
  saveMemberUnlinked,
} from '../db/companies.ts';
import {
  bbiyongOrg,
  syncMembers,
  type MemberChanges,
  type MemberSyncResult,
  type MemberSyncStore,
} from '../bbiyong/index.ts';
import { callBbiyong } from '../session/bbiyongToken.ts';

const OPERATOR_SCOPE: CompanyScope = { role: 'operator', companyId: null };

function dbStore(companyId: string, actor: string): MemberSyncStore {
  return {
    read: async () => {
      const found = await withCompanyScope(OPERATOR_SCOPE, (client) =>
        readMemberSyncTargets(client, companyId),
      );
      if (!found) return null;
      const toRow = (r: {
        member_id: string;
        name: string;
        email: string | null;
        phone: string | null;
        is_representative: string;
        link_s020_member_id: number | null;
      }) => ({
        memberId: r.member_id,
        name: r.name,
        email: r.email,
        phone: r.phone,
        // ★ 코드값('C'/'M')은 DB 어휘다. 판정 함수는 boolean 으로 본다(`MEMBER_ROLE`).
        isRep: r.is_representative === 'C',
        linkMemberId: r.link_s020_member_id,
      });
      return {
        orgCode: found.orgCode,
        active: found.active.map(toRow),
        orphans: found.orphans.map(toRow),
      };
    },
    linked: async ({ memberId, linkMemberId }) => {
      await withCompanyScope(OPERATOR_SCOPE, (client) =>
        saveMemberLinked(client, { companyId, memberId, linkMemberId, actor }),
      );
    },
    unlinked: async ({ memberId }) => {
      await withCompanyScope(OPERATOR_SCOPE, (client) =>
        saveMemberUnlinked(client, { companyId, memberId, actor }),
      );
    },
    pending: async ({ memberId, reason }) => {
      await withCompanyScope(OPERATOR_SCOPE, (client) =>
        saveMemberPending(client, { companyId, memberId, reason, actor }),
      );
    },
  };
}

/** 아무것도 하지 못했을 때의 결과. ★ 던지는 대신 이것을 돌려준다. */
const nothing = (why: string): MemberSyncResult => ({
  sent: 0,
  created: 0,
  updated: 0,
  deleted: 0,
  pending: [],
  skipped: [why],
});

/**
 * 이 입주사의 구성원을 삐용에 맞춘다.
 *
 * **던지지 않는다.** 구성원 저장은 이미 커밋됐고, 여기서 던지면 저장 응답이 500 이 되어
 * 운영자가 저장이 안 된 줄 안다(`registerOrgForCompany` 와 같은 규칙).
 *
 * @param changed 이번 저장에서 **값이 실제로 바뀐** ERP member_id 와 그 칸들
 *   (`replaceMembers` 가 돌려준 `changed`). 비우고 부르면 「바뀐 것은 없다」이고,
 *   번호 없는 직원을 따라붙이는 일만 한다 — 회사 등록 직후가 그 경우다.
 */
export async function syncMembersForCompany(args: {
  companyId: string;
  session: ErpSession;
  actor: string;
  changed?: MemberChanges;
}): Promise<MemberSyncResult> {
  const { companyId, session, actor, changed } = args;
  try {
    return await callBbiyong(session.erpSid, (accessToken) =>
      syncMembers(dbStore(companyId, actor), bbiyongOrg, accessToken, changed ?? new Map()),
    );
  } catch (err) {
    /*
     * 여기까지 오는 것은 **DB 쓰기 실패**나 **재로그인 필요**(삐용 refresh 만료)다.
     * `syncMembers` 는 삐용 업무 실패와 장애를 스스로 삼키므로 그쪽 경로가 아니다.
     *
     * ★ 사유를 DB 에 남기려 또 쓰지 않는다 — DB 가 문제일 수 있고, 그 시도가 다시
     *   던지면 원래 오류가 묻힌다(회사 등록과 같은 판단). 번호가 비어 있는 행은 다음
     *   저장에서 다시 `I` 로 나가므로 조용히 사라지지는 않는다.
     */
    console.error(`[bbiyong] 직원정보 연동 중 예기치 못한 실패 company=${companyId}: ${(err as Error).message}`);
    return nothing('삐용 직원정보 연동을 끝내지 못했다 — 다음 저장에서 다시 보낸다');
  }
}
