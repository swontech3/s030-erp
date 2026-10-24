/**
 * embedBridge — 서로 안에 뜨는 모드 · 로그인 한 번 (2026-10-22 대표 지시 「2번」) · ERP 쪽
 *
 * ★★ 지키는 것 (삐용 s02-front src/common/embedLogin.js 와 같은 규칙 · 같은 메시지 이름)
 *   1) 토큰은 주소에 싣지 않는다 — postMessage 로만
 *   2) 받는 쪽은 보낸 주소를 설정 목록과 대조 — 목록 밖 · 부모가 아닌 창 · 모양이 다르면 무시
 *   3) 바깥은 「내 안에 뜬 창」이 허용 주소에서 「준비됨」을 보낼 때만 그 주소로만 보낸다
 *   4) ERP 안 = 받은 토큰을 기존 로그인 자리(/api/auth/login)로 — 새 로그인 길 없음
 *      ERP 바깥 = 토큰은 서버에서 받아(자기 쿠키) 저장하지 않고 바로 넘긴다
 */
import { describe, it, expect, vi } from 'vitest';
import {
  EMBED_LOGIN,
  EMBED_READY,
  acceptLogin,
  embedLoginTarget,
  isEmbedded,
  parseAllowedOrigins,
  shouldAnswerReady,
  startEmbedInner,
  startEmbedOuter,
  type EmbedWindow,
} from './embedBridge';

const ALLOWED = ['http://192.168.0.22:3000', 'http://localhost:3000'];

describe('parseAllowedOrigins', () => {
  it('쉼표로 여럿 · 공백 · 끝의 / 정리 · 비면 빈 목록', () => {
    expect(parseAllowedOrigins(' http://a:1/ , http://b:2 ,,')).toEqual(['http://a:1', 'http://b:2']);
    expect(parseAllowedOrigins(undefined)).toEqual([]);
  });
});

describe('acceptLogin', () => {
  const parent = {};
  const ok = { origin: 'http://localhost:3000', source: parent, data: { type: EMBED_LOGIN, accessToken: 'a', refreshToken: 'r' } };
  it('허용 주소 · 부모 창 · 토큰 둘이면 받는다', () => {
    expect(acceptLogin(ok, ALLOWED, parent)).toEqual({ accessToken: 'a', refreshToken: 'r' });
  });
  it('★ 목록 밖 · 부모 아님 · 모양 다름은 무시', () => {
    expect(acceptLogin({ ...ok, origin: 'http://evil.test' }, ALLOWED, parent)).toBeNull();
    expect(acceptLogin({ ...ok, source: {} }, ALLOWED, parent)).toBeNull();
    expect(acceptLogin({ ...ok, data: { ...ok.data, accessToken: '' } }, ALLOWED, parent)).toBeNull();
    expect(acceptLogin({ ...ok, data: 'x' }, ALLOWED, parent)).toBeNull();
  });
});

describe('shouldAnswerReady', () => {
  const self = {};
  const ok = { origin: 'http://localhost:3000', source: { parent: self }, data: { type: EMBED_READY } };
  it('허용 주소의 내 안쪽 창이면 보낸다', () => {
    expect(shouldAnswerReady(ok, ALLOWED, self)).toBe(true);
  });
  it('★ 목록 밖 · 내 안쪽이 아님 · 종류 다름이면 보내지 않는다', () => {
    expect(shouldAnswerReady({ ...ok, origin: 'http://evil.test' }, ALLOWED, self)).toBe(false);
    expect(shouldAnswerReady({ ...ok, source: { parent: {} } }, ALLOWED, self)).toBe(false);
    expect(shouldAnswerReady({ ...ok, data: { type: EMBED_LOGIN } }, ALLOWED, self)).toBe(false);
  });
});

describe('embedLoginTarget — 안에서 로그인한 뒤 갈 곳 (2026-10-24 삐용 연계 시험)', () => {
  const HOME = '/dashboard';
  it('ERP 안 주소면 그곳으로 — 삐용 틀에서 법인설립을 처음 누른 경우', () => {
    expect(embedLoginTarget('?redirect=%2Flegal%2Fincorporations', HOME)).toBe('/legal/incorporations');
    expect(embedLoginTarget('?redirect=/legal/incorporations?tab=1', HOME)).toBe('/legal/incorporations?tab=1');
  });
  it('redirect 가 없거나 비면 첫 화면', () => {
    expect(embedLoginTarget('', HOME)).toBe(HOME);
    expect(embedLoginTarget('?redirect=', HOME)).toBe(HOME);
  });
  it('★ 바깥 주소는 무시하고 첫 화면 — // · 주소 형식 · / 로 시작하지 않음', () => {
    for (const bad of ['//evil.test/x', 'https://evil.test/x', 'http:/evil.test', 'javascript:alert(1)', 'legal/x']) {
      expect(embedLoginTarget('?redirect=' + encodeURIComponent(bad), HOME)).toBe(HOME);
    }
  });
  it('★ 브라우저가 // 로 읽는 모양도 무시 — 역슬래시 · 사이에 낀 탭', () => {
    for (const bad of ['/\\evil.test/x', '/\t/evil.test/x']) {
      expect(embedLoginTarget('?redirect=' + encodeURIComponent(bad), HOME)).toBe(HOME);
    }
  });
});

describe('isEmbedded', () => {
  it('맨 위가 아니면 안에 뜬 것', () => {
    expect(isEmbedded({ self: {}, top: {} } as unknown as EmbedWindow)).toBe(true);
    const w = {} as { self: unknown; top: unknown };
    w.self = w;
    w.top = w;
    expect(isEmbedded(w as unknown as EmbedWindow)).toBe(false);
  });
});

function fakeWin(embedded: boolean, parent?: unknown) {
  const listeners: ((e: unknown) => unknown)[] = [];
  const w: Record<string, unknown> = {
    listeners,
    addEventListener: (t: string, fn: (e: unknown) => unknown) => { if (t === 'message') listeners.push(fn); },
    removeEventListener: () => {},
  };
  w.self = w;
  w.top = embedded ? {} : w;
  w.parent = embedded ? parent : w;
  return w as unknown as EmbedWindow & { listeners: ((e: unknown) => Promise<void> | void)[] };
}

describe('startEmbedInner — ERP 가 안에 떴을 때', () => {
  it('★ 「준비됨」은 허용 주소로만 · 받은 토큰은 기존 로그인 자리로 넘긴다', async () => {
    const posted: unknown[] = [];
    const parent = { postMessage: (m: unknown, o: string) => posted.push([m, o]) };
    const win = fakeWin(true, parent);
    const login = vi.fn(async () => true);

    startEmbedInner({ win, allowed: ALLOWED, login });
    expect(posted).toEqual(ALLOWED.map((o) => [{ type: EMBED_READY }, o]));

    await win.listeners[0]!({ origin: 'http://localhost:3000', source: parent, data: { type: EMBED_LOGIN, accessToken: 'a', refreshToken: 'r' } });
    expect(login).toHaveBeenCalledWith({ accessToken: 'a', refreshToken: 'r' });
  });

  it('★ 허용 안 된 주소의 토큰은 로그인 자리로 보내지 않는다', async () => {
    const parent = { postMessage: () => {} };
    const win = fakeWin(true, parent);
    const login = vi.fn(async () => true);
    startEmbedInner({ win, allowed: ALLOWED, login });
    await win.listeners[0]!({ origin: 'http://evil.test', source: parent, data: { type: EMBED_LOGIN, accessToken: 'a', refreshToken: 'r' } });
    expect(login).not.toHaveBeenCalled();
  });

  it('맨 위에 혼자 열렸거나 목록이 비면 아무것도 하지 않는다', () => {
    const top = fakeWin(false);
    startEmbedInner({ win: top, allowed: ALLOWED, login: vi.fn() });
    expect(top.listeners).toEqual([]);
    const parent = { postMessage: vi.fn() };
    const empty = fakeWin(true, parent);
    startEmbedInner({ win: empty, allowed: [], login: vi.fn() });
    expect(empty.listeners).toEqual([]);
    expect(parent.postMessage).not.toHaveBeenCalled();
  });
});

describe('startEmbedOuter — ERP 가 바깥일 때', () => {
  it('내 안쪽 창이 허용 주소에서 「준비됨」 → 서버에서 받은 토큰을 그 주소로만 보낸다', async () => {
    const win = fakeWin(false);
    const posted: unknown[] = [];
    const child = { parent: win, postMessage: (m: unknown, o: string) => posted.push([m, o]) };
    const getTokens = vi.fn(async () => ({ accessToken: 'a', refreshToken: 'r' }));
    startEmbedOuter({ win, allowed: ALLOWED, getTokens });

    await win.listeners[0]!({ origin: 'http://localhost:3000', source: child, data: { type: EMBED_READY } });
    expect(posted).toEqual([[{ type: EMBED_LOGIN, accessToken: 'a', refreshToken: 'r' }, 'http://localhost:3000']]);
  });

  it('★ 허용 안 된 주소면 서버에 묻지도 않는다 · 토큰이 없으면 보내지 않는다', async () => {
    const win = fakeWin(false);
    const posted: unknown[] = [];
    const child = { parent: win, postMessage: (m: unknown, o: string) => posted.push([m, o]) };
    const getTokens = vi.fn(async () => null);
    startEmbedOuter({ win, allowed: ALLOWED, getTokens });

    await win.listeners[0]!({ origin: 'http://evil.test', source: child, data: { type: EMBED_READY } });
    expect(getTokens).not.toHaveBeenCalled();
    await win.listeners[0]!({ origin: 'http://localhost:3000', source: child, data: { type: EMBED_READY } });
    expect(posted).toEqual([]);
  });
});

describe('startEmbedInner — 「준비됨」 다시 보내기 (바깥이 늦게 듣기 시작해도)', () => {
  it('★ 토큰을 받을 때까지 1초마다 · 최대 10번 · 받으면 멈춘다', async () => {
    vi.useFakeTimers();
    try {
      const posted: unknown[] = [];
      const parent = { postMessage: (m: unknown, o: string) => posted.push([m, o]) };
      const win = Object.assign(fakeWin(true, parent), { setInterval, clearInterval });
      startEmbedInner({ win, allowed: ['http://localhost:3000'], login: vi.fn(async () => true) });
      expect(posted).toHaveLength(1);
      vi.advanceTimersByTime(3000);
      expect(posted).toHaveLength(4);
      await win.listeners[0]!({ origin: 'http://localhost:3000', source: parent, data: { type: EMBED_LOGIN, accessToken: 'a', refreshToken: 'r' } });
      vi.advanceTimersByTime(5000);
      expect(posted).toHaveLength(4);

      const posted2: unknown[] = [];
      const parent2 = { postMessage: (m: unknown, o: string) => posted2.push([m, o]) };
      const win2 = Object.assign(fakeWin(true, parent2), { setInterval, clearInterval });
      startEmbedInner({ win: win2, allowed: ['http://localhost:3000'], login: vi.fn() });
      vi.advanceTimersByTime(60000);
      expect(posted2).toHaveLength(10);
    } finally {
      vi.useRealTimers();
    }
  });
});
