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
import { HttpBbiyongOrg, parseCreateOrg, parseMemberOp, parseOrgOp } from './HttpBbiyongOrg.ts';
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

/** 호출마다 **다른** 본문을 돌려주는 대역 — 재입주처럼 여러 번 부르는 흐름에 쓴다. */
function adapterSeq(bodies: readonly unknown[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: unknown, init: unknown) => {
    const body = bodies[calls.length] ?? bodies[bodies.length - 1];
    calls.push({ url: String(url), init: init as RequestInit });
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  return { org: new HttpBbiyongOrg({ baseUrl: 'http://192.168.0.22:8082', fetchImpl: impl }), calls };
}

// ★ 실발 응답은 `data.memberId`(대표 회원번호)를 함긼 준다(규경 2026-10-05).
const OK = { result: 'success', status: 200, massage: null, data: { orgId: 1234, memberId: 851 } };

describe('parseCreateOrg — ① 성공 게이트', () => {
  it('★ 셋 다 맞으면 created', () => {
    expect(parseCreateOrg(OK, 'Z01')).toEqual({ kind: 'created', orgId: 1234, orgCode: 'Z01', memberId: 851 });
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
      // ★★ 대표 회원번호가 없으면 `null` 이다 — **거정로 바꾸지 않는다.**
      //   회사는 이미 만들어졌고, 거지로 돌리면 다시 시도가 다은 코드로 회사를 하나 더 만들다.
      memberId: null,
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

    expect(calls[0]!.url).toBe('http://192.168.0.22:8082/rest/v1/s021100010/erp-register-org');
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
      throw new Error('connect ECONNREFUSED http://192.168.0.22:8082/rest/v1/s021100010/erp-register-org');
    }) as unknown as typeof fetch;
    const org = new HttpBbiyongOrg({ baseUrl: 'http://192.168.0.22:8082', fetchImpl: impl });

    await expect(org.createOrg(REQ, 'tok')).rejects.toThrow(BbiyongUnavailableError);
    await expect(org.createOrg(REQ, 'tok')).rejects.not.toThrow(/192\.168\.0\.22/);
  });
});

describe('HttpBbiyongOrg — ⑥ 퇴실 · 재입주 · 수정 (회신 2026-10-02)', () => {
  const OKOP = { result: 'success', status: 200, massage: null, data: null };

  /*
   * ★★★ 퇴실은 **한 번**(복수 배열), 재입주는 **두 번**(단수 문자열)이다.
   *     삐용이 그렇게 받는다(확인 2026-10-04). 보기에 어긋나 보여도 **맞추지 말 것** —
   *     모양을 「정리」하면 삐용이 모르는 칸을 조용히 무시하고 success 를 돌려줄 수 있다.
   *     아래 시험들이 그 비대칭을 그대로 굳힌다.
   */
  it('★★ 퇴실 — 한 번에 moduleCodes 배열로 둘을 보낸다', async () => {
    const { org, calls } = adapter(OKOP);
    const out = await org.moduleOff('Z01', 'tok');

    expect(out).toEqual({ kind: 'ok' });
    expect(calls).toHaveLength(1); // ★ 한 번이다
    expect(calls[0]!.url).toBe('http://192.168.0.22:8082/rest/v1/s021100010/erp-module-off');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      orgCode: 'Z01',
      moduleCodes: ['OFFICE', 'AUTHZ'],
    });
  });

  it('★★ 재입주 — 모듈마다 한 번씩, 단수 moduleCode 로 두 번 보낸다', async () => {
    const { org, calls } = adapter(OKOP);
    const out = await org.moduleOn('Z01', 'tok');

    expect(out).toEqual({ kind: 'ok' });
    expect(calls).toHaveLength(2); // ★ 두 번이다
    for (const call of calls) {
      expect(call.url).toBe('http://192.168.0.22:8082/rest/v1/s021100010/erp-module-on');
    }
    expect(calls.map((c) => JSON.parse(String(c.init.body)))).toEqual([
      { orgCode: 'Z01', moduleCode: 'OFFICE' },
      { orgCode: 'Z01', moduleCode: 'AUTHZ' },
    ]);
  });

  it('★★ 재입주 — 첫 모듈이 거절되면 **거기서 멈춘다**(두 번째를 보내지 않는다)', async () => {
    const { org, calls } = adapter({ result: 'fail', status: 403, massage: '권한이 없습니다', data: null });
    const out = await org.moduleOn('Z01', 'tok');

    expect(out.kind).toBe('rejected');
    // 반쯤 켜 놓고 성공이라 답하지 않는다. 남은 모듈은 [다시 시도] 가 처음부터 켠다.
    expect(calls).toHaveLength(1);
  });

  /*
   * ★★ 「이미 구독 중」(400)은 성공으로 친다(삐용 회신 2026-10-04).
   *    아래 둘이 **짝**이다 — 통과시키는 400 과 멈추는 400 을 함께 고정하지 않으면,
   *    「400 이면 다 넘어가기」로 넓혀도 시험이 통과해 버린다.
   */
  it('★★ 재입주 — 첫 모듈이 「이미 구독 중」이면 넘어가고 둘째를 보낸다', async () => {
    const { org, calls } = adapterSeq([
      { result: 'fail', status: 400, massage: '이미 구독 중인 서비스입니다', data: null },
      { result: 'success', status: 200, massage: null, data: null },
    ]);
    const out = await org.moduleOn('Z01', 'tok');

    expect(out).toEqual({ kind: 'ok' });
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => (JSON.parse(String(c.init.body)) as { moduleCode: string }).moduleCode)).toEqual([
      ...ORG_MODULE_CODES,
    ]);
  });

  it('★★★ 재입주 — 「선택할 수 없는 서비스」 400 은 **넘어가지 않는다**(안 켜졌는데 켜졌다고 믿으면 안 된다)', async () => {
    const { org, calls } = adapterSeq([
      { result: 'fail', status: 400, massage: 'AUTHZ(AUTHZ) 은(는) 지금 선택할 수 없는 서비스입니다', data: null },
      { result: 'success', status: 200, massage: null, data: null },
    ]);
    const out = await org.moduleOn('Z01', 'tok');

    expect(out.kind).toBe('rejected');
    expect(calls).toHaveLength(1); // 멈췄다
  });

  it('★ 모듈 목록은 등록과 **같은 상수**다 — 한 곳만 고치면 셋이 같이 바뀐다', async () => {
    const off = adapter(OKOP);
    await off.org.moduleOff('Z01', 'tok');
    const sentOff = JSON.parse(String(off.calls[0]!.init.body)) as { moduleCodes: string[] };

    const on = adapter(OKOP);
    await on.org.moduleOn('Z01', 'tok');
    const sentOn = on.calls.map((c) => (JSON.parse(String(c.init.body)) as { moduleCode: string }).moduleCode);

    expect(sentOff.moduleCodes).toEqual([...ORG_MODULE_CODES]);
    expect(sentOn).toEqual([...ORG_MODULE_CODES]);
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

/* ══════════════════════════════════════════════════════════════════════════
   직원정보 (규격 2026-10-05)
   ══════════════════════════════════════════════════════════════════════════ */

describe('sendMember — 보내는 칸', () => {
  const body = (calls: { init: RequestInit }[]) => JSON.parse(String(calls[0]!.init.body));

  it('★ I 는 memberId 를 싣지 않고 repYn 을 싣는다', async () => {
    const { org, calls } = adapter({ result: 'success', status: 200, data: { memberId: 851 } });
    const out = await org.sendMember(
      { regTp: 'I', orgCode: 'Z04', memberName: '이정희', email: 'a@x.com', hpNo: '01011112222', repYn: 'N' },
      'tok',
    );

    expect(calls[0]!.url).toContain('/rest/v1/s021100010/erp-member');
    expect(body(calls)).toEqual({
      regTp: 'I',
      orgCode: 'Z04',
      memberName: '이정희',
      email: 'a@x.com',
      repYn: 'N',
      hpNo: '01011112222',
    });
    expect(out).toEqual({ kind: 'created', memberId: 851 });
  });

  it('★★ U 는 memberId 를 싣고 repYn 을 **빼고** 보낸다 — repYn 은 I 에서만 쓴다', async () => {
    const { org, calls } = adapter({ result: 'success', status: 200 });
    await org.sendMember(
      { regTp: 'U', orgCode: 'Z04', memberId: 851, memberName: '최현수', email: 'ceo@x.com' },
      'tok',
    );

    expect(body(calls)).toEqual({
      regTp: 'U',
      orgCode: 'Z04',
      memberId: 851,
      memberName: '최현수',
      email: 'ceo@x.com',
    });
  });

  it('★★★ hpNo 가 비면 **칸 자체를 뺀다** — 빈 문자열은 삐용의 연락처를 지울 수 있다', async () => {
    const { org, calls } = adapter({ result: 'success', status: 200 });
    await org.sendMember(
      { regTp: 'U', orgCode: 'Z04', memberId: 851, memberName: '최현수', email: 'ceo@x.com', hpNo: '' },
      'tok',
    );

    expect('hpNo' in body(calls)).toBe(false);
  });

  it('D 는 번호로 지목하고 이름·이메일을 함께 싣는다', async () => {
    const { org, calls } = adapter({ result: 'success', status: 200 });
    const out = await org.sendMember(
      { regTp: 'D', orgCode: 'Z04', memberId: 902, memberName: '이정희', email: 'a@x.com' },
      'tok',
    );

    expect(body(calls)).toMatchObject({ regTp: 'D', memberId: 902 });
    expect(out).toEqual({ kind: 'ok' });
  });

  it('★★ 401 은 토큰 만료다 — 장애로 뭉개지 않는다(재발급이 돌아야 한다)', async () => {
    const { org } = adapter({ result: 'fail' }, 401);
    await expect(
      org.sendMember({ regTp: 'U', orgCode: 'Z04', memberId: 851, memberName: '최', email: 'a@x.com' }, 'tok'),
    ).rejects.toBeInstanceOf(BbiyongTokenExpiredError);
  });
});

describe('parseMemberOp — 성공 게이트', () => {
  it('★★ I 가 success 인데 번호가 없으면 **실패다** — 영원히 대기로 남는 상태를 만들지 않는다', () => {
    const out = parseMemberOp({ result: 'success', status: 200, data: {} }, 'I');
    expect(out.kind).toBe('rejected');
    if (out.kind === 'rejected') expect(out.message).toContain('회원번호');
  });

  it('U·D 는 번호를 돌려받지 않아도 성공이다', () => {
    expect(parseMemberOp({ result: 'success', status: 200 }, 'U')).toEqual({ kind: 'ok' });
    expect(parseMemberOp({ result: 'success', status: 200 }, 'D')).toEqual({ kind: 'ok' });
  });

  it('★ 실패도 HTTP 200 이다 — result/status 로 가른다', () => {
    const out = parseMemberOp(
      { result: 'fail', status: 400, massage: '이미 사용중인 이메일입니다.' },
      'I',
    );
    expect(out.kind).toBe('rejected');
    // ★ 이메일 겹침은 삐용 문구가 이미 사람 말이다 — 그대로 보인다.
    if (out.kind === 'rejected') expect(out.message).toContain('이미 사용중인 이메일');
  });

  it('★ 대표 삭제 거절도 삐용 문구를 그대로 쓴다', () => {
    const out = parseMemberOp({ result: 'fail', status: 400, massage: '대표는 삭제할 수 없습니다.' }, 'D');
    if (out.kind === 'rejected') expect(out.message).toContain('대표는 삭제할 수 없습니다');
  });

  it('403 은 등록과 같은 안내로 바꾼다', () => {
    const out = parseMemberOp({ result: 'fail', status: 403, error: ['AUTHZ_DENY'] }, 'U');
    if (out.kind === 'rejected') expect(out.message).toContain('단체관리');
  });

  it('★ 깨진 응답도 던지지 않는다 — rejected 다', () => {
    expect(parseMemberOp(null, 'I').kind).toBe('rejected');
    expect(parseMemberOp({ result: 'success', status: '200', data: { memberId: 1 } }, 'I').kind).toBe('rejected');
  });
});
