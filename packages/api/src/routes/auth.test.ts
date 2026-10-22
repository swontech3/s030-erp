/**
 * POST /auth/login — 삐용 토큰 → ERP 세션 (규격서 Q6 · 2026-10-22).
 *
 * ★★ 지키는 것
 *    1) 비밀번호를 받는 길이 없다 — {email, password} 는 400 이고 삐용도 세션도 부르지 않는다
 *    2) 세션은 **삐용에 물어 확인한 값**으로만 만든다 — 확인이 실패하면 세션을 만들지 않는다
 *    3) 삐용에 못 붙은 것은 인증 실패가 아니다(503)
 * 삐용 · DB 는 가짜로 바꾼다 — 이 시험이 보는 것은 라우트의 순서와 판단이다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

const verifySession = vi.fn();
const createSession = vi.fn();

vi.mock('../bbiyong/index.ts', async () => {
  const types = await vi.importActual<typeof import('../bbiyong/types.ts')>('../bbiyong/types.ts');
  return {
    ...types,
    bbiyongAuth: { verifySession, signOut: vi.fn(), getProfile: vi.fn() },
    bbiyongAcl: { listScreens: vi.fn(async () => ['s030000050']) },
  };
});
vi.mock('../session/store.ts', () => ({
  createSession,
  readRefreshToken: vi.fn(),
  revokeSession: vi.fn(),
}));
vi.mock('../session/hook.ts', () => ({ requireRawSid: vi.fn(), requireSession: vi.fn() }));

const { registerAuthRoutes } = await import('./auth.ts');
const { BbiyongAuthError, BbiyongUnavailableError } = await import('../bbiyong/types.ts');

const VERIFIED = {
  memberId: 4902,
  orgId: 1,
  orgTp: null,
  memberName: '홍길동',
  orgName: '(주)에스원테크',
  accessToken: 'acc',
  refreshToken: 'ref',
};

async function post(body: unknown) {
  const app = Fastify();
  registerAuthRoutes(app);
  await app.ready();
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: body as object });
  await app.close();
  return res;
}

beforeEach(() => {
  verifySession.mockReset();
  createSession.mockReset();
  createSession.mockResolvedValue({
    rawSid: 'raw-sid',
    session: { companyId: null, expiresAt: new Date('2030-01-01T00:00:00Z') },
  });
});

describe('POST /auth/login — 삐용 토큰 → ERP 세션', () => {
  it('★ 이메일 · 비밀번호는 받지 않는다 — 400 · 삐용도 세션도 부르지 않는다', async () => {
    const res = await post({ email: 'a@b.c', password: 'pw' });
    expect(res.statusCode).toBe(400);
    expect(verifySession).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it('토큰 둘을 삐용에 확인하고, 확인된 값으로 세션을 만든다', async () => {
    verifySession.mockResolvedValue(VERIFIED);
    const res = await post({ accessToken: 'acc', refreshToken: 'ref' });

    expect(res.statusCode).toBe(200);
    expect(verifySession).toHaveBeenCalledWith('acc', 'ref');
    expect(createSession).toHaveBeenCalledWith(VERIFIED);
    expect(res.json().erpSid).toBe('raw-sid');
  });

  it('★ 확인이 실패하면 401 · 세션을 만들지 않는다', async () => {
    verifySession.mockRejectedValue(new BbiyongAuthError('x'));
    const res = await post({ accessToken: 'forged', refreshToken: 'forged' });

    expect(res.statusCode).toBe(401);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('삐용에 못 붙으면 503 · 세션을 만들지 않는다', async () => {
    verifySession.mockRejectedValue(new BbiyongUnavailableError('down'));
    const res = await post({ accessToken: 'acc', refreshToken: 'ref' });

    expect(res.statusCode).toBe(503);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('토큰 하나라도 없으면 400', async () => {
    for (const body of [{ accessToken: 'acc' }, { refreshToken: 'ref' }, {}]) {
      const res = await post(body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(verifySession).not.toHaveBeenCalled();
  });

  it('★ 브라우저가 회원 · 회사 번호를 섞어 보내도 쓰지 않는다 — 세션은 확인된 값으로', async () => {
    // Fastify 기본 설정은 스키마 밖 칸을 거부하지 않고 **버린다**(removeAdditional) — 운영 서버도 같다(index.ts).
    verifySession.mockResolvedValue(VERIFIED);
    const res = await post({ accessToken: 'acc', refreshToken: 'ref', memberId: 1, orgId: 999, orgTp: 'S' });

    expect(res.statusCode).toBe(200);
    expect(verifySession).toHaveBeenCalledWith('acc', 'ref');
    expect(createSession).toHaveBeenCalledWith(VERIFIED);
  });
});
