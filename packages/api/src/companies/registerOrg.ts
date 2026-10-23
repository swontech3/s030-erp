/**
 * 삐용 회사 등록을 **실제로 돌리는 자리** — `linkOrg` 에 DB 와 토큰을 붙인다.
 *
 * =============================================================================
 * ★★★ 계약 확정 트랜잭션 **밖**에서 돈다
 * =============================================================================
 * 계약 확정은 계약·청구서·예치금·이력을 한 트랜잭션으로 만들고 **커밋한다.** 이 함수는
 * 그 뒤에 불린다(대표 결정 2026-09-30). 근거 셋:
 *
 *   ① 삐용 장애로 계약 확정이 막히면 운영 업무가 멈춘다
 *   ② 삐용이 회사를 만든 뒤 ERP 커밋이 실패하면 **삐용에 고아 회사**가 남는다 —
 *      삭제 규격이 확인되지 않아 되돌릴 방법이 없다
 *   ③ HTTP 왕복 동안 계약·청구 행의 락을 잡고 있게 된다
 *
 * ★★ 그래서 이 함수도 **긴 트랜잭션을 열지 않는다.** 읽기 · 삐용 호출 · 쓰기가 각각
 *    짧은 트랜잭션이다(`OrgLinkStore` 의 메서드마다 하나). 한 트랜잭션으로 묶으면
 *    ③ 을 이 자리에서 다시 만드는 셈이다.
 *
 * =============================================================================
 * ★★ 토큰 — ERP 서버는 삐용 계정을 갖지 않는다
 * =============================================================================
 * 부르는 것은 **ERP 를 쓰는 운영사 직원의 자기 토큰**이고(결정 Q1), 그 토큰에
 * 「단체관리」(S021100010) 화면 권한이 있어야 한다. `callBbiyong` 이 그 토큰을
 * 살려서(만료면 재발급) 넘긴다.
 */
import type { ErpSession } from '@swonbiz/shared';
import { withCompanyScope, type CompanyScope } from '../db/withCompanyScope.ts';
import {
  listTakenOrgCodes,
  readOrgLinkTarget,
  saveOrgLinked,
  saveOrgLinkPending,
  saveRepMemberLink,
} from '../db/companies.ts';
import { syncMembersForCompany } from './syncMembers.ts';
import {
  bbiyongOrg,
  linkOrg,
  moduleOffOrg,
  moduleOnOrg,
  type OrgLinkResult,
  type OrgLinkStore,
} from '../bbiyong/index.ts';
import { callBbiyong } from '../session/bbiyongToken.ts';

/**
 * 채번은 **전 입주사의 코드**를 봐야 한다. 그래서 스코프를 `operator` 로 고정한다.
 *
 * ★ 이 함수를 부르는 경로는 계약 확정과 재시도 둘뿐이고 **둘 다 운영사 전용**이다
 *   (라우트가 `role !== 'operator'` 를 403 으로 막는다). 입주사 스코프로 부르면
 *   자기 코드만 보이고 **모두가 Z01 을 발급받는다** — 삐용에서 매번 중복이 난다.
 */
const OPERATOR_SCOPE: CompanyScope = { role: 'operator', companyId: null };

function dbStore(companyId: string, actor: string): OrgLinkStore {
  return {
    read: async () => {
      const found = await withCompanyScope(OPERATOR_SCOPE, async (client) => {
        const company = await readOrgLinkTarget(client, companyId);
        if (!company) return null;
        return { company, takenCodes: await listTakenOrgCodes(client) };
      });
      if (!found) return null;
      return {
        company: {
          companyId: found.company.company_id,
          companyName: found.company.company_name,
          ceoName: found.company.ceo_name,
          tel: found.company.tel,
          email: found.company.email,
          linkedOrgId: found.company.link_s020_org_id,
          linkedOrgCode: found.company.link_org_code,
          liveContractCount: found.company.live_contract_count,
        },
        takenCodes: found.takenCodes,
      };
    },
    saveLinked: async ({ orgId, orgCode, repMemberId }) => {
      await withCompanyScope(OPERATOR_SCOPE, (client) =>
        saveOrgLinked(client, { companyId, orgId, orgCode, actor }),
      );

      /*
       * ═══════════════════════════════════════════════════════════════════
       * ★★★ 대표 회원번호 — 회사 등록 응답만이 주는 값이다 (규격 2026-10-05)
       * ═══════════════════════════════════════════════════════════════════
       * 삐용에서 대표는 **회사 등록으로만 생기고 지울 수 없다.** 고치는 길은 `U`
       * 하나뿐이고 `U` 는 이 번호가 필수다 — 지금 안 적어 두면 그 회사의 대표는
       * 영원히 ERP 에서 못 고친다(삐용 회원 조회 규격이 없다).
       *
       * ★★ **실패해도 회사 연결은 되돌리지 않는다.** 여기서 던지면 `linkOrg` 가
       *    「대기」로 돌리는데, 그 회사는 **삐용에 이미 만들어져 있다** — 다음 [다시
       *    시도]는 다음 단체코드로 **회사를 하나 더 만든다.** 번호 한 칸을 못 적은
       *    것보다 그게 훨씬 나쁘다. 그래서 삼키고 로그에 남긴다.
       *
       * ★ 번호가 `null` 인 경우(응답에 없었다)는 어댑터가 이미 경고를 찍었다.
       *   여기서 또 적지 않는다 — 대표를 고치려는 순간 `memberSync` 가 사유를 남긴다.
       */
      if (repMemberId === undefined || repMemberId === null) return;
      try {
        const rows = await withCompanyScope(OPERATOR_SCOPE, (client) =>
          saveRepMemberLink(client, { companyId, linkMemberId: repMemberId, actor }),
        );
        if (rows === 0) {
          console.warn(
            `[bbiyong] 대표 회원번호 ${repMemberId} 를 적을 활성 대표 행이 없다 company=${companyId}`,
          );
        }
      } catch (err) {
        console.error(
          `[bbiyong] 대표 회원번호 저장 실패(회사 연결은 그대로 둔다) company=${companyId}: ${(err as Error).message}`,
        );
      }
    },
    savePending: async (reason) => {
      await withCompanyScope(OPERATOR_SCOPE, (client) =>
        saveOrgLinkPending(client, { companyId, reason, actor }),
      );
    },
  };
}

/**
 * 이 입주사를 삐용에 등록하고 `link_s020_org_id` 를 이어 둔다.
 *
 * **던지지 않는다.** 어떤 실패도 `pending` 이다 — 계약 확정은 이미 커밋됐고, 여기서
 * 던지면 확정 응답이 500 이 되어 운영자가 계약이 안 된 줄 안다.
 */
export async function registerOrgForCompany(args: {
  companyId: string;
  session: ErpSession;
  actor: string;
}): Promise<OrgLinkResult> {
  const { companyId, session, actor } = args;
  try {
    const result = await callBbiyong(session.erpSid, (accessToken) =>
      linkOrg(dbStore(companyId, actor), bbiyongOrg, accessToken),
    );

    /*
     * ═══════════════════════════════════════════════════════════════════════
     * ★★★ 등록이 끝나면 **밀려 있던 직원들**을 삐용에 보낸다
     * ═══════════════════════════════════════════════════════════════════════
     * 계약 폼은 구성원을 **회사 등록보다 먼저** 저장한다(`saveTenant` → `saveContract`).
     * 그때는 단체코드가 없어 보낼 곳이 없었고, 직원들은 회원번호 없이 남아 있다.
     * 여기서 보내지 않으면 그들은 **다음 구성원 저장까지 삐용에 없다** — ERP 엔 있는데
     * 삐용엔 없는 상태가 아무 표시 없이 유지된다.
     *
     * ★ `changed` 를 비워서 부른다 — 바뀐 것은 없고, 번호 없는 직원을 따라붙이는
     *   일만 한다(`syncMembers` 의 판정표).
     * ★★ 던지지 않는다. 실패는 그 구성원 행의 「연동 대기」로 남고, 회사 등록 결과
     *    (`result`)는 **그대로** 돌려준다 — 회사는 멀쩡히 연결됐다. 구성원 때문에
     *    계약 확정 화면에 「회사 연동 대기」가 뜨면 운영자가 엉뚱한 곳을 본다.
     */
    if (result.kind === 'linked') {
      const members = await syncMembersForCompany({ companyId, session, actor });
      if (members.pending.length > 0) {
        console.warn(
          `[bbiyong] 회사 등록 뒤 직원 ${members.pending.length}명이 대기로 남았다 company=${companyId}`,
        );
      }
    }

    return result;
  } catch (err) {
    /*
     * 여기까지 오는 것은 **DB 쓰기 실패**나 **재로그인 필요**(삐용 refresh 만료)다.
     * `linkOrg` 는 삐용 실패를 스스로 삼키므로 그쪽 경로가 아니다.
     *
     * ★ 사유를 DB 에 남기려 또 쓰지 않는다 — DB 가 문제일 수 있고, 그 시도가 다시
     *   던지면 원래 오류가 묻힌다. 로그에 남기고 「대기」로 답한다. `link_status` 가
     *   갱신되지 않아도 `link_s020_org_id` 가 비어 있으므로 화면은 미연동으로 본다.
     */
    console.error(`[bbiyong] 회사 등록 중 예기치 못한 실패 company=${companyId}: ${(err as Error).message}`);
    return {
      kind: 'pending',
      reason: '삐용 회사 등록이 끝나지 않았습니다. 잠시 후 다시 시도해 주세요',
    };
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   퇴실 · 재입주 — 등록과 같은 자리, 같은 규칙
   ══════════════════════════════════════════════════════════════════════════
   ★ 셋 다 **던지지 않는다.** ERP 업무(계약 확정·종료)는 이미 커밋됐고,
     여기서 던지면 그 응답이 500 이 되어 운영자가 업무가 안 된 줄 안다.
   ══════════════════════════════════════════════════════════════════════════ */

/** `callBbiyong` 을 거쳐 한 번 부른다. 예기치 못한 실패도 대기로 바꾼다(등록과 같은 catch). */
async function callOrFail(
  label: string,
  companyId: string,
  session: ErpSession,
  run: (accessToken: string) => Promise<OrgLinkResult>,
): Promise<OrgLinkResult> {
  try {
    return await callBbiyong(session.erpSid, run);
  } catch (err) {
    console.error(`[bbiyong] ${label} 중 예기치 못한 실패 company=${companyId}: ${(err as Error).message}`);
    return { kind: 'pending', reason: `삐용 ${label}이 끝나지 않았습니다. 잠시 후 다시 시도해 주세요` };
  }
}

/** 퇴실 — 계약이 종료됐다. ★ 살아 있는 계약이 남아 있으면 보내지 않는다(`moduleOffOrg`). */
export function moduleOffForCompany(args: {
  companyId: string;
  session: ErpSession;
  actor: string;
}): Promise<OrgLinkResult> {
  const { companyId, session, actor } = args;
  return callOrFail('퇴실', companyId, session, (accessToken) =>
    moduleOffOrg(dbStore(companyId, actor), bbiyongOrg, accessToken),
  );
}

/** 재입주 — 종료됐던 회사가 새 계약을 확정했다. ★ 회사를 다시 만들지 않는다. */
export function moduleOnForCompany(args: {
  companyId: string;
  session: ErpSession;
  actor: string;
}): Promise<OrgLinkResult> {
  const { companyId, session, actor } = args;
  return callOrFail('재입주', companyId, session, (accessToken) =>
    moduleOnOrg(dbStore(companyId, actor), bbiyongOrg, accessToken),
  );
}

/**
 * [다시 시도] 한 번이 **지금 필요한 것**을 한다 (결정 2026-10-03).
 *
 * ★★ 한 업무는 한 화면에서 — 계약 폼의 [다시 시도] 하나뿐이다. 버튼을 늘리지 않고
 *    회사의 **지금 상태**를 보고 고른다:
 *
 *      연결 안 됨          → 등록 (`linkOrg`) — 채번부터 한다
 *      연결됨 + 계약 없음   → 퇴실 (`moduleOff`)
 *      연결됨 + 계약 있음   → 재입주 (`moduleOn`)
 *
 * ★ 회사 수정은 여기서 다시 보내지 않는다(결정 2026-10-23) — 회사 수정은 실패를 「연동 대기」로
 *   남기지 않고 저장 응답의 배너로만 알린다. 다시 보내는 길은 계약 폼 [저장] 이고, 저장마다 값 있는
 *   다섯 칸을 모두 보낸다(`companies/companyOrgSync.ts`).
 */
export async function retryBbiyongForCompany(args: {
  companyId: string;
  session: ErpSession;
  actor: string;
}): Promise<OrgLinkResult> {
  const { companyId } = args;

  const found = await withCompanyScope(OPERATOR_SCOPE, (client) => readOrgLinkTarget(client, companyId));
  if (!found) return { kind: 'not_found' };

  if (found.link_s020_org_id === null || !found.link_org_code) {
    return registerOrgForCompany(args);
  }

  /*
   * ★★★ **고칠 것이 없으면 삐용을 부르지 않는다.**
   *
   * 이 가드가 없으면 멀쩡한 회사의 [다시 시도]가 재입주를 보내고, 삐용이 「이미 이용 중」
   * 으로 거부하고, 그 거부가 `pending` 이 되어 **아무 문제 없는 회사에 「연동 대기」
   * 배너가 뜬다** — 버튼을 눌러 상태를 **망가뜨리는** 셈이다.
   *
   * ★ 「고칠 것이 있는가」의 근거는 `link_status` 다. 실패하면 `savePending` 이 이 값을
   *   `pending` 으로 적고, 성공하면 `saveLinked` 가 `linked` 로 되돌린다. 삐용 쪽 구독
   *   상태를 따라 적는 사본이 아니라 **우리 호출이 끝났는지**를 적는 값이다.
   */
  if (found.link_status === 'linked') {
    return { kind: 'already', orgId: found.link_s020_org_id };
  }

  return found.live_contract_count > 0 ? moduleOnForCompany(args) : moduleOffForCompany(args);
}

/**
 * 계약이 **확정**됐다 — 삐용에 신규 등록인지, 재입주인지, 보낼 것이 없는지 가린다.
 *
 * =============================================================================
 * ★★★ 재입주와 **재계약**을 가린다 — 가르지 않으면 정상 재계약에 경고가 뜬다
 * =============================================================================
 * 재계약은 삐용이 **계속 켜져 있다.** 거기에 재입주(`module-on`)를 보내면 삐용이
 * 「이미 이용 중」으로 거부하고, 그 거부가 `pending` 이 되어 **아무 문제 없는 계약에
 * 「연동 대기」 배너가 뜬다.** 그래서 보내기 전에 ERP 가 가른다.
 *
 * 가르는 근거는 둘 다 ERP 가 확실히 아는 값이다 — 삐용 응답 문구를 짐작하지 않는다:
 *
 *   `closedPrevious` 가 있다       재계약이다(이 트랜잭션이 이전 계약을 닫았다) → 보낼 것 없음
 *   살아 있는 계약이 1개           그 전에는 0개였다 = 삐용이 꺼져 있었다        → 재입주
 *   살아 있는 계약이 2개 이상      이미 입주 중인 회사가 계약을 더 했다          → 보낼 것 없음
 *
 * ★ 연결돼 있지 않으면 재입주가 아니라 신규다 — `registerOrgForCompany` 가 채번부터 한다.
 */
export async function onContractConfirmed(args: {
  companyId: string;
  session: ErpSession;
  actor: string;
  /** 이 확정이 닫은 이전 계약. 있으면 **재계약**이다. */
  closedPrevious: string | null;
}): Promise<OrgLinkResult> {
  const { companyId, closedPrevious } = args;

  const found = await withCompanyScope(OPERATOR_SCOPE, (client) => readOrgLinkTarget(client, companyId));
  if (!found) return { kind: 'not_found' };

  // 아직 삐용에 없다 → 신규 등록(채번 · 중복 재시도 · 실패 보관은 linkOrg 가 한다).
  if (found.link_s020_org_id === null || !found.link_org_code) {
    return registerOrgForCompany(args);
  }

  if (closedPrevious !== null) {
    return { kind: 'skipped', why: '재계약이다 — 삐용은 계속 이용 중이라 보낼 것이 없다' };
  }
  if (found.live_contract_count !== 1) {
    return { kind: 'skipped', why: '이미 입주 중인 회사다 — 계약이 하나 더 늘었을 뿐이다' };
  }

  // 종료됐던 회사가 다시 들어왔다. ★ 회사를 다시 만들지 않는다.
  return moduleOnForCompany(args);
}
