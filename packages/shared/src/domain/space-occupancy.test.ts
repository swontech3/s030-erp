/**
 * 호실 입주 현황 시험.
 *
 * ★ 여기서 지키는 것은 **화면과 서버가 같은 답을 낸다**는 것이다. 셀렉트에서 사라진
 *   호실이 API 로는 들어가면 막은 의미가 없다.
 */
import { describe, expect, it } from 'vitest';
import {
  EMPTY_OCCUPANCY,
  OCCUPANCY_LIVE_STATUSES,
  VIRTUAL_ROOM_TYPE,
  canPickSpace,
  isVirtualRoomType,
  occupancyBySpace,
  rejectSpacePick,
  spaceOptionLabel,
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

  it('호실이 다르면 따로 센다', () => {
    const occ = occupancyBySpace(
      [holder({ spaceId: 'a' }), holder({ spaceId: 'b', contractId: 'k2', companyId: 'c2' })],
      [],
    );
    expect(occ.get('a')?.count).toBe(1);
    expect(occ.get('b')?.count).toBe(1);
  });
});

describe('고를 수 있는가', () => {
  const occOf = (count: number) => ({ count, companyNames: Array.from({ length: count }, (_, i) => `회사${i}`) });

  it('★ 비상주는 아무도 없어야 고른다 — 한 호실에 한 회사다', () => {
    expect(canPickSpace({ roomType: VIRTUAL_ROOM_TYPE, occupancy: EMPTY_OCCUPANCY })).toBe(true);
    expect(canPickSpace({ roomType: VIRTUAL_ROOM_TYPE, occupancy: occOf(1) })).toBe(false);
    expect(canPickSpace({ roomType: VIRTUAL_ROOM_TYPE, occupancy: occOf(2) })).toBe(false);
  });

  it('그 외 구분은 1곳까지 고른다. 2곳이면 막는다', () => {
    for (const type of ['R1', 'R2', 'FI', 'FR']) {
      expect(canPickSpace({ roomType: type, occupancy: EMPTY_OCCUPANCY })).toBe(true);
      expect(canPickSpace({ roomType: type, occupancy: occOf(1) })).toBe(true);
      expect(canPickSpace({ roomType: type, occupancy: occOf(2) })).toBe(false);
      expect(canPickSpace({ roomType: type, occupancy: occOf(3) })).toBe(false);
    }
  });

  it('현황을 모르는 호실은 빈 것으로 본다', () => {
    expect(canPickSpace({ roomType: VIRTUAL_ROOM_TYPE, occupancy: undefined })).toBe(true);
  });

  it('★ 같은 계약 안에서 이미 고른 호실은 못 고른다', () => {
    expect(canPickSpace({ roomType: 'R1', occupancy: EMPTY_OCCUPANCY, pickedElsewhere: true })).toBe(false);
  });

  it('계약구분에 공백이 섞여도 비상주로 본다 — 코드 값이 늘 깨끗하지는 않다', () => {
    expect(isVirtualRoomType(' VR ')).toBe(true);
    expect(canPickSpace({ roomType: ' VR ', occupancy: occOf(1) })).toBe(false);
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

  it('이름이 비어 있으면 붙이지 않는다', () => {
    expect(spaceOptionLabel('Room 1', { count: 1, companyNames: [''] })).toBe('Room 1');
  });
});

describe('저장 거절', () => {
  const names: Record<string, string> = { a: 'Room 1', v: 'VIR 01' };
  const nameOf = (id: string) => names[id] ?? '';

  it('빈 현황이면 통과한다', () => {
    expect(rejectSpacePick([{ roomType: 'R1', spaceId: 'a' }], new Map(), nameOf)).toBeNull();
  });

  it('★ 비상주에 이미 한 곳이 있으면 거절한다 — 누가 쓰는지까지 말한다', () => {
    const occ = new Map([['v', { count: 1, companyNames: ['디데이'] }]]);
    const msg = rejectSpacePick([{ roomType: 'VR', spaceId: 'v' }], occ, nameOf);
    expect(msg).toContain('VIR 01');
    expect(msg).toContain('디데이');
    expect(msg).toContain('비상주');
  });

  it('상주는 1곳까지 통과하고 2곳이면 거절한다', () => {
    const one = new Map([['a', { count: 1, companyNames: ['가나'] }]]);
    expect(rejectSpacePick([{ roomType: 'R1', spaceId: 'a' }], one, nameOf)).toBeNull();
    const two = new Map([['a', { count: 2, companyNames: ['가나', '다라'] }]]);
    expect(rejectSpacePick([{ roomType: 'R1', spaceId: 'a' }], two, nameOf)).toContain('2곳');
  });

  it('★ 같은 호실을 두 줄에 넣으면 거절한다', () => {
    const msg = rejectSpacePick(
      [
        { roomType: 'R1', spaceId: 'a' },
        { roomType: 'R1', spaceId: 'a' },
      ],
      new Map(),
      nameOf,
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
        nameOf,
      ),
    ).toBeNull();
  });

  it('이름을 모르면 식별자로 말한다 — 「 은(는) 이미」로 시작하는 문구가 되면 안 된다', () => {
    const occ = new Map([['zz', { count: 2, companyNames: ['가', '나'] }]]);
    expect(rejectSpacePick([{ roomType: 'R1', spaceId: 'zz' }], occ, nameOf)).toContain('zz');
  });
});
