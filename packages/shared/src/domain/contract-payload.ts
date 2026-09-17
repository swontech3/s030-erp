/**
 * 계약 저장 페이로드 — 화면이 올린 것을 **저장할 행**으로 바꾼다.
 *
 * 규칙의 기록은 `contract-payload.test.ts` 다.
 * 금액 규칙의 정본은 `doc/CONTRACT_DATA_MODEL.md` §C-1 이고, 계산은 전부
 * `contract-amounts.ts` 를 부른다 — 여기서 다시 구현하지 않는다.
 *
 * =============================================================================
 * ★★ 이 모듈의 존재 이유 하나 — 화면 값을 믿지 않는다 (CONT-10)
 * =============================================================================
 * 파생값은 화면이 무엇을 보내든 서버가 다시 계산한 값으로 **덮는다.**
 *
 *     No(seq) · 종료일 · 첫달납부액 · 부가세액 · 납부액
 *
 * 세금계산서에 찍히는 숫자이고, 화면은 지금 실제로 다르게 계산한다 —
 * 시안은 `Math.round`, 서버는 버림이다(`doc/DESIGN_REVIEW_1.md` 로 수정 요청해 둔 상태).
 * 그래서 "맞겠지"가 아니라 **매번 다시 계산하고, 어긋난 칸은 경고로 남긴다.**
 *
 * =============================================================================
 * ★ 검증은 마지막 방어선이다
 * =============================================================================
 * 화면도 같은 검사를 한다. 그래도 여기서 또 한다 — API 를 직접 부르는 경로가 있고,
 * 여기가 DB 제약(NOT NULL · CHECK · UNIQUE) 바로 앞이다. 제약에 걸려 나는 오류는
 * 사람이 읽을 수 없어서, 읽을 수 있는 문구로 먼저 막는다.
 */
import {
  calcEndDate,
  calcFirstPayment,
  calcTotals,
  reconcileRowAmounts,
  type AmountMismatch,
  type ContractSpaceAmounts,
  type RowAmounts,
} from './contract-amounts.ts';

/**
 * 계약 항목 최대 행수 — CONT-04.
 * 화면도 이 값에서 [항목 추가]를 비활성화한다(`03-contract-form.md`).
 */
export const MAX_CONTRACT_SPACES = 10;

/** 화면이 올리는 호실 줄. 파생값(`vatAmount`·`paymentAmount`)은 **대조용**이라 없어도 된다. */
export type ContractSpaceInput = {
  /** 코드 `ROOM_TP`. */
  roomType: string;
  /** ★ 저장 키. 화면 표시는 `room_name` 이지만 올라오는 것은 `space_id` 다. */
  spaceId: string;
  standardFee: number;
  deposit: number;
  monthlyFee: number;
  vatYn: boolean;
  lockerNo?: string | null;
} & Partial<RowAmounts>;

/** 화면이 올리는 계약 조건. 파생값은 받지 않는다 — 받아도 버린다. */
export type ContractInput = {
  buildId: string;
  contractRoom?: string | null;
  /** 코드 `PAYMENT_METHOD` — `M` 월납 / `C` 일시불. */
  paymentMethod: string;
  /** 코드 `ACCESS_ROUTE`. */
  accessRoute?: string | null;
  /** `YYYY-MM-DD`. 계약일자는 날짜만 쓴다. */
  contractDate?: string | null;
  periodMonths: number;
  startDate: Date;
  memo?: string | null;
  spaces: readonly ContractSpaceInput[];
};

/** 저장할 계약 행. */
export type ContractRowWrite = {
  buildId: string;
  contractRoom: string | null;
  paymentMethod: string;
  accessRoute: string | null;
  contractDate: string | null;
  periodMonths: number;
  startDate: Date;
  /** ★ 서버 계산. */
  endDate: Date;
  /** ★ 서버 계산. */
  firstPayment: number;
  memo: string | null;
};

/** 저장할 호실 줄. */
export type ContractSpaceRowWrite = ContractSpaceAmounts &
  RowAmounts & {
    roomType: string;
    spaceId: string;
    lockerNo: string | null;
  };

export type ContractWrite = {
  contract: ContractRowWrite;
  spaces: ContractSpaceRowWrite[];
  /** 화면 값이 서버 값과 어긋난 칸. **저장되는 것은 서버 값이다.** */
  warnings: AmountMismatch[];
};

function requireText(value: string | undefined | null, label: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new RangeError(`${label} 는 필수다`);
  return text;
}

/** 안 보낸 선택 칸은 `null` 이다. `undefined` 를 그대로 DB 로 흘리지 않는다. */
function optionalText(value: string | undefined | null): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}

/**
 * 화면 페이로드 → 저장할 행.
 *
 * 던지는 경우: 필수값 누락 · 호실 줄 수가 1~10 밖 · 기간 0 이하 ·
 * 납부방법이 코드값이 아님 · 금액이 음수이거나 정수가 아님.
 *
 * ★ 첫 오류에서 던진다. 칸별 오류 목록을 만들어 주지 않는다 — 그건 화면의 일이고
 *   (`03-contract-form.md` 의 「필수 항목 N개 미입력」), 여기는 마지막 방어선이다.
 */
export function buildContractWrite(input: ContractInput): ContractWrite {
  const buildId = requireText(input.buildId, '건물');

  if (input.spaces.length === 0) {
    throw new RangeError('계약 항목이 최소 1행 있어야 한다 — 호실 없는 계약은 계약이 아니다');
  }
  if (input.spaces.length > MAX_CONTRACT_SPACES) {
    throw new RangeError(
      `계약 항목은 최대 ${MAX_CONTRACT_SPACES}행이다: ${input.spaces.length}행이 올라왔다`,
    );
  }

  // ★ seq 는 **서버가 배열 순서로 매긴다.** 화면이 보낸 값을 쓰지 않는다 —
  //   겹치면 tb_s080_contract_spaces_contract_id_seq_key(UNIQUE)에 걸려
  //   사람이 못 읽는 오류가 난다.
  const numbered = input.spaces.map((row, index) => ({
    seq: index + 1,
    roomType: requireText(row.roomType, `${index + 1}행 계약구분`),
    spaceId: requireText(row.spaceId, `${index + 1}행 호실`),
    standardFee: row.standardFee,
    deposit: row.deposit,
    monthlyFee: row.monthlyFee,
    vatYn: row.vatYn,
    lockerNo: optionalText(row.lockerNo),
    // 대조용으로만 넘긴다. 저장되는 것은 아래 reconcile 이 낸 서버 값이다.
    vatAmount: row.vatAmount,
    paymentAmount: row.paymentAmount,
  }));

  // 금액 검증(음수·소수)과 재계산을 한 번에 한다 — calcRowAmounts 가 requireWon 을 거친다.
  const { rows, mismatches } = reconcileRowAmounts(numbered);

  const totals = calcTotals(rows);
  const firstPayment = calcFirstPayment({
    totals,
    paymentMethod: input.paymentMethod,
    periodMonths: input.periodMonths,
  });
  // ★ 월납은 기간을 안 봐서 calcFirstPayment 가 기간을 검사하지 않는다.
  //   종료일은 어느 납부방법이든 필요하므로 여기서 걸린다(기간 0 이면 던진다).
  const endDate = calcEndDate(input.startDate, input.periodMonths);

  return {
    contract: {
      buildId,
      contractRoom: optionalText(input.contractRoom),
      paymentMethod: input.paymentMethod,
      accessRoute: optionalText(input.accessRoute),
      contractDate: optionalText(input.contractDate),
      periodMonths: input.periodMonths,
      startDate: input.startDate,
      endDate,
      firstPayment,
      memo: optionalText(input.memo),
    },
    spaces: rows.map((row) => ({
      seq: row.seq,
      roomType: row.roomType,
      spaceId: row.spaceId,
      standardFee: row.standardFee,
      deposit: row.deposit,
      monthlyFee: row.monthlyFee,
      vatYn: row.vatYn,
      vatAmount: row.vatAmount,
      paymentAmount: row.paymentAmount,
      lockerNo: row.lockerNo,
    })),
    warnings: mismatches,
  };
}
