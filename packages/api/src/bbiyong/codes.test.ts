import { describe, expect, it } from 'vitest';
import { HttpBbiyongCodes, parseCodeValues, readEnvelope, SERVER_KEY_HEADER } from './codes.ts';
import { BbiyongTokenExpiredError, BbiyongUnavailableError } from './types.ts';
import { createSharedCodes } from './sharedCodes.ts';
import { MockBbiyongCodes, mockServerReaderOf } from './MockBbiyongCodes.ts';
import { keyOf, writeOf } from '../routes/codesBbiyong.ts';

const BASE = 'http://192.168.0.22:8082';
const ok = (data: unknown, massage = '') => ({ result: 'success', status: 200, data, massage, error: [] });

function adapter(body: unknown, status = 200, serverKey: string | null = 'k') {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: init as RequestInit });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { http: new HttpBbiyongCodes({ baseUrl: BASE, serverKey, fetchImpl }), calls };
}

describe('삐용 공통 코드 — 봉투 · 파싱(명세 118)', () => {
  it('성공은 result success 와 status 200 둘 다 · 거절은 massage 그대로', () => {
    expect(readEnvelope(ok([1]))).toEqual({ ok: true, data: [1], massage: '' });
    expect(readEnvelope({ result: 'fail', status: 403, massage: '코드 관리 화면 수정 권한이 없습니다.' })).toEqual({
      ok: false,
      message: '코드 관리 화면 수정 권한이 없습니다.',
    });
  });

  it('값 — 사용 안 함 줄도 받는다(useYn N) · 묶음이 비면 000 · 모양이 다른 줄은 버린다', () => {
    expect(
      parseCodeValues([
        { category: '', cdTp: 'EMAIL_DOMAIN', cdTpMeaning: '이메일도메인', cdV: 'naver.com', cdVMeaning: 'naver.com', sortSeq: 1, useYn: 'Y' },
        { category: '000', cdTp: 'EMAIL_DOMAIN', cdV: 'nate.com', cdVMeaning: 'nate.com', sortSeq: '5', useYn: 'N' },
        { cdTp: '', cdV: 'x' },
      ]),
    ).toEqual([
      { category: '000', cdTp: 'EMAIL_DOMAIN', cdTpMeaning: '이메일도메인', cdV: 'naver.com', cdVMeaning: 'naver.com', sortSeq: 1, useYn: 'Y' },
      { category: '000', cdTp: 'EMAIL_DOMAIN', cdTpMeaning: '', cdV: 'nate.com', cdVMeaning: 'nate.com', sortSeq: 5, useYn: 'N' },
    ]);
  });
});

describe('HttpBbiyongCodes — 화면 토큰', () => {
  it('값 목록 — GET s030100030/code-values · 토큰', async () => {
    const { http, calls } = adapter(ok([]));
    await http.listValues('000', 'EMAIL_DOMAIN', 'tok');
    const u = new URL(calls[0]!.url);
    expect(u.pathname).toBe('/rest/v1/s030100030/code-values');
    expect(Object.fromEntries(u.searchParams)).toEqual({ category: '000', cdTp: 'EMAIL_DOMAIN' });
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });

  it('추가 — 순서가 비면 칸째 뺀다 · 삐용 거절은 문구 그대로', async () => {
    const { http, calls } = adapter({ result: 'fail', status: 400, massage: '같은 코드값이 「사용 안 함」으로 있습니다.' });
    const out = await http.addValue({ category: '000', cdTp: 'EMAIL_DOMAIN', cdV: 'x.com', cdVMeaning: 'x.com' }, 'tok');
    expect(out).toEqual({ kind: 'rejected', message: '같은 코드값이 「사용 안 함」으로 있습니다.' });
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ category: '000', cdTp: 'EMAIL_DOMAIN', cdV: 'x.com', cdVMeaning: 'x.com' });
  });

  it('사용 안 함 · 다시 사용 — 각자 주소', async () => {
    const a = adapter(ok(null, '사용 안 함으로 바꿨습니다.'));
    expect(await a.http.unuseValue({ category: '000', cdTp: 'COUNTRY', cdV: 'KR' }, 't')).toEqual({ kind: 'ok', value: '사용 안 함으로 바꿨습니다.' });
    expect(new URL(a.calls[0]!.url).pathname).toBe('/rest/v1/s030100030/code-value-unuse');
    const b = adapter(ok(null));
    await b.http.reuseValue({ category: '000', cdTp: 'COUNTRY', cdV: 'KR' }, 't');
    expect(new URL(b.calls[0]!.url).pathname).toBe('/rest/v1/s030100030/code-value-reuse');
  });

  it('토큰 호출의 HTTP 401 은 토큰 만료(재발급)', async () => {
    const { http } = adapter({}, 401);
    await expect(http.listTypes('tok')).rejects.toBeInstanceOf(BbiyongTokenExpiredError);
  });
});

describe('HttpBbiyongCodes — 서버 키', () => {
  it('GET code-server/code-values · 헤더 X-SwonBiz-Server-Key · 토큰 없음', async () => {
    const { http, calls } = adapter(ok([]));
    await http.listValuesByServerKey('000', 'COUNTRY');
    expect(new URL(calls[0]!.url).pathname).toBe('/rest/v1/code-server/code-values');
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(h[SERVER_KEY_HEADER]).toBe('k');
    expect(h.authorization).toBeUndefined();
  });

  it('키가 없으면 부르지 않고 던진다 · 키가 틀리면(401) 장애로 던진다', async () => {
    const none = adapter(ok([]), 200, null);
    await expect(none.http.listValuesByServerKey('000', 'COUNTRY')).rejects.toBeInstanceOf(BbiyongUnavailableError);
    expect(none.calls).toHaveLength(0);
    const wrong = adapter({}, 401);
    await expect(wrong.http.listValuesByServerKey('000', 'COUNTRY')).rejects.toBeInstanceOf(BbiyongUnavailableError);
  });
});

describe('같이 쓰는 코드 — 잠시 보관 · 마지막 값', () => {
  const row = (cdV: string, sortSeq: number, useYn: 'Y' | 'N' = 'Y') => ({
    category: '000', cdTp: 'EMAIL_DOMAIN', cdTpMeaning: '', cdV, cdVMeaning: cdV, sortSeq, useYn,
  });
  const quiet = { warn: () => undefined };

  it('사용 중만 · 순서대로 · 보관 시간 안에는 다시 부르지 않는다', async () => {
    let calls = 0;
    let t = 0;
    const shared = createSharedCodes(
      { listValues: async () => (calls++, [row('b', 2), row('off', 1, 'N'), row('a', 1)]) },
      { freshMs: 1000, now: () => t },
    );
    expect((await shared.values('EMAIL_DOMAIN', quiet)).map((r) => r.cdV)).toEqual(['a', 'b']);
    t = 999;
    await shared.values('EMAIL_DOMAIN', quiet);
    expect(calls).toBe(1);
    t = 1000;
    await shared.values('EMAIL_DOMAIN', quiet);
    expect(calls).toBe(2);
  });

  it('★★ 삐용이 멈추면 마지막 값 · 한 번도 못 받았으면 빈 목록 · 던지지 않는다', async () => {
    let up = true;
    let t = 0;
    const shared = createSharedCodes(
      { listValues: async () => { if (!up) throw new Error('down'); return [row('a', 1)]; } },
      { freshMs: 10, now: () => t },
    );
    expect(await shared.values('COUNTRY', quiet)).toHaveLength(1);
    up = false;
    t = 100;
    expect((await shared.values('COUNTRY', quiet)).map((r) => r.cdV)).toEqual(['a']);
    expect(await shared.values('COUNTRY_TZ', quiet)).toEqual([]);
  });

  it('고친 뒤 보관을 비우면 바로 새 값 — 모의는 코드 관리와 같은 저장소', async () => {
    const mock = new MockBbiyongCodes();
    const shared = createSharedCodes(mockServerReaderOf(mock));
    expect((await shared.values('EMAIL_DOMAIN', quiet)).map((r) => r.cdV)).toEqual([
      'naver.com', 'daum.net', 'gmail.com', 'hanmail.net', 'nate.com',
    ]);
    await mock.unuseValue({ category: '000', cdTp: 'EMAIL_DOMAIN', cdV: 'nate.com' });
    shared.forget('EMAIL_DOMAIN');
    expect((await shared.values('EMAIL_DOMAIN', quiet)).map((r) => r.cdV)).not.toContain('nate.com');
  });
});

describe('라우트 본문 — keyOf · writeOf', () => {
  it('묶음이 비면 000 · 종류 · 코드값이 없으면 null', () => {
    expect(keyOf({ cdTp: ' COUNTRY ', cdV: 'KR' })).toEqual({ category: '000', cdTp: 'COUNTRY', cdV: 'KR' });
    expect(keyOf({ cdTp: 'COUNTRY' })).toBeNull();
  });

  it('순서 — 비면 뺀다 · 숫자 글자는 받는다 · 음수 · 글자는 null · 이름이 비면 null', () => {
    const base = { cdTp: 'COUNTRY', cdV: 'KR', cdVMeaning: '대한민국' };
    expect(writeOf({ ...base, sortSeq: '' })).toEqual({ category: '000', cdTp: 'COUNTRY', cdV: 'KR', cdVMeaning: '대한민국' });
    expect(writeOf({ ...base, sortSeq: '3' })?.sortSeq).toBe(3);
    expect(writeOf({ ...base, sortSeq: -1 })).toBeNull();
    expect(writeOf({ ...base, sortSeq: 'x' })).toBeNull();
    expect(writeOf({ ...base, cdVMeaning: ' ' })).toBeNull();
  });
});
