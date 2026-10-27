/**
 * `/legal/biz-purposes/recommend` — 역할 · 조건 · 404 · 처리(사전 + 바꿔 부르는 말 → 후보, 문구 정하기).
 *
 * ★ DB 에 붙지 않는다. 라우트는 `BizRecommendDeps` 대역으로, 처리는 SQL 글자로 답을 고르는 가짜 클라이언트로 본다.
 *   RLS(047 · 048 · 049 읽기 정책)는 적용 때 erp_app 으로 확인했다(배포 문서 049).
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { ErpSession, ScopeRole } from '@swonbiz/shared';
import type { BizRecommendDetail } from '@swonbiz/shared/domain/biz-purpose-recommend';
import { bizDetailOp, prepareAiOp, recommendBizOp, registerBizRecommendRoutes, type BizRecommendDeps } from './bizRecommend.ts';
import type { ScopedClient } from '../db/withCompanyScope.ts';

const session = (role: ScopeRole): ErpSession => ({
  erpSid: 'sid-hash',
  s020MemberId: 1,
  s020OrgId: role === 'operator' ? 1 : 9003,
  companyId: null,
  role,
  expiresAt: new Date(Date.now() + 60_000),
  lastActiveAt: null,
});

const DETAIL: BizRecommendDetail = {
  bizCode: '552303',
  bizType: '숙박 및 음식점업',
  itemName: '커피 전문점',
  ksic: [{ code: '56221', name: '커피 전문점' }],
  licenses: [],
  purpose: { text: '커피 전문점', source: 'item' },
};

function fakeDeps(): BizRecommendDeps & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    recommend: async (_s, q) => {
      calls.push(['recommend', q]);
      return { items: [], truncated: false };
    },
    detail: async (_s, bizCode) => {
      calls.push(['detail', bizCode]);
      return bizCode === '552303' ? DETAIL : null;
    },
    ai: async (_s, q) => {
      calls.push(['ai', q]);
      return { items: [], truncated: false, ai: { ok: false, message: '안내' } };
    },
  };
}

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

async function build(role: ScopeRole, deps: BizRecommendDeps): Promise<FastifyInstance> {
  app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.session = session(role);
  });
  registerBizRecommendRoutes(app, deps);
  await app.ready();
  return app;
}

describe('GET /legal/biz-purposes/recommend', () => {
  it('★ 회사 세션도 읽는다 — 설명은 앞뒤 공백을 걷어 넘긴다', async () => {
    const deps = fakeDeps();
    const a = await build('tenant', deps);
    const res = await a.inject({ method: 'GET', url: `/legal/biz-purposes/recommend?q=${encodeURIComponent(' 카페 ')}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [], truncated: false });
    expect(deps.calls).toEqual([['recommend', '카페']]);
  });
  it('빈 설명은 400', async () => {
    const a = await build('operator', fakeDeps());
    const res = await a.inject({ method: 'GET', url: '/legal/biz-purposes/recommend?q=%20' });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /legal/biz-purposes/recommend/:bizCode', () => {
  it('회사 세션도 읽는다', async () => {
    const a = await build('tenant', fakeDeps());
    const res = await a.inject({ method: 'GET', url: '/legal/biz-purposes/recommend/552303' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ item: DETAIL });
  });
  it('없는 업종코드는 404 · 모양이 틀리면 400', async () => {
    const deps = fakeDeps();
    const a = await build('operator', deps);
    expect((await a.inject({ method: 'GET', url: '/legal/biz-purposes/recommend/999999' })).statusCode).toBe(404);
    expect((await a.inject({ method: 'GET', url: '/legal/biz-purposes/recommend/12ab' })).statusCode).toBe(400);
    expect(deps.calls).toEqual([['detail', '999999']]);
  });
});

/** SQL 글자로 답을 고르는 가짜 클라이언트. */
function fakeClient(answers: [RegExp, unknown[]][]): ScopedClient & { sql: string[] } {
  const sql: string[] = [];
  return {
    sql,
    query: async (text: string) => {
      sql.push(text);
      const hit = answers.find(([re]) => re.test(text));
      return { rows: hit ? hit[1] : [] };
    },
  } as unknown as ScopedClient & { sql: string[] };
}

describe('recommendBizOp · bizDetailOp', () => {
  it('사전 + 바꿔 부르는 말로 후보를 고른다', async () => {
    const client = fakeClient([
      [/tb_s080_biz_code d/, [
        { biz_code: '552303', biz_type: '숙박 및 음식점업', item_name: '커피 전문점', ksic: [] },
        { biz_code: '930203', biz_type: '개인서비스업', item_name: '두발 미용업', ksic: [] },
      ]],
      [/tb_s080_codes_line/, [{ code: '552303', name: '카페, 커피숍' }]],
    ]);
    const r = await recommendBizOp(client, '동네 카페');
    expect(r.items.map((c) => c.bizCode)).toEqual(['552303']);
    expect(client.sql.some((s) => /category = \$1 AND use_tp = \$2 AND is_active = true/.test(s))).toBe(true);
  });

  it('★ 인허가는 「검토됨」만 읽고, 문구는 카탈로그 → 없으면 종목', async () => {
    const client = fakeClient([
      [/tb_s080_biz_code d/, [{ biz_code: '525101', biz_type: '도매 및 소매업', item_name: '전자상거래 소매업', ksic: [{ code: '47912', name: '전자상거래 소매업' }] }]],
      [/tb_s080_license_rule_biz_code/, [
        { rule_id: 'ecom_mail_order', license_kind: '신고', license_name: '통신판매업 신고', note: '단서', law_name: '전자상거래법', article_no: 12, branch_no: 0, title: '통신판매업자의 신고 등', part: '제1항' },
        { rule_id: 'ecom_mail_order', license_kind: '신고', license_name: '통신판매업 신고', note: '단서', law_name: '전자상거래법 시행령', article_no: 13, branch_no: 0, title: '통신판매업자의 신고절차', part: '제1항' },
      ]],
      [/tb_s080_biz_purpose_catalog/, [{ biz_code: '525101', biz_name: '전자상거래 소매업(통신판매업)' }]],
    ]);
    const d = await bizDetailOp(client, '525101');
    expect(d?.licenses).toEqual([
      {
        kind: '신고',
        name: '통신판매업 신고',
        note: '단서',
        basis: [
          { lawName: '전자상거래법', article: '제12조(통신판매업자의 신고 등) 제1항' },
          { lawName: '전자상거래법 시행령', article: '제13조(통신판매업자의 신고절차) 제1항' },
        ],
      },
    ]);
    expect(d?.purpose).toEqual({ text: '전자상거래 소매업(통신판매업)', source: 'catalog' });
    expect(client.sql.some((s) => s.includes("r.review_status = '검토됨'"))).toBe(true);
  });

  it('없는 업종코드는 null', async () => {
    expect(await bizDetailOp(fakeClient([]), '999999')).toBeNull();
  });
});

describe('POST /legal/biz-purposes/recommend/ai', () => {
  it('★ 회사 세션도 부른다 — 설명은 앞뒤 공백을 걷어 넘긴다', async () => {
    const deps = fakeDeps();
    const a = await build('tenant', deps);
    const res = await a.inject({ method: 'POST', url: '/legal/biz-purposes/recommend/ai', payload: { q: ' 카페 ' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [], truncated: false, ai: { ok: false, message: '안내' } });
    expect(deps.calls).toEqual([['ai', '카페']]);
  });
  it('빈 설명 · 본문 없음은 400 — AI 를 부르지 않는다', async () => {
    const deps = fakeDeps();
    const a = await build('operator', deps);
    expect((await a.inject({ method: 'POST', url: '/legal/biz-purposes/recommend/ai', payload: { q: ' ' } })).statusCode).toBe(400);
    expect((await a.inject({ method: 'POST', url: '/legal/biz-purposes/recommend/ai', payload: {} })).statusCode).toBe(400);
    expect(deps.calls).toEqual([]);
  });
});

describe('prepareAiOp', () => {
  it('후보마다 서버 문구(카탈로그 → 종목) · 설정은 공통 코드 AI_SETTING · ★ 인허가는 읽지 않는다', async () => {
    const client = fakeClient([
      [/tb_s080_biz_code d/, [
        { biz_code: '552303', biz_type: '숙박 및 음식점업', item_name: '커피 전문점', ksic: [] },
        { biz_code: '552304', biz_type: '숙박 및 음식점업', item_name: '커피 음료점', ksic: [] },
      ]],
      [/unnest/, [
        { category: 'AI_SETTING', code: 'MODEL', name: 'claude-sonnet-5-5', sort_order: 1 },
        { category: 'AI_SETTING', code: 'MAX_PICKS', name: '5', sort_order: 2 },
        { category: 'AI_SETTING', code: 'REASON_MAX', name: '100', sort_order: 3 },
        { category: 'AI_SETTING', code: 'MAX_TOKENS', name: '1000', sort_order: 4 },
      ]],
      [/tb_s080_biz_purpose_catalog/, [{ biz_code: '552303', biz_name: '커피 전문점 운영업' }]],
    ]);
    const p = await prepareAiOp(client, '커피');
    expect(p.items.map((c) => c.bizCode)).toEqual(['552303', '552304']);
    expect(p.candidates.map((c) => c.purpose)).toEqual([
      { text: '커피 전문점 운영업', source: 'catalog' },
      { text: '커피 음료점', source: 'item' },
    ]);
    expect(p.settings).toEqual({ model: 'claude-sonnet-5-5', maxPicks: 5, reasonMax: 100, maxTokens: 1000 });
    expect(client.sql.some((s) => s.includes('tb_s080_license_rule'))).toBe(false);
  });
});
