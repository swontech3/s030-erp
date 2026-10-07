/**
 * 삐용 연동 실패를 **저절로 다시 보낸다** — 운영자 요청에 묻어서, 응답 뒤에.
 *
 * =============================================================================
 * ★★★ 타이머가 아니라 **요청에 묻는다** — 서버에 삐용 토큰이 없기 때문이다
 * =============================================================================
 * `purgeTimer` 처럼 `setInterval` 로 돌리고 싶지만 **그럴 자격이 없다.** 삐용을 부르는
 * 문(`callBbiyong`)은 **사람 세션의 토큰**을 쓴다 — 「ERP 서버는 삐용 계정을 갖지
 * 않는다(결정 Q1) · 서버끼리 쓰는 API 키는 만들지 않는다」(`bbiyong/types.ts`).
 * 타이머에는 세션이 없다.
 *
 * 그래서 **운영자가 ERP 를 쓰는 동안 그 사람의 토큰으로** 뒤에서 한 번 돌린다
 * (결정 2026-10-05). 응답을 보낸 **뒤**에 돌므로 사람을 기다리게 하지 않는다.
 *
 * ★★ **한계를 분명히 적어 둔다 — 운영자가 아무도 안 들어오면 안 돈다.**
 *    주말·연휴에 확정한 계약의 연동 실패는 다음 출근까지 그대로 남는다. 그 사이
 *    그 입주사는 삐용에 로그인할 수 없다. **지금은 그 정도를 감수한다**(결정
 *    2026-10-05: 「삐용 연동이 늦어도 입주사가 하루 못 들어오는 정도다」).
 *    ★ 사람 없이 24시간 돌아야 할 이유가 생기면 **삐용과 서버용 토큰을 합의**하고
 *      이 파일을 타이머로 바꾼다 — 그때 바꾸는 것은 「누구 토큰으로 부르나」 한 줄이고,
 *      아래 판정·상한·간격은 그대로 쓴다.
 *
 * =============================================================================
 * ★★ 두 가지 상한 — 상대도 우리도 두드리지 않는다
 * =============================================================================
 *   쿨다운 60초   요청마다 DB 를 보지 않는다. 운영자가 화면을 휘젓는 동안 스윕이
 *                 수십 번 돌면 그게 곧 삐용을 두드리는 것이다
 *   한 번에 3건   요청 하나에 삐용을 20번 부르지 않는다. 남은 것은 다음 스윕이 한다
 *
 * ★ 둘 다 **프로세스 메모리**다. 서버가 여럿이면 각자 자기 쿨다운을 갖는다 —
 *   그만큼 호출이 늘지만, 그걸 맞추려면 DB 에 잠금을 두어야 하고 그건 이 일의
 *   무게에 맞지 않는다(실패 몇 건을 다시 보내는 일이다).
 *
 * =============================================================================
 * ★ 던지지 않는다
 * =============================================================================
 * 이 함수는 **응답이 이미 나간 뒤**에 돈다. 여기서 던지면 아무도 못 받고 로그만
 * 더럽힌다. 그래서 전부 삼키고 로그로만 남긴다 — 실패는 어차피 그 행에 사유로 적힌다.
 */
import type { ErpSession } from '@swonbiz/shared';
import type { FastifyBaseLogger } from 'fastify';
import { withCompanyScope, type CompanyScope } from '../db/withCompanyScope.ts';
import { listPendingLinks, type PendingLinkRow } from '../db/companies.ts';
import { judgeLinkRetry } from '../bbiyong/retryPolicy.ts';
import { retryBbiyongForCompany } from './registerOrg.ts';
import { syncMembersForCompany } from './syncMembers.ts';

/** 대기 목록은 전 입주사를 봐야 한다 — 운영사 전용 경로에서만 부른다. */
const OPERATOR_SCOPE: CompanyScope = { role: 'operator', companyId: null };

const COOLDOWN_MS = 60_000;
const MAX_PER_SWEEP = 3;

/** 마지막 스윕 시각. ★ 프로세스 메모리다(위 머리말). */
let lastSweepAt = 0;

/** 시험이 시간을 갈아 끼울 수 있게 열어 둔다. 운영 코드는 기본값을 쓴다. */
export function resetSweepCooldown(): void {
  lastSweepAt = 0;
}

/**
 * 지금 스윕할 차례인가. ★ **부르자마자 시각을 찍는다** — 같은 순간에 들어온 요청 둘이
 * 동시에 스윕을 시작하지 않게 한다(단일 스레드라 이 한 줄로 충분하다).
 */
function takeTurn(now: number): boolean {
  if (now - lastSweepAt < COOLDOWN_MS) return false;
  lastSweepAt = now;
  return true;
}

/** 다시 보낼 것만 고른다. 판정은 `retryPolicy` 가 한다 — 여기서 다시 적지 않는다. */
export function pickRetryTargets(rows: readonly PendingLinkRow[], now: number): PendingLinkRow[] {
  const due: PendingLinkRow[] = [];
  for (const row of rows) {
    const verdict = judgeLinkRetry(
      {
        attemptCount: row.link_attempt_count,
        retryable: row.link_retryable,
        failedAt: row.link_failed_at,
      },
      { now },
    );
    if (verdict.kind === 'retry') due.push(row);
  }

  /*
   * ★★ **한 회사에 한 건만** 보낸다. 회사 등록이 아직 안 된 상태라면 그 회사의 구성원
   *    연동은 보낼 곳이 없고(`syncMembers` 가 단체코드를 보고 건너뛴다), 등록이 성공하면
   *    그 자리에서 구성원까지 따라붙는다(`registerOrgForCompany`). 둘을 같이 보내면
   *    같은 회사에 호출이 두 벌 나가고 앞엣것의 결과를 뒤엣것이 모른다.
   *    ★ 회사 행(`org`)을 먼저 고른다 — 그게 선행이다.
   */
  const perCompany = new Map<string, PendingLinkRow>();
  for (const row of due) {
    const held = perCompany.get(row.company_id);
    if (!held || (held.kind === 'member' && row.kind === 'org')) perCompany.set(row.company_id, row);
  }
  return [...perCompany.values()].slice(0, MAX_PER_SWEEP);
}

/**
 * 한 번 스윕한다. **기다리지 말고 부른다**(`void`) — 응답 뒤에 도는 일이다.
 *
 * @param session 운영자 세션. ★ **이 사람의 삐용 토큰으로** 부른다. 그래서 삐용
 *   감사기록에는 그 사람이 한 일로 남는다 — 서버 계정이 없으니 다른 방법이 없다.
 */
export function sweepPendingLinks(session: ErpSession, log: FastifyBaseLogger): void {
  if (!takeTurn(Date.now())) return;

  void (async () => {
    const rows = await withCompanyScope(OPERATOR_SCOPE, (client) => listPendingLinks(client));
    const targets = pickRetryTargets(rows, Date.now());
    if (targets.length === 0) return;

    const actor = String(session.s020MemberId);
    for (const row of targets) {
      /*
       * ★ 회사 등록이 아직이면 그쪽부터다. `retryBbiyongForCompany` 는 **지금 필요한
       *   것**을 골라서 한다(등록 · 퇴실 · 재입주) — 멱등이고, 고칠 것이 없으면 삐용을
       *   부르지 않는다(그쪽 주석).
       * ★ 구성원 행이 골라졌다는 것은 회사가 이미 연결됐다는 뜻이다.
       */
      const result =
        row.kind === 'org'
          ? await retryBbiyongForCompany({ companyId: row.company_id, session, actor })
          : await syncMembersForCompany({ companyId: row.company_id, session, actor });

      // ★ 결과를 로그에 한 줄로 남긴다. 실패 사유는 그 행에 이미 적혔다.
      const what = row.kind === 'org' ? '회사 등록' : '직원정보';
      const how = 'kind' in result ? result.kind : `대기 ${result.pending.length}명`;
      log.info(`[bbiyong] 저절로 다시 보냄 — ${what} ${row.company_name} → ${how}`);
    }
  })().catch((err: Error) => {
    // ★ 응답은 이미 나갔다. 던질 곳이 없으므로 로그만 남기고 다음 스윕에 맡긴다.
    log.error({ err }, '[bbiyong] 자동 재시도 스윕 실패 — 다음 차례에 다시 한다');
  });
}
