/**
 * 삐용 퇴실 · 재입주 · 수정 (회신 2026-10-02).
 *
 * ★ 이 파일이 지키는 것:
 *   ① 퇴실은 **살아 있는 계약이 하나도 없을 때만** 나간다 — 남아 있으면 보내지 않는다
 *   ② 재입주는 **회사를 다시 만들지 않는다** — createOrg 를 부르면 터진다
 *   ③ 수정은 **주소를 보내지 않는다** (빈 문자열로도)
 *   ④ 연결되지 않은 입주사에는 아무것도 보내지 않는다
 *   ⑤ 실패는 등록과 같은 자리에 같은 모양으로 남는다 — 던지지 않는다
 *
 * 삐용도 DB 도 없이 돈다 — 저장소와 어댑터를 주입받는다.
 */
import { describe, it, expect } from 'vitest';
import { moduleOffOrg, moduleOnOrg, patchOrgName, type OrgLinkStore, type OrgLinkTarget } from './orgLink.ts';
import { MockBbiyongOrg } from './MockBbiyongOrg.ts';
import {
  BbiyongUnavailableError,
  type BbiyongOrg,
  type BbiyongOrgPatch,
  type OrgOpOutcome,
} from './types.ts';

/** 삐용에 이미 연결된 입주사. 살아 있는 계약은 없다(= 퇴실 대상). */
const LINKED: OrgLinkTarget = {
  companyId: 'C1',
  companyName: '한성무역',
  ceoName: '김대표',
  tel: '010-1234-5678',
  email: 'ceo@hanseong.co.kr',
  linkedOrgId: 9101,
  linkedOrgCode: 'Z01',
  liveContractCount: 0,
};

function store(company: OrgLinkTarget | null) {
  const pending: string[] = [];
  /**
   * ★ 성공하면 `saveLinked` 가 불린다 — 그것이 **대기 사유를 지우는 수단**이다
   *   (`applyOp`). 전용 `clearPending` 을 만들지 않았다.
   */
  const linked: { orgId: number; orgCode: string }[] = [];
  const s: OrgLinkStore & { pending: string[]; linked: typeof linked } = {
    pending,
    linked,
    read: async () => (company ? { company, takenCodes: ['Z01'] } : null),
    saveLinked: async (a) => void linked.push(a),
    savePending: async (reason) => void pending.push(reason),
  };
  return s;
}

interface Seen {
  op: 'off' | 'on' | 'patch';
  orgCode: string;
  body?: Record<string, unknown>;
}

/** 셋만 받는 대역. ★ createOrg 를 부르면 **터진다** — 회사를 다시 만들어선 안 된다. */
function opAdapter(outcome: OrgOpOutcome = { kind: 'ok' }): BbiyongOrg & { seen: Seen[] } {
  const seen: Seen[] = [];
  return {
    seen,
    createOrg: async () => {
      throw new Error('★ 회사를 다시 만들면 안 된다 — createOrg 가 불렸다');
    },
    // ★ 허시·재입주·수정은 직원정보를 부르지 않는다. 부르면 터진다.
    sendMember: async () => {
      throw new Error('★ 이 시험은 sendMember 를 부르지 않아야 한다');
    },
    moduleOff: async (orgCode) => {
      seen.push({ op: 'off', orgCode });
      return outcome;
    },
    moduleOn: async (orgCode) => {
      seen.push({ op: 'on', orgCode });
      return outcome;
    },
    patchOrg: async (patch: BbiyongOrgPatch) => {
      seen.push({ op: 'patch', orgCode: patch.orgCode, body: { ...patch } });
      return outcome;
    },
  };
}

describe('퇴실 — ① 살아 있는 계약이 없을 때만', () => {
  it('★ 계약이 하나도 안 남았으면 OFFICE 를 끈다', async () => {
    const s = store(LINKED);
    const org = opAdapter();

    const out = await moduleOffOrg(s, org, 'token');

    expect(out).toEqual({ kind: 'synced', op: 'off' });
    expect(org.seen).toEqual([{ op: 'off', orgCode: 'Z01' }]);
  });

  it('★★ 살아 있는 계약이 남아 있으면 **보내지 않는다** — 호실 둘 중 하나만 끝난 경우', async () => {
    const s = store({ ...LINKED, liveContractCount: 1 });
    const org = opAdapter();

    const out = await moduleOffOrg(s, org, 'token');

    expect(out.kind).toBe('skipped');
    expect(org.seen).toEqual([]);
    // ★ 보낼 것이 없는 것은 실패가 아니다 — 배너를 띄우지 않는다.
    expect(s.pending).toEqual([]);
  });

  it('연결되지 않은 입주사면 끌 것이 없다', async () => {
    const s = store({ ...LINKED, linkedOrgId: null, linkedOrgCode: null });
    const org = opAdapter();

    expect((await moduleOffOrg(s, org, 'token')).kind).toBe('skipped');
    expect(org.seen).toEqual([]);
  });

  it('org_id 는 있는데 코드가 없으면 보내지 않는다 — 엉뚱한 회사를 끄지 않는다', async () => {
    const s = store({ ...LINKED, linkedOrgCode: null });
    const org = opAdapter();

    expect((await moduleOffOrg(s, org, 'token')).kind).toBe('skipped');
    expect(org.seen).toEqual([]);
  });
});

describe('재입주 — ② 회사를 다시 만들지 않는다', () => {
  it('★ 끊긴 구독을 다시 켠다 — createOrg 는 부르지 않는다', async () => {
    const s = store({ ...LINKED, liveContractCount: 1 });
    const org = opAdapter();

    const out = await moduleOnOrg(s, org, 'token');

    expect(out).toEqual({ kind: 'synced', op: 'on' });
    expect(org.seen).toEqual([{ op: 'on', orgCode: 'Z01' }]);
    // createOrg 를 불렀다면 opAdapter 가 던졌을 것이다.
  });

  it('연결되지 않은 입주사면 재입주가 아니라 신규다', async () => {
    const s = store({ ...LINKED, linkedOrgId: null, linkedOrgCode: null });
    const org = opAdapter();

    const out = await moduleOnOrg(s, org, 'token');
    expect(out.kind).toBe('skipped');
    if (out.kind === 'skipped') expect(out.why).toContain('신규 등록');
  });
});

describe('수정 — ③ 주소를 보내지 않는다', () => {
  it('★★★ 보내는 칸은 orgCode · orgName 뿐이다 — 주소를 빈 문자열로도 보내지 않는다', async () => {
    const s = store({ ...LINKED, liveContractCount: 1 });
    const org = opAdapter();

    await patchOrgName(s, org, 'token');

    const body = org.seen[0]!.body!;
    expect(Object.keys(body).sort()).toEqual(['orgCode', 'orgName']);
    // ★ 빈 문자열로 보내면 삐용에 들어 있는 주소가 지워진다 — 칸 자체가 없어야 한다.
    for (const key of ['zipCode', 'address', 'detailAddress', 'telNo']) {
      expect(body, key).not.toHaveProperty(key);
    }
    expect(body.orgName).toBe('한성무역');
  });

  it('★ 회사명이 비면 보내지 않는다 — 삐용의 단체명을 지우는 셈이다', async () => {
    const s = store({ ...LINKED, companyName: '   ' });
    const org = opAdapter();

    const out = await patchOrgName(s, org, 'token');

    expect(out.kind).toBe('pending');
    expect(org.seen).toEqual([]);
    expect(s.pending[0]).toContain('회사명');
  });
});

describe('실패 — ⑤ 등록과 같은 모양으로 남는다', () => {
  it('★ 삐용이 거부하면 그 문구를 보관한다 (두 번 보낸 경우가 여기다)', async () => {
    const s = store(LINKED);
    const org = opAdapter({ kind: 'rejected', message: '이미 퇴실 처리된 회사입니다', retryable: false });

    const out = await moduleOffOrg(s, org, 'token');

    expect(out.kind).toBe('pending');
    if (out.kind === 'pending') expect(out.reason).toContain('이미 퇴실');
    expect(s.pending[0]).toContain('이미 퇴실');
  });

  it('★★ 삐용에 못 붙어도 던지지 않는다 — 계약 종료는 이미 커밋됐다', async () => {
    const s = store(LINKED);
    const org: BbiyongOrg = {
      ...opAdapter(),
      moduleOff: async () => {
        throw new BbiyongUnavailableError('붙지 못했다');
      },
    };

    const out = await moduleOffOrg(s, org, 'token');

    expect(out.kind).toBe('pending');
    if (out.kind === 'pending') expect(out.reason).toContain('퇴실');
    expect(s.pending).toHaveLength(1);
  });

  it('회사가 없으면 대기도 남기지 않는다', async () => {
    const s = store(null);
    const org = opAdapter();

    expect((await moduleOffOrg(s, org, 'token')).kind).toBe('not_found');
    expect(s.pending).toEqual([]);
  });
});

describe('MockBbiyongOrg — 두 번 보내면 거부한다 (삐용과 같게)', () => {
  const REQ = {
    orgName: '한성무역',
    orgCode: 'Z01',
    memberName: '김대표',
    hpNo: '01012345678',
    email: 'ceo@hanseong.co.kr',
    countryCode: 'KR' as const,
    moduleCodes: ['OFFICE', 'AUTHZ'] as readonly string[],
  };

  it('★ 등록하면 OFFICE 가 켜진 상태다 → 재입주는 거부', async () => {
    const mock = new MockBbiyongOrg();
    await mock.createOrg(REQ, 'tok');

    expect((await mock.moduleOn('Z01', 'tok')).kind).toBe('rejected');
  });

  it('★ 퇴실 한 번은 성공 · 두 번째는 거부', async () => {
    const mock = new MockBbiyongOrg();
    await mock.createOrg(REQ, 'tok');

    expect((await mock.moduleOff('Z01', 'tok')).kind).toBe('ok');
    expect((await mock.moduleOff('Z01', 'tok')).kind).toBe('rejected');
  });

  it('★ 퇴실 → 재입주 → 다시 퇴실 이 돈다', async () => {
    const mock = new MockBbiyongOrg();
    await mock.createOrg(REQ, 'tok');

    expect((await mock.moduleOff('Z01', 'tok')).kind).toBe('ok');
    expect((await mock.moduleOn('Z01', 'tok')).kind).toBe('ok');
    expect((await mock.moduleOff('Z01', 'tok')).kind).toBe('ok');
  });

  it('★★ 모르는 코드는 거부하지 않는다 — API 를 재기동하면 mock 이 비기 때문이다', async () => {
    const mock = new MockBbiyongOrg();

    expect((await mock.moduleOff('Z77', 'tok')).kind).toBe('ok');
    expect((await mock.moduleOn('Z77', 'tok')).kind).toBe('ok');
  });

  it('수정은 회사명이 있으면 통과한다', async () => {
    const mock = new MockBbiyongOrg();

    expect((await mock.patchOrg({ orgCode: 'Z01', orgName: '새이름' }, 'tok')).kind).toBe('ok');
    expect((await mock.patchOrg({ orgCode: 'Z01', orgName: ' ' }, 'tok')).kind).toBe('rejected');
  });
});

describe('성공하면 대기 사유를 지운다 — 배너가 남지 않는다', () => {
  it('★★ 퇴실이 성공하면 saveLinked 로 연결 상태를 되돌린다 (org_id·코드는 그대로)', async () => {
    const s = store(LINKED);
    const org = opAdapter();

    await moduleOffOrg(s, org, 'token');

    expect(s.linked).toEqual([{ orgId: 9101, orgCode: 'Z01' }]);
    expect(s.pending).toEqual([]);
  });

  it('실패하면 지우지 않는다 — 사유가 남는다', async () => {
    const s = store(LINKED);
    const org = opAdapter({ kind: 'rejected', message: '이미 퇴실 처리된 회사입니다', retryable: false });

    await moduleOffOrg(s, org, 'token');

    expect(s.linked).toEqual([]);
    expect(s.pending).toHaveLength(1);
  });
});
