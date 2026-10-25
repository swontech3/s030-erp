/**
 * HttpBbiyongAuth — 삐용 로그인 계통 어댑터(토큰 확인 · 로그아웃 · 재발급).
 *
 * ★ 2026-10-22 — 비밀번호로 대신 로그인하던 signIn · parseSignIn 과 그 시험을 지웠다(규격서 Q6).
 *   그 시험이 지키던 판정(HTTP 200 + result:'fail' · 겸직 먼저 · 깨진 응답)은 브라우저가 쓰는
 *   shared `readSignInTokens` 시험(packages/shared/src/bbiyongSignIn.test.ts)으로 옮겼다.
 */
import { describe, it, expect } from 'vitest';
import { HttpBbiyongAuth, parseReIssue, parseMyMenus, parseMyMenuKeys } from './HttpBbiyongAuth.ts';
import {
  BbiyongAuthError,
  BbiyongReloginRequiredError,
  BbiyongTokenExpiredError,
  BbiyongUnavailableError,
} from './types.ts';

// =============================================================================
// 공용 — 가짜 fetch
// =============================================================================
function stubFetch(res: Response | (() => Promise<Response>)) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return typeof res === 'function' ? await res() : res.clone();
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const BASE = 'https://bbiyong.example.test';

describe('HttpBbiyongAuth.signOut', () => {
  it('refresh-token 헤더로 sign-out 을 부른다 — 쿼리스트링에 싣지 않는다', async () => {
    const { impl, calls } = stubFetch(json({ status: 200, result: 'success', massage: null, data: null, error: null }));
    const auth = new HttpBbiyongAuth({ baseUrl: BASE, fetchImpl: impl });

    await auth.signOut('eyJhbGciOiJIUzI1NiJ9.refresh');

    expect(calls[0]!.url).toBe(`${BASE}/rest/v1/s021200010/sign-out`);
    expect(calls[0]!.url).not.toContain('refresh');
    expect((calls[0]!.init.headers as Record<string, string>)['refresh-token']).toBe('eyJhbGciOiJIUzI1NiJ9.refresh');
  });

  it('삐용 로그아웃이 실패해도 예외를 던지지 않는다 — ERP 세션은 이미 폐기됐다', async () => {
    const { impl } = stubFetch(async () => {
      throw new TypeError('fetch failed');
    });
    const auth = new HttpBbiyongAuth({ baseUrl: BASE, fetchImpl: impl });

    await expect(auth.signOut('eyJ.refresh')).resolves.toBeUndefined();
  });
});

// =============================================================================
// 3. 토큰 갱신 — 만료를 코드에 박지 않고 401 을 받으면 갱신한다
// =============================================================================
describe('parseReIssue', () => {
  it('성공하면 새 access 토큰을 준다 (refresh 는 회전하지 않는다)', () => {
    const body = {
      status: 200,
      result: 'success',
      massage: null,
      data: { accessToken: 'eyJ.new-access', email: '1234', refreshTokenDurationDays: 604800000 },
      error: null,
    };
    const out = parseReIssue(body);
    expect(out).toEqual({ kind: 'success', accessToken: 'eyJ.new-access' });
  });

  it('★ 갱신도 실패할 때 HTTP 200 이다 — result 로 판정한다', () => {
    const body = { status: 400, result: 'fail', massage: '토큰이 만료되었습니다.', data: null, error: 'A010' };
    expect(parseReIssue(body).kind).toBe('fail');
  });

  it('깨진 응답은 실패다 (예외를 던지지 않는다)', () => {
    expect(() => parseReIssue(null)).not.toThrow();
    expect(parseReIssue(null).kind).toBe('fail');
  });
});

describe('HttpBbiyongAuth.reIssue', () => {
  it('토큰 2개를 쿼리스트링에 싣는다 (삐용 규격)', async () => {
    const { impl, calls } = stubFetch(
      json({ status: 200, result: 'success', massage: null, data: { accessToken: 'eyJ.new' }, error: null }),
    );
    const auth = new HttpBbiyongAuth({ baseUrl: BASE, fetchImpl: impl });

    await expect(auth.reIssue('eyJ.old-access', 'eyJ.refresh')).resolves.toBe('eyJ.new');
    expect(calls[0]!.url).toContain('access-token=eyJ.old-access');
    expect(calls[0]!.url).toContain('refresh-token=eyJ.refresh');
  });

  it('★★ 실패해도 에러 메시지에 토큰이 남지 않는다 — 중계 로그에 평문으로 흐른다', async () => {
    const { impl } = stubFetch(async () => {
      // undici 는 요청 URL 을 그대로 붙여 던진다. 그 URL 에 토큰 2개가 들어 있다.
      throw new TypeError(`fetch failed: ${BASE}/rest/v1/auth/re-issue?access-token=eyJ.old-access&refresh-token=eyJ.refresh`);
    });
    const auth = new HttpBbiyongAuth({ baseUrl: BASE, fetchImpl: impl });

    const err = await auth.reIssue('eyJ.old-access', 'eyJ.refresh').catch((e: unknown) => e);
    const text = `${(err as Error).message} ${(err as Error).stack ?? ''}`;
    expect(text).not.toContain('eyJ.old-access');
    expect(text).not.toContain('eyJ.refresh');
    expect(text).not.toContain('access-token=');
  });

  it('갱신 실패는 BbiyongAuthError 다 — 재로그인으로 보낸다', async () => {
    const { impl } = stubFetch(json({ status: 400, result: 'fail', massage: '만료', data: null, error: 'A010' }));
    const auth = new HttpBbiyongAuth({ baseUrl: BASE, fetchImpl: impl });

    await expect(auth.reIssue('eyJ.old', 'eyJ.refresh')).rejects.toBeInstanceOf(BbiyongAuthError);
    await expect(auth.reIssue('eyJ.old', 'eyJ.refresh')).rejects.toBeInstanceOf(BbiyongReloginRequiredError);
  });

  it('★ 재발급 요청 자체가 401 이면 refresh 도 죽었다 — 재로그인이다(만료로 되돌리지 않는다)', async () => {
    // 이것을 BbiyongTokenExpiredError 로 올려보내면 호출자가 「또 재발급하면 되겠지」로
    // 읽고 무한히 돈다. 되살릴 수 없다는 사실을 타입으로 못박는다.
    const { impl } = stubFetch(new Response('', { status: 401 }));
    const auth = new HttpBbiyongAuth({ baseUrl: BASE, fetchImpl: impl });

    const err = await auth.reIssue('eyJ.old', 'eyJ.refresh').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BbiyongReloginRequiredError);
    expect(err).not.toBeInstanceOf(BbiyongTokenExpiredError);
  });
});

// =============================================================================
// 4. ★★ 삐용 토큰 → ERP 세션 (규격서 Q6 · 2026-10-22)
// =============================================================================
// 브라우저가 삐용 로그인을 직접 부르고 토큰을 넘긴다. ERP 서버는 비밀번호를 받지 않는다.
// 받은 토큰은 **삐용에 물어 확인한 뒤에만** 세션이 된다 — 확인은 기존 my-orgs(토큰은 머리글).

/** 2026-10-22 개발계 실물 응답 모양(이름만 바꿈). 지금 계정 = current:true 한 줄 */
const MY_ORGS_BODY = {
  status: 200,
  result: 'success',
  massage: null,
  data: [
    { memberId: 4903, orgId: 7, orgName: '다른 회사', memberName: '홍길동', memberTp: 'A', current: false },
    { memberId: 4902, orgId: 1, orgName: '(주)에스원테크', memberName: '홍길동', memberTp: 'A', current: true },
  ],
  error: [],
};

describe('HttpBbiyongAuth.verifySession', () => {
  it('GET {BASE}/rest/v1/s021200010/my-orgs — 토큰은 Authorization 머리글로만(주소에 싣지 않는다)', async () => {
    const { impl, calls } = stubFetch(json(MY_ORGS_BODY));
    const auth = new HttpBbiyongAuth({ baseUrl: BASE, fetchImpl: impl });

    await auth.verifySession('acc.tok.en', 'ref.tok.en');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${BASE}/rest/v1/s021200010/my-orgs`);
    expect(calls[0]!.init.method).toBe('GET');
    expect(new Headers(calls[0]!.init.headers).get('authorization')).toBe('Bearer acc.tok.en');
    expect(calls[0]!.url).not.toContain('tok.en');
  });

  it('지금 계정(current) 줄의 회원 · 회사를 쓰고 토큰은 받은 그대로 · 회사 구분은 없다(null)', async () => {
    const { impl } = stubFetch(json(MY_ORGS_BODY));
    const auth = new HttpBbiyongAuth({ baseUrl: BASE, fetchImpl: impl });

    await expect(auth.verifySession('acc.tok.en', 'ref.tok.en')).resolves.toEqual({
      memberId: 4902,
      orgId: 1,
      orgTp: null,
      memberName: '홍길동',
      orgName: '(주)에스원테크',
      accessToken: 'acc.tok.en',
      refreshToken: 'ref.tok.en',
    });
  });

  it('확인한 표시정보를 getProfile 이 돌려준다', async () => {
    const { impl } = stubFetch(json(MY_ORGS_BODY));
    const auth = new HttpBbiyongAuth({ baseUrl: BASE, fetchImpl: impl });
    await auth.verifySession('acc.tok.en', 'ref.tok.en');

    await expect(auth.getProfile(4902)).resolves.toEqual({ memberName: '홍길동', orgName: '(주)에스원테크', orgTp: null });
  });

  it('★ 삐용이 401(가짜 · 만료 토큰) 이면 BbiyongAuthError — 연결 실패로 뭉개지 않는다', async () => {
    const { impl } = stubFetch(json({ status: 401, result: 'fail', massage: '로그인이 필요합니다.', data: [], error: [] }, 401));
    const auth = new HttpBbiyongAuth({ baseUrl: BASE, fetchImpl: impl });

    const err = await auth.verifySession('bad', 'bad').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BbiyongAuthError);
    expect(err).not.toBeInstanceOf(BbiyongUnavailableError);
  });

  it('★ HTTP 200 + result:"fail" · 지금 계정 줄 없음 · 깨진 data 는 BbiyongAuthError', async () => {
    const bodies = [
      { status: 403, result: 'fail', massage: 'x', data: [], error: [] },
      { ...MY_ORGS_BODY, data: [{ ...MY_ORGS_BODY.data[0], current: false }] },
      { ...MY_ORGS_BODY, data: [] },
      { ...MY_ORGS_BODY, data: null },
      { ...MY_ORGS_BODY, data: [{ ...MY_ORGS_BODY.data[1], memberId: null }] },
    ];
    for (const body of bodies) {
      const { impl } = stubFetch(json(body));
      const auth = new HttpBbiyongAuth({ baseUrl: BASE, fetchImpl: impl });
      await expect(auth.verifySession('a', 'r'), JSON.stringify(body)).rejects.toBeInstanceOf(BbiyongAuthError);
    }
  });

  it('401 이 아닌 HTTP 비정상은 연결 · 인프라 문제다(인증 실패가 아니다)', async () => {
    for (const status of [403, 500, 502, 504]) {
      const { impl } = stubFetch(new Response('', { status }));
      const auth = new HttpBbiyongAuth({ baseUrl: BASE, fetchImpl: impl });
      const err = await auth.verifySession('a', 'r').catch((e: unknown) => e);
      expect(err, `HTTP ${status}`).toBeInstanceOf(BbiyongUnavailableError);
    }
  });

  it('★ 비밀번호를 받는 길은 없다 — signIn 이 없다', () => {
    const auth = new HttpBbiyongAuth({ baseUrl: BASE });
    expect('signIn' in auth).toBe(false);
  });
});

// =============================================================================
// 4. 내 메뉴 — 법무 회사 정보 「받기」가 실어 온 토큰을 확인한다 (2026-10-23)
// =============================================================================
describe('parseMyMenus', () => {
  it('성공이면 화면코드 목록 — 글자가 아닌 것은 버린다', () => {
    expect(parseMyMenus({ status: 200, result: 'success', massage: null, data: ['S021000000', 'S021100010', 7], error: [] })).toEqual({
      kind: 'ok',
      screens: ['S021000000', 'S021100010'],
    });
  });
  it('★ 지금 삐용 모양(규격서 §1-5 · 2026-10-03 바뀜) — 객체 배열의 menuCode 를 읽는다', () => {
    const data = [
      { menuCode: 'S021100021', keys: ['F001', 'F002'], menuNm: '내 단체 정보' },
      { menuCode: 'S021100010', keys: ['F001', 'F002'], menuNm: '단체관리' },
      { keys: ['F001'] },
      { menuCode: 7 },
    ];
    expect(parseMyMenus({ status: 200, result: 'success', massage: null, data, error: [] })).toEqual({
      kind: 'ok',
      screens: ['S021100021', 'S021100010'],
    });
  });
  it('★ 입구 거절(HTTP 200 · 본문 403 · AUTHZ_DENY) · 깨진 본문은 rejected', () => {
    const deny = { status: 403, result: 'fail', massage: '권한이 없습니다. 관리자에게 권한을 요청하세요', data: [], error: ['AUTHZ_DENY'] };
    expect(parseMyMenus(deny)).toEqual({ kind: 'rejected' });
    expect(parseMyMenus({ status: 200, result: 'success', data: null })).toEqual({ kind: 'rejected' });
    expect(parseMyMenus('x')).toEqual({ kind: 'rejected' });
  });
});

describe('parseMyMenuKeys — 화면별 기능 키(2026-10-25, 법무 회사 정보 수정 열기)', () => {
  it('★ 객체 배열의 menuCode → keys · 글자가 아닌 키는 버린다 · 키 없는 줄은 빠진다', () => {
    const data = [
      { menuCode: 'S021100021', keys: ['F001', 'F002', 3], menuNm: '내 단체 정보' },
      { menuCode: 'S021100010', keys: [] },
      { menuCode: 'S021000000' },
      { keys: ['F001'] },
    ];
    expect(parseMyMenuKeys({ status: 200, result: 'success', massage: null, data, error: [] })).toEqual({
      S021100021: ['F001', 'F002'],
      S021100010: [],
    });
  });
  it('옛 모양(문자열 배열) · 깨진 본문은 null', () => {
    expect(parseMyMenuKeys({ status: 200, result: 'success', data: ['S021100010'] })).toBeNull();
    expect(parseMyMenuKeys({ status: 200, result: 'success', data: null })).toBeNull();
    expect(parseMyMenuKeys('x')).toBeNull();
  });
  it('★ myMenus — 화면코드 목록은 그대로 두고 keys 를 덧붙인다', async () => {
    const data = [{ menuCode: 'S021100021', keys: ['F001', 'F002'] }];
    const { impl } = stubFetch(json({ status: 200, result: 'success', massage: null, data, error: [] }));
    const auth = new HttpBbiyongAuth({ baseUrl: BASE, fetchImpl: impl });
    await expect(auth.myMenus('eyJ.in')).resolves.toEqual({
      kind: 'ok',
      screens: ['S021100021'],
      keys: { S021100021: ['F001', 'F002'] },
    });
  });
});

describe('HttpBbiyongAuth.myMenus', () => {
  it('받은 토큰을 Bearer 로 싣고 GET my-menus 를 부른다', async () => {
    const { impl, calls } = stubFetch(json({ status: 200, result: 'success', massage: null, data: ['S021100010'], error: [] }));
    const auth = new HttpBbiyongAuth({ baseUrl: BASE, fetchImpl: impl });
    await expect(auth.myMenus('eyJ.in')).resolves.toEqual({ kind: 'ok', screens: ['S021100010'] });
    expect(calls[0]!.url).toBe(`${BASE}/rest/v1/s021000000/my-menus`);
    expect(calls[0]!.init.method).toBe('GET');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer eyJ.in');
  });
  it('★ HTTP 401 · 403 은 rejected(재발급하지 않는다) · 그 밖의 HTTP 비정상은 연결 문제로 던진다', async () => {
    for (const status of [401, 403]) {
      const { impl, calls } = stubFetch(new Response('', { status }));
      const auth = new HttpBbiyongAuth({ baseUrl: BASE, fetchImpl: impl });
      await expect(auth.myMenus('eyJ.in'), `HTTP ${status}`).resolves.toEqual({ kind: 'rejected' });
      expect(calls).toHaveLength(1);
    }
    const { impl } = stubFetch(new Response('', { status: 502 }));
    const auth = new HttpBbiyongAuth({ baseUrl: BASE, fetchImpl: impl });
    await expect(auth.myMenus('eyJ.in')).rejects.toBeInstanceOf(BbiyongUnavailableError);
  });
});

// =============================================================================
// 5. 지금 계정의 단체 — 「받기」가 운영사가 아닌 토큰의 회사를 확인한다 (2026-10-25)
// =============================================================================
describe('HttpBbiyongAuth.myOrg', () => {
  it('받은 토큰을 Bearer 로 싣고 GET my-orgs — 지금 계정(current) 줄의 단체', async () => {
    const { impl, calls } = stubFetch(json(MY_ORGS_BODY));
    const auth = new HttpBbiyongAuth({ baseUrl: BASE, fetchImpl: impl });
    await expect(auth.myOrg('eyJ.in')).resolves.toEqual({ kind: 'ok', orgId: 1 });
    expect(calls[0]!.url).toBe(`${BASE}/rest/v1/s021200010/my-orgs`);
    expect(calls[0]!.init.method).toBe('GET');
    expect(new Headers(calls[0]!.init.headers).get('authorization')).toBe('Bearer eyJ.in');
  });
  it('★ 지금 계정 줄이 없거나 실패 본문 · HTTP 401 · 403 은 rejected · 그 밖의 HTTP 비정상은 던진다', async () => {
    const noCurrent = { ...MY_ORGS_BODY, data: MY_ORGS_BODY.data.map((r) => ({ ...r, current: false })) };
    for (const res of [json(noCurrent), json({ status: 403, result: 'fail', data: [] }), new Response('', { status: 401 }), new Response('', { status: 403 })]) {
      const { impl } = stubFetch(res);
      const auth = new HttpBbiyongAuth({ baseUrl: BASE, fetchImpl: impl });
      await expect(auth.myOrg('eyJ.in')).resolves.toEqual({ kind: 'rejected' });
    }
    const { impl } = stubFetch(new Response('', { status: 502 }));
    const auth = new HttpBbiyongAuth({ baseUrl: BASE, fetchImpl: impl });
    await expect(auth.myOrg('eyJ.in')).rejects.toBeInstanceOf(BbiyongUnavailableError);
  });
});
