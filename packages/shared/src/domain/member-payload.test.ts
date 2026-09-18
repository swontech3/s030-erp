import { describe, expect, it } from 'vitest';
import { MAX_MEMBERS, MEMBER_ROLE, buildMemberWrites } from './member-payload.ts';

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `사람${i + 1}` }));

describe('buildMemberWrites', () => {
  it('상한을 넘으면 던진다 — 화면이 아니라 여기서 막힌다', () => {
    expect(() => buildMemberWrites(rows(MAX_MEMBERS + 1))).toThrow(RangeError);
    expect(buildMemberWrites(rows(MAX_MEMBERS))).toHaveLength(MAX_MEMBERS);
  });

  it('이름이 빈 줄은 몇 번째인지 말하며 던진다', () => {
    expect(() => buildMemberWrites([{ name: '김대표' }, { name: '  ' }])).toThrow(/2행 성명/);
  });

  it('★ 대표자 체크가 boolean 으로 와도 저장은 코드값이다', () => {
    const out = buildMemberWrites([
      { name: '김대표', isRepresentative: true },
      { name: '이직원' },
    ]);
    expect(out[0]?.isRepresentative).toBe(MEMBER_ROLE.REPRESENTATIVE);
    expect(out[1]?.isRepresentative).toBe(MEMBER_ROLE.STAFF);
    expect(MEMBER_ROLE.REPRESENTATIVE).toBe('C');
    expect(MEMBER_ROLE.STAFF).toBe('M');
  });

  it('대표자가 여럿이면 첫 번째만 남는다', () => {
    const out = buildMemberWrites([
      { name: '가', isRepresentative: true },
      { name: '나', isRepresentative: true },
    ]);
    expect(out.map((r) => r.isRepresentative)).toEqual(['C', 'M']);
  });

  it('★ 대표자가 아무도 없으면 첫 줄이 대표다 — 대표 없는 회사를 만들지 않는다', () => {
    const out = buildMemberWrites([{ name: '가' }, { name: '나' }]);
    expect(out.map((r) => r.isRepresentative)).toEqual(['C', 'M']);
  });

  it('빈 배열은 허용한다', () => {
    expect(buildMemberWrites([])).toEqual([]);
  });

  it('빈 문자열은 null 로 눕힌다 — undefined 를 DB 로 흘리지 않는다', () => {
    const out = buildMemberWrites([{ name: '가', phone: '  ', email: '', memo: undefined }]);
    expect(out[0]).toMatchObject({ phone: null, email: null, memo: null, memberId: null });
  });
});
