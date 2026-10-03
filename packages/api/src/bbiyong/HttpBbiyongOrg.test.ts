/**
 * HttpBbiyongOrg — 삐용 회사 등록 실호출.
 *
 * ★ 이 파일이 지키는 것:
 *   ① **실패도 HTTP 200 이다** — 성공 게이트 셋(`result`·`status`·HTTP)을 다 본다
 *   ② 중복은 `duplicate_code` 이고 **orgId 를 담지 않는다** (남의 회사일 수 있다)
 *   ③ 401 은 `BbiyongTokenExpiredError` — 장애로 뭉개지 않는다(재발급이 돌아야 한다)
 *   ④ 보내는 칸에 **주소·telNo 가 없다**, moduleCodes 는 `['OFFICE','AUTHZ']`
 *   ⑤ 응답이 깨져도 **던지지 않는다** — `rejected` 다
 *
 * 삐용 없이 돈다 — `fetchImpl` 을 갈아 끼운다.
 */
import { describe, it, expect } from 'vitest';
import { HttpBbiyongOrg, parseCreateOrg, parseOrgOp } from './HttpBbiyongOrg.ts';
import { BbiyongTokenExpiredError, BbiyongUnavailableError, type BbiyongOrgRequest } from './types.ts';
import { ORG_MODULE_CODES } from './orgLink.ts';

const REQ: BbiyongOrgRequest = {
  orgName: '한성무역',
  orgCode: 'Z01',
  memberName: '김대표',
  hpNo: '01012345678',
  email: 'ceo@hanseong.co.kr',
  countryCode: 'KR',
  moduleCodes: ORG_MODULE_CODES,
};

/** 본문 하나를 돌려주는 대역. 기록도 남긴다. */
function fetchOf(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: init as RequestInit });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function adapter(body: unknown, status = 200) {
  const { impl, calls } = fetchOf(body, status);
  return { org: new HttpBbiyongOrg({ baseUrl: 'http://192.168.0.22:8082', fetchImpl: impl }), calls };
}

const OK = { result: 'success', status: 200, massage: null, data: { orgId: 1234 } };

describe('parseCreateOrg — ① 성공 게이트', () => {
  it('★ 셋 다 맞으면 created', () => {
    expect(parseCreateOrg(OK, 'Z01')).toEqual({ kind: 'created', orgId: 1234, orgCode: 'Z01' });
  });

  it('★★ result 가 fail 이면 성공이 아니다 — HTTP 200 이어도', () => {
    const out = parseCreateOrg({ result: 'fail', status: 400, massage: '단체코드는 영문/숫자 3자리로 입력해주세요.' }, 'Z01');
    expect(out.kind).toBe('rejected');
  });

  it('★★ status 가 200 이 아니면 성공이 아니다', () => {
    expect(parseCreateOrg({ result: 'success', status: 403, massage: '권한이 없습니다' }, 'Z01').kind).toBe('rejected');
  });

  it("★ status 가 문자열 '200' 이면 성공으로 보지 않는다 — 판정은 엄격하게", () => {
    expect(parseCreateOrg({ result: 'success', status: '200', data: { orgId: 7 } }, 'Z01').kind).toBe('rejected');
  });

  it('★★ orgId 가 없으면 성공으로 삼지 않는다 — 없는 번호를 link 에 박지 않는다', () => {
    const out = parseCreateOrg({ result: 'success', status: 200, data: {} }, 'Z01');
    expect(out.kind).toBe('rejected');
    if (out.kind === 'rejected') expect(out.message).toContain('회사 번호');
  });

  it('orgId 가 숫자문자열이어도 받는다 — 식별자는 너그럽게', () => {
    expect(parseCreateOrg({ result: 'success', status: 200, data: { orgId: '1234' } }, 'Z01')).toEqual({
      kind: 'created',
      orgId: 1234,
      orgCode: 'Z01',
    });
  });
});

describe('parseCreateOrg — ② 중복', () => {
  const DUP = {
    result: 'fail',
    status: 400,
    massage: '이미 사용중인 단체코드입니다.',
    data: { orgId: 777 },
  };

  it('★ duplicate_code 로 읽는다 — 호출자가 다음 번호로 간다', () => {
    expect(parseCreateOrg(DUP, 'Z01')).toEqual({ kind: 'duplicate_code', orgCode: 'Z01' });
  });

  it('★★★ 응답의 orgId 를 담지 않는다 — 남의 회사일 수 있다', () => {
    const out = parseCreateOrg(DUP, 'Z01');
    expect(out).not.toHaveProperty('orgId');
    expect(JSON.stringify(out)).not.toContain('777');
  });
});

describe('parseCreateOrg — ③ 거절은 사람이 읽을 문구로', () => {
  it('★ 403 은 무엇을 해야 하는지까지 적어 준다', () => {
    const out = parseCreateOrg({ result: 'fail', status: 403, error: ['AUTHZ_DENY'], massage: '권한이 없습니다…' }, 'Z01');
    expect(out.kind).toBe('rejected');
    if (out.kind === 'rejected') {
      expect(out.message).toContain('단체관리');
      expect(out.retryable).toBe(false);
      // ★ 삐용 내부 문구를 날것으로 흘리지 않는다.
      expect(out.message).not.toContain('권한이 없습니다…');
    }
  });

  it('400 은 삐용 문구가 이미 사람 말이라 그대로 쓴다', () => {
    const out = parseCreateOrg({ result: 'fail', status: 400, massage: '단체코드는 영문/숫자 3자리로 입력해주세요.' }, 'ZZZZ');
    if (out.kind === 'rejected') expect(out.message).toContain('3자리');
  });

  it('409 는 삐용 시드 문제 — 다시 시도해도 풀리지 않는다', () => {
    const out = parseCreateOrg({ result: 'fail', status: 409, massage: '권한 견본이 …' }, 'Z01');
    if (out.kind === 'rejected') {
      expect(out.message).toContain('삐용 담당자');
      expect(out.retryable).toBe(false);
    }
  });

  it('★★ 500 「등록되었으나 권한 설정이 끝나지 않았다」 — 다시 시도하지 말라고 적는다', () => {
    const out = parseCreateOrg({ result: 'fail', status: 500, massage: '단체는 등록되었으나…' }, 'Z01');
    if (out.kind === 'rejected') {
      expect(out.message).toContain('즉시');
      expect(out.retryable).toBe(false);
    }
  });

  it('★ 모르는 응답도 던지지 않는다 — rejected 다', () => {
    expect(parseCreateOrg({ result: 'weird', status: 999 }, 'Z01').kind).toBe('rejected');
    expect(parseCreateOrg(null, 'Z01').kind).toBe('rejected');
    expect(parseCreateOrg('문자열', 'Z01').kind).toBe('rejected');
    expect(parseCreateOrg([], 'Z01').kind).toBe('rejected');
  });
});

describe('HttpBbiyongOrg — ④ 보내는 것', () => {
  it('★ 경로와 Bearer 토큰', async () => {
    const { org, calls } = adapter(OK);
    await org.createOrg(REQ, 'tok-abc');

    expect(calls[0]!.url).toBe('http://192.168.0.22:8082/rest/v1/s021100020/org');
    expect(calls[0]!.init.method).toBe('POST');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tok-abc');
    expect(headers['content-type']).toBe('application/json');
  });

  it('★★ 주소·telNo 를 보내지 않는다 — 그 칸은 대표자 자택이다', async () => {
    const { org, calls } = adapter(OK);
    await org.createOrg(REQ, 'tok');

    const sent = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>;
    for (const key of ['zipCode', 'address', 'detailAddress', 'telNo', 'pwd', 'bizNumber']) {
      expect(sent, key).not.toHaveProperty(key);
    }
  });

  it("★ moduleCodes 는 ['OFFICE','AUTHZ'] · hpNo 는 숫자만 · countryCode 는 KR", async () => {
    const { org, calls } = adapter(OK);
    await org.createOrg(REQ, 'tok');

    const sent = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>;
    expect(sent.moduleCodes).toEqual(['OFFICE', 'AUTHZ']);
    expect(sent.hpNo).toBe('01012345678');
    expect(sent.countryCode).toBe('KR');
    expect(sent.orgCode).toBe('Z01');
  });
});

describe('HttpBbiyongOrg — ⑤ 전송 실패', () => {
  it('★★ 401 은 BbiyongTokenExpiredError — 장애로 뭉개지 않는다(재발급이 돌아야 한다)', async () => {
    const { org } = adapter({ exceptionEnum: { code: 'A001' } }, 401);
    await expect(org.createOrg(REQ, 'tok')).rejects.toThrow(BbiyongTokenExpiredError);
  });

  it('그 밖의 HTTP 비정상은 장애다 — 업무 실패는 200 으로 온다', async () => {
    const { org } = adapter({}, 403);
    await expect(org.createOrg(REQ, 'tok')).rejects.toThrow(BbiyongUnavailableError);
  });

  it('JSON 이 아니면 장애다 — 본문은 메시지에 담지 않는다', async () => {
    const { org } = adapter('<html>proxy error</html>');
    await expect(org.createOrg(REQ, 'tok')).rejects.toThrow(BbiyongUnavailableError);
    await expect(org.createOrg(REQ, 'tok')).rejects.not.toThrow(/proxy/);
  });

  it('★ 연결 실패 메시지에 URL·토큰을 남기지 않는다', async () => {
    const impl = (async () => {
      throw new Error('connect ECONNREFUSED http://192.168.0.22:8082/rest/v1/s021100020/org');
    }) as unknown as typeof fetch;
    const org = new HttpBbiyongOrg({ baseUrl: 'http://192.168.0.22:8082', fetchImpl: impl });

    await expect(org.createOrg(REQ, 'tok')).rejects.toThrow(BbiyongUnavailableError);
    await expect(org.createOrg(REQ, 'tok')).rejects.not.toThrow(/192\.168\.0\.22/);
  });
});

describe('HttpBbiyongOrg — ⑥ 퇴실 · 재입주 · 수정 (회신 2026-10-02)', () => {
  const OKOP = { result: 'success', status: 200, massage: null, data: null };

  it('★ 퇴실 — 경로와 본문', async () => {
    const { org, calls } = adapter(OKOP);
    const out = await org.moduleOff('Z01', 'tok');

    expect(out).toEqual({ kind: 'ok' });
    expect(calls[0]!.url).toBe('http://192.168.0.22:8082/rest/v1/s021100010/erp-module-off');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ orgCode: 'Z01', moduleCode: 'OFFICE' });
  });

  it('★ 재입주 — 경로와 본문', async () => {
    const { org, calls } = adapter(OKOP);
    const out = await org.moduleOn('Z01', 'tok');

    expect(out).toEqual({ kind: 'ok' });
    expect(calls[0]!.url).toBe('http://192.168.0.22:8082/rest/v1/s021100010/erp-module-on');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ orgCode: 'Z01', moduleCode: 'OFFICE' });
  });

  it('★★★ 수정 — 보내는 칸은 둘뿐이다. 주소를 빈 문자열로도 보내지 않는다', async () => {
    const { org, calls } = adapter(OKOP);
    await org.patchOrg({ orgCode: 'Z01', orgName: '한성무역' }, 'tok');

    expect(calls[0]!.url).toBe('http://192.168.0.22:8082/rest/v1/s021100010/erp-patch-org');
    const sent = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(['orgCode', 'orgName']);
    // ★ 빈 문자열로 보내면 삐용에 들어 있는 주소가 지워진다 — 되돌릴 수 없다.
    for (const key of ['zipCode', 'address', 'detailAddress', 'telNo']) {
      expect(sent, key).not.toHaveProperty(key);
    }
  });

  it('세 호출 모두 Bearer 토큰을 싣는다', async () => {
    for (const run of [
      (o: ReturnType<typeof adapter>['org']) => o.moduleOff('Z01', 'tok-x'),
      (o: ReturnType<typeof adapter>['org']) => o.moduleOn('Z01', 'tok-x'),
      (o: ReturnType<typeof adapter>['org']) => o.patchOrg({ orgCode: 'Z01', orgName: '가' }, 'tok-x'),
    ]) {
      const { org, calls } = adapter(OKOP);
      await run(org);
      expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer tok-x');
    }
  });

  it('★★ 401 은 재발급으로 — 세 호출 다 같다', async () => {
    for (const run of [
      (o: ReturnType<typeof adapter>['org']) => o.moduleOff('Z01', 'tok'),
      (o: ReturnType<typeof adapter>['org']) => o.moduleOn('Z01', 'tok'),
      (o: ReturnType<typeof adapter>['org']) => o.patchOrg({ orgCode: 'Z01', orgName: '가' }, 'tok'),
    ]) {
      const { org } = adapter({}, 401);
      await expect(run(org)).rejects.toThrow(BbiyongTokenExpiredError);
    }
  });

  it('★ 두 번 보낸 경우 — 삐용 문구를 그대로 사유로 쓴다', async () => {
    const { org } = adapter({ result: 'fail', status: 400, massage: '이미 퇴실 처리된 회사입니다.' });
    const out = await org.moduleOff('Z01', 'tok');

    expect(out.kind).toBe('rejected');
    if (out.kind === 'rejected') expect(out.message).toContain('이미 퇴실');
  });

  it('403 은 등록과 같은 안내로 바꾼다', async () => {
    const { org } = adapter({ result: 'fail', status: 403, error: ['AUTHZ_DENY'] });
    const out = await org.moduleOn('Z01', 'tok');

    if (out.kind === 'rejected') expect(out.message).toContain('단체관리');
  });

  it('★ 깨진 응답도 던지지 않는다 — rejected 다', async () => {
    expect(parseOrgOp(null, '퇴실').kind).toBe('rejected');
    expect(parseOrgOp({ result: 'success', status: '200' }, '퇴실').kind).toBe('rejected');
  });
});
