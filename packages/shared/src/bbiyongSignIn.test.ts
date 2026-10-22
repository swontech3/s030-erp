/**
 * 브라우저가 삐용 로그인을 직접 부른 뒤 그 응답을 읽는 자리 (규격서 Q6 · 2026-10-22).
 *
 * ★★ 지키는 것 — 종전 API 의 parseSignIn 이 지키던 것을 그대로 옮긴다.
 *    1) HTTP 200 + `result: 'fail'` 을 성공으로 읽지 않는다(삐용은 실패도 200 이다)
 *    2) needOrgSelect 는 성공 게이트보다 **먼저** 본다 — 겸직을 「비밀번호 틀림」으로 뭉개지 않는다
 *    3) 깨진 응답에도 예외를 던지지 않는다 — 실패다
 * ★ 브라우저가 읽는 것은 **토큰 둘뿐**이다. 회원번호 · 회사번호는 ERP 서버가 삐용에 물어 확인한다.
 */
import { describe, it, expect } from 'vitest';
import { BBIYONG, readSignInTokens, INVALID_CREDENTIALS_MESSAGE, ORG_SELECT_MESSAGE } from './index';

const SUCCESS_BODY = {
  status: 200,
  result: 'success',
  massage: '성공하였습니다.',
  data: {
    memberId: 1234,
    orgId: 42,
    orgTp: 'S',
    memberName: '홍길동',
    orgName: '주식회사 예시',
    accessToken: 'eyJhbGciOiJIUzI1NiJ9.access',
    refreshToken: 'eyJhbGciOiJIUzI1NiJ9.refresh',
  },
  error: null,
};

describe('readSignInTokens', () => {
  it('성공이면 토큰 둘만 돌려준다', () => {
    expect(readSignInTokens(SUCCESS_BODY)).toEqual({
      kind: 'success',
      accessToken: 'eyJhbGciOiJIUzI1NiJ9.access',
      refreshToken: 'eyJhbGciOiJIUzI1NiJ9.refresh',
    });
  });

  it('★ HTTP 200 + result:"fail" 은 실패다 — 문구는 하나', () => {
    const out = readSignInTokens({ status: 403, result: 'fail', massage: '로그인 실패', data: { code: 'A005' }, error: [] });
    expect(out).toEqual({ kind: 'fail', message: INVALID_CREDENTIALS_MESSAGE });
  });

  it('status 가 문자열 "200" 이면 성공이 아니다', () => {
    expect(readSignInTokens({ ...SUCCESS_BODY, status: '200' }).kind).toBe('fail');
  });

  it('★ needOrgSelect 는 성공 게이트보다 먼저 — result:"fail" 로 와도 겸직 안내', () => {
    const out = readSignInTokens({ status: 200, result: 'fail', data: { needOrgSelect: true, candidates: [] } });
    expect(out).toEqual({ kind: 'orgSelect', message: ORG_SELECT_MESSAGE });
  });

  it('토큰이 하나라도 없으면 실패다', () => {
    expect(readSignInTokens({ ...SUCCESS_BODY, data: { ...SUCCESS_BODY.data, refreshToken: '' } }).kind).toBe('fail');
    expect(readSignInTokens({ ...SUCCESS_BODY, data: { ...SUCCESS_BODY.data, accessToken: undefined } }).kind).toBe('fail');
  });

  it('깨진 응답에도 던지지 않는다', () => {
    for (const bad of [null, undefined, 'x', 42, [], { result: 'success', status: 200 }]) {
      expect(readSignInTokens(bad).kind).toBe('fail');
    }
  });
});

describe('삐용 주소는 설정 값으로만', () => {
  it('★ 코드에 기본 주소가 없다 — BBIYONG.BASE_URL 이 없다', () => {
    expect('BASE_URL' in BBIYONG).toBe(false);
  });
});
