/**
 * 법무 회사별 정관 파일(결정 2026-11-07) — 권한 · 남의 단체 · 올리기 순서 · 바꿀 때 이전 실물 지우기 · 설립 건 바로가기.
 * DB · 저장소 · 삐용은 대역이다. RLS(050)는 개발 DB 에서 erp_app 로 따로 확인했다(배포 문서 §6-1 16).
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { ErpSession, ScopeRole } from '@swonbiz/shared';
import { ALLOWED_MIME_TYPES, MAX_FILE_BYTES } from '@swonbiz/shared/domain/contract-files';
import { registerLegalArticlesFileRoutes, type LegalArticlesFileDeps } from './legalArticlesFile.ts';

const session = (role: ScopeRole, s020OrgId: number): ErpSession => ({
  erpSid: 'sid-hash',
  s020MemberId: 7,
  s020OrgId,
  companyId: null,
  role,
  expiresAt: new Date(Date.now() + 60_000),
  lastActiveAt: null,
});

const TENANT = /FROM public\.tb_s080_companies\s+WHERE link_s020_org_id/;
const FIND_FILE = /SELECT[\s\S]*FROM public\.tb_cm_file/;
const DEL_FILE = /DELETE FROM public\.tb_cm_file/;
const INS_FILE = /INSERT INTO public\.tb_cm_file/;
const OPERATORS = /FROM public\.tb_s080_tenant010/;
const BUILDING_OPERATOR = /JOIN public\.tb_s080_buildings/;
const INCORP = /FROM public\.tb_s080_incorporations/;

const OLD_ROW = {
  id: 'old-1',
  target_type: 'LEGAL_ORG',
  target_id: '9003',
  file_purpose: 'ARTICLES',
  original_name: '옛 정관.pdf',
  storage_path: '1/legal-orgs/9003/ARTICLES/old-1.pdf',
  file_size: 10,
  mime_type: 'application/pdf',
  created_at: new Date('2026-11-01T00:00:00Z'),
};

type Answer = { match: RegExp; rows: unknown[] };

function fake(opts: { answers?: Answer[]; editor?: boolean; failInsert?: boolean } = {}) {
  const seen: { sql: string; params: unknown[] }[] = [];
  /** 일어난 순서 — 저장소 · DB 를 한 줄로 */
  const order: string[] = [];
  let runs = 0;
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      seen.push({ sql, params: params ?? [] });
      if (DEL_FILE.test(sql)) order.push('db:delete');
      if (INS_FILE.test(sql)) {
        order.push('db:insert');
        if (opts.failInsert) throw new Error('insert 실패');
      }
      const hit = (opts.answers ?? []).find((a) => a.match.test(sql));
      return { rows: hit ? hit.rows : [], rowCount: hit ? hit.rows.length : 0 };
    },
  };
  const deps: LegalArticlesFileDeps = {
    run: async (_s, fn) => {
      runs += 1;
      return fn(client as never);
    },
    companyEditor: async (s) => s.role === 'operator' || (opts.editor ?? false),
    putObject: async ({ path }) => {
      order.push(`put:${path}`);
    },
    removeObject: async (path) => {
      order.push(`remove:${path}`);
    },
    signedUrl: async (path) => `https://signed/${path}`,
  };
  return { deps, seen, order, runs: () => runs };
}

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

async function build(who: ErpSession, deps: LegalArticlesFileDeps): Promise<FastifyInstance> {
  app = Fastify();
  // index.ts 와 같은 파서 — 허용 형식만 바이트로 받는다
  app.addContentTypeParser([...ALLOWED_MIME_TYPES], { parseAs: 'buffer', bodyLimit: MAX_FILE_BYTES }, (_req, body, done) =>
    done(null, body),
  );
  app.addHook('onRequest', async (req) => {
    req.session = who;
  });
  registerLegalArticlesFileRoutes(app, deps);
  await app.ready();
  return app;
}

const upload = (a: FastifyInstance, orgId: number, opts: { type?: string; body?: Buffer; name?: string } = {}) =>
  a.inject({
    method: 'POST',
    url: `/legal/orgs/${orgId}/articles-file`,
    headers: { 'content-type': opts.type ?? 'application/pdf', 'x-file-name': encodeURIComponent(opts.name ?? '정관.pdf') },
    payload: opts.body ?? Buffer.from('%PDF-1'),
  });

const ONE_OPERATOR: Answer = { match: OPERATORS, rows: [{ operator_id: 1 }] };

describe('비입주사 — 올리기 · 보기 · 바꾸기', () => {
  it('운영사 — 빈 상태(올릴 수 있음) → 올리기: 실물 → DB(지우고 넣기) 순서 · 경로 · 이전 파일 없음', async () => {
    const f = fake({ answers: [ONE_OPERATOR] });
    const a = await build(session('operator', 1), f.deps);
    const view = (await a.inject({ method: 'GET', url: '/legal/orgs/9003/articles-file' })).json();
    expect(view).toEqual({ file: null, canUpload: true, completedIncorporationId: null });

    const res = await upload(a, 9003);
    expect(res.statusCode).toBe(200);
    expect(f.order).toHaveLength(3);
    expect(f.order[0]).toMatch(/^put:1\/legal-orgs\/9003\/ARTICLES\/[0-9a-f-]{36}\.pdf$/);
    expect(f.order.slice(1)).toEqual(['db:delete', 'db:insert']);
    const ins = f.seen.find((s) => INS_FILE.test(s.sql))!;
    // id, target_type, target_id, purpose, 원본 이름, 경로, 크기, 형식, 운영사, 올린 사람
    expect(ins.params.slice(1, 5)).toEqual(['LEGAL_ORG', '9003', 'ARTICLES', '정관.pdf']);
    expect(ins.params.slice(6)).toEqual([6, 'application/pdf', 1, '7']);
  });

  it('★ 바꾸기 — 커밋 뒤 이전 실물을 지운다(이력 없음)', async () => {
    const f = fake({ answers: [ONE_OPERATOR, { match: DEL_FILE, rows: [OLD_ROW] }] });
    const a = await build(session('operator', 1), f.deps);
    expect((await upload(a, 9003)).statusCode).toBe(200);
    expect(f.order.slice(1)).toEqual(['db:delete', 'db:insert', `remove:${OLD_ROW.storage_path}`]);
  });

  it('★ DB 기록이 실패하면 방금 올린 실물을 지운다 · 이전 실물은 그대로', async () => {
    const f = fake({ answers: [ONE_OPERATOR, { match: DEL_FILE, rows: [OLD_ROW] }], failInsert: true });
    const a = await build(session('operator', 1), f.deps);
    expect((await upload(a, 9003)).statusCode).toBe(500);
    const put = f.order[0]!.slice('put:'.length);
    expect(f.order).toEqual([`put:${put}`, 'db:delete', 'db:insert', `remove:${put}`]);
  });

  it('보기 — 올려 둔 파일 정보 · 주소는 따로(no-store) · 없으면 404', async () => {
    const f = fake({ answers: [{ match: FIND_FILE, rows: [OLD_ROW] }] });
    const a = await build(session('tenant', 9003), f.deps);
    const view = (await a.inject({ method: 'GET', url: '/legal/orgs/9003/articles-file' })).json();
    expect(view.file).toEqual({
      fileId: 'old-1',
      originalName: '옛 정관.pdf',
      fileSize: 10,
      mimeType: 'application/pdf',
      uploadedAt: '2026-11-01T00:00:00.000Z',
    });
    expect(view.canUpload).toBe(false);
    const url = await a.inject({ method: 'GET', url: '/legal/orgs/9003/articles-file/url' });
    expect(url.headers['cache-control']).toBe('no-store');
    expect(url.json()).toEqual({ url: `https://signed/${OLD_ROW.storage_path}`, originalName: '옛 정관.pdf' });

    const none = fake();
    const b = await build(session('operator', 1), none.deps);
    expect((await b.inject({ method: 'GET', url: '/legal/orgs/9003/articles-file/url' })).statusCode).toBe(404);
  });

  it('회사 사용자 — 수정 권한 있으면 올린다 · 없으면 보기만(403 · 저장소 · DB 안 건드림)', async () => {
    const yes = fake({ answers: [ONE_OPERATOR], editor: true });
    const a = await build(session('tenant', 9003), yes.deps);
    expect((await a.inject({ method: 'GET', url: '/legal/orgs/9003/articles-file' })).json().canUpload).toBe(true);
    expect((await upload(a, 9003)).statusCode).toBe(200);
    await a.close();
    app = null;

    const no = fake({ answers: [ONE_OPERATOR] });
    const b = await build(session('tenant', 9003), no.deps);
    const res = await upload(b, 9003);
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toBe('정관 파일은 운영사 또는 회사 정보 수정 권한이 있는 사람만 올릴 수 있습니다');
    expect(no.order).toEqual([]);
  });

  it('운영사가 둘 이상이면 아무 번호나 고르지 않는다 — 400 · 아무것도 안 쓴다(결정 「가」)', async () => {
    const f = fake({ answers: [{ match: OPERATORS, rows: [{ operator_id: 1 }, { operator_id: 2 }] }] });
    const a = await build(session('operator', 1), f.deps);
    const res = await upload(a, 9003);
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('이 회사의 운영사를 확인할 수 없습니다');
    expect(f.order).toEqual([]);
  });

  it('형식 · 크기 — 기존 첨부 규칙(JPG · PNG · PDF · 빈 파일 거절)', async () => {
    const f = fake({ answers: [ONE_OPERATOR] });
    const a = await build(session('operator', 1), f.deps);
    expect((await upload(a, 9003, { type: 'text/plain', body: Buffer.from('x') })).statusCode).toBe(415);
    const empty = await upload(a, 9003, { body: Buffer.alloc(0) });
    expect(empty.statusCode).toBe(400);
    expect((await upload(a, 9003, { type: 'image/png', body: Buffer.from('png') })).statusCode).toBe(200);
    expect(f.order[0]).toMatch(/\.png$/);
  });
});

describe('입주사 — 운영사만 올린다 · 회사 사람은 보기', () => {
  const TENANT_ROW: Answer = { match: TENANT, rows: [{ company_id: 'c-1' }] };

  it('운영사 — 운영사 번호는 회사 → 건물에서', async () => {
    const f = fake({ answers: [TENANT_ROW, { match: BUILDING_OPERATOR, rows: [{ operator_id: 1 }] }] });
    const a = await build(session('operator', 1), f.deps);
    expect((await a.inject({ method: 'GET', url: '/legal/orgs/9001/articles-file' })).json().canUpload).toBe(true);
    expect((await upload(a, 9001)).statusCode).toBe(200);
    expect(f.seen.some((s) => OPERATORS.test(s.sql))).toBe(false);
  });

  it('회사 사람 — 수정 권한이 있어도 올리지 못한다(403) · 보기는 된다', async () => {
    const f = fake({ answers: [TENANT_ROW, { match: FIND_FILE, rows: [{ ...OLD_ROW, target_id: '9001' }] }], editor: true });
    const a = await build(session('tenant', 9001), f.deps);
    const view = (await a.inject({ method: 'GET', url: '/legal/orgs/9001/articles-file' })).json();
    expect(view.canUpload).toBe(false);
    expect(view.file.originalName).toBe('옛 정관.pdf');
    expect((await a.inject({ method: 'GET', url: '/legal/orgs/9001/articles-file/url' })).statusCode).toBe(200);
    expect((await upload(a, 9001)).statusCode).toBe(403);
    expect(f.order).toEqual([]);
  });
});

describe('★★ 남의 단체 — 403 (DB 에 닿기 전)', () => {
  it.each([
    ['GET', '/legal/orgs/9001/articles-file'],
    ['GET', '/legal/orgs/9001/articles-file/url'],
  ] as const)('%s %s', async (method, url) => {
    const f = fake({ editor: true });
    const a = await build(session('tenant', 9003), f.deps);
    expect((await a.inject({ method, url })).statusCode).toBe(403);
    expect(f.runs()).toBe(0);
  });
  it('POST — 수정 권한이 있어도 남의 단체에는 못 올린다', async () => {
    const f = fake({ answers: [ONE_OPERATOR], editor: true });
    const a = await build(session('tenant', 9003), f.deps);
    expect((await upload(a, 9001)).statusCode).toBe(403);
    expect(f.runs()).toBe(0);
    expect(f.order).toEqual([]);
  });
});

describe('설립 건 바로가기', () => {
  it('완료된 설립 건이 있으면 그 id(가장 최근 완료 하나) · 그 단체로 찾는다', async () => {
    const f = fake({ answers: [{ match: INCORP, rows: [{ id: '16f561dd-87c2-4203-a571-4a4b14576f17' }] }] });
    const a = await build(session('tenant', 1344), f.deps);
    const view = (await a.inject({ method: 'GET', url: '/legal/orgs/1344/articles-file' })).json();
    expect(view.completedIncorporationId).toBe('16f561dd-87c2-4203-a571-4a4b14576f17');
    const q = f.seen.find((s) => INCORP.test(s.sql))!;
    expect(q.params).toEqual([1344]);
    expect(q.sql).toMatch(/status = 'C'/);
  });
});
