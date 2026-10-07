/**
 * 삐용 연동 재시도 판정.
 *
 * ★ 이 파일이 지키는 것:
 *   ① **값 문제는 한 번도 다시 보내지 않는다** — 횟수보다 종류를 먼저 본다
 *   ② 그 밖에는 5번까지
 *   ③ 간격은 뒤로 갈수록 뜸하다(1·5·15·30·60분)
 *   ④ `retryable` 이 `null`(모른다)이면 **막지 않는다**
 */
import { describe, it, expect } from 'vitest';
import { judgeLinkRetry, needsHumanHand, MAX_LINK_ATTEMPTS } from './retryPolicy.ts';

const NOW = new Date('2026-10-05T12:00:00.000Z').getTime();
const minutesAgo = (m: number) => new Date(NOW - m * 60_000);

describe('judgeLinkRetry — ① 종류를 횟수보다 먼저 본다', () => {
  it('★★ 값·권한 문제는 1회 실패만으로도 그만둔다 — 한 번도 다시 보내지 않는다', () => {
    const out = judgeLinkRetry({ attemptCount: 1, retryable: false, failedAt: minutesAgo(999) }, { now: NOW });
    expect(out).toEqual({ kind: 'give_up', why: 'not_retryable' });
  });

  it('★ `null`(모른다)은 막지 않는다 — 036 이전 행을 영원히 묶어 두지 않는다', () => {
    const out = judgeLinkRetry({ attemptCount: 0, retryable: null, failedAt: minutesAgo(10) }, { now: NOW });
    expect(out).toEqual({ kind: 'retry' });
  });
});

describe('judgeLinkRetry — ② 횟수 상한', () => {
  it(`★ ${MAX_LINK_ATTEMPTS}번 실패하면 그만둔다`, () => {
    const out = judgeLinkRetry(
      { attemptCount: MAX_LINK_ATTEMPTS, retryable: true, failedAt: minutesAgo(999) },
      { now: NOW },
    );
    expect(out).toEqual({ kind: 'give_up', why: 'too_many' });
  });

  it('4번까지는 아직 보낸다', () => {
    const out = judgeLinkRetry(
      { attemptCount: MAX_LINK_ATTEMPTS - 1, retryable: true, failedAt: minutesAgo(999) },
      { now: NOW },
    );
    expect(out).toEqual({ kind: 'retry' });
  });
});

describe('judgeLinkRetry — ③ 간격은 뒤로 갈수록 뜸하다', () => {
  // [실패 횟수, 기다려야 하는 분]
  const 표: [number, number][] = [
    [0, 1],
    [1, 5],
    [2, 15],
    [3, 30],
    [4, 60],
  ];

  for (const [attemptCount, 기다림] of 표) {
    it(`${attemptCount}회 실패 → ${기다림}분을 기다린다`, () => {
      // 1분 덜 지났으면 아직이다.
      const 아직 = judgeLinkRetry(
        { attemptCount, retryable: true, failedAt: minutesAgo(기다림 - 1) },
        { now: NOW },
      );
      expect(아직.kind).toBe('wait');
      if (아직.kind === 'wait') expect(아직.waitMs).toBe(60_000);

      // 딱 지났으면 보낸다.
      const 지금 = judgeLinkRetry({ attemptCount, retryable: true, failedAt: minutesAgo(기다림) }, { now: NOW });
      expect(지금).toEqual({ kind: 'retry' });
    });
  }

  it('★ 실패 시각을 모르면 기다리지 않는다 — 한 번 보내 보면 결론이 난다', () => {
    const out = judgeLinkRetry({ attemptCount: 2, retryable: true, failedAt: null }, { now: NOW });
    expect(out).toEqual({ kind: 'retry' });
  });
});

describe('needsHumanHand — 화면이 「손봐야 합니다」로 바꿀 때', () => {
  it('★ 상태 컬럼을 새로 만들지 않고 같은 두 칸에서 유도한다', () => {
    expect(needsHumanHand({ attemptCount: 0, retryable: false, failedAt: null })).toBe(true);
    expect(needsHumanHand({ attemptCount: MAX_LINK_ATTEMPTS, retryable: true, failedAt: null })).toBe(true);
    // 아직 저절로 풀릴 수 있는 상태 — 사람을 부르지 않는다.
    expect(needsHumanHand({ attemptCount: 1, retryable: true, failedAt: minutesAgo(1) })).toBe(false);
    expect(needsHumanHand({ attemptCount: 1, retryable: true, failedAt: new Date() })).toBe(false);
  });
});
