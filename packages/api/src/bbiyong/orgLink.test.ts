/**
 * 삐용 회사 등록 — 채번 · 중복 재시도 · 실패 보관.
 *
 * ★ 이 파일이 지키는 것:
 *   ① `Z01` 부터 발급하고, 이미 쓴 번호를 건너뛴다
 *   ② 「이미 사용중인 단체코드」면 **다음 번호로 다시 시도한다**
 *   ③ 주소·telNo 를 보내지 않고, moduleCodes 는 빈 배열이다
 *   ④ 성공하면 org_id·코드를 저장하고, 실패하면 **사람이 읽을 사유**를 남긴다
 *   ⑤ 이미 연결된 회사는 **다시 만들지 않는다** — 재시도를 눌러도 회사가 둘이 되지 않는다
 *
 * 삐용도 DB 도 없이 돈다 — 저장소와 어댑터를 주입받는다.
 */
import { describe, it, expect } from 'vitest';
import { linkOrg, type OrgLinkStore, type OrgLinkTarget } from './orgLink.ts';
import { withFreshAccess, type AccessTokenStore } from './withFreshAccess.ts';
import {
  BbiyongTokenExpiredError,
  BbiyongUnavailableError,
  type BbiyongOrg,
  type CreateOrgOutcome,
} from './types.ts';

const COMPANY: OrgLinkTarget = {
  companyId: 'C1',
  companyName: '한성무역',
  ceoName: '김대표',
  tel: '010-1234-5678',
  email: 'ceo@hanseong.co.kr',
  linkedOrgId: null,
  linkedOrgCode: null,
  // 등록 경로의 시험이다 — 확정된 계약이 있는 상태로 둔다.
  liveContractCount: 1,
};

function store(
  target: { company: OrgLinkTarget; takenCodes: string[] } | null,
): OrgLinkStore & { linked: { orgId: number; orgCode: string }[]; pending: string[] } {
  const linked: { orgId: number; orgCode: string }[] = [];
  const pending: string[] = [];
  return {
    linked,
    pending,
    read: async () => target,
    saveLinked: async (a) => void linked.push(a),
    savePending: async (reason) => void pending.push(reason),
  };
}

interface Seen {
  orgCode: string;
  orgName: string;
  hpNo: string;
  moduleCodes: readonly string[];
}

/** 지정한 코드들만 중복이라고 답하는 대역. 그 밖은 성공. */
function orgAdapter(duplicates: readonly string[] = []): BbiyongOrg & { requests: Seen[] } {
  const requests: Seen[] = [];
  let nextId = 5000;
  return {
    ...createOnly(async () => {
      throw new Error("createOnly 가 바로 아래에서 덮어쓴다");
    }),
    requests,
    createOrg: async (req): Promise<CreateOrgOutcome> => {
      requests.push({
        orgCode: req.orgCode,
        orgName: req.orgName,
        hpNo: req.hpNo,
        moduleCodes: req.moduleCodes,
      });
      if (duplicates.includes(req.orgCode)) return { kind: 'duplicate_code', orgCode: req.orgCode };
      nextId += 1;
      // ★ 대표 회원번호(규경 2026-10-05). 등록 응답만이 주는 값이다 — 여기서도 준다.
      return { kind: 'created', orgId: nextId, orgCode: req.orgCode, memberId: 95_000 + nextId };
    },
  };
}

/**
 * 등록만 쓰는 대역 — 나머지 셋은 **불리면 터진다.**
 *
 * ★ 조용히 `ok` 를 돌려주면 「등록 경로가 실수로 퇴실을 부른다」는 사고를 이 시험이
 *   잡지 못한다. 퇴실·재입주·수정은 각자 전용 시험이 있다.
 */
function createOnly(createOrg: BbiyongOrg['createOrg']): BbiyongOrg {
  const nope = (name: string) => async (): Promise<never> => {
    throw new Error(`이 시험은 ${name} 을 부르지 않아야 한다`);
  };
  return {
    createOrg,
    moduleOff: nope('moduleOff') as BbiyongOrg['moduleOff'],
    moduleOn: nope('moduleOn') as BbiyongOrg['moduleOn'],
    patchOrg: nope('patchOrg') as BbiyongOrg['patchOrg'],
    patchOrgLegal: nope('patchOrgLegal') as BbiyongOrg['patchOrgLegal'],
    sendMember: nope('sendMember') as BbiyongOrg['sendMember'],
    listOrgs: nope('listOrgs') as BbiyongOrg['listOrgs'],
    getOrg: nope('getOrg') as BbiyongOrg['getOrg'],
  };
}

const ALL_CODES = Array.from({ length: 99 }, (_, i) => `Z${String(i + 1).padStart(2, '0')}`);

describe('linkOrg — ① 채번', () => {
  it('★ 첫 회사는 Z01 이다', async () => {
    const s = store({ company: COMPANY, takenCodes: [] });
    const org = orgAdapter();

    const out = await linkOrg(s, org, 'token');

    expect(out.kind).toBe('linked');
    expect(org.requests.map((r) => r.orgCode)).toEqual(['Z01']);
    expect(s.linked).toEqual([{ orgId: 5001, orgCode: 'Z01', repMemberId: 100_001 }]);
  });

  it('이미 쓴 번호는 건너뛴다', async () => {
    const s = store({ company: COMPANY, takenCodes: ['Z01', 'Z02'] });
    const org = orgAdapter();

    await linkOrg(s, org, 'token');
    expect(org.requests[0]!.orgCode).toBe('Z03');
  });

  it('★ 99개를 다 쓰면 부르지 않고 대기로 남긴다 — 코드를 지어내지 않는다', async () => {
    const s = store({ company: COMPANY, takenCodes: ALL_CODES });
    const org = orgAdapter();

    const out = await linkOrg(s, org, 'token');

    expect(out.kind).toBe('pending');
    expect(org.requests).toHaveLength(0); // 삐용을 부르지 않았다
    expect(s.pending[0]).toContain('단체코드');
  });
});

describe('linkOrg — ② 중복이면 다음 번호', () => {
  it('★ Z01 이 중복이면 Z02 로 다시 시도한다', async () => {
    const s = store({ company: COMPANY, takenCodes: [] });
    const org = orgAdapter(['Z01']);

    const out = await linkOrg(s, org, 'token');

    expect(out).toEqual({ kind: 'linked', orgId: 5001, orgCode: 'Z02' });
    expect(org.requests.map((r) => r.orgCode)).toEqual(['Z01', 'Z02']);
    // ★ 저장되는 것은 **성공한** 코드다.
    expect(s.linked).toEqual([{ orgId: 5001, orgCode: 'Z02', repMemberId: 100_001 }]);
  });

  it('여러 번 연달아 중복이어도 계속 올라간다', async () => {
    const s = store({ company: COMPANY, takenCodes: [] });
    const org = orgAdapter(['Z01', 'Z02', 'Z03']);

    const out = await linkOrg(s, org, 'token');

    expect(out.kind).toBe('linked');
    expect(org.requests.map((r) => r.orgCode)).toEqual(['Z01', 'Z02', 'Z03', 'Z04']);
  });

  it('★★ 재시도에 상한이 있다 — 삐용이 계속 중복을 주면 99번 두드리지 않는다', async () => {
    const s = store({ company: COMPANY, takenCodes: [] });
    const org = orgAdapter(ALL_CODES); // 전부 중복

    const out = await linkOrg(s, org, 'token');

    expect(out.kind).toBe('pending');
    expect(org.requests.length).toBeLessThanOrEqual(10);
    expect(s.pending[0]).toContain('단체코드');
  });
});

describe('linkOrg — ③ 요청 본문', () => {
  it("★ moduleCodes 는 ['OFFICE','AUTHZ'] 다 — 삐용 회신 2026-10-01", async () => {
    const s = store({ company: COMPANY, takenCodes: [] });
    const org = orgAdapter();

    await linkOrg(s, org, 'token');
    // 2026-10-01 전까지는 빈 배열이었다(회신 2 — ERP 서비스 5종이 use_yn='N' 이었다).
    expect(org.requests[0]!.moduleCodes).toEqual(['OFFICE', 'AUTHZ']);
  });

  it('★ 휴대전화는 숫자만 보낸다', async () => {
    const s = store({ company: COMPANY, takenCodes: [] });
    const org = orgAdapter();

    await linkOrg(s, org, 'token');
    expect(org.requests[0]!.hpNo).toBe('01012345678');
  });

  it('★★ 주소는 보내지 않는다 — 그 칸은 대표자 자택이다', async () => {
    const s = store({ company: COMPANY, takenCodes: [] });
    const captured: Record<string, unknown>[] = [];
    const org: BbiyongOrg = createOnly(
      async (req) => {
        captured.push({ ...req });
        return { kind: 'created', orgId: 1, orgCode: req.orgCode, memberId: 95_001 };
      },
    );

    await linkOrg(s, org, 'token');

    const body = captured[0]!;
    for (const key of ['zipCode', 'address', 'detailAddress', 'telNo', 'pwd', 'bizNumber']) {
      expect(body, key).not.toHaveProperty(key);
    }
    expect(body.countryCode).toBe('KR');
  });

  it('필수 값이 비면 삐용을 부르지 않고 대기로 남긴다', async () => {
    const s = store({ company: { ...COMPANY, email: null }, takenCodes: [] });
    const org = orgAdapter();

    const out = await linkOrg(s, org, 'token');

    expect(out.kind).toBe('pending');
    expect(org.requests).toHaveLength(0);
    expect(s.pending[0]).toContain('대표 이메일');
  });
});

describe('linkOrg — ④ 실패는 사유를 남긴다', () => {
  it('★ 삐용이 거절하면 그 문구를 보관한다 (재시도해도 안 풀리는 경우)', async () => {
    const s = store({ company: COMPANY, takenCodes: [] });
    const org: BbiyongOrg = createOnly(
      async () => ({
        kind: 'rejected',
        message: '삐용 권한관리에서 「ERP 담당」 역할을 받으세요',
        retryable: false,
      }),
    );

    const out = await linkOrg(s, org, 'token');

    expect(out.kind).toBe('pending');
    if (out.kind !== 'pending') return;
    expect(out.reason).toContain('ERP 담당');
    expect(s.pending[0]).toContain('ERP 담당');
    expect(s.linked).toEqual([]);
  });

  it('★ 삐용에 못 붙어도 던지지 않는다 — 계약 확정은 이미 커밋됐다', async () => {
    const s = store({ company: COMPANY, takenCodes: [] });
    const org: BbiyongOrg = createOnly(
      async () => {
        throw new BbiyongUnavailableError('붙지 못했다');
      },
    );

    // 여기서 던지면 확정 응답이 500 이 되고, 운영자는 계약이 안 된 줄 안다.
    const out = await linkOrg(s, org, 'token');

    expect(out.kind).toBe('pending');
    if (out.kind !== 'pending') return;
    expect(out.reason).toContain('삐용');
    expect(s.pending).toHaveLength(1);
  });
});

describe('linkOrg — ⑤ 이미 연결된 회사', () => {
  it('★★ 다시 만들지 않는다 — 재시도를 두 번 눌러도 회사가 둘이 되지 않는다', async () => {
    const s = store({ company: { ...COMPANY, linkedOrgId: 9100 }, takenCodes: ['Z01'] });
    const org = orgAdapter();

    const out = await linkOrg(s, org, 'token');

    expect(out).toEqual({ kind: 'already', orgId: 9100 });
    expect(org.requests).toHaveLength(0);
    expect(s.linked).toEqual([]);
    expect(s.pending).toEqual([]);
  });

  it('회사가 없으면 대기도 남기지 않는다', async () => {
    const s = store(null);
    const org = orgAdapter();

    const out = await linkOrg(s, org, 'token');

    expect(out.kind).toBe('not_found');
    expect(org.requests).toHaveLength(0);
    expect(s.pending).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   ⑥ 토큰 만료 — **재발급으로 이어져야 한다**
   ══════════════════════════════════════════════════════════════════════════
   ★★★ 이 시험이 지키는 것: `linkOrg` 의 catch 가 **`BbiyongTokenExpiredError` 까지
        삼키면** 그 예외가 `withFreshAccess` 까지 올라가지 못하고, **재발급이 돌지 않은
        채** 「연동 대기」로 떨어진다. 토큰은 멀쩡히 되살릴 수 있는데 운영자는
        「잠시 후 다시 시도해 주세요」를 읽는다.

   ★ 그래서 **`withFreshAccess` 와 함께** 돌린다. 단위로 갈라 놓으면 「던지는가」만
     보게 되고, **정말 재발급이 돌고 다시 불리는가**는 아무도 지키지 않는다.
   ══════════════════════════════════════════════════════════════════════════ */
describe('linkOrg — ⑥ 토큰 만료는 재발급으로 이어진다', () => {
  /** 토큰 저장소 대역. ★ `revoke` 가 불리면 터진다 — 되살릴 수 있는 상황이다. */
  function tokenStore(): AccessTokenStore & { saved: string[] } {
    const saved: string[] = [];
    return {
      saved,
      read: async () => ({ accessToken: 'old-access', refreshToken: 'refresh' }),
      saveAccess: async (t) => void saved.push(t),
      revoke: async () => {
        throw new Error('★ 재발급으로 풀리는 상황에서 세션을 폐기해선 안 된다');
      },
    };
  }

  it('★★ 만료를 삼키지 않는다 — 재발급하고 **새 토큰으로 다시 부른다**', async () => {
    const s = store({ company: COMPANY, takenCodes: [] });
    const ts = tokenStore();
    const 받은토큰: string[] = [];

    const org = createOnly(async (req, accessToken) => {
      받은토큰.push(accessToken);
      // 첫 호출은 401 — 삐용이 만료된 토큰을 거부한 모양이다.
      if (받은토큰.length === 1) throw new BbiyongTokenExpiredError('삐용 회사 등록이 401');
      return { kind: 'created', orgId: 7001, orgCode: req.orgCode, memberId: 95_001 };
    });

    const result = await withFreshAccess(ts, { reIssue: async () => 'fresh-access' }, (token) =>
      linkOrg(s, org, token),
    );

    // 재발급이 돌았고, 두 번째 호출은 **새 토큰**을 받았다.
    expect(ts.saved).toEqual(['fresh-access']);
    expect(받은토큰).toEqual(['old-access', 'fresh-access']);
    // 결과는 성공이다 — 대기로 떨어지지 않는다.
    expect(result).toEqual({ kind: 'linked', orgId: 7001, orgCode: 'Z01' });
    expect(s.pending).toEqual([]);
  });

  it('★ 그 밖의 실패는 그대로 대기다 — 재발급을 부르지 않는다', async () => {
    const s = store({ company: COMPANY, takenCodes: [] });
    const ts = tokenStore();
    let reissued = 0;

    const org = createOnly(async () => {
      throw new BbiyongUnavailableError('삐용 회사 등록 호출 실패');
    });

    const result = await withFreshAccess(
      ts,
      { reIssue: async () => { reissued += 1; return 'fresh-access'; } },
      (token) => linkOrg(s, org, token),
    );

    expect(reissued).toBe(0);
    expect(ts.saved).toEqual([]);
    expect(result.kind).toBe('pending');
    expect(s.pending).toHaveLength(1);
  });
});
