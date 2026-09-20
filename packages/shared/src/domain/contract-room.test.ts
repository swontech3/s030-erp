/**
 * 계약호실 판정 — 화면과 서버가 **같은 함수**를 본다.
 *
 * 이 번호는 세무서에 내는 번호다. 두 계약이 같은 번호로 제출되면 밖에서 사고가
 * 난다. 그래서 「무엇이 중복인가」를 여기서 고정한다.
 */
import { describe, it, expect } from 'vitest';
import {
  ROOM_LIVE_STATUSES,
  compareRooms,
  findRoomConflict,
  holdsRoom,
  normalizeRoom,
  sortRoomHolders,
} from './contract-room.ts';

describe('holdsRoom', () => {
  it('계약중·계약대기만 번호를 붙들고 있다', () => {
    expect(holdsRoom('confirmed')).toBe(true);
    expect(holdsRoom('draft')).toBe(true);
  });

  /** ★ 끝난 계약의 번호는 **다시 쓸 수 있다.** 퇴실했으면 그 호실로 다시 신고한다. */
  it('종료·취소는 번호를 놓아 준다', () => {
    expect(holdsRoom('terminated')).toBe(false);
    expect(holdsRoom('cancelled')).toBe(false);
  });

  it('상태 목록이 둘뿐이다 — 늘어나면 이 테스트가 먼저 깨진다', () => {
    expect([...ROOM_LIVE_STATUSES]).toEqual(['confirmed', 'draft']);
  });
});

describe('findRoomConflict', () => {
  const holders = [
    { contractId: 'k-1', companyName: '에스원3DP', room: '6-1' },
    { contractId: 'k-2', companyName: '○○상사', room: '112-3' },
  ];

  it('같은 번호가 있으면 그 계약을 돌려준다', () => {
    expect(findRoomConflict(holders, '6-1', null)?.contractId).toBe('k-1');
  });

  it('없는 번호는 중복이 아니다', () => {
    expect(findRoomConflict(holders, '9-9', null)).toBeNull();
  });

  /** ★★ 자기 자신을 막으면 **아무도 자기 계약을 수정할 수 없다.** */
  it('지금 편집 중인 그 계약은 중복이 아니다', () => {
    expect(findRoomConflict(holders, '6-1', 'k-1')).toBeNull();
  });

  it('다른 계약이면 편집 중이어도 중복이다', () => {
    expect(findRoomConflict(holders, '6-1', 'k-2')?.contractId).toBe('k-1');
  });

  it('앞뒤 공백은 같은 번호로 본다', () => {
    expect(findRoomConflict(holders, '  6-1 ', null)?.contractId).toBe('k-1');
  });

  /** ★ 아직 안 정한 계약끼리 부딪히면 안 된다. */
  it('빈 번호는 중복이 아니다', () => {
    expect(findRoomConflict([...holders, { contractId: 'k-3', companyName: 'x', room: '' }], '', null)).toBeNull();
  });
});

describe('compareRooms', () => {
  /** ★ 글자로 정렬하면 `1-10 · 112-3 · 6-1 · 7-2` 가 된다. 숫자 토막은 숫자로 본다. */
  it('숫자 토막을 숫자로 비교한다', () => {
    const sorted = ['112-3', '6-1', '1-10', '7-2'].sort(compareRooms);
    expect(sorted).toEqual(['1-10', '6-1', '7-2', '112-3']);
  });

  it('앞이 같으면 뒤 숫자로 가른다', () => {
    expect(['6-10', '6-2'].sort(compareRooms)).toEqual(['6-2', '6-10']);
  });

  it('짧은 쪽이 앞이다', () => {
    expect(['6-1', '6'].sort(compareRooms)).toEqual(['6', '6-1']);
  });

  /** 세무서 표기라 무엇이 들어올지 우리가 정하지 않는다. 죽지만 않으면 된다. */
  it('숫자가 아닌 번호가 섞여도 죽지 않는다', () => {
    expect(() => ['B1', '6-1', '지하1'].sort(compareRooms)).not.toThrow();
  });
});

describe('sortRoomHolders', () => {
  it('번호 순으로 정렬하고 원본을 건드리지 않는다', () => {
    const input = [
      { contractId: 'a', companyName: '가', room: '112-3' },
      { contractId: 'b', companyName: '나', room: '6-1' },
    ];
    expect(sortRoomHolders(input).map((h) => h.room)).toEqual(['6-1', '112-3']);
    expect(input[0]!.room).toBe('112-3');
  });

  it('번호가 같으면 회사명으로 가른다 — 순서가 흔들리지 않게', () => {
    const same = [
      { contractId: 'a', companyName: '나회사', room: '6-1' },
      { contractId: 'b', companyName: '가회사', room: '6-1' },
    ];
    expect(sortRoomHolders(same).map((h) => h.companyName)).toEqual(['가회사', '나회사']);
  });
});

describe('normalizeRoom', () => {
  it('앞뒤 공백만 뗀다 — 가운데는 건드리지 않는다', () => {
    expect(normalizeRoom('  6 - 1  ')).toBe('6 - 1');
  });

  it('없는 값은 빈 문자열이다', () => {
    expect(normalizeRoom(null)).toBe('');
    expect(normalizeRoom(undefined)).toBe('');
  });
});
