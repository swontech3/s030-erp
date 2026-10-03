/**
 * 호실 입주 현황 시험.
 *
 * ★ 여기서 지키는 것은 **화면과 서버가 같은 답을 낸다**는 것이다. 셀렉트에서 사라진
 *   호실이 API 로는 들어가면 막은 의미가 없다.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_COMPANIES,
  EMPTY_OCCUPANCY,
  MIN_MAX_COMPANIES,
  OCCUPANCY_LIVE_STATUSES,
  VIRTUAL_ROOM_TYPE,
  canPickSpace,
  isVirtualRoomType,
  maxCompaniesOf,
  occupancyBySpace,
  rejectSpacePick,
  spaceOptionLabel,
  warnVirtualShared,
  type SpaceHolder,
} from './space-occupancy.ts';

const holder = (over: Partial<SpaceHolder>): SpaceHolder => ({
  spaceId: 'sp1',
  contractId: 'k1',
  companyId: 'c1',
  companyName: '에스원3DP',
  ...over,
});

describe('입주로 세는 상태', () => {
  it('계약중·계약대기만 센다 — 종료·취소는 놓아 준다', () => {
    expect([...OCCUPANCY_LIVE_STATUSES]).toEqual(['confirmed', 'draft']);
  });

  it('계약호실과 같은 목록이다 — 「살아 있는 계약」의 정의는 하나다', async () => {
    const { ROOM_LIVE_STATUSES } = await import('./contract-room.ts');
    expect(OCCUPANCY_LIVE_STATUSES).toBe(ROOM_LIVE_STATUSES);
  });
});

describe('호실별 입주 현황', () => {
  it('아무도 없으면 비어 있다', () => {
    expect(occupancyBySpace([], []).size).toBe(0);
  });

  it('회사 수를 센다', () => {
    const occ = occupancyBySpace(
      [
        holder({ companyId: 'c1', companyName: '가나' }),
        holder({ contractId: 'k2', companyId: 'c2', companyName: '다라' }),
      ],
      [],
    );
    expect(occ.get('sp1')).toEqual({ count: 2, companyNames: ['가나', '다라'] });
  });

  it('★ 한 회사가 두 줄을 잡아도 1곳이다 — 줄로 세면 재계약 때 2곳으로 보인다', () => {
    const occ = occupancyBySpace(
      [holder({ contractId: 'k1' }), holder({ contractId: 'k2' })],
      [],
    );
    expect(occ.get('sp1')?.count).toBe(1);
  });

  it('★★ 자기 계약은 세지 않는다 — 열어서 그대로 저장할 때 자기 호실이 사라진다', () => {
    const holders = [holder({ contractId: 'mine' })];
    expect(occupancyBySpace(holders, ['mine']).get('sp1')).toBeUndefined();
    expect(occupancyBySpace(holders, []).get('sp1')?.count).toBe(1);
  });

  /**
   * ★★ 재계약 — 「자기」가 **둘**이다. 이전 계약이 살아 있는 채로 같은 호실을 들고
   *    있으므로, 빼지 않으면 비상주 호실이 「이미 사용 중」이 되어 **재계약이 자기
   *    이전 계약 때문에 막힌다.**
   */
  it('★ 재계약 — 이어받은 이전 계약도 빼고 센다', () => {
    const occ = occupancyBySpace(
      [holder({ contractId: 'prev' }), holder({ contractId: 'k9', companyId: 'c2', companyName: '남' })],
      ['prev'],
    );
    expect(occ.get('sp1')).toEqual({ count: 1, companyNames: ['남'] });
  });

  it('★ 저장된 재계약은 자기와 이전 계약 둘 다 뺀다', () => {
    const holders = [
      holder({ contractId: 'mine' }),
      holder({ contractId: 'prev', companyId: 'c2', companyName: '이전' }),
    ];
    expect(occupancyBySpace(holders, ['mine', 'prev']).get('sp1')).toBeUndefined();
  });

  it('자기 계약을 빼도 남이 있으면 그대로 센다', () => {
    const occ = occupancyBySpace(
      [holder({ contractId: 'mine' }), holder({ contractId: 'k2', companyId: 'c2', companyName: '남' })],
      ['mine'],
    );
    expect(occ.get('sp1')).toEqual({ count: 1, companyNames: ['남'] });
  });

  /**
   * ★★★ 「한 회사의 계약 둘은 1 이다」 — 자기 회사는 세지 않는다. 세면 1곳짜리
   *    호실에서 같은 회사가 계약을 하나 더 맺는 길이 막히고, 그것은 「회사 수로
   *    센다」와 어긋난다.
   */
  it('★★★ 자기 회사는 세지 않는다 — 계약이 달라도 같은 회사면 자리를 더 먹지 않는다', () => {
    const holders = [holder({ contractId: 'k1', companyId: 'c1' })];
    /* 계약 ID 는 다르다(새 계약) — 그래도 회사가 같아 세지 않는다. */
    expect(occupancyBySpace(holders, [], 'c1').get('sp1')).toBeUndefined();
    expect(occupancyBySpace(holders, [], 'c2').get('sp1')?.count).toBe(1);
  });

  it('자기 회사를 빼도 다른 회사는 그대로 센다', () => {
    const occ = occupancyBySpace(
      [holder({ companyId: 'c1' }), holder({ contractId: 'k2', companyId: 'c2', companyName: '남' })],
      [],
      'c1',
    );
    expect(occ.get('sp1')).toEqual({ count: 1, companyNames: ['남'] });
  });

  it('입주사를 아직 안 골랐으면(null·빈 문자열) 아무것도 빼지 않는다', () => {
    const holders = [holder({ companyId: 'c1' })];
    expect(occupancyBySpace(holders, [], null).get('sp1')?.count).toBe(1);
    expect(occupancyBySpace(holders, [], '').get('sp1')?.count).toBe(1);
    expect(occupancyBySpace(holders, []).get('sp1')?.count).toBe(1);
  });

  it('호실이 다르면 따로 센다', () => {
    const occ = occupancyBySpace(
      [holder({ spaceId: 'a' }), holder({ spaceId: 'b', contractId: 'k2', companyId: 'c2' })],
      [],
    );
    expect(occ.get('a')?.count).toBe(1);
    expect(occ.get('b')?.count).toBe(1);
  });
});

describe('호실이 정한 수 — 「입주 가능 회사 수」', () => {
  it('값이 없거나 1 미만이면 기본값이다 — 느슨한 쪽으로 넘어가지 않는다', () => {
    expect(DEFAULT_MAX_COMPANIES).toBe(1);
    expect(MIN_MAX_COMPANIES).toBe(1);
    expect(maxCompaniesOf(null)).toBe(1);
    expect(maxCompaniesOf(undefined)).toBe(1);
    expect(maxCompaniesOf(0)).toBe(1);
    expect(maxCompaniesOf(-3)).toBe(1);
    expect(maxCompaniesOf(Number.NaN)).toBe(1);
  });

  it('준 수는 그대로 쓴다. 소수는 버린다', () => {
    expect(maxCompaniesOf(1)).toBe(1);
    expect(maxCompaniesOf(3)).toBe(3);
    expect(maxCompaniesOf(2.9)).toBe(2);
  });
});

describe('고를 수 있는가', () => {
  const occOf = (count: number) => ({ count, companyNames: Array.from({ length: count }, (_, i) => `회사${i}`) });

  it('★ 1곳짜리 호실은 아무도 없어야 고른다 — 기본값이 이것이다', () => {
    expect(canPickSpace({ occupancy: EMPTY_OCCUPANCY, maxCompanies: 1 })).toBe(true);
    expect(canPickSpace({ occupancy: occOf(1), maxCompanies: 1 })).toBe(false);
    expect(canPickSpace({ occupancy: occOf(2), maxCompanies: 1 })).toBe(false);
  });

  it('2곳짜리는 1곳까지 고른다. 2곳이면 막는다', () => {
    expect(canPickSpace({ occupancy: EMPTY_OCCUPANCY, maxCompanies: 2 })).toBe(true);
    expect(canPickSpace({ occupancy: occOf(1), maxCompanies: 2 })).toBe(true);
    expect(canPickSpace({ occupancy: occOf(2), maxCompanies: 2 })).toBe(false);
    expect(canPickSpace({ occupancy: occOf(3), maxCompanies: 2 })).toBe(false);
  });

  it('운영자가 올린 수만큼 늘어난다 — 코드에 박힌 2 가 아니다', () => {
    expect(canPickSpace({ occupancy: occOf(2), maxCompanies: 3 })).toBe(true);
    expect(canPickSpace({ occupancy: occOf(3), maxCompanies: 3 })).toBe(false);
  });

  it('★ 수를 모르면 1곳으로 본다 — 목록에 뜨는데 저장이 막히는 쪽이 더 나쁘다', () => {
    expect(canPickSpace({ occupancy: EMPTY_OCCUPANCY })).toBe(true);
    expect(canPickSpace({ occupancy: occOf(1) })).toBe(false);
    expect(canPickSpace({ occupancy: occOf(1), maxCompanies: null })).toBe(false);
  });

  it('현황을 모르는 호실은 빈 것으로 본다', () => {
    expect(canPickSpace({ occupancy: undefined, maxCompanies: 1 })).toBe(true);
  });

  it('★ 같은 계약 안에서 이미 고른 호실은 못 고른다 — 수가 남아 있어도', () => {
    expect(canPickSpace({ occupancy: EMPTY_OCCUPANCY, maxCompanies: 9, pickedElsewhere: true })).toBe(false);
  });

  it('★ 계약구분을 보지 않는다 — 비상주 특례를 없앴다', () => {
    /* 비상주도 수가 2 면 1곳까지 고른다. 막는 것은 「수」 하나다. */
    expect(canPickSpace({ occupancy: occOf(1), maxCompanies: 2 })).toBe(true);
  });
});

describe('비상주를 여러 곳에 열 때의 알림', () => {
  it('막지 않고 알린다 — 같은 주소로 사업자가 여럿 등록된다', () => {
    const msg = warnVirtualShared(VIRTUAL_ROOM_TYPE, 2);
    expect(msg).toContain('비상주');
    expect(msg).toContain('2곳');
  });

  it('1곳이면 알릴 것이 없다', () => {
    expect(warnVirtualShared(VIRTUAL_ROOM_TYPE, 1)).toBeNull();
  });

  it('비상주가 아니면 알리지 않는다', () => {
    expect(warnVirtualShared('R1', 5)).toBeNull();
  });

  it('계약구분에 공백이 섞여도 비상주로 본다 — 코드 값이 늘 깨끗하지는 않다', () => {
    expect(isVirtualRoomType(' VR ')).toBe(true);
    expect(warnVirtualShared(' VR ', 3)).not.toBeNull();
  });
});

describe('셀렉트 글자', () => {
  it('아무도 없으면 이름만', () => {
    expect(spaceOptionLabel('Room 1', EMPTY_OCCUPANCY)).toBe('Room 1');
    expect(spaceOptionLabel('Room 1', undefined)).toBe('Room 1');
  });

  it('1곳이면 회사 이름을 함께 보여준다 — 모르고 겹치는 것과 알고 겹치는 것은 다르다', () => {
    expect(spaceOptionLabel('Room 1', { count: 1, companyNames: ['에스원3DP'] })).toBe('Room 1 (에스원3DP)');
  });

  it('★ 여러 곳이면 전부 적는다 — 한 곳만 보이면 나머지는 모르고 겹치는 것이 된다', () => {
    expect(spaceOptionLabel('Room 1', { count: 2, companyNames: ['가나', '다라'] })).toBe('Room 1 (가나 · 다라)');
  });

  it('이름이 비어 있으면 붙이지 않는다', () => {
    expect(spaceOptionLabel('Room 1', { count: 1, companyNames: [''] })).toBe('Room 1');
  });
});

describe('저장 거절', () => {
  /** 이름과 「입주 가능 회사 수」를 같은 줄에서 준다 — 서버가 보는 모양 그대로다. */
  const spaces: Record<string, { roomName: string; maxCompanies: number }> = {
    a: { roomName: 'Room 1', maxCompanies: 2 },
    v: { roomName: 'VIR 01', maxCompanies: 1 },
  };
  const spaceOf = (id: string) => spaces[id];

  it('빈 현황이면 통과한다', () => {
    expect(rejectSpacePick([{ roomType: 'R1', spaceId: 'a' }], new Map(), spaceOf)).toBeNull();
  });

  it('★ 1곳짜리에 이미 한 곳이 있으면 거절한다 — 몇 곳까지인지와 누가 쓰는지를 말한다', () => {
    const occ = new Map([['v', { count: 1, companyNames: ['디데이'] }]]);
    const msg = rejectSpacePick([{ roomType: 'VR', spaceId: 'v' }], occ, spaceOf);
    expect(msg).toContain('VIR 01');
    expect(msg).toContain('1곳까지');
    expect(msg).toContain('디데이');
  });

  it('2곳짜리는 1곳까지 통과하고 2곳이면 거절한다', () => {
    const one = new Map([['a', { count: 1, companyNames: ['가나'] }]]);
    expect(rejectSpacePick([{ roomType: 'R1', spaceId: 'a' }], one, spaceOf)).toBeNull();
    const two = new Map([['a', { count: 2, companyNames: ['가나', '다라'] }]]);
    const msg = rejectSpacePick([{ roomType: 'R1', spaceId: 'a' }], two, spaceOf);
    expect(msg).toContain('2곳까지');
    expect(msg).toContain('가나 · 다라');
  });

  it('★★ 화면이 거르는 것과 같은 답을 낸다 — 두 규칙이 갈리면 목록과 저장이 어긋난다', () => {
    for (const max of [1, 2, 3]) {
      for (let count = 0; count <= 4; count += 1) {
        const occ = new Map([['a', { count, companyNames: Array.from({ length: count }, (_, i) => `회사${i}`) }]]);
        const screen = canPickSpace({ occupancy: occ.get('a'), maxCompanies: max });
        const server = rejectSpacePick(
          [{ roomType: 'R1', spaceId: 'a' }],
          occ,
          () => ({ roomName: 'Room 1', maxCompanies: max }),
        );
        expect(server === null).toBe(screen);
      }
    }
  });

  it('★ 같은 호실을 두 줄에 넣으면 거절한다', () => {
    const msg = rejectSpacePick(
      [
        { roomType: 'R1', spaceId: 'a' },
        { roomType: 'R1', spaceId: 'a' },
      ],
      new Map(),
      spaceOf,
    );
    expect(msg).toContain('두 줄');
  });

  it('빈 호실 줄은 보지 않는다 — 그건 페이로드가 먼저 막는다', () => {
    expect(
      rejectSpacePick(
        [
          { roomType: 'R1', spaceId: '' },
          { roomType: 'R1', spaceId: '' },
        ],
        new Map(),
        spaceOf,
      ),
    ).toBeNull();
  });

  it('이름을 모르면 식별자로 말한다 — 「 은(는) 이미」로 시작하는 문구가 되면 안 된다', () => {
    const occ = new Map([['zz', { count: 2, companyNames: ['가', '나'] }]]);
    expect(rejectSpacePick([{ roomType: 'R1', spaceId: 'zz' }], occ, spaceOf)).toContain('zz');
  });

  it('★ 모르는 호실은 1곳으로 본다 — 폐쇄한 호실을 API 로 밀어 넣어도 막힌다', () => {
    const occ = new Map([['zz', { count: 1, companyNames: ['가'] }]]);
    expect(rejectSpacePick([{ roomType: 'R1', spaceId: 'zz' }], occ, spaceOf)).toContain('1곳까지');
  });
});
