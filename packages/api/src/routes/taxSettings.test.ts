/**
 * `/tax/settings` — 본문 해석(400) · 저장으로 넘기는 값 · 404 · 역할.
 *
 * ★ DB 에 붙지 않는다. 라우트는 `TaxSettingsDeps` 대역으로 본다. 단체 범위 · RLS · id 유지는
 *   `scripts/verify-tax-settings.js` 가 실제 DB 에서 잰다.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { ErpSession, ScopeRole } from '@swonbiz/shared';
import type { TaxSettingsResponse, TaxSettingsSave } from '@swonbiz/shared/domain/tax-settings';
import { fillCompanyName, registerTaxSettingRoutes, type TaxSettingsDeps } from './taxSettings.ts';

const session = (role: ScopeRole): ErpSession => ({
  erpSid: 'sid-hash',
  s020MemberId: 7,
  s020OrgId: role === 'operator' ? 1 : 9003,
  companyId: null,
  role,
  expiresAt: new Date(Date.now() + 60_000),
  lastActiveAt: null,
});

const RESPONSE: TaxSettingsResponse = {
  settings: { saved: false, bizType: null, withholdingCycle: 'M', taxEmails: [], unusedKinds: [] },
  finAccounts: [],
  codes: { bizTypes: [], withholdingCycles: [], kinds: [], finKinds: [], banks: [], cardCompanies: [] },
  company: { source: 'none', name: '에스원테크', bizNumber: null, corpNumber: null },
};

function fakeDeps(saveResult: Awaited<ReturnType<TaxSettingsDeps['save']>> = { ok: true, data: RESPONSE }) {
  const calls: unknown[][] = [];
  const deps: TaxSettingsDeps = {
    codeSets: async () => ({
      bizTypes: ['I', 'C'],
      withholdingCycles: ['M', 'H'],
      kinds: ['INVOICE', 'CARD', 'CASH', 'BANK', 'NTAX', 'LTAX', 'SOCIAL', 'LOAN'],
      banks: ['004', '020', '081'],
      cardCompanies: ['KB', 'WOORI'],
    }),
    read: async (s) => {
      calls.push(['read', s.s020OrgId]);
      return RESPONSE;
    },
    save: async (s, save) => {
      calls.push(['save', s.s020OrgId, save]);
      return saveResult;
    },
  };
  return { deps, calls };
}

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

async function build(role: ScopeRole, deps: TaxSettingsDeps): Promise<FastifyInstance> {
  app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.session = session(role);
  });
  registerTaxSettingRoutes(app, deps);
  await app.ready();
  return app;
}

const body = () => ({
  bizType: 'C',
  withholdingCycle: 'H',
  taxEmails: [{ name: '김세무', email: 'tax@example.com' }, { name: '', email: '' }],
  unusedKinds: ['SOCIAL'],
  finAccounts: [{ id: 'acc-1', kind: 'B', bankCode: '004', number: '123-456-7890', alias: '주거래', isActive: true }],
});

describe('GET /tax/settings', () => {
  it('운영사 · 회사 모두 읽는다 — 자기 세션 그대로 넘기고, 캐시하지 않는다', async () => {
    for (const role of ['operator', 'tenant'] as const) {
      const { deps, calls } = fakeDeps();
      const a = await build(role, deps);
      const res = await a.inject({ method: 'GET', url: '/tax/settings' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.json()).toEqual(RESPONSE);
      expect(calls).toEqual([['read', role === 'operator' ? 1 : 9003]]);
      await a.close();
      app = null;
    }
  });
});

describe('PUT /tax/settings — 잘못된 본문은 400, 저장에 닿지 않는다', () => {
  const cases: [string, unknown, string][] = [
    ['본문이 객체가 아님', [], 'body'],
    ['사업자 유형 없음', { ...body(), bizType: '' }, 'bizType'],
    ['코드 표에 없는 원천세 주기', { ...body(), withholdingCycle: 'Q' }, 'withholdingCycle'],
    ['세무사 메일 4개', {
      ...body(),
      taxEmails: [1, 2, 3, 4].map((i) => ({ name: '', email: `m${i}@example.com` })),
    }, 'taxEmails'],
    ['은행 계좌에 카드사', { ...body(), finAccounts: [{ kind: 'B', bankCode: '004', cardCoCode: 'KB', number: '1234567890' }] },
      'finAccounts[0].cardCoCode'],
    ['카드 5자리', { ...body(), finAccounts: [{ kind: 'C', cardCoCode: 'KB', number: '12345' }] }, 'finAccounts[0].number'],
    ['없는 자료 종류', { ...body(), unusedKinds: ['FOO'] }, 'unusedKinds'],
  ];

  for (const [label, payload, field] of cases) {
    it(label, async () => {
      const { deps, calls } = fakeDeps();
      const a = await build('tenant', deps);
      const res = await a.inject({ method: 'PUT', url: '/tax/settings', payload: payload as object });
      expect(res.statusCode).toBe(400);
      const json = res.json();
      expect(json.error).toBe('invalid_request');
      expect(json.errors.map((e: { field: string }) => e.field)).toContain(field);
      expect(json.message).toBe(json.errors[0].message);
      expect(calls).toEqual([]);
    });
  }
});

describe('PUT /tax/settings — 저장', () => {
  it('다듬은 값을 저장으로 넘기고 새 상태를 돌려준다 — 빈 메일 줄은 버리고 계좌번호는 숫자만', async () => {
    const { deps, calls } = fakeDeps();
    const a = await build('operator', deps);
    const res = await a.inject({ method: 'PUT', url: '/tax/settings', payload: body() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(RESPONSE);
    const saved = calls[0]![2] as TaxSettingsSave;
    expect(calls[0]![1]).toBe(1);
    expect(saved.taxEmails).toEqual([{ name: '김세무', email: 'tax@example.com' }]);
    expect(saved.finAccounts[0]!.number).toBe('1234567890');
  });

  it('남의 단체 · 없는 계좌 id 는 404 — 저장이 그렇게 답하면 그대로', async () => {
    const { deps } = fakeDeps({ ok: false, status: 404, message: '없는 계좌 · 카드입니다' });
    const a = await build('tenant', deps);
    const res = await a.inject({ method: 'PUT', url: '/tax/settings', payload: body() });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found', message: '없는 계좌 · 카드입니다' });
  });
});

describe('fillCompanyName — 회사명이 비어 있으면 세션 회사명', () => {
  it('★ 상호가 빈 법무 비입주사도 세션 회사명으로 채운다(source 와 상관없이)', () => {
    const company = { source: 'legal' as const, name: null, bizNumber: '2208162517', corpNumber: null };
    expect(fillCompanyName(company, '에스원테크')).toEqual({ ...company, name: '에스원테크' });
  });
});
