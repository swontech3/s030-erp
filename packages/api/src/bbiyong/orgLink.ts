/**
 * 삐용 회사 등록 — 채번하고, 중복이면 다음 번호로, 실패하면 사유를 남긴다.
 *
 * =============================================================================
 * ★★★ **던지지 않는다.** 계약 확정은 이미 커밋됐다
 * =============================================================================
 * 이 함수가 도는 시점에 계약은 이미 「계약중」이고 청구서도 만들어져 있다(대표 결정
 * 2026-09-30). 여기서 예외를 올려보내면 확정 응답이 500 이 되고, **운영자는 계약이
 * 안 된 줄 알고 다시 확정을 누른다** — 청구서가 두 벌 생기지는 않지만(멱등) 그
 * 혼란만으로도 충분히 나쁘다.
 *
 * 그래서 어떤 실패도 `pending` 이다. `pending` 은 「계약은 됐고 삐용 연결만 아직」이고,
 * 그 상태가 화면에 보이며 [다시 시도] 로 되살릴 수 있다.
 *
 * =============================================================================
 * 왜 저장소와 어댑터를 주입받는가
 * =============================================================================
 * 이 파일에는 DB 도 fetch 도 없다. 「Z01 부터 채번하는가」, 「중복이면 다음 번호로
 * 가는가」, 「99개를 다 쓰면 멈추는가」를 **삐용도 DB 도 없이** 시험할 수 있다.
 * DB 를 붙이는 자리는 `companies/registerOrg.ts` 다.
 */
import { firstFreeOrgCode, nextOrgCode } from '@swonbiz/shared/domain/org-code';
import type {
  BbiyongOrg,
  BbiyongOrgRequest,
  CreateOrgOutcome,
  OrgOpOutcome,
} from './types.ts';

/**
 * 삐용에 등록할 입주사 — **필요한 칸만** 추린 것.
 *
 * 매핑 근거는 `@swonbiz/shared` 의 `tenant-registration.ts` 다.
 *   `companyName` → `orgName` · `ceoName` → `memberName` · `email` → `email`
 *   `tel`         → `hpNo`  ★ 대표 **휴대전화**다. 계약 폼의 「연락처」 칸이고
 *                             placeholder 가 `010-0000-0000` 이다. ERP 에 회사 전화
 *                             칸이 없으므로 `telNo`(선택)는 보내지 않는다(결정 2026-09-30).
 */
export interface OrgLinkTarget {
  companyId: string;
  companyName: string | null;
  ceoName: string | null;
  tel: string | null;
  email: string | null;
  /** 이미 연결됐으면 그 org_id. ★ 값이 있으면 **다시 만들지 않는다.** */
  linkedOrgId: number | null;
  /**
   * 이미 발급된 단체코드. 퇴실·재입주·수정이 **이 코드로 회사를 지목한다**.
   *
   * ★ `linkedOrgId` 와 함께 저장되므로 둘은 같이 있거나 같이 없다. 그래도 따로 보는 것은
   *   org_id 가 있는데 코드가 없는 행(손으로 고친 자료)이 생겼을 때 조용히 엉뚱한 회사를
   *   끄지 않게 하기 위해서다.
   */
  linkedOrgCode: string | null;
  /**
   * 지금 **살아 있는 계약**이 몇 개인가 (`confirmed` · `draft`).
   *
   * ★★ 퇴실·재입주를 이 값으로 가른다 — ERP 는 「삐용에서 지금 켜져 있는가」를 따로
   *    적지 않는다(결정 2026-10-03). 사본을 두면 반드시 어긋나고, 어긋난 사본은 멀쩡한
   *    회사를 끄는 쪽으로 틀린다. 판정의 근거는 **ERP 의 계약**이고, 중복 호출은 삐용이
   *    거부한다.
   * ★ 판정은 `isPreviousLive` 와 같은 어휘다 — 계약중·계약대기가 살아 있는 것이다.
   */
  liveContractCount: number;
}

export interface OrgLinkStore {
  /**
   * 등록할 회사와 **이미 쓰인 단체코드 전부**. 회사가 없으면 `null`.
   *
   * ★ `takenCodes` 는 ERP 가 발급한 코드 목록이다. 삐용 쪽에 ERP 가 모르는 Z 코드가
   *   있으면 중복으로 돌아오고, 그때 다음 번호로 넘어간다.
   */
  read(): Promise<{ company: OrgLinkTarget; takenCodes: string[] } | null>;
  saveLinked(args: { orgId: number; orgCode: string }): Promise<void>;
  /** ★ `reason` 은 **운영자에게 그대로 보여줄 문구**다. */
  savePending(reason: string): Promise<void>;
}

export type OrgLinkResult =
  | { kind: 'linked'; orgId: number; orgCode: string }
  /** 이미 연결돼 있었다. 아무것도 하지 않았다. */
  | { kind: 'already'; orgId: number }
  /** 계약은 확정됐고 연결만 아직이다. `reason` 이 화면에 뜬다. */
  | { kind: 'pending'; reason: string }
  /** 퇴실·재입주·수정이 삐용에 반영됐다. */
  | { kind: 'synced'; op: OrgOp }
  /** 보낼 것이 없었다 — 연결되지 않은 회사이거나 바뀐 것이 없다. */
  | { kind: 'skipped'; why: string }
  | { kind: 'not_found' };

/** 삐용에 보낼 수 있는 일. 등록은 `linkOrg` 가 따로 한다. */
export type OrgOp = 'off' | 'on' | 'patch';

/**
 * 중복 응답을 몇 번까지 따라갈 것인가.
 *
 * ★★ 상한이 없으면 삐용이 모든 코드를 중복이라고 답하는 동안 **99번 두드린다.**
 *    그건 장애 상황에서 상대를 더 때리는 모양이고, 사람이 볼 응답도 그만큼 늦어진다.
 *    여기서 멈추면 「대기」로 남고 [다시 시도] 가 이어서 한다.
 */
const MAX_ATTEMPTS = 10;

/**
 * 보낼 구독 모듈 — **고정이다**(삐용 회신 2026-10-01).
 *
 * ★ 계약에서 읽지 않는다. 지금 ERP 가 파는 것은 공유오피스 하나이고, 권한관리(AUTHZ)는
 *   그 회사 대표가 역할 화면을 쓰려면 필요하다. 계약마다 서비스가 갈리는 날 계약에서
 *   읽어 오는 자리로 바꾼다(연동규격 §2-3 `[결정 Q3]`).
 */
export const ORG_MODULE_CODES = ['OFFICE', 'AUTHZ'] as const;

/** 하이픈·공백을 떼고 숫자만. 삐용은 숫자만 받는다(`tenant-registration` 의 `digitsOnly`). */
function digitsOf(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * 삐용에 보낼 수 있는 상태인가. 못 보낼 값이면 **사람에게 할 말**을 돌려준다.
 *
 * ★ 화면은 이 칸들을 필수로 막는다. 여기서 또 보는 것은 API 를 직접 부르는 경로와,
 *   회사명 없이 임시저장된 가계약이 나중에 확정되는 경로가 있기 때문이다.
 */
function missingField(company: OrgLinkTarget): string | null {
  const required: [label: string, value: string | null][] = [
    ['회사명', company.companyName],
    ['대표자명', company.ceoName],
    ['대표 휴대전화', company.tel],
    ['대표 이메일', company.email],
  ];
  const missing = required.filter(([, v]) => !v || !v.trim()).map(([label]) => label);
  if (missing.length === 0) return null;
  return `${missing.join(' · ')}이(가) 비어 있어 삐용에 회사를 만들 수 없습니다. 입주사 정보를 채운 뒤 다시 시도해 주세요`;
}

function requestFor(company: OrgLinkTarget, orgCode: string): BbiyongOrgRequest {
  return {
    orgName: (company.companyName ?? '').trim(),
    orgCode,
    memberName: (company.ceoName ?? '').trim(),
    hpNo: digitsOf(company.tel ?? ''),
    email: (company.email ?? '').trim(),
    // ★ 운영자가 고르는 값이 아니다 — 항상 KR.
    countryCode: 'KR',
    // ★★ ['OFFICE', 'AUTHZ'] 고정 — 삐용 회신 2026-10-01 로 OFFICE 가 열렸다(types.ts).
    //    그 전까지는 빈 배열이었다.
    moduleCodes: ORG_MODULE_CODES,
  };
}

export async function linkOrg(
  store: OrgLinkStore,
  org: BbiyongOrg,
  accessToken: string,
): Promise<OrgLinkResult> {
  const target = await store.read();
  if (!target) return { kind: 'not_found' };

  const { company, takenCodes } = target;

  // ★★ 이미 연결됐으면 **아무것도 하지 않는다.** 이것이 없으면 [다시 시도] 를 두 번
  //    누른 운영자가 삐용에 회사를 둘 만들고, 둘 중 하나는 아무도 모르는 채 남는다.
  if (company.linkedOrgId !== null) return { kind: 'already', orgId: company.linkedOrgId };

  const missing = missingField(company);
  if (missing) {
    await store.savePending(missing);
    return { kind: 'pending', reason: missing };
  }

  let orgCode = firstFreeOrgCode(takenCodes);
  if (orgCode === null) {
    const reason =
      '발급할 단체코드가 없습니다(Z01~Z99 를 모두 사용했습니다). 삐용에 코드 대역 확장을 요청해야 합니다';
    await store.savePending(reason);
    return { kind: 'pending', reason };
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS && orgCode !== null; attempt += 1) {
    let outcome: CreateOrgOutcome;
    try {
      outcome = await org.createOrg(requestFor(company, orgCode), accessToken);
    } catch (err) {
      /*
       * ★ 삐용 장애·토큰 만료다. **던지지 않는다**(파일 머리말). 다시 시도하면 풀릴
       *   종류이므로 그렇게 안내한다.
       *
       * ★★ 알려진 구멍: 삐용이 회사를 만든 **뒤** 응답이 유실되면 그 코드는 삐용에
       *    남고, 다음 시도는 그것을 중복으로 만나 **다음 번호로 넘어간다** — 삐용에
       *    쓰이지 않는 회사 한 개가 남는다. 중복 응답의 `data.orgId` 를 가져다 쓰면
       *    막을 수 있지만 그 값이 **남의 회사일 수 있어** 쓰지 않는다(types.ts).
       *    3-5(실호출) 전에 삐용과 정리할 항목이다.
       */
      console.warn(`[bbiyong] 회사 등록 실패(대기로 남긴다): ${(err as Error).message}`);
      const reason = '삐용에 연결할 수 없어 회사 등록이 끝나지 않았습니다. 잠시 후 다시 시도해 주세요';
      await store.savePending(reason);
      return { kind: 'pending', reason };
    }

    if (outcome.kind === 'created') {
      await store.saveLinked({ orgId: outcome.orgId, orgCode: outcome.orgCode });
      return { kind: 'linked', orgId: outcome.orgId, orgCode: outcome.orgCode };
    }

    if (outcome.kind === 'rejected') {
      // 삐용이 업무 실패로 답했다. 문구는 어댑터가 이미 사람 말로 바꿔서 준다.
      await store.savePending(outcome.message);
      return { kind: 'pending', reason: outcome.message };
    }

    // 중복 — 다음 번호로. ★ 응답의 orgId 는 쓰지 않는다(types.ts).
    orgCode = nextOrgCode(outcome.orgCode);
  }

  const reason =
    '사용할 수 있는 단체코드를 찾지 못했습니다. 잠시 후 다시 시도해 주세요(계속되면 삐용에 문의해야 합니다)';
  await store.savePending(reason);
  return { kind: 'pending', reason };
}

/* ══════════════════════════════════════════════════════════════════════════
   퇴실 · 재입주 · 수정 (삐용 회신 2026-10-02)
   ══════════════════════════════════════════════════════════════════════════
   ★★★ 등록과 **같은 규칙**이다 — 던지지 않고, 실패는 `pending` 이며, 사유는 운영자가
        그대로 읽는 문구다. `savePending` 을 새로 만들지 않고 그대로 쓴다.

   ★★ **ERP 는 「삐용에서 지금 켜져 있는가」를 적지 않는다**(결정 2026-10-03).
      판정의 근거는 ERP 의 계약(`hasLiveContract`)이고, 두 번 보내는 것은 막지 않는다 —
      삐용이 거부한다. 사본을 두면 반드시 어긋나고, 어긋난 사본은 **멀쩡한 회사를 끄는**
      쪽으로 틀린다. 그래서 `link_status` 에 'out' 같은 값을 더하지 않았다(마이그레이션 0).
   ══════════════════════════════════════════════════════════════════════════ */

/** 삐용에 보낸 한 번의 결과를 ERP 상태로 옮긴다. 실패는 전부 `pending` 이다. */
async function applyOp(
  store: OrgLinkStore,
  company: OrgLinkTarget,
  op: OrgOp,
  label: string,
  run: () => Promise<OrgOpOutcome>,
): Promise<OrgLinkResult> {
  let outcome: OrgOpOutcome;
  try {
    outcome = await run();
  } catch (err) {
    // ★ 삐용 장애·토큰 만료. 던지지 않는다 — ERP 업무(계약 종료·회사명 수정)는 이미 끝났다.
    console.warn(`[bbiyong] ${label} 실패(대기로 남긴다): ${(err as Error).message}`);
    const reason = `삐용에 연결할 수 없어 ${label}이 반영되지 않았습니다. 잠시 후 다시 시도해 주세요`;
    await store.savePending(reason);
    return { kind: 'pending', reason };
  }

  if (outcome.kind === 'ok') {
    /*
     * ★★ 성공했으면 **남아 있던 대기 사유를 지운다.** 지우지 않으면 퇴실이 한 번 실패한
     *    뒤 [다시 시도]로 성공해도 화면에 배너가 그대로 남는다.
     *
     * ★ 지우는 수단으로 `saveLinked` 를 그대로 쓴다 — 그 함수가 하는 일이 「연결됨으로
     *   적고 실패를 지우는 것」이고, org_id·코드는 바뀌지 않으므로 같은 값을 다시 쓴다.
     *   전용 `clearPending` 을 새로 만들지 않는다(등록에서 쓰는 구조를 그대로 쓴다).
     */
    await store.saveLinked({ orgId: company.linkedOrgId as number, orgCode: company.linkedOrgCode as string });
    return { kind: 'synced', op };
  }

  await store.savePending(outcome.message);
  return { kind: 'pending', reason: outcome.message };
}

/**
 * 퇴실 — 계약이 종료돼 **살아 있는 계약이 하나도 남지 않았을 때** OFFICE 를 끈다.
 *
 * ★★ 살아 있는 계약이 남아 있으면 **보내지 않는다.** 한 회사가 호실 둘을 계약했다가
 *    하나만 끝낸 경우가 그렇다 — 거기서 끄면 아직 입주해 있는 회사가 삐용을 못 쓴다.
 */
export async function moduleOffOrg(
  store: OrgLinkStore,
  org: BbiyongOrg,
  accessToken: string,
): Promise<OrgLinkResult> {
  const target = await store.read();
  if (!target) return { kind: 'not_found' };
  const { company } = target;

  if (company.linkedOrgId === null || !company.linkedOrgCode) {
    return { kind: 'skipped', why: '삐용에 연결되지 않은 입주사다 — 끌 것이 없다' };
  }
  if (company.liveContractCount > 0) {
    return { kind: 'skipped', why: '살아 있는 계약이 남아 있다 — 아직 퇴실이 아니다' };
  }

  const orgCode = company.linkedOrgCode;
  return applyOp(store, company, 'off', '퇴실', () => org.moduleOff(orgCode, accessToken));
}

/**
 * 재입주 — 종료됐던 회사가 새 계약을 확정했다. ★ **회사를 다시 만들지 않는다.**
 *
 * ★ 연결돼 있지 않으면 재입주가 아니라 신규다 — `linkOrg` 가 할 일이다.
 */
export async function moduleOnOrg(
  store: OrgLinkStore,
  org: BbiyongOrg,
  accessToken: string,
): Promise<OrgLinkResult> {
  const target = await store.read();
  if (!target) return { kind: 'not_found' };
  const { company } = target;

  if (company.linkedOrgId === null || !company.linkedOrgCode) {
    return { kind: 'skipped', why: '삐용에 연결되지 않은 입주사다 — 신규 등록이 할 일이다' };
  }

  const orgCode = company.linkedOrgCode;
  return applyOp(store, company, 'on', '재입주', () => org.moduleOn(orgCode, accessToken));
}

/**
 * 회사명 수정 — 삐용의 단체명을 ERP 값으로 맞춘다.
 *
 * ★★★ **주소를 보내지 않는다**(`BbiyongOrgPatch` 에 칸이 없다). 빈 문자열로 보내면
 *    삐용에 들어 있는 주소가 지워지고 되돌릴 수 없다 — ERP 가 가진 주소는 **대표자
 *    자택**이라 애초에 그 자리에 들어갈 값이 아니다.
 */
export async function patchOrgName(
  store: OrgLinkStore,
  org: BbiyongOrg,
  accessToken: string,
): Promise<OrgLinkResult> {
  const target = await store.read();
  if (!target) return { kind: 'not_found' };
  const { company } = target;

  if (company.linkedOrgId === null || !company.linkedOrgCode) {
    return { kind: 'skipped', why: '삐용에 연결되지 않은 입주사다 — 반영할 곳이 없다' };
  }

  const orgName = (company.companyName ?? '').trim();
  if (!orgName) {
    // ★ 회사명은 NOT NULL 이지만 빈 문자열이 들어갈 수 있다(가계약). 빈 이름을 보내면
    //   삐용의 단체명을 지우는 셈이라 보내지 않는다.
    const reason = '회사명이 비어 있어 삐용에 반영할 수 없습니다. 입주사 정보를 채운 뒤 다시 시도해 주세요';
    await store.savePending(reason);
    return { kind: 'pending', reason };
  }

  const orgCode = company.linkedOrgCode;
  return applyOp(store, company, 'patch', '회사 수정', () => org.patchOrg({ orgCode, orgName }, accessToken));
}
