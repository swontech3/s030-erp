/**
 * 토큰 만료 처리 — **이 파일이 지키는 것은 세 줄이다.**
 *
 *   ① 삐용이 401 을 주면 재발급(auth/re-issue)을 **한 번** 시도하고 다시 부른다
 *   ② 재발급도 실패하면 재로그인 안내 + ERP 세션 폐기
 *   ③ 부르기 직전에 만료된 토큰이면 401 을 기다리지 않고 먼저 되살린다
 *
 * ★ 삐용도 DB 도 없이 돈다 — 저장소와 어댑터를 주입받는 설계의 이유가 이것이다.
 */
import { describe, it, expect, vi } from 'vitest';
import { withFreshAccess, type AccessTokenStore } from './withFreshAccess.ts';
import {
  BbiyongReloginRequiredError,
  BbiyongTokenExpiredError,
  BbiyongUnavailableError,
} from './types.ts';

/** JWT 모양의 access 토큰. 서명은 아무 값이어도 된다 — 읽는 것은 `exp` 뿐이다. */
function jwt(expSec: number): string {
  const payload = Buffer.from(JSON.stringify({ sub: '1', auth: 'ROLE', exp: expSec })).toString('base64url');
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.sig`;
}

const NOW = 1_800_000_000_000; // 고정 시각. Date.now() 를 쓰지 않는다
const LIVE = jwt(NOW / 1000 + 3600); // 1시간 남음
const DEAD = jwt(NOW / 1000 - 10); // 10초 전에 만료

function store(tokens: { accessToken: string; refreshToken: string } | null): AccessTokenStore & {
  saved: string[];
  revoked: number;
} {
  const saved: string[] = [];
  let revoked = 0;
  return {
    saved,
    get revoked() {
      return revoked;
    },
    read: async () => tokens,
    saveAccess: async (t) => void saved.push(t),
    revoke: async () => void revoked++,
  };
}

const okAuth = (fresh: string) => ({ reIssue: vi.fn(async () => fresh) });

describe('withFreshAccess — ① 401 은 재발급으로 이어진다', () => {
  it('★ 401 → 재발급 → 새 토큰으로 다시 부른다', async () => {
    const s = store({ accessToken: LIVE, refreshToken: 'refresh' });
    const auth = okAuth('new-access');
    const call = vi
      .fn<(t: string) => Promise<string>>()
      .mockRejectedValueOnce(new BbiyongTokenExpiredError('401'))
      .mockResolvedValueOnce('결과');

    const out = await withFreshAccess(s, auth, call, { now: () => NOW });

    expect(out).toBe('결과');
    expect(auth.reIssue).toHaveBeenCalledWith(LIVE, 'refresh');
    expect(call.mock.calls.map((c) => c[0])).toEqual([LIVE, 'new-access']);
    // 새 access 토큰을 세션에 보관한다 — 다음 요청이 또 401 을 맞지 않게.
    expect(s.saved).toEqual(['new-access']);
    expect(s.revoked).toBe(0); // 살아났으므로 세션은 그대로
  });

  it('★ 재발급은 한 번뿐이다 — 새 토큰으로도 401 이면 거기서 멈춘다', async () => {
    const s = store({ accessToken: LIVE, refreshToken: 'refresh' });
    const auth = okAuth('new-access');
    const call = vi.fn(async () => {
      throw new BbiyongTokenExpiredError('401');
    });

    await expect(withFreshAccess(s, auth, call, { now: () => NOW })).rejects.toThrow(
      BbiyongReloginRequiredError,
    );
    expect(auth.reIssue).toHaveBeenCalledTimes(1); // 무한히 돌지 않는다
    expect(call).toHaveBeenCalledTimes(2);
    expect(s.revoked).toBe(1);
  });

  it('401 이 아닌 오류는 재발급을 부르지 않고 그대로 올라간다', async () => {
    const s = store({ accessToken: LIVE, refreshToken: 'refresh' });
    const auth = okAuth('new-access');
    const boom = new Error('업무 오류');

    await expect(
      withFreshAccess(s, auth, async () => {
        throw boom;
      }, { now: () => NOW }),
    ).rejects.toBe(boom);
    expect(auth.reIssue).not.toHaveBeenCalled();
  });
});

describe('withFreshAccess — ② 재발급도 실패하면 재로그인 안내', () => {
  it('★ 재발급이 만료로 실패 → 재로그인 + ERP 세션 폐기', async () => {
    const s = store({ accessToken: LIVE, refreshToken: 'refresh' });
    const auth = {
      reIssue: vi.fn(async () => {
        throw new BbiyongReloginRequiredError();
      }),
    };
    const call = vi.fn(async () => {
      throw new BbiyongTokenExpiredError('401');
    });

    const err = await withFreshAccess(s, auth, call, { now: () => NOW }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BbiyongReloginRequiredError);
    expect((err as Error).message).toContain('다시 로그인해 주세요');
    expect(s.revoked).toBe(1); // 살려 두면 같은 오류가 반복된다
    expect(call).toHaveBeenCalledTimes(1); // 되살리지 못했으니 다시 부르지 않는다
  });

  it('★★ 삐용 장애는 재로그인이 아니다 — 세션을 죽이지 않는다', async () => {
    const s = store({ accessToken: LIVE, refreshToken: 'refresh' });
    const auth = {
      reIssue: vi.fn(async () => {
        throw new BbiyongUnavailableError('붙지 못했다');
      }),
    };

    await expect(
      withFreshAccess(s, auth, async () => {
        throw new BbiyongTokenExpiredError('401');
      }, { now: () => NOW }),
    ).rejects.toThrow(BbiyongUnavailableError);
    // 삐용이 흔들릴 때마다 전원이 로그인 화면으로 튕기면 안 된다.
    expect(s.revoked).toBe(0);
  });

  it('세션이 없거나 복호화할 수 없으면 부르지 않고 재로그인이다', async () => {
    const s = store(null);
    const auth = okAuth('new-access');
    const call = vi.fn();

    await expect(withFreshAccess(s, auth, call, { now: () => NOW })).rejects.toThrow(
      BbiyongReloginRequiredError,
    );
    expect(call).not.toHaveBeenCalled();
    expect(auth.reIssue).not.toHaveBeenCalled();
    expect(s.revoked).toBe(1);
  });
});

describe('withFreshAccess — ③ 부르기 직전에 생존을 본다', () => {
  it('★ 이미 만료된 토큰이면 401 을 기다리지 않고 먼저 되살린다', async () => {
    const s = store({ accessToken: DEAD, refreshToken: 'refresh' });
    const auth = okAuth('new-access');
    const call = vi.fn(async (t: string) => t);

    const out = await withFreshAccess(s, auth, call, { now: () => NOW });

    expect(out).toBe('new-access');
    expect(auth.reIssue).toHaveBeenCalledTimes(1);
    // 죽은 토큰으로는 **한 번도** 부르지 않았다 — 그 한 번이 「서버에 연결할 수 없습니다」였다.
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith('new-access');
  });

  it('★ 선검사로 되살린 뒤에도 401 이면 재발급을 또 하지 않는다', async () => {
    const s = store({ accessToken: DEAD, refreshToken: 'refresh' });
    const auth = okAuth('new-access');
    const call = vi.fn(async () => {
      throw new BbiyongTokenExpiredError('401');
    });

    await expect(withFreshAccess(s, auth, call, { now: () => NOW })).rejects.toThrow(
      BbiyongReloginRequiredError,
    );
    expect(auth.reIssue).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledTimes(1);
    expect(s.revoked).toBe(1);
  });

  it('살아 있는 토큰은 재발급하지 않는다 — 멀쩡한 토큰을 버리지 않는다', async () => {
    const s = store({ accessToken: LIVE, refreshToken: 'refresh' });
    const auth = okAuth('new-access');

    await withFreshAccess(s, auth, async (t) => t, { now: () => NOW });
    expect(auth.reIssue).not.toHaveBeenCalled();
    expect(s.saved).toEqual([]);
  });

  it('★ MOCK 토큰(JWT 가 아니다)은 "모른다" 이므로 그냥 불러 본다', async () => {
    const s = store({ accessToken: 'mock-access.1001.123', refreshToken: 'mock-refresh.1001.123' });
    const auth = okAuth('new-access');

    const out = await withFreshAccess(s, auth, async (t) => t, { now: () => NOW });
    expect(out).toBe('mock-access.1001.123');
    expect(auth.reIssue).not.toHaveBeenCalled();
  });
});
