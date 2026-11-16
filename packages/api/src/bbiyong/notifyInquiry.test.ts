/**
 * notifyInquiry — 새 문의 접수를 삐용에 알린다(앱 1단계 3-마, 2026-11-16).
 *
 * ★ 이 파일이 지키는 것:
 *   ① **절대 던지지 않는다** — 삐용이 꺼져 있어도 · 500 이어도 · 시간이 지나도 결과 글자만 돌려준다
 *   ② 키가 없거나 삐용 주소가 없으면(MOCK) **부르지 않는다**
 *   ③ 헤더 `X-SwonBiz-Server-Key` · 본문은 문의 번호와 유형 이름 **둘뿐** — 고객 이름 · 연락처를 싣지 않는다
 *   ④ 비밀 키 값은 기록에 남기지 않는다
 *
 * 삐용 없이 돈다 — `fetchImpl` 을 갈아 끼운다.
 */
import { describe, it, expect } from 'vitest';
import { notifyNewInquiry, inquiryTypeName, SERVER_KEY_HEADER } from './notifyInquiry.ts';

const KEY = 'vitest-server-key-0123456789';
const INPUT = { inquiryId: 'c5244944-dc83-4b31-b828-c69b434baf90', typeName: '입주문의' };

function fetchOf(status = 202) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: init as RequestInit });
    return new Response(JSON.stringify({ status, result: 'success' }), { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function logOf() {
  const lines: string[] = [];
  return {
    lines,
    log: {
      info: (o: unknown, m?: string) => void lines.push(`${m ?? ''} ${JSON.stringify(o)}`),
      warn: (o: unknown, m?: string) => void lines.push(`${m ?? ''} ${JSON.stringify(o)}`),
    },
  };
}

describe('notifyNewInquiry', () => {
  it('키가 맞으면 삐용 주소에 헤더 · 본문 둘을 실어 부르고 sent', async () => {
    const { impl, calls } = fetchOf(202);
    const { log } = logOf();
    const out = await notifyNewInquiry(INPUT, { baseUrl: 'http://192.168.0.22:8092/', serverKey: KEY, fetchImpl: impl, log });

    expect(out).toBe('sent');
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe('http://192.168.0.22:8092/rest/v1/noti/erp-inquiry');
    expect(call.init.method).toBe('POST');
    const headers = new Headers(call.init.headers);
    expect(headers.get(SERVER_KEY_HEADER)).toBe(KEY);
    expect(headers.get('content-type')).toContain('application/json');
    expect(JSON.parse(String(call.init.body))).toEqual(INPUT);
  });

  it('서버 키가 없으면 부르지 않는다(skipped)', async () => {
    const { impl, calls } = fetchOf();
    const { log } = logOf();
    expect(await notifyNewInquiry(INPUT, { baseUrl: 'http://x:8092', serverKey: null, fetchImpl: impl, log })).toBe('skipped');
    expect(await notifyNewInquiry(INPUT, { baseUrl: 'http://x:8092', serverKey: '  ', fetchImpl: impl, log })).toBe('skipped');
    expect(calls).toHaveLength(0);
  });

  it('삐용 주소가 없으면(MOCK) 부르지 않는다(skipped)', async () => {
    const { impl, calls } = fetchOf();
    const { log } = logOf();
    expect(await notifyNewInquiry(INPUT, { baseUrl: null, serverKey: KEY, fetchImpl: impl, log })).toBe('skipped');
    expect(calls).toHaveLength(0);
  });

  it.each([401, 500, 503])('삐용이 %i 이면 던지지 않고 failed', async (status) => {
    const { impl } = fetchOf(status);
    const { log, lines } = logOf();
    await expect(notifyNewInquiry(INPUT, { baseUrl: 'http://x:8092', serverKey: KEY, fetchImpl: impl, log })).resolves.toBe('failed');
    expect(lines.join('\n')).toContain(String(status));
  });

  it('연결이 끊겨도 던지지 않고 failed', async () => {
    const impl = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const { log } = logOf();
    await expect(notifyNewInquiry(INPUT, { baseUrl: 'http://x:8092', serverKey: KEY, fetchImpl: impl, log })).resolves.toBe('failed');
  });

  it('시간이 지나면 끊고 failed', async () => {
    const impl = ((_url: unknown, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new Error('aborted')));
      })) as unknown as typeof fetch;
    const { log } = logOf();
    await expect(
      notifyNewInquiry(INPUT, { baseUrl: 'http://x:8092', serverKey: KEY, fetchImpl: impl, log, timeoutMs: 20 }),
    ).resolves.toBe('failed');
  });

  it('비밀 키 값은 기록에 남기지 않는다', async () => {
    const { impl } = fetchOf(401);
    const { log, lines } = logOf();
    await notifyNewInquiry(INPUT, { baseUrl: 'http://x:8092', serverKey: KEY, fetchImpl: impl, log });
    expect(lines.join('\n')).not.toContain(KEY);
  });
});

describe('inquiryTypeName', () => {
  const codes = [
    { category: 'QU_TP', code: 'O', name: '입주문의' },
    { category: 'QU_TP', code: 'R', name: '대관문의' },
    { category: 'QU_ST', code: 'R', name: '접수' },
  ];

  it('유형 코드 → 이름(QU_TP 에서만 찾는다)', () => {
    expect(inquiryTypeName(codes, 'O')).toBe('입주문의');
    expect(inquiryTypeName(codes, 'R')).toBe('대관문의');
  });

  it('없으면 빈 글자', () => {
    expect(inquiryTypeName(codes, 'Z')).toBe('');
  });
});
