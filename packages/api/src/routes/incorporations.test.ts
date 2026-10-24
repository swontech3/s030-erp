/**
 * `/legal/incorporations` — DB 에 닿기 **전**의 거절(남의 단체 403 · 틀린 조건 · 본문 400).
 *
 * ★ 판정 · SQL · RLS 는 실제 DB 로 잰다(erp_app · 롤백 — 10-6 의 verify 스크립트). 여기서는 대역 `run` 이
 *   불리지 않아야 하는 경로만 본다 — 불리면 시험이 실패한다.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { ErpSession, ScopeRole } from '@swonbiz/shared';
import { registerIncorporationRoutes } from './incorporations.ts';

const session = (role: ScopeRole, s020OrgId: number): ErpSession => ({
  erpSid: 'sid-hash',
  s020MemberId: 1,
  s020OrgId,
  companyId: null,
  role,
  expiresAt: new Date(Date.now() + 60_000),
  lastActiveAt: null,
});

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

async function build(who: ErpSession): Promise<{ a: FastifyInstance; calls: number[] }> {
  const calls: number[] = [];
  app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.session = who;
  });
  registerIncorporationRoutes(app, {
    run: async () => {
      calls.push(1);
      throw new Error('DB 에 닿으면 안 된다');
    },
  });
  await app.ready();
  return { a: app, calls };
}

describe('DB 전 거절', () => {
  it('★ 회사 세션이 남의 단체로 새 건 · 임시 모드 — 403', async () => {
    const { a, calls } = await build(session('tenant', 9003));
    const post = await a.inject({ method: 'POST', url: '/legal/incorporations', payload: { orgId: 9001, info: {} } });
    const draft = await a.inject({ method: 'GET', url: '/legal/incorporations/draft?orgId=9001' });
    expect([post.statusCode, draft.statusCode]).toEqual([403, 403]);
    expect(post.json().message).toBe('자기 회사의 법인설립만 다룰 수 있습니다');
    expect(calls).toEqual([]);
  });

  it('운영사는 단체가 필수 · 틀린 본문은 칸별 오류 400', async () => {
    const { a, calls } = await build(session('operator', 1));
    const noOrg = await a.inject({ method: 'POST', url: '/legal/incorporations', payload: { info: {} } });
    const badBody = await a.inject({ method: 'POST', url: '/legal/incorporations', payload: { orgId: 9003, info: { parValue: 'x' } } });
    expect([noOrg.statusCode, badBody.statusCode]).toEqual([400, 400]);
    expect(badBody.json().errors).toEqual([{ field: 'parValue', message: '1주의 금액은(는) 0 이상의 정수로 입력하세요' }]);
    expect(calls).toEqual([]);
  });

  it('목록 — 모르는 상태는 400', async () => {
    const { a, calls } = await build(session('operator', 1));
    const res = await a.inject({ method: 'GET', url: '/legal/incorporations?status=A' });
    expect(res.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });
});
