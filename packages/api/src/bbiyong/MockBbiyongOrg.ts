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
import { MOCK_ACCOUNTS } from './MockBbiyongAuth.ts';
import type {
  BbiyongMemberRequest,
  BbiyongOrg,
  BbiyongOrgInfo,
  BbiyongOrgKey,
  BbiyongOrgLegalPatch,
  BbiyongOrgPatch,
  BbiyongOrgRequest,
  BbiyongOrgSearch,
  CreateOrgOutcome,
  MemberOpOutcome,
  OrgLookupOutcome,
  OrgOpOutcome,
} from './types.ts';

/**
 * 모의 단체 상태. ★ 삐용 단체 조회 규격이 없어 **어휘가 정해지지 않았다**(`BbiyongOrgInfo.status`).
 *   화면은 해석하지 않고 그대로 보여 준다.
 */
const MOCK_ORG_STATUS = '정상';

/**
 * 로그인 모의 계정 중 **회사 단체**(단체코드를 적은 것). 단체 조회가 이것을 돌려준다.
 * ★ 여기 다시 적지 않는다 — `MockBbiyongAuth` 의 계정표 한 곳에서 끌어온다.
 */
function seededOrgs(): BbiyongOrgInfo[] {
  return MOCK_ACCOUNTS.filter((a) => a.orgCode !== undefined).map((a) => ({
    orgId: a.orgId,
    orgCode: a.orgCode as string,
    orgName: a.orgName,
    repName: a.memberName,
    status: MOCK_ORG_STATUS,
  }));
}

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

/**
 * mock 회원번호의 기준값. 회사 등록이 받는 대표 번호는 `기준값 + 단체코드 숫자` 이고
 * (`Z01` → 95101), 직원은 그 뒤로 1씩 올라간다.
 *
 * ★ `MOCK_ORG_ID_BASE`(9100)·`MockBbiyongAuth`(9001·9002)와 **자리수를 벌려 둔다.**
 *   `link_s020_member_id` 와 `link_s020_org_id` 는 다른 컬럼이지만, 번호대가 겹치면
 *   로그를 읽는 사람이 둘을 헷갈린다(실제로 9101 을 org 로도 member 로도 읽게 된다).
 */
export const MOCK_MEMBER_ID_BASE = 95000;

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

  /** 단체코드 → 대표 회원번호. 회사 등록이 넣는다. 직원 삭제가 **대표인지** 볼 때 쓴다. */
  readonly #repByCode = new Map<string, number>();

  /**
   * 이 프로세스가 만든 직원들. 회원번호 → { 단체코드, 이메일 }.
   *
   * ★ 이메일을 들고 있는 이유는 **겹침을 재현하기 위해서다.** 삐용은 이메일을 로그인
   *   아이디로 쓰므로 같은 이메일을 두 번 등록하면 거절한다. mock 이 통과시키면 그
   *   경로가 실연동에서 처음 터지고, 그때는 「어제까지 되던 것」이 안 되는 모양이 된다.
   * ★★ 재기동하면 비어 있다 — 그래서 **모르는 번호는 거부하지 않고 통과시킨다**
   *    (`moduleOff` 의 `#known` 과 같은 이유).
   */
  readonly #members = new Map<number, { orgCode: string; email: string }>();

  /**
   * 직원 회원번호를 **이메일에서 유도한다** — 증가 카운터가 아니다.
   *
   * ★★ 카운터로 두면 프로세스를 재기동할 때마다 같은 번호가 처음부터 다시 나오고, 그
   *    번호는 앞선 실행이 남긴 `link_s020_member_id` 의 UNIQUE 에 걸려 **저장이 실패한다**
   *    (`MOCK_ORG_ID_BASE` 머리말의 2026-09-30 사고와 같은 모양이다). 이메일은 삐용에서
   *    유일하므로 그것에서 유도하면 번호도 유일해지고, 재기동해도 같은 사람이 같은
   *    번호를 받는다.
   *
   * ★ 대표 번호대(기준값+100~199)를 피해 기준값+1000 위로 둔다.
   */
  #memberIdFor(email: string): number {
    let hash = 0x811c9dc5;
    for (const ch of email.toLowerCase()) {
      hash = ((hash ^ ch.charCodeAt(0)) * 0x01000193) >>> 0;
    }
    return MOCK_MEMBER_ID_BASE + 1000 + (hash % 90_000);
  }

  /**
   * 이 프로세스가 만든 회사의 조회용 정보 — 코드 → 단체. 단체 조회가 모의 계정 단체와 함께 돌려준다.
   * ★ 재기동하면 비어 있다(`#byCode` 와 같다). 진실원은 삐용이고, 여기는 대역이다.
   */
  readonly #createdInfo = new Map<string, BbiyongOrgInfo>();

  /** 조회 대상 전부 — 모의 계정 단체 + 이 프로세스가 만든 회사. */
  #directory(): BbiyongOrgInfo[] {
    return [...seededOrgs(), ...this.#createdInfo.values()];
  }

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
    // ★ ERP 등록 주소(erp-register-org)는 Z 코드만 받는다(삐용 회신 2026-10-14).
    //   거절 문구는 회신에 적힌 문장 그대로 둔다.
    if (!req.orgCode.startsWith('Z')) {
      return { kind: 'rejected', message: 'Z 로 시작하는 단체코드는 시스템 예약 코드입니다', retryable: false };
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
    // ★ 모의 계정 단체(Z97~Z99)의 코드도 「이미 있음」이다 — 삐용이라면 그렇게 답한다.
    //   ERP 채번이 다음 번호로 넘어간다.
    if (existing !== undefined || seededOrgs().some((o) => o.orgCode === req.orgCode)) {
      // ★ orgId 를 결과에 담지 않는다 — 호출자가 그것을 쓰면 안 되는 값이다(types.ts).
      return { kind: 'duplicate_code', orgCode: req.orgCode };
    }

    // ★ 코드에서 유도한다(위 주석). `Z01` → 9101. 숫자가 아니면 기준값 그대로다.
    const orgId = MOCK_ORG_ID_BASE + (Number(req.orgCode.slice(1)) || 0);
    this.#byCode.set(req.orgCode, orgId);
    /*
     * ★★ 대표 회원번호도 같은 방식으로 **코드에서 유도한다**(`Z01` → 95101). 증가
     *    카운터로 두면 재기동할 때마다 같은 번호가 다시 나오고, 그 번호는
     *    `link_s020_member_id` 의 UNIQUE 에 걸려 저장이 조용히 실패한다 —
     *    `MOCK_ORG_ID_BASE` 머리말에 적힌 2026-09-30 사고와 같은 모양이다.
     */
    const repMemberId = MOCK_MEMBER_ID_BASE + 100 + (Number(req.orgCode.slice(1)) || 0);
    this.#repByCode.set(req.orgCode, repMemberId);
    this.#createdInfo.set(req.orgCode, {
      orgId,
      orgCode: req.orgCode,
      orgName: req.orgName,
      repName: req.memberName,
      status: MOCK_ORG_STATUS,
    });
    // ★ 등록은 OFFICE 를 켠 상태로 만든다 — moduleCodes 에 OFFICE 를 보내기 때문이다.
    if (req.moduleCodes.includes('OFFICE')) this.#officeOn.add(req.orgCode);
    // ★ 평문 로그에 이메일·전화를 남기지 않는다. 남는 것은 코드와 번호뿐이다.
    console.log(
      `[bbiyong] MOCK 회사 등록 — orgCode=${req.orgCode} orgId=${orgId} 대표회원=${repMemberId}`,
    );
    return { kind: 'created', orgId, orgCode: req.orgCode, memberId: repMemberId };
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

  /**
   * 입주사 회사 수정 — 실물과 같이 **값 있는 칸만** 받는다(결정 2026-10-23). ★ 주소 칸은 애초에
   * 인터페이스에 없다(`BbiyongOrgPatch`).
   * ★ 빈 문자열이 실려 오면 거부한다 — 실물에서는 삐용 값이 지워지는 사고다. 만드는 쪽
   *   (`companies/companyOrgSync.ts`)이 빼야 하므로, 여기 걸리면 그쪽 결함이다.
   */
  async patchOrg(patch: BbiyongOrgPatch, _accessToken: string): Promise<OrgOpOutcome> {
    const { orgCode, ...fields } = patch;
    const keys = Object.keys(fields).filter((k) => fields[k as keyof typeof fields] !== undefined);
    if (keys.some((k) => fields[k as keyof typeof fields]!.trim() === '')) {
      return { kind: 'rejected', message: '빈 값이 실려 와 삐용에 반영하지 않았습니다', retryable: false };
    }
    // ★ 칸 이름만 남긴다 — 번호 값은 로그에 두지 않는다.
    console.log(`[bbiyong] MOCK 회사 수정 — orgCode=${orgCode} [${keys.join(',')}]`);
    // 조회에 바뀐 이름이 보여야 한다 — 이 프로세스가 만든 회사만 들고 있다.
    const info = this.#createdInfo.get(orgCode);
    if (info && patch.orgName !== undefined) this.#createdInfo.set(orgCode, { ...info, orgName: patch.orgName });
    return { kind: 'ok' };
  }

  /**
   * 법무 회사 수정 — 실물과 같이 **값 있는 칸만** 받는다(결정 2026-10-22).
   * ★ 빈 문자열이 실려 오면 거부한다 — 실물에서는 삐용 값이 지워지는 사고다. 만드는 쪽
   *   (`legal/legalOrgSync.ts`)이 빼야 하므로, 여기 걸리면 그쪽 결함이다.
   * ★ 조회 모양(`BbiyongOrgInfo`)에 주소 · 번호 칸이 없어 들고 있지 않는다 — 칸 이름만 로그에 남긴다.
   */
  async patchOrgLegal(patch: BbiyongOrgLegalPatch, _accessToken: string): Promise<OrgOpOutcome> {
    const { orgCode, ...fields } = patch;
    const keys = Object.keys(fields).filter((k) => fields[k as keyof typeof fields] !== undefined);
    if (keys.some((k) => fields[k as keyof typeof fields]!.trim() === '')) {
      return { kind: 'rejected', message: '빈 값이 실려 와 삐용에 반영하지 않았습니다', retryable: false };
    }
    console.log(`[bbiyong] MOCK 법무 회사 수정 — orgCode=${orgCode} [${keys.join(',')}]`);
    return { kind: 'ok' };
  }

  /**
   * 단체 목록 — 회사명 일부로 찾는다(삐용 회신 2026-10-09).
   * ★ 실물은 「법무 서비스를 받은 회사」만 준다 — 거르는 것은 삐용 몫이다. mock 은 자기가
   *   아는 단체(모의 계정 + 이 프로세스가 만든 회사)를 **거르지 않고** 준다.
   * ★ 대소문자·앞뒤 공백을 무시한다. 빈 검색어는 전부다. 코드 순으로 준다.
   */
  async listOrgs(search: BbiyongOrgSearch, _accessToken: string): Promise<OrgLookupOutcome<BbiyongOrgInfo[]>> {
    const needle = search.name.trim().toLowerCase();
    const value = this.#directory()
      .filter((o) => needle === '' || o.orgName.toLowerCase().includes(needle))
      .sort((a, b) => a.orgCode.localeCompare(b.orgCode));
    return { kind: 'ok', value };
  }

  /** 단체 한 곳 — 단체 ID 또는 단체코드. 없으면 null. */
  async getOrg(key: BbiyongOrgKey, _accessToken: string): Promise<OrgLookupOutcome<BbiyongOrgInfo | null>> {
    const found = this.#directory().find((o) =>
      'orgId' in key ? o.orgId === key.orgId : o.orgCode === key.orgCode.trim().toUpperCase(),
    );
    return { kind: 'ok', value: found ?? null };
  }

  /**
   * 직원정보 — 신규 · 수정 · 삭제 (규격 2026-10-05).
   *
   * ★★ 삐용이 거절하는 것을 mock 도 거절한다. 통과시키면 실연동에서 처음 터진다:
   *    ① 칸이 비었다 ② 이메일이 겹친다 ③ **대표를 지우려 한다** ④ 번호 없는 수정·삭제
   *
   * ★ 대표 `I` 는 **여기서 막지 않는다.** ERP 는 대표에게 `I` 를 보내지 않으므로
   *   (`memberSync.ts`) 그 경로로 오는 요청 자체가 버그이고, mock 이 조용히 받아 주면
   *   그 버그가 묻힌다 — `repYn:'Y'` 로 오는 `I` 는 삐용처럼 거절한다.
   */
  async sendMember(req: BbiyongMemberRequest, _accessToken: string): Promise<MemberOpOutcome> {
    if (!req.orgCode) {
      return { kind: 'rejected', message: '단체코드가 없어 삐용에 보낼 수 없습니다', retryable: false };
    }
    for (const [key, value] of [
      ['성명', req.memberName],
      ['이메일', req.email],
    ] as const) {
      if (!value) {
        return { kind: 'rejected', message: `${key}이(가) 없어 삐용에 보낼 수 없습니다`, retryable: false };
      }
    }

    if (req.regTp === 'I') {
      if (req.repYn === 'Y') {
        return { kind: 'rejected', message: '대표는 회사 등록으로만 만들 수 있습니다', retryable: false };
      }
      // ★ 이메일 겹침 — 삐용은 이메일을 로그인 아이디로 쓴다. 이 프로세스가 아는 범위에서만 본다.
      for (const [id, m] of this.#members) {
        if (m.email.toLowerCase() === req.email.toLowerCase()) {
          return {
            kind: 'rejected',
            message: `이미 사용중인 이메일입니다(회원번호 ${id}). 다른 이메일을 입력해 주세요`,
            retryable: false,
          };
        }
      }
      const memberId = this.#memberIdFor(req.email);
      this.#members.set(memberId, { orgCode: req.orgCode, email: req.email });
      console.log(`[bbiyong] MOCK 직원 등록 — orgCode=${req.orgCode} memberId=${memberId}`);
      return { kind: 'created', memberId };
    }

    if (req.memberId === undefined) {
      return { kind: 'rejected', message: '회원번호가 없어 삐용에 보낼 수 없습니다', retryable: false };
    }

    if (req.regTp === 'D') {
      // ★★ 대표는 지울 수 없다 — 삐용이 그렇게 받는다(규격). 회사 등록이 넣어 둔 번호로 본다.
      for (const [code, repId] of this.#repByCode) {
        if (repId === req.memberId) {
          return {
            kind: 'rejected',
            message: `대표는 삭제할 수 없습니다(단체 ${code})`,
            retryable: false,
          };
        }
      }
      this.#members.delete(req.memberId);
      console.log(`[bbiyong] MOCK 직원 삭제 — orgCode=${req.orgCode} memberId=${req.memberId}`);
      return { kind: 'ok' };
    }

    // U — 대표도 이것만은 된다. ★ 이메일을 바꿨으면 들고 있는 값도 맞춘다(겹침 판정의 근거).
    const known = this.#members.get(req.memberId);
    if (known) this.#members.set(req.memberId, { ...known, email: req.email });
    console.log(`[bbiyong] MOCK 직원 수정 — orgCode=${req.orgCode} memberId=${req.memberId}`);
    return { kind: 'ok' };
  }
}
