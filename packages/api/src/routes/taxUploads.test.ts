/**
 * `/tax/uploads` — 본문 해석(400) · 엑셀 본문 형식 · 409 · 404 · 세션 단체를 그대로 넘기는지.
 *
 * ★ DB 에 붙지 않는다. 라우트는 `TaxUploadsDeps` 대역으로 본다. 단체 범위 · 중복 · 거래처 등록은
 *   `scripts/verify-tax-uploads.js` 가 실제 DB 에서 잰다.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { ErpSession, ScopeRole } from '@swonbiz/shared';
import type { TaxUploadPreview, TaxUploadsResponse } from '@swonbiz/shared/domain/tax-uploads';
import { registerSpreadsheetBodyParser, registerTaxUploadRoutes, type TaxUploadsDeps } from './taxUploads.ts';

const session = (role: ScopeRole): ErpSession => ({
  erpSid: 'sid-hash',
  s020MemberId: 7,
  s020OrgId: role === 'operator' ? 1 : 9001,
  companyId: null,
  role,
  expiresAt: new Date(Date.now() + 60_000),
  lastActiveAt: null,
});

const LIST: TaxUploadsResponse = { month: '2026-09', bizTypeName: null, cards: [], files: [], codes: { kinds: [], invDirs: [] } };
const EXCLUDED = { nonGeneral: 0, noBizNo: 0, badAmount: 0, noApproval: 0, dupInFile: 0, otherClass: 0, badDate: 0 };
const PREVIEW: TaxUploadPreview = {
  kind: 'INVOICE', fileName: 'a.xls', direction: 'S', sameFile: null, totalRows: 0, byMonth: [], sample: [],
  toInsert: 0, alreadyUploaded: 0, alreadyWhere: [], excluded: EXCLUDED, skipReasons: [], warnings: [],
};
const XLS = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
const XLS_TYPE = 'application/vnd.ms-excel';

function fakeDeps(over: Partial<TaxUploadsDeps> = {}) {
  const calls: unknown[][] = [];
  const deps: TaxUploadsDeps = {
    list: async (s, month) => { calls.push(['list', s.s020OrgId, month]); return LIST; },
    preview: async (s, kind, name, bytes) => { calls.push(['preview', s.s020OrgId, kind, name, bytes.length]); return { ok: true, data: PREVIEW }; },
    upload: async (s, kind, name) => {
      calls.push(['upload', s.s020OrgId, kind, name]);
      return { ok: false, status: 409, error: 'same_file', message: '이미 올린 파일입니다' };
    },
    remove: async (s, ids, dryRun) => {
      calls.push([dryRun ? 'check' : 'remove', s.s020OrgId, ids]);
      return { ok: false, status: 404, error: 'not_found', message: '없는 파일입니다' };
    },
    template: async (s, kind) => {
      calls.push(['template', s.s020OrgId, kind]);
      return { ok: true, data: { fileName: '현금경비_양식.xlsx', bytes: new Uint8Array([0x50, 0x4b, 3, 4]) } };
    },
    ...over,
  };
  return { deps, calls };
}

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

async function build(role: ScopeRole, deps: TaxUploadsDeps): Promise<FastifyInstance> {
  app = Fastify();
  registerSpreadsheetBodyParser(app);
  app.addHook('onRequest', async (req) => {
    req.session = session(role);
  });
  registerTaxUploadRoutes(app, deps);
  await app.ready();
  return app;
}

describe('GET /tax/uploads', () => {
  it('달을 받아 세션 단체로 읽는다 · 캐시하지 않는다', async () => {
    const { deps, calls } = fakeDeps();
    const a = await build('operator', deps);
    const res = await a.inject({ method: 'GET', url: '/tax/uploads?month=2026-09' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(calls).toEqual([['list', 1, '2026-09']]);
  });

  it('달이 없거나 틀리면 400 + errors', async () => {
    const { deps, calls } = fakeDeps();
    const a = await build('tenant', deps);
    for (const url of ['/tax/uploads', '/tax/uploads?month=2026-13', '/tax/uploads?month=202609']) {
      const res = await a.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'invalid_request', errors: [{ field: 'month' }] });
    }
    expect(calls).toEqual([]);
  });
});

describe('POST /tax/uploads/preview · /tax/uploads — 엑셀 본문', () => {
  const post = (a: FastifyInstance, url: string, headers: Record<string, string>, payload: Buffer | string) =>
    a.inject({ method: 'POST', url, headers, payload });

  it('엑셀 본문 · 파일 이름(인코딩)을 세션 단체와 함께 넘긴다', async () => {
    const { deps, calls } = fakeDeps();
    const a = await build('tenant', deps);
    const res = await post(a, '/tax/uploads/preview?kind=INVOICE',
      { 'content-type': XLS_TYPE, 'x-file-name': encodeURIComponent('매출 목록.xls') }, XLS);
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([['preview', 9001, 'INVOICE', '매출 목록.xls', XLS.length]]);
  });

  it('★ 카드 사용 내역 · 현금 경비도 받는다(1-4) — 종류를 그대로 넘긴다', async () => {
    const { deps, calls } = fakeDeps();
    const a = await build('tenant', deps);
    const card = await post(a, '/tax/uploads/preview?kind=CARD', { 'content-type': XLS_TYPE, 'x-file-name': 'card.xls' }, XLS);
    const cash = await post(a, '/tax/uploads?kind=CASH', { 'content-type': XLS_TYPE, 'x-file-name': 'cash.xls' }, XLS);
    expect(card.statusCode).toBe(200);
    expect(cash.statusCode).toBe(409);
    expect(calls).toEqual([['preview', 9001, 'CARD', 'card.xls', XLS.length], ['upload', 9001, 'CASH', 'cash.xls']]);
  });

  it('아직 올릴 수 없는 종류 · 종류 없음은 400', async () => {
    const { deps, calls } = fakeDeps();
    const a = await build('tenant', deps);
    for (const url of ['/tax/uploads/preview?kind=BANK', '/tax/uploads/preview', '/tax/uploads?kind=NTAX']) {
      const res = await post(a, url, { 'content-type': XLS_TYPE, 'x-file-name': 'a.xls' }, XLS);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ errors: [{ field: 'kind' }] });
    }
    expect(calls).toEqual([]);
  });

  it('파일 이름이 없으면 400', async () => {
    const { deps } = fakeDeps();
    const a = await build('tenant', deps);
    const res = await post(a, '/tax/uploads/preview?kind=INVOICE', { 'content-type': XLS_TYPE }, XLS);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ errors: [{ field: 'fileName' }] });
  });

  it('엑셀이 아닌 본문 형식은 415 — 라우트까지 오지 않는다', async () => {
    const { deps, calls } = fakeDeps();
    const a = await build('tenant', deps);
    const res = await post(a, '/tax/uploads/preview?kind=INVOICE', { 'content-type': 'text/csv', 'x-file-name': 'a.csv' }, 'a,b');
    expect(res.statusCode).toBe(415);
    expect(calls).toEqual([]);
  });

  it('5MB 를 넘는 본문은 413', async () => {
    const { deps, calls } = fakeDeps();
    const a = await build('tenant', deps);
    const res = await post(a, '/tax/uploads/preview?kind=INVOICE',
      { 'content-type': XLS_TYPE, 'x-file-name': 'a.xls' }, Buffer.alloc(5 * 1024 * 1024 + 1));
    expect(res.statusCode).toBe(413);
    expect(calls).toEqual([]);
  });

  it('미리보기의 400(양식 · 판정)을 그대로 돌려준다', async () => {
    const { deps } = fakeDeps({
      preview: async () => ({ ok: false, status: 400, error: 'format_mismatch', message: '양식이 맞지 않습니다' }),
    });
    const a = await build('tenant', deps);
    const res = await post(a, '/tax/uploads/preview?kind=INVOICE', { 'content-type': XLS_TYPE, 'x-file-name': 'a.xls' }, XLS);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'format_mismatch', message: '양식이 맞지 않습니다' });
  });

  it('같은 파일 올리기는 409', async () => {
    const { deps, calls } = fakeDeps();
    const a = await build('operator', deps);
    const res = await post(a, '/tax/uploads?kind=INVOICE', { 'content-type': XLS_TYPE, 'x-file-name': 'a.xls' }, XLS);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'same_file' });
    expect(calls).toEqual([['upload', 1, 'INVOICE', 'a.xls']]);
  });
});

describe('GET /tax/uploads/template — 표준 양식 내려받기(1-4)', () => {
  it('현금 경비 양식을 세션 단체로 만들어 엑셀로 보낸다', async () => {
    const { deps, calls } = fakeDeps();
    const a = await build('tenant', deps);
    const res = await a.inject({ method: 'GET', url: '/tax/uploads/template?kind=CASH' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers['content-disposition']).toContain(`filename*=UTF-8''${encodeURIComponent('현금경비_양식.xlsx')}`);
    expect(calls).toEqual([['template', 9001, 'CASH']]);
  });

  it('표준 양식이 없는 종류(홈택스 파일 그대로인 계산서 · 카드) · 종류 없음은 400', async () => {
    const { deps, calls } = fakeDeps();
    const a = await build('tenant', deps);
    for (const url of ['/tax/uploads/template?kind=CARD', '/tax/uploads/template?kind=INVOICE', '/tax/uploads/template']) {
      const res = await a.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ errors: [{ field: 'kind' }] });
    }
    expect(calls).toEqual([]);
  });
});

describe('POST /tax/uploads/delete', () => {
  it('ids 가 없으면 400 + errors', async () => {
    const { deps, calls } = fakeDeps();
    const a = await build('tenant', deps);
    for (const payload of [{}, { ids: [] }, { ids: [3] }]) {
      const res = await a.inject({ method: 'POST', url: '/tax/uploads/delete', payload });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ errors: [{ field: 'ids' }] });
    }
    expect(calls).toEqual([]);
  });

  it('남의 단체 · 없는 id 는 404 를 그대로', async () => {
    const { deps, calls } = fakeDeps();
    const a = await build('tenant', deps);
    const res = await a.inject({ method: 'POST', url: '/tax/uploads/delete', payload: { ids: ['f1', 'f1', 'f2'] } });
    expect(res.statusCode).toBe(404);
    expect(calls).toEqual([['remove', 9001, ['f1', 'f2']]]);
  });
});

describe('POST /tax/uploads/delete-check — 지우기 전 확인(지우지 않음)', () => {
  it('지우기와 같은 처리를 확인으로만 부른다', async () => {
    const DATA = { deletedFiles: 1, deletedRows: 3, laterFilesWithSkips: [] };
    const { deps, calls } = fakeDeps({
      remove: async (s, ids, dryRun) => {
        calls.push([dryRun ? 'check' : 'remove', s.s020OrgId, ids]);
        return { ok: true, data: DATA };
      },
    });
    const a = await build('operator', deps);
    const res = await a.inject({ method: 'POST', url: '/tax/uploads/delete-check', payload: { ids: ['f1'] } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(DATA);
    expect(calls).toEqual([['check', 1, ['f1']]]);
  });

  it('ids 가 없으면 400', async () => {
    const { deps, calls } = fakeDeps();
    const a = await build('tenant', deps);
    const res = await a.inject({ method: 'POST', url: '/tax/uploads/delete-check', payload: { ids: [] } });
    expect(res.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });
});
