/**
 * 삐용 직원정보 연동 — 구성원 명부 한 벌을 보고 `I`·`U`·`D` 를 가린다 (규격 2026-10-05).
 *
 * =============================================================================
 * ★★★ **던지지 않는다.** 구성원 저장은 이미 커밋됐다
 * =============================================================================
 * 이 함수가 도는 시점에 `tb_s080_members` 는 이미 고쳐져 있다(회사 등록과 같은 규칙,
 * 결정 2026-10-05). 여기서 예외를 올려보내면 저장 응답이 500 이 되고, **운영자는
 * 구성원이 저장 안 된 줄 알고 다시 누른다.**
 *
 * 그래서 어떤 실패도 그 구성원 행의 「연동 대기」다(`link_failed_reason`). 그 상태가
 * 계약 폼에 뜨고, **다음 저장이 곧 재시도다** — 버튼을 따로 만들지 않는다(한 업무는
 * 한 화면에서). 회원번호가 없는 행은 다음에도 `I` 로 나가기 때문이다.
 *
 * ★ 예외는 하나다 — `BbiyongTokenExpiredError` 는 **그대로 던진다.** `withFreshAccess`
 *   가 그것을 받아 토큰을 재발급하고 **이 함수를 처음부터 다시 부른다.** 다시 불려도
 *   안전하다: 판정의 근거가 전부 DB(`store.read()`)이고, 앞서 번호를 받은 행은 그
 *   번호가 이미 적혀 있어 `I` 가 아니라 `U` 로 나간다. 삼켜 버리면 재발급이 돌지 않고
 *   멀쩡한 세션에서 전원이 「연동 대기」가 된다.
 *
 * =============================================================================
 * ★★ 무엇을 보낼지는 「ERP 에서 새 행인가」가 아니라 **「삐용에 번호가 있는가」**로 가른다
 * =============================================================================
 * 계약 폼은 **구성원을 회사 등록보다 먼저 저장한다**(`saveTenant` → `saveContract`).
 * 그래서 신규 계약의 직원들은 삐용에 보낼 곳(단체코드)이 아직 없는 상태로 저장된다.
 * 「새 행이면 `I`」로 가르면 그 직원들은 **영영 삐용에 가지 않는다** — 다음 저장에서는
 * 이미 기존 행이기 때문이다.
 *
 * 번호를 기준으로 가르면 그 구멍이 없다:
 *
 *   번호 없음 + 직원   → `I` (바뀌지 않았어도 보낸다 — 밀린 것을 따라잡는다)
 *   번호 있음 + 바뀜   → `U`
 *   번호 있음 + 그대로 → 보내지 않는다
 *   명부에서 빠짐      → `D` (번호가 있을 때만)
 *
 * =============================================================================
 * ★★★ 대표는 `U` 하나뿐이다
 * =============================================================================
 * 삐용에서 대표는 **회사 등록으로만 생기고 지울 수 없다**(규격). 그래서 대표에게는
 * `I` 도 `D` 도 보내지 않는다 — 보내면 거절되고, 그 거절이 멀쩡한 회사에 「연동 대기」를
 * 띄운다. 대표 수정에 필요한 회원번호는 **회사 등록 응답**이 준다.
 *
 * ★ 번호를 못 받아 둔 회사(규격이 번호를 주기 전에 등록된 회사)는 대표를 고칠 길이
 *   없다. 그때는 **보내지 않고 사유만 남긴다**(결정 2026-10-05) — 사람이 삐용 화면에서
 *   직접 고친다. 지금 실제로 걸리는 것은 **코스준2(Z04) 하나뿐**이다. Z01·Z02 는
 *   MOCK 이 만든 가짜 연결이라 삐용에 그 회사가 없다.
 *
 * =============================================================================
 * 왜 저장소와 어댑터를 주입받는가 — `orgLink.ts` 와 같은 이유
 * =============================================================================
 * 이 파일에는 DB 도 fetch 도 없다. 「대표에게 `I` 를 안 보내는가」, 「번호 없는 직원이
 * 따라붙는가」, 「삭제가 먼저 나가는가」를 삐용도 DB 도 없이 시험할 수 있다.
 * DB 를 붙이는 자리는 `companies/syncMembers.ts` 다.
 */
import {
  BbiyongTokenExpiredError,
  type BbiyongMemberRequest,
  type BbiyongOrg,
  type MemberOpOutcome,
} from './types.ts';

/** 구성원 한 줄 — 삐용에 보낼 칸과 연동 상태만 추린 것. */
export interface MemberLinkRow {
  /** ERP 쪽 id(`tb_s080_members.member_id`). 삐용 번호와 다른 값이다. */
  memberId: string;
  name: string;
  email: string | null;
  phone: string | null;
  /** 대표인가 — `is_representative === 'C'`. ★ 대표는 `U` 만 보낸다. */
  isRep: boolean;
  /** 삐용 회원번호(`link_s020_member_id`). `null` 이면 아직 삐용에 없다. */
  linkMemberId: number | null;
}

export interface MemberSyncStore {
  /**
   * 그 회사의 단체코드와 구성원 두 묶음. 회사가 없으면 `null`.
   *
   * ★ `orphans` 는 **명부에서 빠졌는데 삐용 번호를 아직 들고 있는 행**이다
   *   (`status <> 'active'` + 번호 있음). `replaceMembers` 가 지우지 않고 `inactive` 로
   *   두기 때문에 이 모양으로 남는다 — 그것이 곧 「삐용에서 지울 것」 목록이다.
   * ★★ 삭제 대상을 **저장 때의 변경 내역이 아니라 DB 상태**에서 읽는다. 그래서 다시
   *   불려도 같은 일을 두 번 하지 않는다(성공하면 번호를 지우므로 다음엔 안 보인다).
   */
  read(): Promise<{ orgCode: string | null; active: MemberLinkRow[]; orphans: MemberLinkRow[] } | null>;
  /** 번호를 적고 **대기 사유를 지운다**. `U` 성공에도 쓴다(같은 번호를 다시 적는다). */
  linked(args: { memberId: string; linkMemberId: number }): Promise<void>;
  /** 삐용에서 지웠다 — 번호와 사유를 **둘 다 비운다**. */
  unlinked(args: { memberId: string }): Promise<void>;
  /**
   * ★ `reason` 은 **운영자에게 그대로 보여줄 문구**다.
   * @param retryable 다시 보내면 풀릴 종류인가 — 서버가 저절로 다시 보낼지를 이 값이
   *   가른다(`retryPolicy`). 생략하면 「모른다」이고 막지 않는다.
   */
  pending(args: { memberId: string; reason: string; retryable?: boolean }): Promise<void>;
}

/** 운영자가 읽는 대기 한 줄. */
export interface MemberPending {
  memberId: string;
  name: string;
  reason: string;
}

export interface MemberSyncResult {
  /** 삐용에 보낸 요청 수. 0 이면 아무것도 보내지 않았다. */
  sent: number;
  /** `I` 로 번호를 새로 받은 수. */
  created: number;
  updated: number;
  deleted: number;
  /** 아직 삐용에 반영되지 않은 구성원들. 화면이 이것을 띄운다. */
  pending: MemberPending[];
  /** 왜 보내지 않았는가 — 로그·시험용이다. 화면에 띄우지 않는다. */
  skipped: string[];
}

/** 하이픈·공백을 떼고 숫자만. 삐용은 숫자만 받는다(`orgLink.digitsOf` 와 같은 규칙). */
function digitsOf(value: string | null): string {
  return (value ?? '').replace(/\D/g, '');
}

const REP_NO_NUMBER =
  '삐용에 회사를 등록할 때 대표 회원번호를 받지 못해 대표 정보를 삐용에 반영하지 못했습니다. 삐용 화면에서 직접 고쳐야 합니다';

const NO_EMAIL =
  '이메일이 없어 삐용에 직원을 만들 수 없습니다(이메일이 삐용 로그인 아이디다). 이메일을 채운 뒤 다시 저장해 주세요';

/**
 * 삐용에 못 붙었거나 삐용이 규격 밖으로 답했다.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ★★★ **연락처가 겹치면 지금은 이 문구가 뜬다** — 삐용 결함이다(실측 2026-10-05)
 * ══════════════════════════════════════════════════════════════════════════
 * 이미 그 단체에 있는 `hpNo` 로 `I` 를 보내면 삐용이 **`500 Internal Server Error`**
 * 를 준다(본문 없음). 이메일 겹침은 `200 + result:'fail'` 로 「같은 회사에 같은
 * 이메일이 있습니다」를 제대로 주는데, 연락처만 처리되지 않은 예외로 터진다.
 * 대조군까지 확인했다 — 이메일만 새것 + 연락처 중복 → 500 · 둘 다 새것 → 200 created.
 *
 * 500 은 규격 밖이므로 `HttpBbiyongOrg.#post` 가 장애로 보고(`!res.ok`), 그 결과가
 * 이 문구다. **운영자는 「연결할 수 없다」를 읽는데 실제 원인은 연락처 중복**이라
 * 고칠 수가 없다.
 *
 * ★★ **ERP 가 「연락처가 겹칩니다」로 번역하지 않는다**(결정 2026-10-05, 삐용 회신으로
 *    삐용이 고치기로 했다). 500 은 **다른 이유로도 난다** — 추측해서 사유를 적으면
 *    엉뚱한 원인을 가리키고, 그건 아무 사유도 없는 것보다 나쁘다. 삐용이 이메일처럼
 *    `400 + 문구`로 바꾸면 그 문구가 그대로 그 줄에 뜬다(여기는 손댈 것이 없다).
 */
const UNAVAILABLE = '삐용에 연결할 수 없어 직원정보가 반영되지 않았습니다. 잠시 후 다시 저장해 주세요';

/** 보낼 한 건 — 무엇을 왜 보내는지 한 묶음으로 만들어 두고 한꺼번에 돈다. */
interface Plan {
  row: MemberLinkRow;
  req: BbiyongMemberRequest;
}

/**
 * 구성원 명부를 삐용에 맞춘다.
 *
 * @param changed 이번 저장에서 **값이 실제로 바뀐** ERP member_id 들. 비우면
 *   「바뀐 것은 없다」 — 번호 없는 직원을 따라붙이는 용도(회사 등록 직후)로 그렇게 부른다.
 *   ★ 이 집합이 없으면 `U` 를 매 저장마다 전원에게 보내야 한다. 그건 20명이면 20번이고,
 *     아무것도 안 바꾼 저장에도 삐용을 두드리는 모양이다.
 */
export async function syncMembers(
  store: MemberSyncStore,
  org: BbiyongOrg,
  accessToken: string,
  changed: ReadonlySet<string> = new Set(),
): Promise<MemberSyncResult> {
  const result: MemberSyncResult = { sent: 0, created: 0, updated: 0, deleted: 0, pending: [], skipped: [] };

  const found = await store.read();
  if (!found) {
    result.skipped.push('입주사를 찾을 수 없다');
    return result;
  }

  const { orgCode, active, orphans } = found;
  if (!orgCode) {
    /*
     * ★★ 삐용에 연결되지 않은 입주사다 — **보낼 곳이 없다.** 사유도 남기지 않는다:
     *    아직 계약을 확정하지 않은 회사가 전부 여기 걸리고, 그건 잘못된 상태가 아니다.
     *    확정이 끝나면 회사 등록이 `syncMembers` 를 다시 부른다(`registerOrg.ts`).
     */
    result.skipped.push('삐용에 연결되지 않은 입주사다 — 단체코드가 없다');
    return result;
  }

  // ───────────────────────────────────────────────────────────────────────
  // 계획을 먼저 세운다 — 보내지 않을 것은 여기서 다 걸러진다
  // ───────────────────────────────────────────────────────────────────────
  const plans: Plan[] = [];
  /** 보내기 전에 이미 아는 실패. 삐용을 부르지 않고 사유만 남긴다. */
  const refused: MemberPending[] = [];

  /*
   * ★★★ **삭제가 먼저다.** 직원 하나를 빼고 같은 이메일로 다른 사람을 넣는 저장이
   *    실제로 있다(담당자 교체). `I` 를 먼저 보내면 삐용이 「이미 사용중인 이메일」로
   *    거절하고, 그 직원은 대기로 남는다 — 순서만으로 막을 수 있는 실패다.
   */
  for (const row of orphans) {
    if (row.linkMemberId === null) continue; // read() 가 이미 걸렀지만 타입을 좁힌다.
    if (row.isRep) {
      // ★ 대표는 삐용에서 지울 수 없다. 번호는 **지우지 않고 그대로 둔다** —
      //   다시 대표로 살아나면 그 번호로 `U` 를 보내야 한다.
      result.skipped.push(`대표는 삐용에서 지울 수 없다 — 보내지 않는다 (${row.memberId})`);
      continue;
    }
    plans.push({
      row,
      req: {
        regTp: 'D',
        orgCode,
        memberId: row.linkMemberId,
        memberName: row.name,
        email: row.email ?? '',
        hpNo: digitsOf(row.phone),
      },
    });
  }

  for (const row of active) {
    const email = (row.email ?? '').trim();
    const base = {
      orgCode,
      memberName: row.name.trim(),
      email,
      hpNo: digitsOf(row.phone),
    };

    if (row.linkMemberId !== null) {
      // 이미 삐용에 있다 → 바뀐 것만 `U`. 대표도 이 길로 간다(대표의 유일한 길이다).
      if (!changed.has(row.memberId)) {
        result.skipped.push(`바뀐 것이 없다 — 보내지 않는다 (${row.memberId})`);
        continue;
      }
      if (!email) {
        refused.push({ memberId: row.memberId, name: row.name, reason: NO_EMAIL });
        continue;
      }
      plans.push({ row, req: { regTp: 'U', ...base, memberId: row.linkMemberId } });
      continue;
    }

    // 번호가 없다 — 아직 삐용에 없는 사람이다.
    if (row.isRep) {
      /*
       * ★ 대표는 `I` 가 거부된다. 회사 등록이 번호를 줬어야 하는데 없는 상태다.
       *   **바뀐 것이 있을 때만** 사유를 남긴다 — 매 저장마다 적으면 고칠 수도 없는
       *   배너가 영구히 뜬다(회사 쪽 [다시 시도]가 멀쩡한 회사를 망가뜨리던 것과 같은
       *   모양이다, `registerOrg.retryBbiyongForCompany` 주석).
       */
      if (changed.has(row.memberId)) {
        refused.push({ memberId: row.memberId, name: row.name, reason: REP_NO_NUMBER });
      } else {
        result.skipped.push(`대표 회원번호가 없고 바뀐 것도 없다 — 보내지 않는다 (${row.memberId})`);
      }
      continue;
    }

    if (!email) {
      // ★ 이메일은 삐용 로그인 아이디다 — 없으면 만들 수 없다. 회사 등록의
      //   `missingField` 와 같은 자리이고, 같은 모양으로 사람에게 말한다.
      refused.push({ memberId: row.memberId, name: row.name, reason: NO_EMAIL });
      continue;
    }

    // ★ ERP 가 보내는 `I` 는 **직원뿐**이므로 `repYn` 은 늘 'N' 이다(위 머리말).
    plans.push({ row, req: { regTp: 'I', ...base, repYn: 'N' } });
  }

  // 보내기 전에 아는 실패를 먼저 적는다. 삐용이 죽어 있어도 이 사유는 남는다.
  for (const p of refused) {
    // ★ 보내기 전에 아는 실패는 **전부 값 문제**다(대표 번호 없음 · 이메일 없음) —
    //   다시 보내도 같으므로 `retryable: false` 로 적어 서버가 두드리지 않게 한다.
    await store.pending({ memberId: p.memberId, reason: p.reason, retryable: false });
    result.pending.push(p);
  }

  // ───────────────────────────────────────────────────────────────────────
  // 한 건씩 보낸다
  // ───────────────────────────────────────────────────────────────────────
  for (const [index, plan] of plans.entries()) {
    let outcome: MemberOpOutcome;
    try {
      result.sent += 1;
      outcome = await org.sendMember(plan.req, accessToken);
    } catch (err) {
      // ★ 토큰 만료는 **그대로 던진다** — `withFreshAccess` 가 재발급하고 처음부터
      //   다시 부른다(파일 머리말). 삼키면 재발급이 돌지 않는다.
      if (err instanceof BbiyongTokenExpiredError) throw err;

      /*
       * 삐용 장애다. **여기서 멈춘다** — 죽은 상대를 20번 더 두드리지 않는다.
       * ★ 남은 사람들도 보내지 못한 것이 사실이므로 같은 사유를 적는다. 적지 않으면
       *   번호 있는 사람(= `U` 대상)의 변경이 조용히 사라진다 — 번호 없는 사람은
       *   다음 저장에서 `I` 로 따라붙지만, 그쪽은 「바뀐 것」을 아는 사람이 없다.
       */
      console.warn(`[bbiyong] 직원정보 실패(대기로 남긴다): ${(err as Error).message}`);
      for (const rest of plans.slice(index)) {
        await store.pending({ memberId: rest.row.memberId, reason: UNAVAILABLE, retryable: true });
        result.pending.push({ memberId: rest.row.memberId, name: rest.row.name, reason: UNAVAILABLE });
      }
      return result;
    }

    if (outcome.kind === 'created') {
      await store.linked({ memberId: plan.row.memberId, linkMemberId: outcome.memberId });
      result.created += 1;
      continue;
    }

    if (outcome.kind === 'ok') {
      if (plan.req.regTp === 'D') {
        // ★ 번호를 비운다. 그 행이 다시 살아나면 **새 사람으로 `I`** 가 나가야 한다 —
        //   지워진 번호로 `U` 를 보내면 삐용이 「없는 회원」으로 거절한다.
        await store.unlinked({ memberId: plan.row.memberId });
        result.deleted += 1;
      } else {
        // ★ 성공했으면 남아 있던 대기 사유를 지운다. 지우는 수단으로 `linked` 를 그대로
        //   쓴다 — 번호는 그대로이고, 하는 일이 「번호를 적고 사유를 지우는 것」이다
        //   (`orgLink.applyOp` 가 `saveLinked` 를 쓰는 것과 같은 구조다).
        await store.linked({ memberId: plan.row.memberId, linkMemberId: plan.req.memberId as number });
        result.updated += 1;
      }
      continue;
    }

    // 삐용이 업무 실패로 답했다 — 이메일 겹침·대표 삭제 같은 것들이다. 문구는 어댑터가
    // 사람 말로 만들어 준다. ★ 멈추지 않는다: 한 사람의 이메일이 겹친다고 나머지
    // 사람들의 저장까지 멈출 이유가 없다(장애와 다른 종류다).
    await store.pending({ memberId: plan.row.memberId, reason: outcome.message, retryable: outcome.retryable });
    result.pending.push({ memberId: plan.row.memberId, name: plan.row.name, reason: outcome.message });
  }

  return result;
}
