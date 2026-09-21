/**
 * 계약서 표기 규칙 시험.
 *
 * ★ 여기서 지키는 것은 **인쇄되는 종이에 지어낸 값이 안 나온다**는 것이다.
 *   빈 값은 빈 값으로 남아야 하고, 그 자리는 사람이 손으로 적는다.
 */
import { describe, expect, it } from 'vitest';
import {
  companyAddressLabel,
  dayOfMonthLabel,
  formatWon,
  memoLabel,
  periodLabel,
  planSummaryLabel,
  roomNamesLabel,
  signDateLabel,
  subleaseDateLabel,
  subleaseTargetLabel,
  vatPercentLabel,
  vatSuffix,
} from './contract-document.ts';
import {
  calcSubleaseMonthlyPayment,
  calcTotals,
  usesSubleaseStandardFee,
} from './contract-amounts.ts';

describe('계약구분 요약 · 이용호실', () => {
  it('1개면 그 값, N개면 「외 N-1건」', () => {
    expect(planSummaryLabel(['1인실'])).toBe('1인실');
    expect(planSummaryLabel(['1인실', '2인실', '비상주'])).toBe('1인실 외 2건');
  });

  it('줄이 없으면 빈 문자열 — 「0건」이라고 적지 않는다', () => {
    expect(planSummaryLabel([])).toBe('');
  });

  it('호실은 " / " 로 잇고 빈 이름은 건너뛴다', () => {
    expect(roomNamesLabel(['Room-1', 'Room-2'])).toBe('Room-1 / Room-2');
    expect(roomNamesLabel(['Room-1', '  ', 'Room-3'])).toBe('Room-1 / Room-3');
    expect(roomNamesLabel([])).toBe('');
  });
});

describe('부가세 문구', () => {
  it('전부 발행이면 「(부가세 포함)」', () => {
    expect(vatSuffix([true, true])).toBe(' (부가세 포함)');
  });

  it('일부만이면 「(일부 부가세 포함)」', () => {
    expect(vatSuffix([true, false])).toBe(' (일부 부가세 포함)');
  });

  it('전부 해제면 아무것도 안 붙인다', () => {
    expect(vatSuffix([false, false])).toBe('');
  });

  it('줄이 0건이어도 붙이지 않는다', () => {
    expect(vatSuffix([])).toBe('');
  });

  it('세율 문구는 상수에서 나온다 — 10% 를 두 번 적지 않는다', () => {
    expect(vatPercentLabel()).toBe('10%');
  });
});

describe('날짜 — 자리마다 형식이 다르다', () => {
  it('이용계약서는 공백이 있고 전대차는 없다', () => {
    expect(signDateLabel('2026-01-10')).toBe('2026 년 1 월 10 일');
    expect(subleaseDateLabel('2026-01-10')).toBe('2026년 1월 10일');
  });

  it('★ 비어 있으면 기입선 문구다 — 오늘 날짜로 대체하지 않는다', () => {
    expect(signDateLabel('')).toBe('____ 년 __ 월 __ 일');
    expect(subleaseDateLabel('')).toBe('20__ 년 __ 월 __ 일');
    expect(dayOfMonthLabel('')).toBe('');
  });

  it('형식이 아니면 값으로 치지 않는다', () => {
    for (const bad of ['2026/01/10', '26-1-10', '2026-01-10T00:00:00Z', 'abc']) {
      expect(signDateLabel(bad)).toBe('____ 년 __ 월 __ 일');
    }
  });

  it('앞의 0 을 떼고 적는다 — 「1 월」이지 「01 월」이 아니다', () => {
    expect(signDateLabel('2026-01-05')).toBe('2026 년 1 월 5 일');
    expect(dayOfMonthLabel('2026-01-05')).toBe('5');
  });

  it('이용기간 — 기간이 있으면 괄호가 붙는다', () => {
    expect(periodLabel('2026-01-15', '2026-07-14', 6)).toBe('2026.01.15 ~ 2026.07.14 (6개월)');
    expect(periodLabel('2026-01-15', '2026-07-14', null)).toBe('2026.01.15 ~ 2026.07.14');
    expect(periodLabel('', '', 6)).toBe('');
  });
});

describe('주소', () => {
  const full = { zipCode: '06158', address: '서울특별시 강남구 봉은사로 55길 19', addressDetail: '3층 301호' };

  it('이용계약서는 우편번호를 앞에 붙인다', () => {
    expect(companyAddressLabel({ ...full, withZip: true })).toBe(
      '06158 서울특별시 강남구 봉은사로 55길 19 3층 301호',
    );
  });

  it('전대차 서명란은 우편번호 없이 적는다 (시안)', () => {
    expect(companyAddressLabel({ ...full, withZip: false })).toBe(
      '서울특별시 강남구 봉은사로 55길 19 3층 301호',
    );
  });

  it('비어 있는 조각은 건너뛴다', () => {
    expect(companyAddressLabel({ zipCode: null, address: '서울 강남구', addressDetail: '', withZip: true })).toBe(
      '서울 강남구',
    );
  });

  it('★ 셋 다 비면 빈 문자열 — 화면이 기입선을 그린다', () => {
    expect(
      companyAddressLabel({ zipCode: null, address: null, addressDetail: null, withZip: true }),
    ).toBe('');
  });

  it('★ 전대차 2조 2항은 건물+계약호실이다 — 회사 주소가 아니다', () => {
    const t = subleaseTargetLabel({
      buildingAddress: '서울시 강남구 봉은사로55길 19, 3층',
      buildingSuffix: '(삼성동, 우리빌딩)',
      contractRoom: '1-10',
    });
    expect(t.room).toBe('1-10');
    expect(`${t.prefix} ${t.room}호 ${t.suffix}`).toBe(
      '서울시 강남구 봉은사로55길 19, 3층 1-10호 (삼성동, 우리빌딩)',
    );
  });

  it('★ 계약호실이 없으면 비운다 — 아무 호실이나 넣지 않는다', () => {
    expect(
      subleaseTargetLabel({ buildingAddress: 'a', buildingSuffix: 'b', contractRoom: null }).room,
    ).toBe('');
  });
});

describe('특기사항', () => {
  it('두 섹션의 것을 줄바꿈으로 잇는다', () => {
    expect(memoLabel(['섹션1 메모', '섹션2 메모'])).toBe('섹션1 메모\n섹션2 메모');
  });

  it('빈 것은 빼고 잇는다 — 빈 줄이 남지 않는다', () => {
    expect(memoLabel([null, '있는 것', '  '])).toBe('있는 것');
    expect(memoLabel([null, null])).toBe('');
  });

  /**
   * ★★ 재계약 문구가 **이용계약서에 그대로 인쇄된다**(2026-09-21).
   *    `renewed_from_contract_id` 는 DB 안에만 있어서 입주사는 볼 수 없다 — 이 문장이
   *    「어느 계약을 이어받았는지」를 사람이 읽을 수 있게 남기는 유일한 자리다.
   *
   * ★ 할인 문구가 위에 얹혀도 함께 인쇄된다. 잘라내지 않는다.
   */
  it('★★ 재계약 문구가 그대로 인쇄된다 — 할인 문구와 함께여도', () => {
    const sectionTwo = [
      '기준가 대비 -10,000원 (10.0% 할인)',
      '재계약 (이전 계약 기간 2026.01.02 ~ 2027.01.01)',
    ].join('\n');

    expect(memoLabel(['회사 비고', sectionTwo])).toBe(
      ['회사 비고', '기준가 대비 -10,000원 (10.0% 할인)', '재계약 (이전 계약 기간 2026.01.02 ~ 2027.01.01)'].join(
        '\n',
      ),
    );
  });
});

describe('금액 표기', () => {
  it('천단위 구분', () => {
    expect(formatWon(968_000)).toBe('968,000');
    expect(formatWon(0)).toBe('0');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   ★★ 전대차 비상주 특례 — 두 문서의 숫자가 갈리는 자리
   ══════════════════════════════════════════════════════════════════════════ */

const row = (roomType: string, standardFee: number, monthlyFee: number, seq = 1) => ({
  seq,
  roomType,
  standardFee,
  deposit: 0,
  monthlyFee,
  vatYn: true,
});

describe('★ 전대차 비상주 특례가 이용계약서와 다른 숫자를 만든다', () => {
  it('비상주 1건 — 전대차는 기준가, 이용계약서는 실계약가', () => {
    const rows = [row('VR', 300_000, 100_000)];
    const usage = calcTotals(rows).monthlyPayment; // 이용계약서
    const sublease = calcSubleaseMonthlyPayment(rows); // 전대차

    expect(usage).toBe(110_000); // 100,000 + 부가세 10,000
    expect(sublease).toBe(330_000); // 300,000 + 부가세 30,000
    expect(sublease).not.toBe(usage); // ★ 이 작업의 핵심
    expect(usesSubleaseStandardFee(rows)).toBe(true);
  });

  it('비상주 2건 — 아직 특례다', () => {
    const rows = [row('VR', 300_000, 100_000, 1), row('VR', 200_000, 50_000, 2)];
    expect(usesSubleaseStandardFee(rows)).toBe(true);
    expect(calcSubleaseMonthlyPayment(rows)).toBe(330_000 + 220_000);
    expect(calcTotals(rows).monthlyPayment).toBe(110_000 + 55_000);
  });

  it('★ 비상주 3건 — 특례가 아니다. 두 문서가 같은 숫자다', () => {
    const rows = [
      row('VR', 300_000, 100_000, 1),
      row('VR', 300_000, 100_000, 2),
      row('VR', 300_000, 100_000, 3),
    ];
    expect(usesSubleaseStandardFee(rows)).toBe(false);
    expect(calcSubleaseMonthlyPayment(rows)).toBe(calcTotals(rows).monthlyPayment);
    expect(calcSubleaseMonthlyPayment(rows)).toBe(330_000);
  });

  it('★ 비상주 + 다른 호실 — 한 줄만 섞여도 계약 전체가 특례에서 빠진다', () => {
    const rows = [row('VR', 300_000, 100_000, 1), row('R1', 500_000, 400_000, 2)];
    expect(usesSubleaseStandardFee(rows)).toBe(false);
    expect(calcSubleaseMonthlyPayment(rows)).toBe(calcTotals(rows).monthlyPayment);
    expect(calcSubleaseMonthlyPayment(rows)).toBe(110_000 + 440_000);
  });

  it('비상주가 아닌 1건 — 건수가 적어도 특례가 아니다', () => {
    const rows = [row('R1', 500_000, 400_000)];
    expect(usesSubleaseStandardFee(rows)).toBe(false);
    expect(calcSubleaseMonthlyPayment(rows)).toBe(calcTotals(rows).monthlyPayment);
  });

  it('★ 표시명이 아니라 코드로 가른다 — 「비상주」라는 글자는 판정에 쓰이지 않는다', () => {
    const rows = [row('비상주', 300_000, 100_000)];
    expect(usesSubleaseStandardFee(rows)).toBe(false);
    expect(calcSubleaseMonthlyPayment(rows)).toBe(110_000);
  });

  it('줄이 0건이면 0이다 — 오류가 아니다', () => {
    expect(usesSubleaseStandardFee([])).toBe(false);
    expect(calcSubleaseMonthlyPayment([])).toBe(0);
  });
});
