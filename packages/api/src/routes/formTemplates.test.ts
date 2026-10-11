/**
 * 표양식 관리 라우트 — 법무 표시 삭제 막기 · 목록의 `legal` · 법무 선택지(5-3, 2026-10-11).
 *
 * ★ DB 에 붙지 않는다. `withCompanyScope` 를 SQL 로 답을 고르는 가짜 클라이언트로 바꾼다.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ErpSession, ScopeRole } from '@swonbiz/shared';

interface Seen {
  sql: string;
  params: unknown[];
}
const state: { answers: { match: RegExp; rows: unknown[] }[]; seen: Seen[] } = { answers: [], seen: [] };

vi.mock('../db/withCompanyScope.ts', () => ({
  withCompanyScope: async (_scope: unknown, fn: (c: unknown) => Promise<unknown>) =>
    fn({
      query: async (sql: string, params?: unknown[]) => {
        state.seen.push({ sql, params: params ?? [] });
        const hit = state.answers.find((a) => a.match.test(sql));
        return { rows: hit ? hit.rows : [], rowCount: hit ? hit.rows.length : 0 };
      },
    }),
}));

const { registerFormTemplateRoutes } = await import('./formTemplates.ts');

const session = (role: ScopeRole): ErpSession => ({
  erpSid: 'sid-hash',
  s020MemberId: 1,
  s020OrgId: 1,
  companyId: null,
  role,
  expiresAt: new Date(Date.now() + 60_000),
  lastActiveAt: null,
});

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
  state.answers = [];
  state.seen = [];
});

async function build(role: ScopeRole = 'operator'): Promise<FastifyInstance> {
  app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.session = session(role);
  });
  registerFormTemplateRoutes(app);
  await app.ready();
  return app;
}

const CODES = {
  match: /FROM public\.tb_s080_codes_line/,
  rows: [
    { category: 'LAW_DOC_TP', code: 'T', name: '표' },
    { category: 'LAW_CNG_TP', code: 'NAME', name: '상호 목적 공고방법변경' },
    { category: 'LAW_CNG_TP', code: 'CEO_CHG', name: '대표이사변경' },
    { category: 'LAW_CNG_TP', code: 'OFFICER', name: '임원변경' },
    { category: 'MEMBER_TYPE', code: 'R', name: '주식회사' },
    { category: 'MEMBER_TYPE', code: 'A', name: '유한회사' },
  ],
};
const row = (over: Record<string, unknown> = {}) => ({
  id: 'f-1',
  name: '법인변경등록1',
  description: null,
  kind: 'T',
  updated_on: '2026-10-11',
  legal: false,
  definition: { version: 2, font: { family: '굴림', size: 9 }, pages: [{ colWidths: [3], rowHeights: [1], cells: [] }] },
  ...over,
});
const FIND = (r: unknown) => ({ match: /FROM public\.tb_s080_form_templates t\s+WHERE t\.id/, rows: r ? [r] : [] });
const DELETED = /DELETE FROM public\.tb_s080_form_templates/;

describe('DELETE /form-templates/:id — 결정 E', () => {
  it('★★ 법무 표시가 붙은 양식은 409 — 지우는 문장을 보내지 않는다', async () => {
    state.answers = [FIND(row({ legal: true }))];
    const res = await (await build()).inject({ method: 'DELETE', url: '/form-templates/f-1' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: 'in_use',
      message: '법무 표시가 붙은 양식이라 지울 수 없습니다 — 양식 편집에서 법무 표시를 뗀 뒤 지워 주세요',
    });
    expect(state.seen.some((s) => DELETED.test(s.sql))).toBe(false);
  });

  it('★ 표시가 없으면 지운다 — 등기 설정 연결은 더 보지 않는다 · 문장에도 표시 조건', async () => {
    state.answers = [FIND(row()), { match: DELETED, rows: [{}] }];
    const res = await (await build()).inject({ method: 'DELETE', url: '/form-templates/f-1' });
    expect(res.statusCode).toBe(200);
    expect(state.seen.some((s) => /tb_s080_doc_form_settings/.test(s.sql))).toBe(false);
    expect(state.seen.find((s) => DELETED.test(s.sql))!.sql).toMatch(/NOT \(definition \? 'legal'\)/);
  });

  it('없는 양식은 404', async () => {
    state.answers = [FIND(null)];
    const res = await (await build()).inject({ method: 'DELETE', url: '/form-templates/f-1' });
    expect(res.statusCode).toBe(404);
  });

  it('운영사만', async () => {
    const res = await (await build('tenant')).inject({ method: 'DELETE', url: '/form-templates/f-1' });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /form-templates — 목록의 legal · 법무 선택지', () => {
  it('목록에 legal · 선택지는 앱이 아는 값만(CEO_CHG 없음)', async () => {
    state.answers = [{ match: /ORDER BY t\.updated_at/, rows: [row({ legal: true })] }, CODES];
    const body = (await (await build()).inject({ method: 'GET', url: '/form-templates' })).json();
    expect(body.templates[0].legal).toBe(true);
    expect(body.templates[0].linkCount).toBeUndefined();
    expect(body.legalOptions).toEqual({
      changeTypes: [
        { code: 'NAME', name: '상호 목적 공고방법변경' },
        { code: 'OFFICER', name: '임원변경' },
      ],
      companyTypes: [
        { code: 'R', name: '주식회사' },
        { code: 'A', name: '유한회사' },
      ],
    });
  });

  it('양식 하나에도 선택지 · 표시가 실린다', async () => {
    const legal = { domain: 'corp-change', changeTypes: ['OFFICER'], companyType: 'ALL', unit: 'officer', officerKinds: ['REELECT'] };
    state.answers = [FIND(row({ legal: true, definition: { ...row().definition, legal } })), CODES];
    const body = (await (await build()).inject({ method: 'GET', url: '/form-templates/f-1' })).json();
    expect(body.template.definition.legal).toEqual(legal);
    expect(body.legalOptions.changeTypes).toHaveLength(2);
  });
});

describe('PATCH /form-templates/:id — 법무 표시 검사', () => {
  it('틀린 표시는 400 — 사유를 그대로', async () => {
    state.answers = [CODES];
    const res = await (await build()).inject({
      method: 'PATCH',
      url: '/form-templates/f-1',
      payload: {
        name: '중임승낙서',
        kind: 'T',
        definition: { ...row().definition, legal: { domain: 'corp-change', changeTypes: ['HQ'], companyType: 'ALL', unit: 'officer', officerKinds: ['REELECT'] } },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain('임원마다 한 장인 양식은 임원변경에만 붙일 수 있습니다');
  });
});

describe('POST /form-templates/:id/duplicate — 복사본은 법무 표시 없음(결정 2026-10-11)', () => {
  it('★ 표시를 떼고 넣는다 · 나머지 정의(레거시 dataSource 포함)는 그대로', async () => {
    const legal = { domain: 'corp-change', changeTypes: ['OFFICER'], companyType: 'ALL', unit: 'officer', officerKinds: ['REELECT'] };
    const definition = { ...row().definition, dataSource: 'corp-change', legal };
    state.answers = [FIND(row({ legal: true, definition })), { match: /INSERT INTO public\.tb_s080_form_templates/, rows: [] }];
    const res = await (await build()).inject({ method: 'POST', url: '/form-templates/f-1/duplicate' });
    expect(res.statusCode).toBe(201);
    const ins = state.seen.find((s) => /INSERT INTO public\.tb_s080_form_templates/.test(s.sql))!;
    expect(ins.params[2]).toBe('법인변경등록1 (복사본)');
    const saved = JSON.parse(ins.params[5] as string);
    expect(saved.legal).toBeUndefined();
    expect(saved.dataSource).toBe('corp-change');
    expect(saved.pages).toEqual(definition.pages);
  });
});
