/**
 * MockBbiyongOrg — 삐용 회사 등록 대역(3-2).
 *
 * =============================================================================
 * ★★ 삐용을 **실제로 부르지 않는다**
 * =============================================================================
 * 회신 2·3·4 가 오지 않아 실호출은 3-5 다. 지금 맞춰 두는 것은 **ERP 쪽 코드**다 —
 * 채번·중복 재시도·연결 저장·실패 보관까지 전부 여기서 돌려 보고, 3-5 에서는
 * 이 파일 자리에 `HttpBbiyongOrg` 를 끼우는 것만 남게 한다.
 *
 * =============================================================================
 * ★★★ 중복 재시도는 **시험이 지킨다** — mock 이 임의로 거절하지 않는다
 * =============================================================================
 * 이 저장소의 mock 은 보통 실패 경로를 일부러 살려 둔다(`MockBbiyongAuth` 는 비밀번호가
 * 틀리면 실패시킨다 — 「통과시키면 그 경로가 죽은 코드로 남는다」). 여기서는 그렇게
 * 하지 않는다. 특정 코드를 미리 점유해 두면 **모든 등록이 그 구멍을 매번 다시 밟아**
 * 호출이 두 번씩 나가고, 검증 스크립트가 보는 번호도 `Z01` 이 아니게 된다.
 *
 * 대신 중복·소진·거절 경로는 `orgLink.test.ts` 가 대역 어댑터로 **직접** 돌린다.
 * 즉 그 코드는 시험되지 않은 채 남아 있지 않다 — 그게 원래 목적이었다.
 *
 * ★ 같은 프로세스 안에서는 두 번째 등록이 같은 코드를 쓰면 실제로 중복을 돌려준다
 *   (아래 `#byCode`). 재기동하면 비어 있다 — 진실원은 ERP DB 쪽 `link_org_code` 다.
 */
import type {
  BbiyongOrg,
  BbiyongOrgPatch,
  BbiyongOrgRequest,
  CreateOrgOutcome,
  OrgOpOutcome,
} from './types.ts';

/**
 * mock org_id 의 기준값. 실제 번호는 `기준값 + 단체코드의 숫자` 다 — `Z01` → 9101.
 *
 * ★ `MockBbiyongAuth` 가 쓰는 9001·9002 와 겹치지 않게 띄워 둔다. 겹치면 새로 등록한
 *   회사가 `tenant@test.com` 의 조직과 같은 번호를 갖고, `link_s020_org_id` 의
 *   UNIQUE 에 걸려 저장이 실패한다 — 원인을 찾기 어려운 자리다.
 *
 * ★★ **번호를 단체코드에서 유도한다 — 증가 카운터가 아니다.** 카운터로 두면 프로세스를
 *    재기동할 때마다 9100 부터 다시 시작하고, 앞선 실행이 남긴 `link_s020_org_id` 와
 *    부딪혀 UNIQUE 위반이 난다(2026-09-30 검증 중 실제로 났다). 단체코드는 ERP 쪽에서
 *    UNIQUE 이므로 그것에서 유도하면 번호도 자동으로 유일해지고, 재기동에도 같은
 *    코드가 같은 번호를 받는다.
 */
export const MOCK_ORG_ID_BASE = 9100;

export class MockBbiyongOrg implements BbiyongOrg {
  /** 이 프로세스가 만든 회사들. 코드 → org_id. */
  readonly #byCode = new Map<string, number>();

  /**
   * OFFICE 구독이 켜져 있는 코드들 — 퇴실·재입주가 이것을 본다.
   *
   * ★ 등록하면 켜진 상태로 들어간다(`moduleCodes` 에 OFFICE 를 보내므로).
   * ★★ 재기동하면 비어 있다. 그래서 **모르는 코드는 거부하지 않고 통과시킨다**(아래
   *    `#known`) — 그러지 않으면 API 를 재기동한 뒤 기존 입주사의 퇴실이 전부 실패한다.
   *    「두 번 보내면 거부」는 이 프로세스가 아는 코드에서만 재현된다. 중복 거부 경로를
   *    시험하는 것은 `MockBbiyongOrg.test.ts` 와 `orgLink.test.ts` 다.
   */
  readonly #officeOn = new Set<string>();

  /** 이 프로세스가 아는 코드인가. 모르면 중복 판정을 하지 않는다(위 주석). */
  #known(orgCode: string): boolean {
    return this.#byCode.has(orgCode);
  }

  async createOrg(req: BbiyongOrgRequest, _accessToken: string): Promise<CreateOrgOutcome> {
    /*
     * ★ 삐용이 400 으로 막는 것들을 mock 도 막는다. 여기서 통과시키면 3-5 에서 처음
     *   터지고, 그때는 「어제까지 되던 것」이 안 되는 모양으로 보인다.
     */
    if (!/^[A-Za-z0-9]{3}$/.test(req.orgCode)) {
      return { kind: 'rejected', message: '단체코드가 규격에 맞지 않습니다', retryable: false };
    }
    for (const [key, value] of [
      ['회사명', req.orgName],
      ['대표자명', req.memberName],
      ['대표 휴대전화', req.hpNo],
      ['대표 이메일', req.email],
    ] as const) {
      if (!value) {
        return { kind: 'rejected', message: `${key}이(가) 없어 삐용에 등록할 수 없습니다`, retryable: false };
      }
    }

    const existing = this.#byCode.get(req.orgCode);
    if (existing !== undefined) {
      // ★ orgId 를 결과에 담지 않는다 — 호출자가 그것을 쓰면 안 되는 값이다(types.ts).
      return { kind: 'duplicate_code', orgCode: req.orgCode };
    }

    // ★ 코드에서 유도한다(위 주석). `Z01` → 9101. ERP 코드가 아니면 뒤 2자리를 그대로 쓴다.
    const orgId = MOCK_ORG_ID_BASE + (Number(req.orgCode.slice(1)) || 0);
    this.#byCode.set(req.orgCode, orgId);
    // ★ 등록은 OFFICE 를 켠 상태로 만든다 — moduleCodes 에 OFFICE 를 보내기 때문이다.
    if (req.moduleCodes.includes('OFFICE')) this.#officeOn.add(req.orgCode);
    // ★ 평문 로그에 이메일·전화를 남기지 않는다. 남는 것은 코드와 번호뿐이다.
    console.log(`[bbiyong] MOCK 회사 등록 — orgCode=${req.orgCode} orgId=${orgId}`);
    return { kind: 'created', orgId, orgCode: req.orgCode };
  }

  /** 퇴실 — 이미 꺼져 있으면 삐용처럼 거부한다. */
  async moduleOff(orgCode: string, _accessToken: string): Promise<OrgOpOutcome> {
    if (this.#known(orgCode) && !this.#officeOn.has(orgCode)) {
      return { kind: 'rejected', message: '이미 퇴실 처리된 회사입니다', retryable: false };
    }
    this.#officeOn.delete(orgCode);
    console.log(`[bbiyong] MOCK 퇴실 — orgCode=${orgCode}`);
    return { kind: 'ok' };
  }

  /** 재입주 — 이미 켜져 있으면 삐용처럼 거부한다. ★ 회사를 다시 만들지 않는다. */
  async moduleOn(orgCode: string, _accessToken: string): Promise<OrgOpOutcome> {
    if (this.#known(orgCode) && this.#officeOn.has(orgCode)) {
      return { kind: 'rejected', message: '이미 이용 중인 회사입니다', retryable: false };
    }
    this.#officeOn.add(orgCode);
    console.log(`[bbiyong] MOCK 재입주 — orgCode=${orgCode}`);
    return { kind: 'ok' };
  }

  /** 회사명 수정. ★ 주소 칸은 애초에 인터페이스에 없다(`BbiyongOrgPatch`). */
  async patchOrg(patch: BbiyongOrgPatch, _accessToken: string): Promise<OrgOpOutcome> {
    if (!patch.orgName.trim()) {
      return { kind: 'rejected', message: '회사명이 비어 있어 삐용에 반영할 수 없습니다', retryable: false };
    }
    // ★ 회사명은 로그에 남겨도 되는 값이다(공개 정보). 이메일·전화는 여기 오지 않는다.
    console.log(`[bbiyong] MOCK 회사 수정 — orgCode=${patch.orgCode}`);
    return { kind: 'ok' };
  }
}
