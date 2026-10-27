import { describe, expect, it } from 'vitest';
import { checkAiPicks, parseAiSettings } from './biz-purpose-recommend-ai.ts';

const ALLOWED = new Set(['552303', '552304', '525101']);
const S = { maxPicks: 2, reasonMax: 10 };
const raw = (picks: unknown) => JSON.stringify({ picks });

describe('checkAiPicks — 서버 검사', () => {
  it('① 깨진 JSON · 모양이 틀린 답은 빈 목록', () => {
    expect(checkAiPicks('{"picks": [', ALLOWED, S)).toEqual([]);
    expect(checkAiPicks('고른 업종은 552303 입니다', ALLOWED, S)).toEqual([]);
    expect(checkAiPicks('{"items": []}', ALLOWED, S)).toEqual([]);
    expect(checkAiPicks(raw([{ bizCode: 552303, reason: '숫자' }, 'x', null]), ALLOWED, S)).toEqual([]);
  });
  it('① 앞뒤 ``` 울타리 하나는 걷는다', () => {
    expect(checkAiPicks('```json\n' + raw([{ bizCode: '552303', reason: '커피' }]) + '\n```', ALLOWED, S)).toEqual([
      { bizCode: '552303', reason: '커피' },
    ]);
  });
  it('② 후보 밖 업종코드는 버린다', () => {
    expect(checkAiPicks(raw([{ bizCode: '999999', reason: '밖' }, { bizCode: '552304', reason: '안' }]), ALLOWED, S)).toEqual([
      { bizCode: '552304', reason: '안' },
    ]);
  });
  it('④ 빈 이유는 그 줄을 버리고, 상한을 넘는 이유는 그 길이로 자른다', () => {
    expect(
      checkAiPicks(raw([{ bizCode: '552303', reason: ' ' }, { bizCode: '552304', reason: '열한글자를넘는이유입니다' }]), ALLOWED, S),
    ).toEqual([{ bizCode: '552304', reason: '열한글자를넘는이유입' }]);
  });
  it('⑤ 같은 업종은 첫 줄만 · MAX_PICKS 에서 자른다', () => {
    expect(
      checkAiPicks(
        raw([
          { bizCode: '552303', reason: '하나' },
          { bizCode: '552303', reason: '또' },
          { bizCode: '552304', reason: '둘' },
          { bizCode: '525101', reason: '셋' },
        ]),
        ALLOWED,
        S,
      ),
    ).toEqual([
      { bizCode: '552303', reason: '하나' },
      { bizCode: '552304', reason: '둘' },
    ]);
  });
});

describe('parseAiSettings', () => {
  const rows = [
    { code: 'MODEL', name: 'claude-sonnet-5-5' },
    { code: 'MAX_PICKS', name: '5' },
    { code: 'REASON_MAX', name: '100' },
    { code: 'MAX_TOKENS', name: '1000' },
  ];
  it('넷이 다 있으면 설정', () => {
    expect(parseAiSettings(rows)).toEqual({ model: 'claude-sonnet-5-5', maxPicks: 5, reasonMax: 100, maxTokens: 1000 });
  });
  it('하나라도 없거나 숫자가 아니면 null', () => {
    expect(parseAiSettings(rows.slice(1))).toBeNull();
    expect(parseAiSettings(rows.map((r) => (r.code === 'MAX_PICKS' ? { ...r, name: '다섯' } : r)))).toBeNull();
    expect(parseAiSettings(rows.map((r) => (r.code === 'MAX_TOKENS' ? { ...r, name: '0' } : r)))).toBeNull();
  });
});
