/**
 * 특기사항의 **자동 줄** — 화면이 얹었다 뺐다 하는 줄과 사람이 쓴 줄을 가른다.
 *
 * =============================================================================
 * ★★ 자동 줄은 **첫 줄**이고, 표식은 접두사다
 * =============================================================================
 * 금액이 바뀔 때마다 화면이 할인 문구를 특기사항 맨 위에 다시 얹는다. 그때 **사람이
 * 쓴 줄을 지우면 안 되므로** 「어느 줄이 자동으로 들어간 줄인가」를 알아볼 방법이
 * 필요하고, 그것이 `DISCOUNT_PREFIX` 다.
 *
 * ★★★ 그래서 **첫 줄이 자동 줄이 아니면 지우지 않고 밀어낸다.** 재계약 문구가
 *      첫 줄에 오는 자리라(`buildRenewalSeed`) 이 규칙이 깨지면 그 문구가 조용히
 *      사라진다 — 계약서에 인쇄되는 문장이다.
 *
 * ★ 2026-09-21에 `packages/web` 의 `form-model.ts` 에서 옮겨 왔다. 재계약 문구와
 *   할인 문구가 부딪히는지 시험해야 했는데 웹에는 시험 러너가 없어 걸 수 없었다.
 *   **옮기면서 동작은 바꾸지 않았다** — `contract-memo.test.ts` 가 그 약속이다.
 */

/** 원 단위 콤마. 시안 표기 그대로다. */
const comma = (n: number): string => (n || 0).toLocaleString('ko-KR');

/**
 * 자동으로 들어간 할인 줄의 표식.
 *
 * ★ `discountLabel` 이 만드는 문구가 반드시 이것으로 시작해야 한다. 둘이 갈리면
 *   `withDiscountLine` 이 옛 줄을 못 알아보고 **줄이 계속 쌓인다.**
 */
export const DISCOUNT_PREFIX = '기준가 대비 ';

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
 * 할인 문구를 특기사항 **첫 줄에만** 둔다. 사용자가 쓴 줄은 보존한다.
 *
 * ★ 빈 문구를 주면 자동 줄을 **뺀다**(할인이 사라진 경우).
 * ★ 렌더마다 다시 불리는 자리라 여러 번 불러도 줄이 쌓이지 않아야 한다.
 *
 * ★ **옮기면서 한 가지만 고쳤다** — 특기사항이 비어 있을 때 `''.split('\n')` 이
 *   `['']` 이라 결과에 **빈 줄이 하나 붙어 나왔다**(`"…할인)\n"`). 그 값이 그대로
 *   저장되고 계약서에도 실린다. 중간의 빈 줄은 사람이 넣은 것일 수 있으므로
 *   **통째로 비어 있을 때만** 떨어뜨린다.
 */
export function withDiscountLine(memo: string, line: string): string {
  const lines = memo.split('\n');
  const hasAuto = lines[0]?.startsWith(DISCOUNT_PREFIX) ?? false;
  const kept = hasAuto ? lines.slice(1) : lines;
  const rest = kept.length === 1 && kept[0] === '' ? [] : kept;
  return line ? [line, ...rest].join('\n') : rest.join('\n');
}
