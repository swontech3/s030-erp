/**
 * 특기사항의 **자동 줄** — 화면이 얹었다 뺐다 하는 줄과 사람이 쓴 줄을 가른다.
 *
 * ★ 2026-09-21에 `packages/web` 의 `form-model.ts` 에서 옮겨 왔다. 재계약이 특기사항
 *   첫 줄에 문구를 넣게 되면서 **할인 문구와 부딪히는지**를 시험해야 했는데, 두 규칙이
 *   서로 다른 패키지에 있어 함께 걸 수가 없었다(웹에는 시험 러너가 없다).
 *
 * ★ 2026-09-26에 무상 문구가 두 번째 자동 줄로 들어왔다. 아래 시험이 **둘이 같이
 *   있을 때의 순서**와 **각각만 빠질 때**를 건다.
 */
import { describe, it, expect } from 'vitest';
import {
  DISCOUNT_PREFIX,
  FREE_LINE,
  discountLabel,
  freeLabel,
  withAutoLines,
} from './contract-memo.ts';

const DISCOUNT = '기준가 대비 -10,000원 (10.0% 할인)';
const FREE1 = '무상 1개월 제공 — 계약만료일 이전 중도 해지 시 무상 기간의 이용료를 정산 시 반환한다';

describe('discountLabel', () => {
  it('기준가보다 싸면 할인 문구', () => {
    expect(discountLabel(100_000, 90_000)).toBe('기준가 대비 -10,000원 (10.0% 할인)');
  });

  it('기준가보다 비싸면 추가 문구', () => {
    expect(discountLabel(100_000, 110_000)).toBe('기준가 대비 +10,000원 (10.0% 추가)');
  });

  it('★ 차액이 없으면 빈 문자열이다 — 없는 할인을 적지 않는다', () => {
    expect(discountLabel(100_000, 100_000)).toBe('');
  });

  it('★ 한쪽이 0 이면 빈 문자열이다 — 아직 안 채운 칸으로 비율을 내지 않는다', () => {
    expect(discountLabel(0, 90_000)).toBe('');
    expect(discountLabel(100_000, 0)).toBe('');
  });

  it('소수 한 자리로 반올림한다', () => {
    expect(discountLabel(300_000, 200_000)).toBe('기준가 대비 -100,000원 (33.3% 할인)');
  });

  /** ★ `withAutoLines` 가 이 접두사로 자동 줄을 알아본다. 둘이 갈리면 줄이 쌓인다. */
  it('★★ 접두사가 자동 줄의 표식이다', () => {
    expect(discountLabel(100_000, 90_000).startsWith(DISCOUNT_PREFIX)).toBe(true);
  });
});

describe('freeLabel', () => {
  /** ★★ 이 문장이 정산서의 무상 환수 근거다 — 글자 하나까지 그대로 인쇄된다. */
  it('★★ 무상이 있으면 개월수와 환수 문장을 적는다', () => {
    expect(freeLabel(1)).toBe(
      '무상 1개월 제공 — 계약만료일 이전 중도 해지 시 무상 기간의 이용료를 정산 시 반환한다',
    );
    expect(freeLabel(3)).toBe(
      '무상 3개월 제공 — 계약만료일 이전 중도 해지 시 무상 기간의 이용료를 정산 시 반환한다',
    );
  });

  it('★ 무상이 0 이면 빈 문자열이다 — 없는 혜택을 적지 않는다', () => {
    expect(freeLabel(0)).toBe('');
    expect(freeLabel(-1)).toBe('');
    expect(freeLabel(Number.NaN)).toBe('');
  });

  /** ★ `withAutoLines` 가 이 꼴로 자동 줄을 알아본다. 갈리면 줄이 쌓인다. */
  it('★★ 만든 문구가 자동 줄 표식에 걸린다', () => {
    expect(FREE_LINE.test(freeLabel(2))).toBe(true);
  });

  /** ★ 「무상 주차 1대」 같은 사람의 줄을 자동 줄로 오인하면 다음 렌더에 지워진다. */
  it('★★ 사람이 쓴 「무상 …」 줄은 표식에 걸리지 않는다', () => {
    expect(FREE_LINE.test('무상 주차 1대')).toBe(false);
    expect(FREE_LINE.test('무상 기간 협의')).toBe(false);
  });
});

describe('withAutoLines', () => {
  /**
   * ★ 예전에는 빈 특기사항에 얹으면 `"…할인)\n"` 으로 **빈 줄이 하나 붙어** 나왔고
   *   (`''.split('\n')` 이 `['']` 이라), 그 값이 그대로 저장되고 계약서에도 실렸다.
   */
  it('★ 빈 특기사항에 얹으면 그 줄만 남는다 — 빈 줄이 붙지 않는다', () => {
    expect(withAutoLines('', [DISCOUNT])).toBe(DISCOUNT);
  });

  /** ★ 중간의 빈 줄은 사람이 넣은 것일 수 있다 — 떨어뜨리지 않는다. */
  it('★ 사람이 넣은 빈 줄은 보존한다', () => {
    const memo = [DISCOUNT, '주차 1대 포함', '', '입주일 협의'].join('\n');
    expect(withAutoLines(memo, [''])).toBe(['주차 1대 포함', '', '입주일 협의'].join('\n'));
  });

  /** ★★ 사람이 쓴 줄은 **보존한다.** 자동 줄만 갈아 끼운다. */
  it('★★ 사람이 쓴 줄은 건드리지 않는다', () => {
    const memo = [DISCOUNT, '주차 1대 포함', '입주일 협의'].join('\n');
    expect(withAutoLines(memo, ['기준가 대비 -20,000원 (20.0% 할인)'])).toBe(
      ['기준가 대비 -20,000원 (20.0% 할인)', '주차 1대 포함', '입주일 협의'].join('\n'),
    );
  });

  it('★ 할인이 사라지면 자동 줄만 빠진다', () => {
    expect(withAutoLines([DISCOUNT, '주차 1대 포함'].join('\n'), [''])).toBe('주차 1대 포함');
  });

  /**
   * ★★★ **자동 줄이 아니면 밀어낸다 — 지우지 않는다.**
   *    재계약 문구가 첫 줄에 오는 자리라 이것이 깨지면 그 문구가 사라진다.
   */
  it('★★★ 첫 줄이 남의 줄이면 지우지 않고 그 위에 얹는다', () => {
    expect(withAutoLines('재계약 (이전 계약 기간 2026.01.02 ~ 2027.01.01)', [DISCOUNT])).toBe(
      [DISCOUNT, '재계약 (이전 계약 기간 2026.01.02 ~ 2027.01.01)'].join('\n'),
    );
  });

  /** ★ 렌더마다 다시 얹히는 자리라, 여러 번 불러도 줄이 쌓이면 안 된다. */
  it('★ 같은 값을 여러 번 얹어도 줄이 쌓이지 않는다', () => {
    const once = withAutoLines('주차 1대 포함', [DISCOUNT]);
    expect(withAutoLines(withAutoLines(once, [DISCOUNT]), [DISCOUNT])).toBe(once);
  });

  /* ── 할인 + 무상 ─────────────────────────────────────────────────────── */

  /** ★★ 순서는 부르는 쪽이 정한다 — 할인이 먼저다. */
  it('★★ 둘 다 있으면 할인 → 무상 순으로 맨 위에 모인다', () => {
    expect(withAutoLines('주차 1대 포함', [DISCOUNT, FREE1])).toBe(
      [DISCOUNT, FREE1, '주차 1대 포함'].join('\n'),
    );
  });

  it('★ 무상만 있으면 무상 줄만 얹힌다', () => {
    expect(withAutoLines('주차 1대 포함', ['', FREE1])).toBe([FREE1, '주차 1대 포함'].join('\n'));
  });

  /** ★★ 한쪽만 빠져도 남은 자동 줄과 사람의 줄은 그대로다. */
  it('★★ 할인만 사라지면 무상 줄은 남는다', () => {
    const both = withAutoLines('주차 1대 포함', [DISCOUNT, FREE1]);
    expect(withAutoLines(both, ['', FREE1])).toBe([FREE1, '주차 1대 포함'].join('\n'));
  });

  it('★★ 무상이 0 이 되면 무상 줄만 빠진다', () => {
    const both = withAutoLines('주차 1대 포함', [DISCOUNT, FREE1]);
    expect(withAutoLines(both, [DISCOUNT, ''])).toBe([DISCOUNT, '주차 1대 포함'].join('\n'));
  });

  it('★ 둘 다 사라지면 사람이 쓴 줄만 남는다', () => {
    const both = withAutoLines('주차 1대 포함', [DISCOUNT, FREE1]);
    expect(withAutoLines(both, ['', ''])).toBe('주차 1대 포함');
  });

  it('★ 둘 다 있어도 여러 번 얹으면 줄이 쌓이지 않는다', () => {
    const once = withAutoLines('주차 1대 포함', [DISCOUNT, FREE1]);
    expect(withAutoLines(withAutoLines(once, [DISCOUNT, FREE1]), [DISCOUNT, FREE1])).toBe(once);
  });

  /** ★ 개월수만 바뀌면 그 줄만 갈린다. */
  it('★ 무상 개월수가 바뀌면 그 줄이 갈린다', () => {
    const free3 = freeLabel(3);
    expect(withAutoLines(withAutoLines('주차 1대 포함', [FREE1]), [free3])).toBe(
      [free3, '주차 1대 포함'].join('\n'),
    );
  });

  /** ★★★ 자동 줄 둘 아래에 있는 재계약 문구는 살아남는다. */
  it('★★★ 자동 줄 둘이 얹혀도 재계약 문구는 밀려 내려갈 뿐이다', () => {
    const renewal = '재계약 (이전 계약 기간 2026.01.02 ~ 2027.01.01)';
    expect(withAutoLines(renewal, [DISCOUNT, FREE1])).toBe([DISCOUNT, FREE1, renewal].join('\n'));
  });
});
