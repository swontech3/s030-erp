/**
 * 계약 금액 계산 — 순수 함수.
 *
 * 정본은 `doc/CONTRACT_DATA_MODEL.md` 다. 이 파일과 어긋나면 그 문서를 따른다.
 * 규칙의 기록은 `contract-amounts.test.ts` 다.
 *
 * =============================================================================
 * ★ 화면 값을 믿지 않는다
 * =============================================================================
 * 세금계산서에 찍히는 값이다. 화면에서 올라온 `vat_amount` · `payment_amount` 를
 * 그대로 저장하지 않고, 서버가 `monthly_fee` 로부터 다시 계산한다.
 * 어긋나면 **서버 값을 쓰고** 어긋난 칸을 남긴다 — `reconcileRowAmounts`.
 *
 * 지금 시안(`s030200040.html` 708행)은 `Math.round`(반올림)를 쓴다. 여기는 **버림**이다.
 * 시안 데이터가 만원 단위라 아직 드러나지 않지만 **할인이 들어가면 갈린다.**
 * 프런트에 맞춰 달라고 요청해 둔 상태다(`doc/DESIGN_REVIEW_1.md`).
 *
 * =============================================================================
 * ★ 순수 함수다
 * =============================================================================
 * DB · 현재 시각 · 전역 상태를 참조하지 않는다. 인자를 변형하지도 않는다.
 * 그래서 DB 없이 시험할 수 있고, 화면과 서버가 같은 함수를 쓸 수 있다.
 *
 * 날짜는 **UTC 로만 다룬다.** 로컬 표준시대 접근자(`getMonth` 등)를 쓰면 같은 입력이
 * 실행 머신에 따라 다른 답을 낸다 — 그건 순수 함수가 아니다.
 *
 * =============================================================================
 * ★ 부동소수점을 쓰지 않는다
 * =============================================================================
 * `0.1` 을 곱하면 `99999 * 0.1 === 9999.900000000001` 이 된다. 이번 세율(10%)에서는
 * `Math.floor` 가 우연히 다 가려 주지만, **우연에 기대지 않는다.**
 *
 * 세율을 정수 두 개(`numerator` / `denominator`)로 두고 이렇게 계산한다.
 *
 *     const product = fee * numerator;                      // 정수 × 정수 — 정확
 *     return (product - (product % denominator)) / denominator;
 *
 * `%` 는 정수끼리 정확하고, 빼고 나면 `denominator` 의 배수라 나눗셈 결과가 정확히
 * 표현되는 정수다. 중간에 소수가 한 번도 생기지 않는다. 세율이 바뀌어도 그대로 맞는다.
 */

/**
 * 부가가치세율 — **정수 두 개**다. `0.1` 이라는 부동소수점 상수를 두지 않는다.
 * 세율이 바뀌면 여기 한 곳만 고친다.
 */
export const VAT_RATE = { numerator: 1, denominator: 10 } as const;

/** 코드 `PAYMENT_METHOD` — 화면의 "월납"/"일시불"이 아니라 저장되는 코드값이다. */
export const PAYMENT_METHOD = {
  /** 월납 */
  MONTHLY: 'M',
  /** 일시불 */
  LUMP_SUM: 'C',
} as const;

export type PaymentMethod = (typeof PAYMENT_METHOD)[keyof typeof PAYMENT_METHOD];

/** 계약 항목 한 줄 — 금액 계산에 필요한 칸만. */
export type ContractSpaceAmounts = {
  /** 표시 순서. 어긋남을 보고할 때 어느 줄인지 가리킨다. */
  seq: number;
  /** 월회비(기준가). 합계 표시용이고 부가세 계산에는 쓰지 않는다. */
  standardFee: number;
  /** 예치금. */
  deposit: number;
  /** 월이용료 — 할인 반영 실제 금액. **부가세 제외.** */
  monthlyFee: number;
  /** 부가세 대상 여부. `invoice_yn` 이 아니다. */
  vatYn: boolean;
};

/** 서버가 계산해서 저장하는 두 칸. */
export type RowAmounts = {
  vatAmount: number;
  paymentAmount: number;
};

export type ContractTotals = {
  deposit: number;
  standardFee: number;
  /** 월이용료 합계 — **부가세 제외.** */
  monthlyFee: number;
  vatAmount: number;
  /**
   * ★ 월납부액 합계 — **부가세를 포함한다.**
   * 제일 틀리기 쉬운 자리다. 부가세 제외로 읽으면 첫달납부액이 10% 틀린다.
   */
  monthlyPayment: number;
};

/** 화면 값과 서버 값이 어긋난 칸 하나. */
export type AmountMismatch = {
  seq: number;
  field: 'vatAmount' | 'paymentAmount';
  /** 화면이 올려 보낸 값. */
  submitted: number;
  /** 서버가 다시 계산한 값. **이 값이 저장된다.** */
  server: number;
};

/** 원 단위 정수여야 하는 자리. 소수·음수·NaN 이 들어오면 계산을 시작하지 않는다. */
function requireWon(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} 는 0 이상의 원 단위 정수여야 한다: ${value}`);
  }
  return value;
}

/**
 * 호실 줄 하나의 부가세액과 납부액.
 *
 *     부가세액 = vat_yn 이 false 면 0, 아니면 floor(월이용료 × 10%)
 *     납부액   = 월이용료 + 부가세액
 *
 * ★ 버림이다. 반올림이 아니다.
 */
export function calcRowAmounts(row: Pick<ContractSpaceAmounts, 'monthlyFee' | 'vatYn'>): RowAmounts {
  const monthlyFee = requireWon(row.monthlyFee, 'monthlyFee');
  const vatAmount = calcVat(monthlyFee, row.vatYn);
  return { vatAmount, paymentAmount: monthlyFee + vatAmount };
}

/**
 * 공급가에 붙는 부가세액 — **버림**이다.
 *
 * ★ 정수 연산만 쓴다(위 머리말 「부동소수점을 쓰지 않는다」). `0.1` 을 곱하면
 *   `99999 * 0.1 === 9999.900000000001` 이 된다.
 *
 * ★ 계약 줄과 **중도 해지 환수**가 같은 함수를 쓴다. 두 벌로 두면 같은 금액에
 *   서로 다른 부가세가 붙고, 그 차이는 원 단위라 아무도 못 알아챈다.
 */
export function calcVat(supplyAmount: number, vatYn: boolean): number {
  if (!vatYn) return 0;
  const product = supplyAmount * VAT_RATE.numerator;
  return (product - (product % VAT_RATE.denominator)) / VAT_RATE.denominator;
}

/**
 * 합계 — **줄마다 계산해서 더한다.** 합계에 한 번 매기지 않는다.
 *
 * 두 방식은 결과가 다르다. 99,999 두 줄이면 줄별은 19,998, 합계 한 번은 19,999 다.
 * 줄별이 맞다 — 세금계산서 명세가 줄 단위로 나가기 때문이다.
 *
 * 줄이 0개면 합계가 전부 0이다. 아직 호실을 안 고른 상태이지 오류가 아니다.
 */
export function calcTotals(rows: readonly ContractSpaceAmounts[]): ContractTotals {
  return rows.reduce<ContractTotals>(
    (acc, row) => {
      const { vatAmount, paymentAmount } = calcRowAmounts(row);
      return {
        deposit: acc.deposit + requireWon(row.deposit, 'deposit'),
        standardFee: acc.standardFee + requireWon(row.standardFee, 'standardFee'),
        monthlyFee: acc.monthlyFee + row.monthlyFee,
        vatAmount: acc.vatAmount + vatAmount,
        monthlyPayment: acc.monthlyPayment + paymentAmount,
      };
    },
    { deposit: 0, standardFee: 0, monthlyFee: 0, vatAmount: 0, monthlyPayment: 0 },
  );
}

/**
 * 첫달납부액.
 *
 *     월납    월납부액 합계 + 예치금 합계
 *     일시불  (월납부액 합계 × 기간) + 예치금 합계
 *
 * ★ 월납부액은 **부가세 포함**이다(`ContractTotals.monthlyPayment`).
 */
export function calcFirstPayment(args: {
  totals: ContractTotals;
  paymentMethod: string;
  periodMonths: number;
  /** 무상 개월수. 안 넘기면 0. */
  freeMonths?: number;
}): number {
  const { totals, paymentMethod, periodMonths } = args;
  const freeMonths = requireFreeMonths(args.freeMonths, periodMonths);

  if (paymentMethod !== PAYMENT_METHOD.MONTHLY && paymentMethod !== PAYMENT_METHOD.LUMP_SUM) {
    throw new RangeError(
      `paymentMethod 는 코드값이어야 한다 ('${PAYMENT_METHOD.MONTHLY}' 월납 / '${PAYMENT_METHOD.LUMP_SUM}' 일시불): ${paymentMethod}`,
    );
  }

  if (paymentMethod === PAYMENT_METHOD.MONTHLY) {
    /*
     * ★★ 첫 달이 무상이면 **예치금뿐**이다. 무상 달에는 받을 돈이 없다.
     *    여기에 월납부액을 더하면 「무상인데 첫 달에 돈을 받는」 계약서가 나온다.
     */
    return freeMonths > 0 ? totals.deposit : totals.monthlyPayment + totals.deposit;
  }

  requirePeriod(periodMonths);
  // ★ 일시불은 전 기간을 한 번에 받는다 — 무상 달만큼 빼고 받는다.
  return totals.monthlyPayment * (periodMonths - freeMonths) + totals.deposit;
}

/**
 * 무상 개월수 검사 — **화면과 서버가 같은 규칙을 본다**.
 *
 * ★★ 무상은 **계약 개월수보다 작아야 한다.** 같거나 크면 계약 전체가 무상이고,
 *    그건 이용계약이 아니라 다른 것이다. 일시불에서는 청구액이 0 이나 음수가 된다.
 *
 * ★ 무상이 0 이면 기간을 보지 않는다. 화면이 기간을 아직 안 적은 상태(0)에서도
 *   월납 첫달납부액을 계속 부르기 때문이다 — 거기서 던지면 입력 도중에 화면이 죽는다.
 */
export function requireFreeMonths(freeMonths: number | undefined, periodMonths: number): number {
  const value = freeMonths ?? 0;
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`무상 개월수는 0 이상의 정수여야 한다: ${value}`);
  }
  if (value > 0 && !(value < periodMonths)) {
    throw new RangeError(
      `무상 개월수는 계약 개월수보다 작아야 한다: 무상 ${value}개월 / 기간 ${periodMonths}개월`,
    );
  }
  return value;
}

function requirePeriod(periodMonths: number): number {
  if (!Number.isInteger(periodMonths) || periodMonths < 1) {
    throw new RangeError(`periodMonths 는 1 이상의 정수여야 한다: ${periodMonths}`);
  }
  return periodMonths;
}

/**
 * 종료일 = 시작일 + 기간(월) − 1일.
 *
 * ★ **말일 처리 — 그 달의 말일로 맞춘다.**
 * 1월 31일 + 1개월은 2월 31일이 없으므로 2월 28일로 맞춘 뒤 하루를 빼 2월 27일이다.
 * 시안(`calcEndDate`, 736행)은 JS `Date.setMonth` 의 오버플로를 그대로 둬서 3월 2일을
 * 낸다 — 처리가 없는 것이지 그렇게 정한 것이 아니다.
 *
 * ★ **기간 0 은 오류다.** 시안은 `if (!months) return ""` 로 아무 값도 내지 않는데,
 * `tb_s080_contracts.end_date` 는 NOT NULL 이라 서버가 저장할 값이 없다.
 * 기간이 없는 계약은 계약이 아니므로 조용히 넘기지 않고 던진다.
 *
 * 날짜만 다룬다 — 시:분:초는 버리고 UTC 자정으로 맞춘다.
 */
export function calcEndDate(startDate: Date, periodMonths: number): Date {
  requirePeriod(periodMonths);
  if (Number.isNaN(startDate.getTime())) {
    throw new RangeError('startDate 가 올바른 날짜가 아니다');
  }

  const year = startDate.getUTCFullYear();
  const month = startDate.getUTCMonth();
  const day = startDate.getUTCDate();

  const targetMonth = month + periodMonths;
  // 그 달의 말일. Date.UTC 는 day=0 을 "전 달의 마지막 날"로 읽는다.
  const lastDayOfTargetMonth = new Date(Date.UTC(year, targetMonth + 1, 0)).getUTCDate();

  // ★ 오버플로를 허용하지 않는다. 31일이 없는 달이면 그 달 말일에 멈춘다.
  const clampedDay = Math.min(day, lastDayOfTargetMonth);

  // 하루 뺀다. Date.UTC 가 day=0 이하를 전 달로 되짚어 주므로 달·해 넘김이 자동이다.
  return new Date(Date.UTC(year, targetMonth, clampedDay - 1));
}

/**
 * 화면 값과 서버 값을 대조한다.
 *
 * **서버 값이 정본이다.** 돌려주는 `rows` 는 서버가 다시 계산한 값이고, 어긋난 칸은
 * `mismatches` 에 남는다 — 저장하는 쪽이 그 목록을 경고로 기록한다.
 * 화면이 값을 안 보냈으면(`undefined`) 어긋남이 아니다. 서버가 채우는 것뿐이다.
 *
 * ★ 이 작업 범위는 여기까지다. 저장은 하지 않는다.
 */
export function reconcileRowAmounts<T extends ContractSpaceAmounts & Partial<RowAmounts>>(
  rows: readonly T[],
): { rows: (T & RowAmounts)[]; mismatches: AmountMismatch[] } {
  const mismatches: AmountMismatch[] = [];

  const resolved = rows.map((row) => {
    const server = calcRowAmounts(row);

    for (const field of ['vatAmount', 'paymentAmount'] as const) {
      const submitted = row[field];
      if (submitted !== undefined && submitted !== server[field]) {
        mismatches.push({ seq: row.seq, field, submitted, server: server[field] });
      }
    }

    return { ...row, ...server };
  });

  return { rows: resolved, mismatches };
}

/**
 * 코드 `ROOM_TP` — 계약구분.
 *
 * ★ 특례가 걸리는 「비상주」만 상수로 둔다. 나머지 값(`R1`·`R2`·`R3`·`FI`·`FR`·`ET`)은
 *   판정에 쓰이지 않으므로 여기에 늘어놓지 않는다 — 늘어놓으면 코드 마스터와
 *   두 벌이 되어 어긋난다.
 *
 * 값의 근거는 실 DB 조사다(`doc/LEGACY_DATA_SURVEY.md` §③ · `doc/CONTRACT_DATA_MODEL.md` §A-6).
 * **표시명("비상주")으로 비교하지 않는다** — 표시명은 바뀔 수 있고 실제로 바뀔 예정이다
 * (`R3` 「3인실」→「팀오피스」, §C-3 ①).
 */
export const ROOM_TYPE = {
  /** 비상주. */
  VIRTUAL_OFFICE: 'VR',
} as const;

/** 계약서 출력에 쓰는 줄 — 금액 칸에 계약구분이 더 붙는다. */
export type ContractSpaceForDocument = ContractSpaceAmounts & {
  /** 코드 `ROOM_TP`. */
  roomType: string;
};

/**
 * 비상주 특례가 걸리는 호실 줄 수의 상한.
 * 1~2건까지다. 3건부터는 특례가 아니다.
 */
const SUBLEASE_STANDARD_FEE_MAX_ROWS = 2;

/**
 * 전대차계약서 2조 2항 「월회비」.
 *
 * =============================================================================
 * ★ 왜 이용계약서와 금액이 다른가
 * =============================================================================
 * 전대차계약서는 **세무서 제출용**이다. 비상주는 할인폭이 커서 실제 계약금액으로
 * 내면 세무서가 인정하지 않는 경우가 많다. 그래서 호실 지정금액(`standardFee`)으로
 * 찍는다. 이용계약서는 지금 설계 그대로 실제 계약금액(`monthlyFee`) 기준이다.
 *
 * =============================================================================
 * ★★ 계약 단위 판정이다 — 줄마다 나누지 않는다
 * =============================================================================
 *     호실 1~2건이고 **그 전부가** 비상주   → 기준가(`standardFee`)로
 *     그 외                                → 실계약가(`monthlyFee`)로
 *
 * 한 계약 안에서 비상주 줄만 기준가로, 나머지는 실계약가로 섞지 않는다. 섞으면
 * 문서에 찍히는 합계가 어느 쪽 기준인지 설명할 수 없는 숫자가 된다.
 * 줄이 하나라도 비상주가 아니면 **계약 전체가** 특례에서 빠진다.
 *
 * 부가세는 **고른 기준액에서 다시 계산한다**(버림). 기준가로 갈 때 실계약가에서
 * 나온 부가세를 그대로 얹지 않는다 — 그러면 문서의 금액과 부가세가 서로 다른
 * 근거를 갖게 된다.
 *
 * 줄이 0건이면 0이다. 아직 호실을 안 고른 상태이지 오류가 아니다.
 */
export function calcSubleaseMonthlyPayment(rows: readonly ContractSpaceForDocument[]): number {
  const usesStandardFee = usesSubleaseStandardFee(rows);

  return rows.reduce((sum, row) => {
    const base = usesStandardFee ? row.standardFee : row.monthlyFee;
    return sum + calcRowAmounts({ monthlyFee: base, vatYn: row.vatYn }).paymentAmount;
  }, 0);
}

/**
 * 이 계약이 **기준가 특례에 걸리는가.**
 *
 * ★★ **금액을 이걸로 만들지 않는다.** 금액은 `calcSubleaseMonthlyPayment` 하나가 정한다.
 *    이 함수는 그 함수가 쓰는 조건을 **이름 붙여 내보낸 것**이고, 용도는 둘뿐이다:
 *      · 시험이 「왜 그 숫자인가」를 조건으로 적을 수 있게
 *      · 검증 스크립트가 어느 기준으로 찍혔는지 함께 보고할 수 있게
 *
 *    화면이 이걸 보고 금액을 갈라 계산하면 분기가 두 벌이 된다 — 그 순간
 *    전대차계약서의 숫자와 이 판정이 어긋날 수 있다. **부르는 쪽은 금액을 만들지 않는다.**
 */
export function usesSubleaseStandardFee(rows: readonly ContractSpaceForDocument[]): boolean {
  return (
    rows.length > 0 &&
    rows.length <= SUBLEASE_STANDARD_FEE_MAX_ROWS &&
    rows.every((row) => row.roomType === ROOM_TYPE.VIRTUAL_OFFICE)
  );
}
