/**
 * 계약서 2종(s0300200040p1)이 쓰는 **표기 규칙** — 순수 함수.
 *
 * 명세: `design/handoff/tenant-contract/06-contracts.md`
 *
 * =============================================================================
 * ★★ 금액을 여기서 계산하지 않는다
 * =============================================================================
 * 합계·부가세·첫달납부액·전대차 월회비는 전부 `contract-amounts.ts` 가 만든다.
 * 이 파일은 **이미 나온 숫자를 어떻게 적는가**만 정한다 — 「968,000 원 (부가세 포함)」
 * 처럼 문구가 붙는 자리다. 계산을 여기로 옮기면 세금계산서와 계약서가 갈린다.
 *
 * =============================================================================
 * ★★ 인쇄되는 문서다 — **없는 값을 지어내지 않는다**
 * =============================================================================
 * 세무서에 내는 종이다. 비어 있으면 **비운다**. 그 자리는 화면에서 기입선으로 보이고
 * 사람이 손으로 적는다. 「미상」·「-」 같은 글자를 찍지 않는다 — 그건 값처럼 보인다.
 */
import { VAT_RATE } from './contract-amounts.ts';

/* ══════════════════════════════════════════════════════════════════════════
   계약구분 요약 · 이용호실
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * 「1인실」 / 「1인실 외 2건」 — 명세 「계약구분 요약 규칙」.
 *
 * ★ 인자는 **표시명**이다(코드가 아니다). 판정에 쓰이지 않고 종이에 그대로 찍히는
 *   글자라서다. 판정은 전부 코드값으로 한다(`ROOM_TYPE.VIRTUAL_OFFICE`).
 *
 * 줄이 없으면 빈 문자열이다 — 「0건」이라고 적지 않는다.
 */
export function planSummaryLabel(roomTypeNames: readonly string[]): string {
  const first = roomTypeNames[0];
  if (!first) return '';
  return roomTypeNames.length > 1 ? `${first} 외 ${roomTypeNames.length - 1}건` : first;
}

/**
 * 「Room-1 / Room-2」 — 명세 「이용호실 규칙」.
 *
 * ★ 계약구분도 계약호실도 붙이지 않는다. 계약호실(국세청 신고용)은 전대차 전용이다.
 * ★ 이름이 비어 있는 줄은 **건너뛴다.** 「 / / 」 가 찍히면 호실이 셋인 것처럼 보인다.
 */
export function roomNamesLabel(roomNames: readonly string[]): string {
  return roomNames.map((n) => n.trim()).filter((n) => n !== '').join(' / ');
}

/* ══════════════════════════════════════════════════════════════════════════
   금액 표기
   ══════════════════════════════════════════════════════════════════════════ */

/** 「968,000」 — 천단위 구분만. 원 단위 정수를 전제한다. */
export function formatWon(amount: number): string {
  return amount.toLocaleString('ko-KR');
}

/**
 * 월납부액 뒤에 붙는 부가세 문구 — 명세 「월납부액 부가세 표기」.
 *
 *     전 항목 발행    「(부가세 포함)」
 *     일부만 발행     「(일부 부가세 포함)」
 *     전부 해제       (아무것도 안 붙인다)
 *
 * ★ 줄이 0건이면 빈 문자열이다. 「전부 해제」와 같은 결과이지만 이유가 다르다 —
 *   아직 호실을 안 고른 것이고, 그래도 종이에 적을 말은 없다.
 */
export function vatSuffix(vatFlags: readonly boolean[]): string {
  if (vatFlags.length === 0) return '';
  const on = vatFlags.filter(Boolean).length;
  if (on === 0) return '';
  return on === vatFlags.length ? ' (부가세 포함)' : ' (일부 부가세 포함)';
}

/**
 * 부가세율 표기 — 「10%」. 상수를 문자열로 두 번 적지 않는다.
 * 지금은 쓰이는 자리가 없지만, 조항 문구에 세율이 들어가는 날 이것을 쓴다.
 */
export const vatPercentLabel = (): string =>
  `${(VAT_RATE.numerator * 100) / VAT_RATE.denominator}%`;

/* ══════════════════════════════════════════════════════════════════════════
   날짜 표기 — **세 가지 형식이 각각 다른 자리에 쓰인다**
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * `YYYY-MM-DD` 를 조각으로. 형식이 아니면 `null` — **오늘로 대체하지 않는다.**
 * 계약서에 오늘 날짜가 찍히면 그건 지어낸 값이다.
 */
function parts(iso: string): { y: string; m: string; d: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  return { y: m[1]!, m: String(Number(m[2])), d: String(Number(m[3])) };
}

/**
 * 이용계약서 서명 날짜 — 「2026 년 1 월 10 일」(공백 있음).
 * 비어 있으면 「____ 년 __ 월 __ 일」 — 명세 그대로. 손으로 적는 자리다.
 */
export function signDateLabel(iso: string): string {
  const p = parts(iso);
  return p ? `${p.y} 년 ${p.m} 월 ${p.d} 일` : '____ 년 __ 월 __ 일';
}

/**
 * 전대차 도입 문구·조항 날짜 — 「2026년 1월 10일」(공백 없음).
 * 비어 있으면 「20__ 년 __ 월 __ 일」 — 명세가 이용계약서와 **다른 문자열**을 쓴다.
 */
export function subleaseDateLabel(iso: string): string {
  const p = parts(iso);
  return p ? `${p.y}년 ${p.m}월 ${p.d}일` : '20__ 년 __ 월 __ 일';
}

/** 전대차 5조 1항 — 계약일자에서 **일(day)만**. 없으면 빈 문자열(기입선이 뜬다). */
export function dayOfMonthLabel(iso: string): string {
  return parts(iso)?.d ?? '';
}

/**
 * 이용기간 — 「2026.01.15 ~ 2026.07.14 (6개월)」. 기간이 없으면 괄호를 빼고 적는다.
 *
 * ★ 무상이 있으면 「(12개월, 무상 1개월)」이 된다. **계약 내용이라 계약서에 찍힌다** —
 *   적지 않으면 나중에 입주사와 우리가 서로 다른 것을 기억한다.
 *
 * ★ 이 줄은 **이용계약서에만** 있다. 전대차계약서의 3조는 개월수 없이 시작일·종료일
 *   날짜만 적으므로 무상을 넣을 자리가 없다 — 전대차는 손대지 않는다.
 */
export function periodLabel(
  startIso: string,
  endIso: string,
  months: number | null,
  freeMonths?: number | null,
): string {
  const dot = (iso: string) => (parts(iso) ? iso.replace(/-/g, '.') : '');
  const range = `${dot(startIso)} ~ ${dot(endIso)}`;
  if (range.trim() === '~') return '';
  if (!months || months <= 0) return range;

  const free = freeMonths && freeMonths > 0 ? `, 무상 ${freeMonths}개월` : '';
  return `${range} (${months}개월${free})`;
}

/* ══════════════════════════════════════════════════════════════════════════
   주소 · 특기사항
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * 이용계약서 「주소」 — 우편번호 + 기본 + 상세를 한 줄로.
 *
 * ★★ 이 값의 출처는 **`Company.ceoAddress` 계열 하나뿐이다.** 계약 폼 섹션 1 의
 *    「대표자 주소」이고, 그 칸의 힌트가 «계약서에 인쇄되는 대표자 주소입니다» 다.
 *    DB 에는 `address`(사업장)·`head_address`(본점) 컬럼도 있지만 **API 가 내려주지
 *    않고 입력란도 없다** — 값이 언제나 NULL 이라 쓰면 빈 줄만 나온다.
 *    (경위: `doc/CONTRACT_DOCUMENTS.md` §B)
 *
 * ★ 비어 있는 조각은 건너뛴다. 셋 다 비면 빈 문자열이고, 그때 화면이 기입선을 그린다.
 */
export function companyAddressLabel(args: {
  zipCode: string | null;
  address: string | null;
  addressDetail: string | null;
  /** 우편번호를 앞에 붙일지. 전대차 서명란은 시안이 우편번호 없이 적는다. */
  withZip: boolean;
}): string {
  const pieces = [
    args.withZip ? args.zipCode : null,
    args.address,
    args.addressDetail,
  ];
  return pieces
    .map((p) => (p ?? '').trim())
    .filter((p) => p !== '')
    .join(' ');
}

/**
 * 전대차 2조 2항 「대상」 — **사업장 주소**다. 회사가 입력한 주소가 아니다.
 *
 *     {건물 주소} {계약호실}호 (삼성동, 우리빌딩)
 *
 * ★★ 세무서에 내는 줄이다. 국세청 신고 주소와 같아야 하므로 **건물 + 계약호실**로
 *    만든다 — 대표자 주소를 여기 쓰면 틀린 주소가 신고된다.
 * ★ 계약호실이 없으면 호실 부분을 **비운다**(기입선). 아무 호실이나 넣지 않는다.
 */
export function subleaseTargetLabel(args: {
  buildingAddress: string;
  buildingSuffix: string;
  contractRoom: string | null;
}): { prefix: string; room: string; suffix: string } {
  return {
    prefix: args.buildingAddress,
    room: (args.contractRoom ?? '').trim(),
    suffix: args.buildingSuffix,
  };
}

/**
 * 특기사항 — 섹션 1 과 섹션 2 의 것을 줄바꿈으로 잇는다(명세 8행).
 * 둘 다 비면 빈 문자열이다. 빈 줄만 남기지 않는다.
 */
export function memoLabel(parts: readonly (string | null)[]): string {
  return parts
    .map((p) => (p ?? '').trim())
    .filter((p) => p !== '')
    .join('\n');
}
