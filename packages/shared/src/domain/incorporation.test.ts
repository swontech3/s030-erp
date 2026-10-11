import { describe, expect, it } from 'vitest';
import {
  INCORP_FIELD_DEFS,
  INCORP_FOUNDER_MAX,
  INCORP_PURPOSE_MAX,
  checkIncorporationTransition,
  incorporationWarnings,
  isMonthDay,
  validateIncorporation,
  type IncorporationContent,
  type IncorporationPersonInput,
} from './incorporation.ts';
import { checkTransition } from './corp-change.ts';

const CEO: IncorporationPersonInput = { name: '홍길동', isFounder: true, isDirector: true, isRepresentative: true, unitsSubscribed: 10_000 };
const OK: IncorporationContent = {
  info: {
    nameKo: '스원테크',
    nameEn: null,
    hq: { zipCode: '06234', address: '서울특별시 강남구 테헤란로 123', addressDetail: '4층' },
    capitalAmount: 10_000_000,
    parValue: 1_000,
    unitsAuthorized: 100_000,
    unitsIssued: 10_000,
    publicNoticeMethod: null,
    fiscalStart: '01-01',
    fiscalEnd: '12-31',
    plannedDate: '2026-11-02',
    purposes: '소프트웨어 개발 및 공급업\n경영 컨설팅업',
  },
  persons: [CEO],
};
const fields = (c: IncorporationContent) => validateIncorporation(c).map((e) => e.field);
const withInfo = (patch: Partial<IncorporationContent['info']>): IncorporationContent => ({ ...OK, info: { ...OK.info, ...patch } });

describe('validateIncorporation', () => {
  it('정상이면 오류 없음 — 영문 상호 · 공고방법은 선택', () => {
    expect(validateIncorporation(OK)).toEqual([]);
  });

  it('필수 칸이 비면 칸마다 오류', () => {
    const required = INCORP_FIELD_DEFS.filter((d) => d.required).map((d) => d.name);
    expect(required).toEqual(['nameKo', 'hq', 'capitalAmount', 'parValue', 'unitsAuthorized', 'unitsIssued', 'fiscalStart', 'fiscalEnd', 'plannedDate', 'purposes']);
    const empty = fields({ info: {}, persons: [CEO] });
    expect(empty).toEqual(expect.arrayContaining(required));
  });

  it('본점은 우편번호 · 기본주소가 둘 다 있어야 한다', () => {
    expect(fields(withInfo({ hq: { zipCode: '06234', address: ' ' } }))).toEqual(['hq.address']);
  });

  it('숫자 칸 · 사업연도 · 설립예정일 형식', () => {
    expect(fields(withInfo({ parValue: 0 }))).toContain('parValue');
    expect(fields(withInfo({ unitsIssued: 1.5 }))).toContain('unitsIssued');
    expect(fields(withInfo({ capitalAmount: Number.MAX_SAFE_INTEGER + 1 }))).toContain('capitalAmount');
    // ★ 21억을 넘는 금액도 받는다(042 bigint) — 30억 = 1,000원 × 3,000,000주
    const big = withInfo({ capitalAmount: 3_000_000_000, unitsAuthorized: 3_000_000, unitsIssued: 3_000_000 });
    expect(fields({ ...big, persons: [{ ...CEO, unitsSubscribed: 3_000_000 }] })).toEqual([]);
    expect(fields(withInfo({ fiscalStart: '1-1' }))).toContain('fiscalStart');
    expect(fields(withInfo({ fiscalEnd: '02-30' }))).toContain('fiscalEnd');
    expect(fields(withInfo({ plannedDate: '2026-02-30' }))).toContain('plannedDate');
  });

  it('★ 자본금 = 1주의 금액 × 설립 때 발행 수', () => {
    expect(fields(withInfo({ capitalAmount: 9_000_000 }))).toEqual(['capitalAmount']);
  });

  it('설립 때 발행 수 ≤ 발행할 총수', () => {
    const c = withInfo({ unitsAuthorized: 5_000 });
    expect(fields(c)).toEqual(['unitsIssued']);
  });

  it('★ 발기인 인수 주식 수 합 = 설립 때 발행 수 (이사 · 감사의 인수수량은 세지 않는다)', () => {
    const c: IncorporationContent = {
      ...OK,
      persons: [
        { ...CEO, unitsSubscribed: 6_000 },
        { name: '이을순', isFounder: true, unitsSubscribed: 3_000 },
        { name: '박병철', isAuditor: true, unitsSubscribed: 1_000 },
      ],
    };
    const e = validateIncorporation(c);
    expect(e.map((x) => x.field)).toEqual(['persons']);
    expect(e[0]!.message).toContain('합(9,000)');
  });

  it(`★ 사업목적 ${INCORP_PURPOSE_MAX}줄 · 발기인 ${INCORP_FOUNDER_MAX}명까지 — 넘으면 거절`, () => {
    const lines = (n: number) => Array.from({ length: n }, (_, i) => `목적 ${i + 1}`).join('\n');
    expect(fields(withInfo({ purposes: lines(INCORP_PURPOSE_MAX) }))).toEqual([]);
    expect(fields(withInfo({ purposes: lines(INCORP_PURPOSE_MAX + 1) }))).toEqual(['purposes']);

    const founders = (n: number): IncorporationPersonInput[] =>
      Array.from({ length: n }, (_, i) => ({ name: `발기인${i}`, isFounder: true, isRepresentative: i === 0, unitsSubscribed: i === 0 ? 10_000 : 0 }));
    expect(fields({ ...OK, persons: founders(INCORP_FOUNDER_MAX) })).toEqual([]);
    expect(fields({ ...OK, persons: founders(INCORP_FOUNDER_MAX + 1) })).toEqual(['persons']);
  });

  it('발기인 · 대표이사가 없으면 거절', () => {
    expect(validateIncorporation({ ...OK, persons: [{ name: '김이사', isDirector: true }] }).map((e) => e.message)).toEqual([
      '발기인을 1명 이상 등록하세요',
      '대표이사를 1명 이상 등록하세요',
    ]);
  });

  it('사람 칸 — 성명 · 역할 하나 이상 · 인수수량 · 취임일 · 주민번호 모양', () => {
    const e = fields({
      ...OK,
      persons: [CEO, { name: ' ', unitsSubscribed: -1, appointmentDate: '2026-13-01', rrn: '12345' }],
    });
    expect(e).toEqual(['persons.1.name', 'persons.1.roles', 'persons.1.unitsSubscribed', 'persons.1.appointmentDate', 'persons.1.rrn']);
  });
});

describe('isMonthDay', () => {
  it('있는 날짜만 — 2월 29일은 받는다', () => {
    expect(['01-01', '12-31', '02-29'].map(isMonthDay)).toEqual([true, true, true]);
    expect(['02-30', '13-01', '00-10', '1-01', '01/01'].map(isMonthDay)).toEqual([false, false, false, false, false]);
  });
});

describe('incorporationWarnings — 막지 않는다', () => {
  it('1주 100원 미만 · 자본금 10억 이상인데 감사 없음', () => {
    expect(incorporationWarnings(OK)).toEqual([]);
    expect(incorporationWarnings(withInfo({ parValue: 50, capitalAmount: 1_000_000_000 }))).toEqual([
      '1주의 금액이 100원 미만입니다',
      '자본금이 10억 원 이상인데 감사가 없습니다',
    ]);
  });
});

describe('checkIncorporationTransition — 법인변경과 같은 규칙', () => {
  it('P→E 는 저장될 내용으로 검증 · 내용이 없으면 거절', () => {
    expect(checkIncorporationTransition({ from: 'P', to: 'E', role: 'tenant', content: OK })).toEqual({ ok: true });
    expect(checkIncorporationTransition({ from: 'P', to: 'E', role: 'tenant', content: withInfo({ nameKo: '' }) })).toMatchObject({
      ok: false,
      code: 'invalid',
      errors: [{ field: 'nameKo' }],
    });
    expect(checkIncorporationTransition({ from: 'P', to: 'E', role: 'tenant' })).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('★ 역할 · 표 · 복원은 법인변경 판정과 같은 답', () => {
    const cases = [
      { from: 'E', to: 'C', role: 'tenant' as const },
      { from: 'C', to: 'E', role: 'tenant' as const },
      { from: 'P', to: 'X', role: 'operator' as const },
      { from: 'X', to: 'E', role: 'operator' as const, statusBeforeCancel: 'P' },
      { from: 'P', to: 'A', role: 'operator' as const },
      { from: 'S', to: 'P', role: 'operator' as const },
    ];
    for (const c of cases) expect(checkIncorporationTransition(c)).toEqual(checkTransition(c));
  });
});
