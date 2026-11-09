/**
 * [AI 추천] — 가짜 AI 로 본다(2026-10-27). 실제 Claude 확인은 키를 넣은 뒤에 한다.
 *
 *   · 후보 밖 업종코드는 버린다 · 문구는 서버 문구 · 깨진 JSON / 키 없음 / 호출 실패 → 일반 추천 그대로 + 안내
 *   · Claude 호출 모양(주소 · 머리 · 모델 · 최대 길이)과 실패 응답
 */
import { describe, expect, it } from 'vitest';
import { AI_FAIL_MESSAGE } from '@swonbiz/shared/domain/biz-purpose-recommend-ai';
import { claudePick, runAiPick, type AiPick, type AiPrep } from './bizRecommendAi.ts';

const cand = (bizCode: string, itemName: string, text: string) => ({
  bizCode,
  bizType: '숙박 및 음식점업',
  itemName,
  ksic: [],
  purpose: { text, source: 'catalog' as const },
});

const PREP: AiPrep = {
  items: [
    { bizCode: '552303', bizType: '숙박 및 음식점업', itemName: '커피 전문점', ksic: [], matchedBy: [{ kind: 'item' }] },
    { bizCode: '552304', bizType: '숙박 및 음식점업', itemName: '커피 음료점', ksic: [], matchedBy: [{ kind: 'item' }] },
  ],
  truncated: false,
  enabled: true,
  candidates: [cand('552303', '커피 전문점', '커피 전문점 운영업'), cand('552304', '커피 음료점', '커피 음료점')],
  settings: { model: 'claude-sonnet-5-5', maxPicks: 5, reasonMax: 100, maxTokens: 1000 },
};

const general = { items: PREP.items, truncated: false };

function quietLog() {
  const warns: string[] = [];
  return { warns, warn: (_o: object, msg: string) => void warns.push(msg) };
}

const answering = (text: string): AiPick & { calls: number } => {
  const f = Object.assign(async () => {
    f.calls++;
    return text;
  }, { calls: 0 });
  return f;
};

describe('runAiPick', () => {
  it('★ 꺼져 있으면(ENABLED ≠ Y) 키가 있어도 부르지 않고 일반 추천만', async () => {
    const ai = answering(JSON.stringify({ picks: [{ bizCode: '552303', reason: '커피' }] }));
    const r = await runAiPick({ ...PREP, enabled: false, candidates: [], settings: null }, '카페', ai, quietLog());
    expect(r).toEqual({ ...general, ai: { ok: false, message: AI_FAIL_MESSAGE.disabled } });
    expect(ai.calls).toBe(0);
  });

  it('★ 후보 밖 업종코드는 버리고, 문구는 AI 가 무엇을 주든 서버 문구', async () => {
    const ai = answering(
      JSON.stringify({
        picks: [
          { bizCode: '999999', reason: '후보 밖' },
          { bizCode: '552303', reason: '커피를 판다', purpose: 'AI 가 지은 문구' },
        ],
      }),
    );
    const r = await runAiPick(PREP, '카페', ai, quietLog());
    expect(r).toEqual({
      ...general,
      ai: { ok: true, picks: [{ bizCode: '552303', reason: '커피를 판다', purpose: { text: '커피 전문점 운영업', source: 'catalog' } }] },
    });
  });

  it('★ 깨진 JSON → 일반 추천 그대로 + 안내', async () => {
    const r = await runAiPick(PREP, '카페', answering('{"picks": [ {"bizCode": "552303"'), quietLog());
    expect(r).toEqual({ ...general, ai: { ok: false, message: AI_FAIL_MESSAGE.empty } });
  });

  it('★ 키 없음 → 부르지 않고 일반 추천 + 안내', async () => {
    const log = quietLog();
    const r = await runAiPick(PREP, '카페', null, log);
    expect(r).toEqual({ ...general, ai: { ok: false, message: AI_FAIL_MESSAGE.noKey } });
    expect(log.warns.join()).toContain('ANTHROPIC_API_KEY');
  });

  it('★ 호출 실패 · 시간 초과(던짐) → 일반 추천 + 안내 — 라우트까지 던지지 않는다', async () => {
    const timeout: AiPick = async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    };
    const r = await runAiPick(PREP, '카페', timeout, quietLog());
    expect(r).toEqual({ ...general, ai: { ok: false, message: AI_FAIL_MESSAGE.failed } });
  });

  it('후보가 없거나 설정이 없으면 부르지 않는다', async () => {
    const ai = answering('{"picks":[]}');
    const none = await runAiPick({ ...PREP, items: [], candidates: [] }, '카페', ai, quietLog());
    expect(none.ai).toEqual({ ok: false, message: AI_FAIL_MESSAGE.noCandidates });
    const noSet = await runAiPick({ ...PREP, settings: null }, '카페', ai, quietLog());
    expect(noSet).toEqual({ ...general, ai: { ok: false, message: AI_FAIL_MESSAGE.noSettings } });
    expect(ai.calls).toBe(0);
  });

  it('AI 에게는 사업 설명 · 후보 · 서버 문구를 보낸다', async () => {
    let seen: Parameters<AiPick>[0] | null = null;
    await runAiPick(PREP, '카페', async (req) => {
      seen = req;
      return '{"picks":[]}';
    }, quietLog());
    const user = JSON.parse(seen!.user) as { 사업설명: string; 후보: { 업종코드: string; 사업목적문구: string }[] };
    expect(user.사업설명).toBe('카페');
    expect(user.후보.map((c) => [c.업종코드, c.사업목적문구])).toEqual([
      ['552303', '커피 전문점 운영업'],
      ['552304', '커피 음료점'],
    ]);
    expect(seen!.system).toContain('최대 5개');
  });
});

describe('claudePick', () => {
  it('Messages API — 키는 머리에, 모델 · 최대 길이는 설정에서. 글 조각을 잇는다', async () => {
    let url = '';
    let init: RequestInit = {};
    const fake = (async (u: string, i: RequestInit) => {
      url = u;
      init = i;
      return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"picks"' }, { type: 'text', text: ':[]}' }] }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    const text = await claudePick('test-key', fake)({ system: 'S', user: 'U', settings: PREP.settings! });
    expect(text).toBe('{"picks":[]}');
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('test-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'claude-sonnet-5-5',
      max_tokens: 1000,
      system: 'S',
      messages: [{ role: 'user', content: 'U' }],
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('실패 응답은 던진다(runAiPick 이 접는다)', async () => {
    const fake = (async () => new Response('{"type":"error"}', { status: 529 })) as unknown as typeof fetch;
    await expect(claudePick('k', fake)({ system: 'S', user: 'U', settings: PREP.settings! })).rejects.toThrow('529');
  });
});
