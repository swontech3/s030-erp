/**
 * `/legal/doc-form-settings` — 역할 · 본문 · 지우기 키 · 코드 확인 · SQL.
 *
 * ★ DB 에 붙지 않는다. 라우트는 `DocFormSettingDeps` 대역으로, 처리와 SQL 은 가짜 클라이언트로 본다.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { ErpSession, ScopeRole } from '@swonbiz/shared';
import type { DocFormSettingSave, DocFormSettingView } from '@swonbiz/shared/domain/doc-form-setting';
import { readDocFormSettingsOp, registerDocFormSettingRoutes, saveDocFormSettingOp, type DocFormSettingDeps } from './docFormSettings.ts';
import { deleteDocFormSettingOverride } from '../db/docFormSettings.ts';
import type { ScopedClient } from '../db/withCompanyScope.ts';

const session = (role: ScopeRole): ErpSession => ({
  erpSid: 'sid-hash',
  s020MemberId: 7,
  s020OrgId: role === 'operator' ? 1 : 9003,
  companyId: null,
  role,
  expiresAt: new Date(Date.now() + 60_000),
  lastActiveAt: null,
});

const VIEW: DocFormSettingView = {
  companyType: '',
  label: '본점이전',
  formNo: '[양식 제66-1호]',
  matter: null,
  matterBody: null,
  regPurpose: null,
  regReason: null,
  isActive: true,
  taxes: null,
  incorpTax: null,
  attachments: [],
  updatedAt: '2026-10-18 10:00',
};

function fakeDeps(removed = true): DocFormSettingDeps & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    read: async () => {
      calls.push(['read']);
      return { groups: [], companyTypes: [] };
    },
    save: async (_s, save) => {
      calls.push(['save', save]);
      return { ok: true, item: VIEW };
    },
    remove: async (_s, key) => {
      calls.push(['remove', key]);
      return removed;
    },
  };
}

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

async function build(role: ScopeRole, deps: DocFormSettingDeps): Promise<FastifyInstance> {
  app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.session = session(role);
  });
  registerDocFormSettingRoutes(app, deps);
  await app.ready();
  return app;
}

const body = { domain: 'corp-change', regTypeKey: 'HQ', companyType: '', label: ' 본점이전 ', isActive: false };

describe('/legal/doc-form-settings — 운영사만', () => {
  it('★ 회사 세션은 읽기 · 저장 · 지우기 모두 403 — 처리에 닿지 않는다', async () => {
    const deps = fakeDeps();
    const a = await build('tenant', deps);
    const get = await a.inject({ method: 'GET', url: '/legal/doc-form-settings' });
    const put = await a.inject({ method: 'PUT', url: '/legal/doc-form-settings', payload: body });
    const del = await a.inject({ method: 'DELETE', url: '/legal/doc-form-settings/corp-change/HQ/A' });
    expect([get.statusCode, put.statusCode, del.statusCode]).toEqual([403, 403, 403]);
    expect(deps.calls).toEqual([]);
  });

  it('운영사 읽기 — no-store', async () => {
    const a = await build('operator', fakeDeps());
    const res = await a.inject({ method: 'GET', url: '/legal/doc-form-settings' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('운영사 저장 — 다듬은 본문으로 처리에 넘긴다', async () => {
    const deps = fakeDeps();
    const a = await build('operator', deps);
    const res = await a.inject({ method: 'PUT', url: '/legal/doc-form-settings', payload: body });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ item: VIEW });
    expect(deps.calls[0]).toEqual(['save', expect.objectContaining({ label: '본점이전', isActive: false, companyType: '' })]);
  });

  it('틀린 본문은 400 · 칸별 오류', async () => {
    const a = await build('operator', fakeDeps());
    const res = await a.inject({ method: 'PUT', url: '/legal/doc-form-settings', payload: { ...body, label: '' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toEqual([{ field: 'label', message: '기본 줄의 표시명을 입력하세요' }]);
  });

  it('★ 지우기 — 회사유형 줄만. 기본 줄 · 설립 줄은 400, 없는 줄은 404', async () => {
    const deps = fakeDeps();
    const a = await build('operator', deps);
    const ok = await a.inject({ method: 'DELETE', url: '/legal/doc-form-settings/corp-change/HQ/A' });
    expect(ok.statusCode).toBe(200);
    expect(deps.calls).toEqual([['remove', { domain: 'corp-change', regTypeKey: 'HQ', companyType: 'A' }]]);
    // 기본 줄은 주소에 빈 칸을 둘 수 없다 — 「''」 대신 무엇을 넣어도 회사유형 검사에서 걸린다
    const base = await a.inject({ method: 'DELETE', url: '/legal/doc-form-settings/corp-change/HQ/X' });
    const inc = await a.inject({ method: 'DELETE', url: '/legal/doc-form-settings/incorporation/R_PROMOTER/R' });
    expect([base.statusCode, inc.statusCode]).toEqual([400, 400]);

    const none = await build('operator', fakeDeps(false));
    expect((await none.inject({ method: 'DELETE', url: '/legal/doc-form-settings/corp-change/HQ/R' })).statusCode).toBe(404);
  });
});

/** 가짜 클라이언트 — SQL 앞머리로 갈래를 고른다. */
function fakeClient(codes: { category: string; code: string; name: string; sort_order: number }[], rows: Record<string, unknown>[] = []) {
  const sql: { text: string; params: unknown[] }[] = [];
  const client = {
    query: async (text: string, params: unknown[] = []) => {
      sql.push({ text, params });
      if (/tb_s080_codes_line/.test(text)) {
        const [cats] = params as [string[]];
        return { rows: codes.filter((c) => cats.includes(c.category)) };
      }
      if (/^\s*SELECT/.test(text)) return { rows };
      if (/^\s*INSERT/.test(text)) {
        return {
          rows: [
            {
              domain: params[2], reg_type_key: params[3], company_type: params[4], label: params[5], form_no: params[6],
              matter: params[7], matter_body: params[8], reg_purpose: params[9], reg_reason: params[10], is_active: params[11],
              taxes: params[13] === null ? null : JSON.parse(params[13] as string),
              attachments: params[14] === null ? null : JSON.parse(params[14] as string),
              updated_at: '2026-10-18 10:00',
            },
          ],
        };
      }
      if (/^\s*DELETE/.test(text)) return { rows: params[3] === 'A' ? [{ id: 'x' }] : [] };
      return { rows: [] };
    },
  };
  return { client: client as unknown as ScopedClient, sql };
}

const CODES = [
  { category: 'LAW_CNG_TP', code: 'NAME', name: '상호변경', sort_order: 1 },
  { category: 'LAW_CNG_TP', code: 'PURPOSE', name: '목적변경', sort_order: 3 },
  { category: 'LAW_CNG_TP', code: 'HQ', name: '본점이전', sort_order: 2 },
  { category: 'LAW_EST_TP', code: 'R_PROMOTER', name: '주식회사 발기설립', sort_order: 1 },
  { category: 'MEMBER_TYPE', code: 'R', name: '주식회사', sort_order: 1 },
  { category: 'MEMBER_TYPE', code: 'A', name: '유한회사', sort_order: 2 },
];

const save = (o: Partial<DocFormSettingSave>): DocFormSettingSave => ({
  domain: 'corp-change',
  regTypeKey: 'HQ',
  companyType: '',
  label: '본점이전',
  formNo: null,
  regPurpose: null,
  regReason: null,
  matter: '본점을 이전한 뜻',
  matterBody: null,
  isActive: true,
  taxes: { regLicense: 112_500, localEdu: 22_500, regFee: 7_000 },
  incorpTax: null,
  attachments: [{ name: '정관', copies: 1 }],
  ...o,
});

describe('처리 — 목록 · 저장 · 지우기', () => {
  it('목록 — 구분별 코드에 줄을 붙이고, 세금은 구분의 모양만 읽는다', async () => {
    const TAX = { regLicenseRate: 4, regLicenseMin: 112_500, metroMultiplier: 3, localEduRate: 20, regFee: 35_000 };
    const { client } = fakeClient(CODES, [
      { domain: 'corp-change', reg_type_key: 'NAME', company_type: '', label: '상호', is_active: true, taxes: { regLicense: 40_200, localEdu: 8_040, regFee: 4_000 }, attachments: ['정관'], updated_at: 't' },
      { domain: 'incorporation', reg_type_key: 'R_PROMOTER', company_type: '', label: '발기설립', is_active: true, taxes: TAX, attachments: null, updated_at: 't' },
    ]);
    const out = await readDocFormSettingsOp(client);
    expect(out.companyTypes).toEqual([{ code: 'R', name: '주식회사' }, { code: 'A', name: '유한회사' }]);
    expect(out.groups.map((g) => [g.domain, g.items.map((i) => i.code)])).toEqual([
      ['corp-change', ['NAME', 'PURPOSE', 'HQ']],
      ['incorporation', ['R_PROMOTER']],
    ]);
    const name = out.groups[0]!.items[0]!.rows[0]!;
    expect(name).toMatchObject({ taxes: { regLicense: 40_200 }, incorpTax: null, attachments: [{ name: '정관', copies: 1 }] });
    expect(out.groups[1]!.items[0]!.rows[0]).toMatchObject({ taxes: null, incorpTax: TAX, attachments: [] });
  });

  it('★ 저장 — 그 분류의 살아 있는 코드가 아니면 400(SQL 을 쓰지 않는다)', async () => {
    const { client, sql } = fakeClient(CODES);
    const r = await saveDocFormSettingOp(client, save({ regTypeKey: 'CEO_CHG' }), '7');
    expect(r).toMatchObject({ ok: false, status: 400, field: 'regTypeKey' });
    expect(sql.some((s) => /^\s*INSERT/.test(s.text))).toBe(false);
  });

  it('★ 저장 SQL — 고유 키 upsert · 새 줄 tax_mode 는 구분으로 · 설립은 등기할 사항을 덮지 않는다 · 수정자', async () => {
    const { client, sql } = fakeClient(CODES);
    const r = await saveDocFormSettingOp(client, save({}), '7');
    expect(r).toMatchObject({ ok: true, item: { label: '본점이전', taxes: { regLicense: 112_500 }, attachments: [{ name: '정관', copies: 1 }] } });
    const insert = sql.find((s) => /^\s*INSERT/.test(s.text))!;
    expect(insert.text).toMatch(/ON CONFLICT \(operator_id, domain, reg_type_key, company_type\) DO UPDATE/);
    expect(insert.text).toMatch(/matter = CASE WHEN t\.domain = 'incorporation' THEN t\.matter ELSE EXCLUDED\.matter END/);
    expect(insert.text).not.toMatch(/tax_mode = /);
    expect(insert.text).not.toMatch(/form_template_id|custom_tokens|sort_order/);
    expect(insert.params[12]).toBe('fixed');
    expect(insert.params[15]).toBe('7');

    const inc = fakeClient(CODES);
    const TAX = { regLicenseRate: 4, regLicenseMin: 112_500, metroMultiplier: 3, localEduRate: 20, regFee: 35_000 };
    await saveDocFormSettingOp(inc.client, save({ domain: 'incorporation', regTypeKey: 'R_PROMOTER', matter: null, taxes: null, incorpTax: TAX }), '7');
    const p = inc.sql.find((s) => /^\s*INSERT/.test(s.text))!.params;
    expect(p[12]).toBe('computed');
    expect(JSON.parse(p[13] as string)).toEqual(TAX);
  });

  it('지우기 SQL — 기본 줄은 SQL 에서도 지우지 않는다', async () => {
    const { client, sql } = fakeClient(CODES);
    expect(await deleteDocFormSettingOverride(client, { domain: 'corp-change', regTypeKey: 'HQ', companyType: 'A' })).toBe(true);
    expect(sql[0]!.text).toMatch(/company_type <> ''/);
  });
});
