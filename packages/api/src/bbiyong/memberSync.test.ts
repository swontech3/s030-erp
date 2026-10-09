/**
 * 삐용 직원정보 연동 (규격 2026-10-05).
 *
 * ★ 이 파일이 지키는 것:
 *   ① **대표에게 `I`·`D` 를 보내지 않는다** — 삐용이 거부하는 요청이다
 *   ② 번호 없는 직원은 **바뀌지 않았어도** `I` 로 나간다(회사 등록 전에 저장된 사람)
 *   ③ 번호 있고 바뀐 사람만 `U` — 비고만 고친 저장으로 삐용을 두드리지 않는다
 *   ④ **삭제가 먼저다** — 같은 이메일로 사람이 바뀌는 저장을 순서로 살린다
 *   ⑤ 받은 회원번호를 저장하고, 삭제 성공은 번호를 비운다
 *   ⑥ 실패는 **던지지 않는다** — 그 행의 「연동 대기」다. 토큰 만료만 그대로 던진다
 *
 * 삐용도 DB 도 없이 돈다 — 저장소와 어댑터를 주입받는다.
 */
import { describe, it, expect } from 'vitest';
import { syncMembers, type MemberLinkRow, type MemberSyncStore } from './memberSync.ts';
import {
  BbiyongTokenExpiredError,
  BbiyongUnavailableError,
  type BbiyongMemberRequest,
  type BbiyongOrg,
  type MemberOpOutcome,
} from './types.ts';

const staff = (over: Partial<MemberLinkRow> = {}): MemberLinkRow => ({
  memberId: 'M-staff',
  name: '이정희',
  email: 'staff@example.com',
  phone: '010-1111-2222',
  isRep: false,
  linkMemberId: null,
  ...over,
});

const rep = (over: Partial<MemberLinkRow> = {}): MemberLinkRow => ({
  memberId: 'M-rep',
  name: '최현수',
  email: 'ceo@example.com',
  phone: '010-3333-4444',
  isRep: true,
  linkMemberId: null,
  ...over,
});

/**
 * 저장소가 **무엇을 적었는가**. ★ 이름에 `wrote` 를 붙인 이사유는 `MemberSyncStore` 의
 * 메서드 이름(`linked`·`unlinked`·`pending`)와 가리지 않기 위해서다 — 한 객제에
 * 둘 다 단면 배열이 함수에 덮여 시험이 조용히 함수를 들여다보게 된다.
 */
interface Written {
  wroteLinked: { memberId: string; linkMemberId: number }[];
  wroteUnlinked: string[];
  wrotePending: { memberId: string; reason: string }[];
}

function store(
  found: { orgCode: string | null; active?: MemberLinkRow[]; orphans?: MemberLinkRow[] } | null,
): MemberSyncStore & Written {
  const w: Written = { wroteLinked: [], wroteUnlinked: [], wrotePending: [] };
  return {
    ...w,
    read: async () =>
      found === null
        ? null
        : { orgCode: found.orgCode, active: found.active ?? [], orphans: found.orphans ?? [] },
    linked: async (a) => void w.wroteLinked.push(a),
    unlinked: async ({ memberId }) => void w.wroteUnlinked.push(memberId),
    pending: async (a) => void w.wrotePending.push(a),
  };
}

/**
 * 직원정보만 받는 대역. ★ 나머지 넷을 부르면 **터진다** — 구성원 저장이 회사를 만들거나
 * 퇴실을 보내는 사고를 이 시험이 잡아야 한다.
 */
function memberAdapter(
  reply: (req: BbiyongMemberRequest) => MemberOpOutcome | Promise<MemberOpOutcome> = () => ({ kind: 'ok' }),
): BbiyongOrg & { seen: BbiyongMemberRequest[] } {
  const seen: BbiyongMemberRequest[] = [];
  const nope = (name: string) => async (): Promise<never> => {
    throw new Error(`이 시험은 ${name} 을 부르지 않아야 한다`);
  };
  return {
    seen,
    createOrg: nope('createOrg') as BbiyongOrg['createOrg'],
    moduleOff: nope('moduleOff') as BbiyongOrg['moduleOff'],
    moduleOn: nope('moduleOn') as BbiyongOrg['moduleOn'],
    patchOrg: nope('patchOrg') as BbiyongOrg['patchOrg'],
    listOrgs: nope('listOrgs') as BbiyongOrg['listOrgs'],
    getOrg: nope('getOrg') as BbiyongOrg['getOrg'],
    sendMember: async (req) => {
      seen.push({ ...req });
      return reply(req);
    },
  };
}

describe('syncMembers — ① 대표', () => {
  it('★★ 번호 없는 대표에게 I 를 보내지 않는다 — 바뀌었으면 사유만 남긴다', async () => {
    const s = store({ orgCode: 'Z04', active: [rep()] });
    const org = memberAdapter();

    const out = await syncMembers(s, org, 'token', new Set(['M-rep']));

    expect(org.seen).toEqual([]);
    expect(out.sent).toBe(0);
    expect(s.wrotePending).toHaveLength(1);
    expect(s.wrotePending[0]!.reason).toContain('대표 회원번호');
    expect(out.pending[0]!.name).toBe('최현수');
  });

  it('★ 번호도 없고 바뀐 것도 없으면 사유조차 남기지 않는다 — 고칠 수 없는 배너를 띄우지 않는다', async () => {
    const s = store({ orgCode: 'Z04', active: [rep()] });
    const out = await syncMembers(s, memberAdapter(), 'token');

    expect(s.wrotePending).toEqual([]);
    expect(out.pending).toEqual([]);
  });

  it('★ 번호가 있고 이름이 바뀌면 U 로 간다 — 대표의 유일한 길이다', async () => {
    const s = store({ orgCode: 'Z04', active: [rep({ linkMemberId: 851, name: '최현수2' })] });
    const org = memberAdapter();

    await syncMembers(s, org, 'token', new Set(['M-rep']));

    expect(org.seen).toHaveLength(1);
    expect(org.seen[0]).toMatchObject({ regTp: 'U', orgCode: 'Z04', memberId: 851, memberName: '최현수2' });
    // ★ repYn 은 I 에서만 쓰는 칸이다 — U 에 실으면 안 된다.
    expect(org.seen[0]!.repYn).toBeUndefined();
    // 성공했으면 대기 사유가 지워진다(같은 번호를 다시 적는 것이 그 수단이다).
    expect(s.wroteLinked).toEqual([{ memberId: 'M-rep', linkMemberId: 851 }]);
  });

  it('★★ 명부에서 빠진 대표에게 D 를 보내지 않는다 — 번호도 지우지 않는다', async () => {
    const s = store({ orgCode: 'Z04', orphans: [rep({ linkMemberId: 851 })] });
    const org = memberAdapter();

    const out = await syncMembers(s, org, 'token');

    expect(org.seen).toEqual([]);
    expect(s.wroteUnlinked).toEqual([]);
    expect(out.skipped.join(' ')).toContain('대표는 삐용에서 지울 수 없다');
  });
});

describe('syncMembers — ② 직원', () => {
  it('★★ 번호 없는 직원은 바뀌지 않았어도 I 로 나간다 — 회사 등록 전에 저장된 사람', async () => {
    const s = store({ orgCode: 'Z04', active: [staff()] });
    const org = memberAdapter(() => ({ kind: 'created', memberId: 902 }));

    // ★ changed 를 비워서 부른다 = 회사 등록 직후의 호출이다.
    const out = await syncMembers(s, org, 'token');

    expect(org.seen[0]).toEqual({
      regTp: 'I',
      orgCode: 'Z04',
      memberName: '이정희',
      email: 'staff@example.com',
      // ★ 숫자만 보낸다 — 하이픈을 떼고 간다.
      hpNo: '01011112222',
      // ★ ERP 가 보내는 I 는 직원뿐이라 늘 'N' 이다. 칸을 빼지 않는다.
      repYn: 'N',
    });
    // ★ I 에는 memberId 를 싣지 않는다(아직 없다).
    expect('memberId' in org.seen[0]!).toBe(false);
    expect(s.wroteLinked).toEqual([{ memberId: 'M-staff', linkMemberId: 902 }]);
    expect(out.created).toBe(1);
  });

  it('★ 번호가 있고 안 바뀌었으면 보내지 않는다', async () => {
    const s = store({ orgCode: 'Z04', active: [staff({ linkMemberId: 902 })] });
    const out = await syncMembers(s, memberAdapter(), 'token');

    expect(out.sent).toBe(0);
    expect(s.wroteLinked).toEqual([]);
    expect(s.wrotePending).toEqual([]);
  });

  it('★ 명부에서 빠지고 번호가 있으면 D — 성공하면 번호를 비운다', async () => {
    const s = store({ orgCode: 'Z04', orphans: [staff({ linkMemberId: 902 })] });
    const org = memberAdapter();

    const out = await syncMembers(s, org, 'token');

    expect(org.seen[0]).toMatchObject({ regTp: 'D', orgCode: 'Z04', memberId: 902 });
    expect(s.wroteUnlinked).toEqual(['M-staff']);
    expect(out.deleted).toBe(1);
  });

  it('★★ 삭제가 먼저 나간다 — 같은 이메일로 담당자가 바뀌는 저장을 순서로 살린다', async () => {
    const s = store({
      orgCode: 'Z04',
      active: [staff({ memberId: 'M-new', name: '새담당', email: 'desk@example.com' })],
      orphans: [staff({ memberId: 'M-old', linkMemberId: 902, email: 'desk@example.com' })],
    });
    const org = memberAdapter((req) => (req.regTp === 'I' ? { kind: 'created', memberId: 903 } : { kind: 'ok' }));

    await syncMembers(s, org, 'token', new Set(['M-new']));

    expect(org.seen.map((r) => r.regTp)).toEqual(['D', 'I']);
  });

  it('★ 이메일이 없으면 보내지 않고 사유를 남긴다 — 이메일이 삐용 로그인 아이디다', async () => {
    const s = store({ orgCode: 'Z04', active: [staff({ email: null })] });
    const org = memberAdapter();

    const out = await syncMembers(s, org, 'token');

    expect(org.seen).toEqual([]);
    expect(s.wrotePending[0]!.reason).toContain('이메일');
    expect(out.pending).toHaveLength(1);
  });
});

describe('syncMembers — ③ 보낼 것이 없는 경우', () => {
  it('★★ 단체코드가 없으면 아무것도 보내지 않고 **사유도 남기지 않는다**', async () => {
    const s = store({ orgCode: null, active: [staff(), rep()] });
    const out = await syncMembers(s, memberAdapter(), 'token', new Set(['M-staff', 'M-rep']));

    expect(out.sent).toBe(0);
    // ★ 확정 전 회사가 전부 여기 걸린다 — 잘못된 상태가 아니므로 배너를 띄우지 않는다.
    expect(s.wrotePending).toEqual([]);
    expect(out.skipped.join(' ')).toContain('연결되지 않은');
  });

  it('입주사가 없으면 조용히 끝난다', async () => {
    const s = store(null);
    const out = await syncMembers(s, memberAdapter(), 'token');
    expect(out.sent).toBe(0);
    expect(out.skipped.join(' ')).toContain('찾을 수 없다');
  });
});

describe('syncMembers — ④ 실패', () => {
  it('★★ 삐용이 거절해도 던지지 않는다 — 그 행의 대기로 남고 **나머지는 계속 보낸다**', async () => {
    const s = store({
      orgCode: 'Z04',
      active: [
        staff({ memberId: 'M-a', email: 'dup@example.com' }),
        staff({ memberId: 'M-b', email: 'ok@example.com' }),
      ],
    });
    const org = memberAdapter((req) =>
      req.email === 'dup@example.com'
        ? { kind: 'rejected', message: '이미 사용중인 이메일입니다', retryable: false }
        : { kind: 'created', memberId: 905 },
    );

    const out = await syncMembers(s, org, 'token');

    expect(org.seen).toHaveLength(2);
    /*
     * ★ `retryable: false` 를 **함께 적는다**(036). 이메일 겹침은 다시 보내도 같은
     *   답이 오므로, 서버가 저절로 다시 보내지 않게 그 사실을 그 행에 남긴다
     *   (`retryPolicy.judgeLinkRetry` 가 이 값을 보고 한 번도 보내지 않는다).
     */
    expect(s.wrotePending).toEqual([
      { memberId: 'M-a', reason: '이미 사용중인 이메일입니다', retryable: false },
    ]);
    expect(s.wroteLinked).toEqual([{ memberId: 'M-b', linkMemberId: 905 }]);
    expect(out.pending).toHaveLength(1);
  });

  it('★★ 삐용 장애면 **거기서 멈추고** 남은 사람까지 대기로 남긴다 — 던지지 않는다', async () => {
    const s = store({
      orgCode: 'Z04',
      active: [staff({ memberId: 'M-a', email: 'a@x.com' }), staff({ memberId: 'M-b', email: 'b@x.com' })],
    });
    const org = memberAdapter(() => {
      throw new BbiyongUnavailableError('삐용 직원 등록 호출 실패');
    });

    const out = await syncMembers(s, org, 'token');

    // ★ 죽은 상대를 두 번 더 두드리지 않는다.
    expect(org.seen).toHaveLength(1);
    expect(s.wrotePending.map((p) => p.memberId)).toEqual(['M-a', 'M-b']);
    expect(out.pending).toHaveLength(2);
  });

  it('★★★ 토큰 만료는 **그대로 던진다** — withFreshAccess 가 재발급하고 처음부터 다시 부른다', async () => {
    const s = store({ orgCode: 'Z04', active: [staff()] });
    const org = memberAdapter(() => {
      throw new BbiyongTokenExpiredError('401');
    });

    await expect(syncMembers(s, org, 'token')).rejects.toBeInstanceOf(BbiyongTokenExpiredError);
    // ★ 삼키고 「대기」로 적어 버리면 재발급이 돌지 않고 멀쩡한 세션에서 전원이 대기가 된다.
    expect(s.wrotePending).toEqual([]);
  });
});
