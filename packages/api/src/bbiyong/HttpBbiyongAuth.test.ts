/**
 * HttpBbiyongAuth — 삐용 로그인 API 응답 파싱.
 *
 * ★★ 이 파일이 지키는 것은 두 줄이다. 나머지가 다 통과해도 이 둘이 뚫리면 로그인이 뚫린다.
 *    1) HTTP 200 + `result: 'fail'` 을 성공으로 오판하지 않는다
 *       — 삐용은 CustomResponse.fail() 을 ResponseEntity.ok() 로 감싼다. res.ok 만 보면
 *         **실패한 로그인이 통과한다.**
 *    2) 실패 사유 필드는 `massage` 다(오타지만 실제 필드명). `message` 로 읽으면 항상
 *       undefined 라 조용히 죽는다.
 *
 * 응답 예시는 삐용 회신 ⑦ 과 .planning/research/BBIYONG-AUTH.md §2.3 을 그대로 옮겼다.
 */
import { describe, it, expect } from 'vitest';
import {
  HttpBbiyongAuth,
  parseSignIn,
  parseReIssue,
  INVALID_CREDENTIALS_MESSAGE,
  ORG_SELECT_MESSAGE,
} from './HttpBbiyongAuth.ts';
import { BbiyongAuthError, BbiyongOrgSelectRequiredError, BbiyongUnavailableError } from './types.ts';

// ── 회신에 실린 실제 응답 예시 ────────────────────────────────────────────────
const SUCCESS_BODY = {
  status: 200,
  result: 'success',
  massage: '성공하였습니다.',
  data: {
    memberId: 1234,
    email: 'user@example.com',
    memberName: '홍길동',
    memberTp: 'C',
    orgId: 42,
    orgName: '주식회사 예시',
    orgTp: 'S',
    mailAgentYn: 'N',
    accessToken: 'eyJhbGciOiJIUzI1NiJ9.access',
    refreshToken: 'eyJhbGciOiJIUzI1NiJ9.refresh',
  },
  error: null,
};

const ORG_SELECT_BODY = {
  status: 200,
  result: 'success',
  massage: null,
  data: {
    needOrgSelect: true,
    selectToken: 'eyJhbGciOiJIUzI1NiJ9.select',
    candidates: [
      { memberId: 1234, orgId: 42, orgName: '주식회사 예시' },
      { memberId: 5678, orgId: 77, orgName: '다른 단체' },
    ],
  },
  error: null,
};

const FAIL_BODY = {
  status: 403,
  result: 'fail',
  massage: '이메일 또는 비밀번호를 확인해 주세요.',
  data: null,
  error: 'A005',
};

/**
 * ★ 2026-09-08 개발계(192.168.0.14:8082)에서 **실제로 받은** 실패 응답.
 *   회신의 예시와 모양이 다르다 — 오류 코드가 `data.code` 에 있고 최상위 `error` 는 빈 배열이다.
 *   회신 문서만 보고 짠 파서는 조용히 `code=-` 만 남긴다. 실물로 고정해 둔다.
 */
const REAL_FAIL_BODY = {
  status: 403,
  result: 'fail',
  massage: '로그인 실패',
  data: { status: 403, code: 'A005', message: '가입된 이메일 정보가 없습니다.' },
  error: [],
};

/** 응답을 통째로 만드는 대신, 예시에서 한 필드만 바꿔 본다. */
function withData(patch: Record<string, unknown>) {
  return { ...SUCCESS_BODY, data: { ...SUCCESS_BODY.data, ...patch } };
}

// =============================================================================
// 1. 파싱 — 순수 함수
// =============================================================================
describe('parseSignIn — 성공 판정', () => {
  it('성공(단일 단체) 응답에서 토큰과 orgId 를 뽑는다', () => {
    const out = parseSignIn(SUCCESS_BODY);
    expect(out.kind).toBe('success');
    if (out.kind !== 'success') return;
    expect(out.result).toEqual({
      memberId: 1234,
      orgId: 42,
      orgTp: 'S',
      memberName: '홍길동',
      orgName: '주식회사 예시',
      accessToken: 'eyJhbGciOiJIUzI1NiJ9.access',
      refreshToken: 'eyJhbGciOiJIUzI1NiJ9.refresh',
    });
  });

  it('★ HTTP 200 으로 온 result:"fail" 을 성공으로 오판하지 않는다', () => {
    // 이 응답은 HTTP 200 이다. res.ok 만 보면 여기서 로그인이 통과한다.
    expect(parseSignIn(FAIL_BODY).kind).toBe('fail');
    // ★ data 까지 채워져 온 실패 — data 유무가 아니라 **게이트**가 막아야 한다.
    //   (FAIL_BODY 는 data 가 null 이라 게이트를 지워도 통과한다. 이 줄이 진짜 검사다.)
    expect(parseSignIn({ ...SUCCESS_BODY, result: 'fail', status: 403 }).kind).toBe('fail');
  });

  it('★ status 가 200 이어도 result 가 success 가 아니면 실패다', () => {
    expect(parseSignIn({ ...FAIL_BODY, status: 200 }).kind).toBe('fail');
    expect(parseSignIn({ ...SUCCESS_BODY, result: 'fail' }).kind).toBe('fail');
  });

  it('★ result 가 success 여도 status 가 200 이 아니면 실패다', () => {
    expect(parseSignIn({ ...SUCCESS_BODY, status: 403 }).kind).toBe('fail');
  });

  it('status 가 문자열 "200" 이어도 성공으로 보지 않는다 (규격은 숫자다)', () => {
    expect(parseSignIn({ ...SUCCESS_BODY, status: '200' }).kind).toBe('fail');
  });
});

describe('parseSignIn — massage 필드', () => {
  it('★ 실패 사유는 massage 에서 읽는다', () => {
    const out = parseSignIn(FAIL_BODY);
    if (out.kind !== 'fail') throw new Error('실패로 판정되어야 한다');
    expect(out.serverMessage).toBe('이메일 또는 비밀번호를 확인해 주세요.');
    expect(out.errorCode).toBe('A005');
  });

  it('★ 실물 응답 — data 가 채워진 실패도 실패다', () => {
    expect(parseSignIn(REAL_FAIL_BODY).kind).toBe('fail');
  });

  it('★ 실물 응답 — 오류 코드가 data.code 에 있어도 줍는다 (최상위 error 는 빈 배열이었다)', () => {
    const out = parseSignIn(REAL_FAIL_BODY);
    if (out.kind !== 'fail') throw new Error('실패로 판정되어야 한다');
    expect(out.errorCode).toBe('A005');
    // 로그에 남길 사유. massage 만으로는 "로그인 실패" 뿐이라 원인을 알 수 없다.
    expect(out.serverMessage).toContain('가입된 이메일 정보가 없습니다.');
  });

  it('★ 그 사유를 사용자에게 보여주지는 않는다 — 계정 존재 여부가 새면 안 된다', async () => {
    const { impl } = stubFetch(json(REAL_FAIL_BODY));
    const auth = new HttpBbiyongAuth({ baseUrl: BASE, fetchImpl: impl });

    const err = await auth.signIn('nobody@example.com', 'x').catch((e: unknown) => e);
    expect((err as Error).message).toBe(INVALID_CREDENTIALS_MESSAGE);
    expect((err as Error).message).not.toContain('가입된 이메일');
  });

  it('★ message(정상 철자) 로 읽지 않는다 — massage 가 없으면 사유는 null 이다', () => {
    const body = { status: 403, result: 'fail', message: '이건 읽으면 안 된다', data: null, error: 'A005' };
    const out = parseSignIn(body);
    if (out.kind !== 'fail') throw new Error('실패로 판정되어야 한다');
    expect(out.serverMessage).toBeNull();
  });
});

describe('parseSignIn — needOrgSelect', () => {
  it('needOrgSelect 가 있으면 안내 경로로 간다 (예외를 던지지 않는다)', () => {
    const out = parseSignIn(ORG_SELECT_BODY);
    expect(out.kind).toBe('orgSelect');
    if (out.kind !== 'orgSelect') return;
    expect(out.candidateCount).toBe(2);
  });

  it('needOrgSelect 응답에서 selectToken 을 결과에 담지 않는다 (3분 유효, 보관 금지)', () => {
    const out = parseSignIn(ORG_SELECT_BODY);
    expect(JSON.stringify(out)).not.toContain('select');
  });

  it('needOrgSelect 판정은 값이 아니라 존재 여부로 한다', () => {
    const body = { ...ORG_SELECT_BODY, data: { ...ORG_SELECT_BODY.data, needOrgSelect: false } };
    expect(parseSignIn(body).kind).toBe('orgSelect');
  });
});

describe('parseSignIn — 깨진 응답은 실패다 (예외를 던지지 않는다)', () => {
  const broken: [string, unknown][] = [
    ['null', null],
    ['undefined', undefined],
    ['문자열', '서버 점검 중입니다'],
    ['배열', [1, 2, 3]],
    ['빈 객체', {}],
    ['data 없음', { status: 200, result: 'success', massage: null, error: null }],
    ['data 가 null', { ...SUCCESS_BODY, data: null }],
    ['data 가 문자열', { ...SUCCESS_BODY, data: 'ok' }],
  ];
  for (const [name, body] of broken) {
    it(`${name} → fail`, () => {
      expect(() => parseSignIn(body)).not.toThrow();
      expect(parseSignIn(body).kind).toBe('fail');
    });
  }

  it('accessToken 이 없으면 실패다 — 반쪽 세션을 만들지 않는다', () => {
    expect(parseSignIn(withData({ accessToken: undefined })).kind).toBe('fail');
  });

  it('refreshToken 이 빈 문자열이면 실패다', () => {
    expect(parseSignIn(withData({ refreshToken: '' })).kind).toBe('fail');
  });

  it('★ orgId 가 없으면 실패다 — orgId 는 응답 본문에만 있고 JWT 에는 없다', () => {
    expect(parseSignIn(withData({ orgId: undefined })).kind).toBe('fail');
  });

  it('memberId 가 없으면 실패다', () => {
    expect(parseSignIn(withData({ memberId: null })).kind).toBe('fail');
  });

  it('orgTp 가 없으면 실패다 — 운영사/입주사 스코프를 정할 수 없다', () => {
    expect(parseSignIn(withData({ orgTp: undefined })).kind).toBe('fail');
  });

  it('표시용 이름이 없어도 로그인은 된다 (빈 문자열)', () => {
    const out = parseSignIn(withData({ memberName: undefined, orgName: undefined }));
    if (out.kind !== 'success') throw new Error('성공이어야 한다');
    expect(out.result.memberName).toBe('');
    expect(out.result.orgName).toBe('');
  });
});

// =============================================================================
// 2. 어댑터 — 실제 fetch 호출 모양과 예외 번역
// =============================================================================
/** 응답 하나를 돌려주는 fetch 대역. 요청은 그대로 기록한다. */
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

describe('HttpBbiyongAuth.signIn', () => {
  it('POST {BASE}/rest/v1/s021200010/sign-in 에 {email, pwd} 로 보낸다', async () => {
    const { impl, calls } = stubFetch(json(SUCCESS_BODY));
    const auth = new HttpBbiyongAuth({ baseUrl: BASE, fetchImpl: impl });

    await auth.signIn('user@example.com', 'secret!');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${BASE}/rest/v1/s021200010/sign-in`);
    expect(calls[0]!.init.method).toBe('POST');
    // 필드명은 pwd 다. password 로 보내면 삐용이 못 읽는다.
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ email: 'user@example.com', pwd: 'secret!' });
  });

  it('성공하면 memberId·orgId·토큰을 돌려준다', async () => {
    const { impl } = stubFetch(json(SUCCESS_BODY));
    const auth = new HttpBbiyongAuth({ baseUrl: BASE, fetchImpl: impl });

    const login = await auth.signIn('user@example.com', 'secret!');

    expect(login.memberId).toBe(1234);
    expect(login.orgId).toBe(42);
    expect(login.accessToken).toBe('eyJhbGciOiJIUzI1NiJ9.access');
  });

  it('★ HTTP 200 + result:"fail" 이면 BbiyongAuthError 를 던진다', async () => {
    const { impl } = stubFetch(json(FAIL_BODY));
    const auth = new HttpBbiyongAuth({ baseUrl: BASE, fetchImpl: impl });

    await expect(auth.signIn('user@example.com', 'wrong')).rejects.toBeInstanceOf(BbiyongAuthError);
  });

  it('실패 메시지는 고정 문구다 — 이메일 없음과 비밀번호 틀림을 구분하지 않는다', async () => {
    const { impl } = stubFetch(json(FAIL_BODY));
    const auth = new HttpBbiyongAuth({ baseUrl: BASE, fetchImpl: impl });

    // 삐용의 massage 를 그대로 화면에 흘리면 삐용 문구 변경이 곧 ERP 화면 변경이 된다.
    await expect(auth.signIn('user@example.com', 'wrong')).rejects.toThrow(INVALID_CREDENTIALS_MESSAGE);
  });

  it('needOrgSelect 면 BbiyongOrgSelectRequiredError 를 던진다 — 안내 문구가 붙는다', async () => {
    const { impl } = stubFetch(json(ORG_SELECT_BODY));
    const auth = new HttpBbiyongAuth({ baseUrl: BASE, fetchImpl: impl });

    const err = await auth.signIn('user@example.com', 'secret!').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BbiyongOrgSelectRequiredError);
    expect(err).toBeInstanceOf(BbiyongAuthError); // 라우트는 여전히 401 로 번역한다
    expect((err as Error).message).toBe(ORG_SELECT_MESSAGE);
  });

  it('삐용이 HTTP 500 이면 인증 실패가 아니라 연결 실패로 번역한다', async () => {
    const { impl } = stubFetch(new Response('gateway error', { status: 500 }));
    const auth = new HttpBbiyongAuth({ baseUrl: BASE, fetchImpl: impl });

    const err = await auth.signIn('user@example.com', 'secret!').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BbiyongUnavailableError);
    expect(err).not.toBeInstanceOf(BbiyongAuthError); // 사용자 잘못으로 돌리지 않는다
  });

  it('응답이 JSON 이 아니어도 예외로 죽지 않는다 (연결 실패로 번역)', async () => {
    const { impl } = stubFetch(new Response('<html>502 Bad Gateway</html>', { status: 200 }));
    const auth = new HttpBbiyongAuth({ baseUrl: BASE, fetchImpl: impl });

    await expect(auth.signIn('user@example.com', 'secret!')).rejects.toBeInstanceOf(BbiyongUnavailableError);
  });

  it('★ 네트워크 오류 메시지에 비밀번호가 섞이지 않는다', async () => {
    const { impl } = stubFetch(async () => {
      throw new TypeError('fetch failed: https://bbiyong.example.test/rest/v1/s021200010/sign-in?pwd=secret!');
    });
    const auth = new HttpBbiyongAuth({ baseUrl: BASE, fetchImpl: impl });

    const err = await auth.signIn('user@example.com', 'secret!').catch((e: unknown) => e);
    expect((err as Error).message).not.toContain('secret!');
  });
});

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

describe('HttpBbiyongAuth.getProfile', () => {
  it('로그인에서 받은 표시정보를 돌려준다', async () => {
    const { impl } = stubFetch(json(SUCCESS_BODY));
    const auth = new HttpBbiyongAuth({ baseUrl: BASE, fetchImpl: impl });
    await auth.signIn('user@example.com', 'secret!');

    await expect(auth.getProfile(1234)).resolves.toEqual({
      memberName: '홍길동',
      orgName: '주식회사 예시',
      orgTp: 'S',
    });
  });

  it('모르는 memberId 는 null 이다 — 화면은 빈 이름으로 버틴다', async () => {
    const { impl } = stubFetch(json(SUCCESS_BODY));
    const auth = new HttpBbiyongAuth({ baseUrl: BASE, fetchImpl: impl });

    await expect(auth.getProfile(9999)).resolves.toBeNull();
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
  });
});
