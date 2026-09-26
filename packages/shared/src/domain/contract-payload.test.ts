/**
 * 계약 저장 페이로드 — 화면이 올린 것을 저장할 행으로 바꾼다.
 *
 * ★★ 이 모듈의 존재 이유 하나 — **화면 값을 믿지 않는다.**
 *    파생값(종료일 · 첫달납부액 · 부가세액 · 납부액 · No)은 화면이 무엇을 보내든
 *    서버가 다시 계산한 값으로 덮는다. 세금계산서가 걸린 숫자다(CONT-10).
 *
 * 요구사항: CONT-04(최대 10행) · CONT-10(총액 서버 재계산).
 */
import { describe, it, expect } from 'vitest';
import { PAYMENT_METHOD } from './contract-amounts';
import { MAX_CONTRACT_SPACES, buildContractWrite } from './contract-payload';

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

/** 호실 줄 하나. 기준가 450,000 / 실계약가 400,000 — 할인이 있는 쪽이 기본이다. */
const space = (over: Partial<Parameters<typeof buildContractWrite>[0]['spaces'][number]> = {}) => ({
  roomType: 'R1',
  spaceId: 'space-1',
  standardFee: 450_000,
  deposit: 900_000,
  monthlyFee: 400_000,
  vatYn: true,
  ...over,
});

const input = (over: Partial<Parameters<typeof buildContractWrite>[0]> = {}) => ({
  buildId: 'build-1',
  paymentMethod: PAYMENT_METHOD.MONTHLY,
  periodMonths: 12,
  startDate: utc(2026, 1, 1),
  spaces: [space()],
  ...over,
});

// ═══════════════════════════════════════════════════════════════════════════
// 정상 경로
// ═══════════════════════════════════════════════════════════════════════════
describe('buildContractWrite — 저장할 행을 만든다', () => {
  it('호실 줄을 그대로 옮긴다', () => {
    const { spaces } = buildContractWrite(input());
    expect(spaces).toHaveLength(1);
    expect(spaces[0]).toMatchObject({
      roomType: 'R1',
      spaceId: 'space-1',
      standardFee: 450_000,
      deposit: 900_000,
      monthlyFee: 400_000,
      vatYn: true,
    });
  });

  it('입력한 계약 조건을 그대로 옮긴다', () => {
    const { contract } = buildContractWrite(input({ contractRoom: '6-1', accessRoute: 'D', memo: '첫 달 무료' }));
    expect(contract).toMatchObject({
      buildId: 'build-1',
      contractRoom: '6-1',
      accessRoute: 'D',
      memo: '첫 달 무료',
      paymentMethod: PAYMENT_METHOD.MONTHLY,
      periodMonths: 12,
    });
  });

  it('안 보낸 선택 칸은 null 이다 — undefined 를 DB 로 흘리지 않는다', () => {
    const { contract } = buildContractWrite(input());
    expect(contract.contractRoom).toBeNull();
    expect(contract.accessRoute).toBeNull();
    expect(contract.memo).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ★ 파생값은 서버가 다시 계산한다 (CONT-10)
// ═══════════════════════════════════════════════════════════════════════════
describe('buildContractWrite — 무상 개월수', () => {
  it('안 보내면 0 이다', () => {
    expect(buildContractWrite(input()).contract.freeMonths).toBe(0);
  });

  it('보낸 값을 그대로 저장한다', () => {
    expect(buildContractWrite(input({ freeMonths: 2 })).contract.freeMonths).toBe(2);
  });

  it('★ 무상이 있으면 월납 첫달납부액이 예치금뿐이다', () => {
    // 예치금 900,000 / 월납부액 440,000
    expect(buildContractWrite(input({ freeMonths: 1 })).contract.firstPayment).toBe(900_000);
    expect(buildContractWrite(input()).contract.firstPayment).toBe(1_340_000);
  });

  it('★ 무상이 기간 이상이면 던진다 — 서버가 마지막 방어선이다', () => {
    expect(() => buildContractWrite(input({ periodMonths: 6, freeMonths: 6 }))).toThrow(RangeError);
  });
});

describe('buildContractWrite — 화면 값을 믿지 않는다', () => {
  it('★ No(seq)는 서버가 배열 순서로 매긴다', () => {
    const { spaces } = buildContractWrite(
      input({ spaces: [space({ spaceId: 'a' }), space({ spaceId: 'b' }), space({ spaceId: 'c' })] }),
    );
    expect(spaces.map((s) => s.seq)).toEqual([1, 2, 3]);
  });

  it('★ 화면이 보낸 seq 는 무시한다 — 겹치면 UNIQUE 인덱스에 걸린다', () => {
    const { spaces } = buildContractWrite(
      input({
        spaces: [
          space({ spaceId: 'a', seq: 7 } as never),
          space({ spaceId: 'b', seq: 7 } as never),
        ],
      }),
    );
    expect(spaces.map((s) => s.seq)).toEqual([1, 2]);
  });

  it('★ 종료일은 서버가 계산한다 — 2026-01-01 + 12개월 = 2026-12-31', () => {
    const { contract } = buildContractWrite(input());
    expect(contract.endDate.toISOString().slice(0, 10)).toBe('2026-12-31');
  });

  it('★ 화면이 종료일을 보내도 서버 계산값을 쓴다', () => {
    const { contract } = buildContractWrite(input({ endDate: utc(2099, 12, 31) } as never));
    expect(contract.endDate.toISOString().slice(0, 10)).toBe('2026-12-31');
  });

  it('★ 말일 처리도 서버 규칙이다 — 1/31 + 1개월 = 2/27', () => {
    const { contract } = buildContractWrite(input({ startDate: utc(2026, 1, 31), periodMonths: 1 }));
    expect(contract.endDate.toISOString().slice(0, 10)).toBe('2026-02-27');
  });

  it('★ 부가세액·납부액은 서버가 재계산한다 — 400,000 → 40,000 / 440,000', () => {
    const { spaces } = buildContractWrite(input());
    expect(spaces[0].vatAmount).toBe(40_000);
    expect(spaces[0].paymentAmount).toBe(440_000);
  });

  it('★ vat_yn 이 꺼진 줄은 부가세 0 이다', () => {
    const { spaces } = buildContractWrite(input({ spaces: [space({ vatYn: false })] }));
    expect(spaces[0].vatAmount).toBe(0);
    expect(spaces[0].paymentAmount).toBe(400_000);
  });

  it('★ 첫달납부액은 서버가 계산한다 — 월납: 월납부액 합계 + 예치금 합계', () => {
    const { contract } = buildContractWrite(input());
    expect(contract.firstPayment).toBe(440_000 + 900_000);
  });

  it('일시불이면 기간을 곱한다', () => {
    const { contract } = buildContractWrite(
      input({ paymentMethod: PAYMENT_METHOD.LUMP_SUM, periodMonths: 6 }),
    );
    expect(contract.firstPayment).toBe(440_000 * 6 + 900_000);
  });

  it('★ 화면이 첫달납부액을 보내도 서버 계산값을 쓴다', () => {
    const { contract } = buildContractWrite(input({ firstPayment: 1 } as never));
    expect(contract.firstPayment).toBe(440_000 + 900_000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 어긋남 경고 — 프런트가 반올림을 쓰는 동안 계속 뜬다
// ═══════════════════════════════════════════════════════════════════════════
describe('buildContractWrite — 화면 값과 어긋나면 경고를 남긴다', () => {
  it('★ 화면이 반올림해 보내면 경고가 남고 서버 값(버림)이 저장된다', () => {
    // 99,999 × 10% — 버림 9,999, 반올림 10,000
    const { spaces, warnings } = buildContractWrite(
      input({ spaces: [space({ monthlyFee: 99_999, vatAmount: 10_000, paymentAmount: 109_999 })] }),
    );
    expect(spaces[0].vatAmount).toBe(9_999);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatchObject({ seq: 1, field: 'vatAmount', submitted: 10_000, server: 9_999 });
  });

  it('화면 값이 맞으면 경고가 없다', () => {
    const { warnings } = buildContractWrite(
      input({ spaces: [space({ vatAmount: 40_000, paymentAmount: 440_000 })] }),
    );
    expect(warnings).toEqual([]);
  });

  it('화면이 파생값을 아예 안 보내면 경고가 아니다 — 서버가 채우는 것뿐이다', () => {
    const { warnings } = buildContractWrite(input());
    expect(warnings).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 검증 — 서버가 거부하는 것
// ═══════════════════════════════════════════════════════════════════════════
describe('buildContractWrite — 호실 줄 수 (CONT-04)', () => {
  it('최대는 10행이다', () => {
    expect(MAX_CONTRACT_SPACES).toBe(10);
  });

  it('10행은 통과한다 — 경계', () => {
    const spaces = Array.from({ length: 10 }, (_, i) => space({ spaceId: `s${i}` }));
    expect(buildContractWrite(input({ spaces })).spaces).toHaveLength(10);
  });

  it('★ 11행이면 던진다', () => {
    const spaces = Array.from({ length: 11 }, (_, i) => space({ spaceId: `s${i}` }));
    expect(() => buildContractWrite(input({ spaces }))).toThrow(/10/);
  });

  it('★ 0행이면 던진다 — 호실 없는 계약은 계약이 아니다', () => {
    expect(() => buildContractWrite(input({ spaces: [] }))).toThrow();
  });
});

describe('buildContractWrite — 필수값', () => {
  it('기간이 0이면 던진다', () => {
    expect(() => buildContractWrite(input({ periodMonths: 0 }))).toThrow();
  });

  it('납부방법이 코드값(M·C)이 아니면 던진다 — 화면 문구("월납")를 받지 않는다', () => {
    expect(() => buildContractWrite(input({ paymentMethod: '월납' }))).toThrow();
  });

  it('★ 계약구분이 비면 던진다', () => {
    expect(() => buildContractWrite(input({ spaces: [space({ roomType: '' })] }))).toThrow(/계약구분/);
  });

  it('★ 호실이 비면 던진다 — space_id 가 저장 키다', () => {
    expect(() => buildContractWrite(input({ spaces: [space({ spaceId: '' })] }))).toThrow(/호실/);
  });

  it('건물이 비면 던진다', () => {
    expect(() => buildContractWrite(input({ buildId: '' }))).toThrow();
  });

  it('금액이 음수면 던진다', () => {
    expect(() => buildContractWrite(input({ spaces: [space({ monthlyFee: -1 })] }))).toThrow();
  });

  it('금액이 소수면 던진다 — 원 단위 정수다', () => {
    expect(() => buildContractWrite(input({ spaces: [space({ deposit: 1.5 })] }))).toThrow();
  });
});

describe('buildContractWrite — 순수 함수', () => {
  it('입력을 변형하지 않는다', () => {
    const arg = input({ spaces: [space(), space({ spaceId: 'b' })] });
    const before = JSON.stringify(arg);
    buildContractWrite(arg);
    expect(JSON.stringify(arg)).toBe(before);
  });
});
