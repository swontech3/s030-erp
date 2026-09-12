/**
 * MockBbiyongAcl.getScope — 데이터 스코프 판정.
 *
 * ★ 이 테스트가 지키는 것은 하나다: **scope 는 orgTp 에서 유도되지 않는다.**
 *   `orgTp === 'S' → operator` 는 RLS 전체열람 스위치였고 2026-09-12 회신 §1 로 제거됐다.
 *   그 줄이 어떤 형태로든 되살아나면 여기서 걸린다.
 */
import { describe, expect, it } from 'vitest';
import { MockBbiyongAcl } from './MockBbiyongAcl.ts';
import type { AclSubject } from './types.ts';

const acl = new MockBbiyongAcl();

/** 판정 입력에는 식별자만 있다 — orgTp 는 없다(회신 §2). */
const subject = (s020MemberId: number, s020OrgId: number): AclSubject => ({ s020MemberId, s020OrgId });

const ADMIN = subject(1001, 1);
const OPERATOR = subject(1002, 1);
const TENANT = subject(2001, 9001);
const NOACCESS = subject(2002, 9002);

describe('MockBbiyongAcl.getScope', () => {
  it('계정 데이터의 scope 를 그대로 돌려준다 — 운영사 2계정', () => {
    expect(acl.getScope(ADMIN, null)).toEqual({ role: 'operator', companyId: null });
    expect(acl.getScope(OPERATOR, null)).toEqual({ role: 'operator', companyId: null });
  });

  it('계정 데이터의 scope 를 그대로 돌려준다 — 입주사', () => {
    expect(acl.getScope(TENANT, 'c-9001')).toEqual({ role: 'tenant', companyId: 'c-9001' });
  });

  it('연결이 없는 계정은 companyId 가 null 이다 — 예외가 아니라 빈 스코프', () => {
    expect(acl.getScope(NOACCESS, null)).toEqual({ role: 'tenant', companyId: null });
  });

  it('orgTp 가 섞여 들어와도 결과가 달라지지 않는다', () => {
    // ★ 타입에서는 뺐지만 런타임으로는 여전히 흘러들 수 있다(세션 객체를 그대로 넘기는 자리).
    //   'S' 를 보고 operator 로 올라가던 경로가 되살아나면 이 단언이 깨진다.
    const withS = { ...TENANT, orgTp: 'S' } as AclSubject;
    const withN = { ...TENANT, orgTp: 'N' } as AclSubject;
    expect(acl.getScope(withS, 'c-9001')).toEqual(acl.getScope(withN, 'c-9001'));
    expect(acl.getScope(withS, 'c-9001')).toEqual({ role: 'tenant', companyId: 'c-9001' });
  });

  it('운영사 계정에 companyId 가 딸려와도 무시하고 전체 스코프다', () => {
    expect(acl.getScope(ADMIN, 'c-9001')).toEqual({ role: 'operator', companyId: null });
  });

  it('모르는 계정은 tenant 로 닫는다 — fail-closed', () => {
    expect(acl.getScope(subject(9999, 9999), 'c-9001')).toEqual({ role: 'tenant', companyId: 'c-9001' });
  });
});
