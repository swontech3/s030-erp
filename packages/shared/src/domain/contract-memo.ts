/**
 * 특기사항의 **자동 줄** — 화면이 얹었다 뺐다 하는 줄과 사람이 쓴 줄을 가른다.
 *
 * =============================================================================
 * ★★ 자동 줄은 **맨 위**에 모이고, 각 줄은 스스로 표식을 갖는다
 * =============================================================================
 * 금액이나 무상 개월수가 바뀔 때마다 화면이 자동 줄을 특기사항 맨 위에 다시 얹는다.
 * 그때 **사람이 쓴 줄을 지우면 안 되므로** 「어느 줄이 자동으로 들어간 줄인가」를
 * 알아볼 방법이 필요하고, 그것이 `DISCOUNT_PREFIX` 와 `FREE_LINE` 이다.
 *
 * ★★★ 그래서 **자동 줄이 아닌 줄은 지우지 않고 밀어낸다.** 재계약 문구가 첫 줄에
 *      오는 자리라(`buildRenewalSeed`) 이 규칙이 깨지면 그 문구가 조용히 사라진다 —
 *      계약서에 인쇄되는 문장이다.
 *
 * ★★ 자동 줄의 **순서는 `withAutoLines` 를 부르는 쪽이 정한다**(할인 → 무상).
 *    지우는 쪽은 순서를 따지지 않고 맨 위의 자동 줄을 다 걷어 낸다 — 순서가 뒤바뀐
 *    옛 저장값도 다시 얹히면서 제자리를 찾는다.
 *
 * ★ 2026-09-21에 `packages/web` 의 `form-model.ts` 에서 옮겨 왔다. 재계약 문구와
 *   할인 문구가 부딪히는지 시험해야 했는데 웹에는 시험 러너가 없어 걸 수 없었다.
 * ★ 2026-09-26에 무상 문구가 두 번째 자동 줄로 들어왔다. 자동 줄이 **하나**라는
 *   가정(`withDiscountLine`)을 걷어 내고 `withAutoLines` 하나로 합쳤다.
 */

/** 원 단위 콤마. 시안 표기 그대로다. */
const comma = (n: number): string => (n || 0).toLocaleString('ko-KR');

/**
 * 자동으로 들어간 할인 줄의 표식.
 *
 * ★ `discountLabel` 이 만드는 문구가 반드시 이것으로 시작해야 한다. 둘이 갈리면
 *   `withAutoLines` 가 옛 줄을 못 알아보고 **줄이 계속 쌓인다.**
 */
export const DISCOUNT_PREFIX = '기준가 대비 ';

/**
 * 자동으로 들어간 무상 줄의 표식.
 *
 * ★ **접두사 하나(`'무상 '`)로는 안 된다.** 운영자가 「무상 주차 1대」처럼 적을 수
 *   있고, 그 줄을 자동 줄로 오인하면 다음 렌더에 지워진다. 개월수까지 본다.
 * ★ `freeLabel` 이 만드는 문구가 반드시 이것에 걸려야 한다 — 갈리면 줄이 쌓인다.
 */
export const FREE_LINE = /^무상 \d+개월 제공 — /;

/** 맨 위에서 걷어 낼 자동 줄인가. */
const isAutoLine = (line: string): boolean =>
  line.startsWith(DISCOUNT_PREFIX) || FREE_LINE.test(line);

/**
 * 기준가 대비 할인 문구. 차액이 없으면 빈 문자열이다.
 *
 * ★ 표시 문구이지 저장값이 아니다 — 시안 문자열 형식을 그대로 옮긴다(`05-logic.md` §4).
 * ★ 한쪽이 0 이면 빈 문자열이다. 아직 안 채운 칸으로 비율을 내지 않는다.
 */
export function discountLabel(standardFee: number, monthlyFee: number): string {
  if (!standardFee || !monthlyFee || standardFee === monthlyFee) return '';
  const diff = monthlyFee - standardFee;
  const pct = Math.abs((diff / standardFee) * 100).toFixed(1);
  return `${DISCOUNT_PREFIX}${diff < 0 ? '-' : '+'}${comma(Math.abs(diff))}원 (${pct}${diff < 0 ? '% 할인)' : '% 추가)'}`;
}

/**
 * 무상 개월 문구. 무상이 없으면 빈 문자열이다.
 *
 * ★★ **이 줄이 무상 환수의 근거다.** 전대차계약서에 무상 환수를 직접 말하는 조항이
 *    없어서(할인 환수는 제8조 3항), 정산서의 「무상 환수」는 이 특기사항을 근거로
 *    가리킨다(`FREE_CLAWBACK_BASIS`). 문구를 고치면 그 근거가 같이 바뀐다.
 * ★ 개월수만 다르고 문장은 고정이다 — 계약서에 그대로 인쇄된다.
 */
export function freeLabel(freeMonths: number): string {
  const months = Math.floor(freeMonths || 0);
  if (months <= 0) return '';
  return `무상 ${months}개월 제공 — 계약만료일 이전 중도 해지 시 무상 기간의 이용료를 정산 시 반환한다`;
}

/**
 * 자동 줄을 특기사항 **맨 위에만** 둔다. 사용자가 쓴 줄은 보존한다.
 *
 * ★ 빈 문구는 **빠진다** — 할인이 없어지거나 무상이 0 이 되면 그 줄만 사라진다.
 * ★ 렌더마다 다시 불리는 자리라 여러 번 불러도 줄이 쌓이지 않아야 한다.
 *
 * ★ 특기사항이 통째로 비어 있을 때 `''.split('\n')` 이 `['']` 이라 결과에 **빈 줄이
 *   하나 붙어 나온다**(`"…할인)\n"`). 그 값이 그대로 저장되고 계약서에도 실린다.
 *   중간의 빈 줄은 사람이 넣은 것일 수 있으므로 **통째로 비어 있을 때만** 떨어뜨린다.
 */
export function withAutoLines(memo: string, lines: readonly string[]): string {
  const all = memo.split('\n');
  let i = 0;
  while (i < all.length && isAutoLine(all[i] ?? '')) i += 1;
  const kept = all.slice(i);
  const rest = kept.length === 1 && kept[0] === '' ? [] : kept;
  return [...lines.filter(Boolean), ...rest].join('\n');
}
