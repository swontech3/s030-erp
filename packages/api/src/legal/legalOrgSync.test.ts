/**
 * 법무 비입주사 회사 정보 → 삐용 보내기 — 칸 고르기(`legalOrgPatchOf`) · 결과(`pushLegalOrg`).
 * ★ DB · 삐용에 붙지 않는다. 어댑터와 토큰 문은 대역이다.
 */
import { describe, expect, it } from 'vitest';
import type { ErpSession } from '@swonbiz/shared';
import type { LegalOrgInput } from '@swonbiz/shared/domain/corp-change-detail';
import type { BbiyongOrg, BbiyongOrgLegalPatch, OrgOpOutcome } from '../bbiyong/types.ts';
import { MockBbiyongOrg } from '../bbiyong/MockBbiyongOrg.ts';
import { legalOrgPatchOf, pushLegalOrg } from './legalOrgSync.ts';

const EMPTY: LegalOrgInput = {
  legalName: null,
  corpNumber: null,
  bizNumber: null,
  ceoName: null,
  tel: null,
  headZipCode: null,
  headAddress: null,
  headAddressDetail: null,
  ceoZipCode: null,
  ceoAddress: null,
  ceoAddressDetail: null,
  memberType: null,
};
const FULL: LegalOrgInput = {
  ...EMPTY,
  legalName: '주식회사 한빛',
  ceoName: '이대표',
  tel: '02-123-4567',
  corpNumber: '111000-2313123',
  bizNumber: '105-87-68687',
  headZipCode: '06097',
  headAddress: '서울 강남구 테헤란로 1',
  headAddressDetail: '3층',
  ceoZipCode: '04000',
  ceoAddress: '서울 마포구 자택로 2',
  ceoAddressDetail: '101호',
  memberType: 'R',
};

const session = { erpSid: 'sid-hash', s020MemberId: 1, s020OrgId: 1, role: 'operator' } as ErpSession;

function via(outcome: OrgOpOutcome | Error = { kind: 'ok' }) {
  const sent: { patch: BbiyongOrgLegalPatch; token: string }[] = [];
  const org = {
    patchOrgLegal: async (patch: BbiyongOrgLegalPatch, token: string) => {
      sent.push({ patch, token });
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  } as unknown as BbiyongOrg;
  const call = async <T,>(_sid: string, fn: (token: string) => Promise<T>) => fn('tok');
  return { sent, via: { org, call } };
}

describe('legalOrgPatchOf', () => {
  it('★★ 본점 주소 3칸 · 사업자번호 · 법인번호만 — 회사명 · 대표 · 전화 · 자택 · 회사유형은 싣지 않는다', () => {
    expect(legalOrgPatchOf('Z01', FULL)).toEqual({
      orgCode: 'Z01',
      zipCode: '06097',
      address: '서울 강남구 테헤란로 1',
      detailAddress: '3층',
      bizNumber: '1058768687',
      corpNumber: '1110002313123',
    });
  });
  it('★★ 번호는 숫자만 보낸다(삐용 회신 2026-10-23) — 하이픈 · 공백을 뗀다', () => {
    expect(legalOrgPatchOf('Z01', { ...EMPTY, bizNumber: '105-87-68687', corpNumber: ' 111000-2313123 ' })).toEqual({
      orgCode: 'Z01',
      bizNumber: '1058768687',
      corpNumber: '1110002313123',
    });
  });
  it('★★ 값이 없는 칸은 칸째 뺀다(빈 문자열도) — 보낼 칸이 없으면 null', () => {
    expect(legalOrgPatchOf('Z01', { ...EMPTY, headAddress: '서울', headAddressDetail: ' ' })).toEqual({
      orgCode: 'Z01',
      address: '서울',
    });
    expect(legalOrgPatchOf('Z01', { ...EMPTY, legalName: '이름만', ceoAddress: '자택만' })).toBeNull();
  });
});

describe('pushLegalOrg', () => {
  it('보낸다 — 운영사 토큰으로, 결과 ok', async () => {
    const v = via();
    expect(await pushLegalOrg(session, 'Z01', FULL, v.via)).toEqual({ kind: 'ok' });
    expect(v.sent.map((s) => [s.patch.orgCode, s.token])).toEqual([['Z01', 'tok']]);
  });
  it('★ 수정 권한이 있는 회사 사용자도 그 사람의 토큰으로 보낸다 — 모의 삐용에서 ok(2026-10-25)', async () => {
    const company = { ...session, s020OrgId: 9003, role: 'tenant' } as ErpSession;
    const call = async <T,>(_sid: string, fn: (token: string) => Promise<T>) => fn('company-tok');
    expect(await pushLegalOrg(company, 'Z99', FULL, { org: new MockBbiyongOrg(), call })).toEqual({ kind: 'ok' });
  });
  it('보낼 값이 없으면 부르지 않는다(null)', async () => {
    const v = via();
    expect(await pushLegalOrg(session, 'Z01', EMPTY, v.via)).toBeNull();
    expect(await pushLegalOrg(session, null, EMPTY, v.via)).toBeNull();
    expect(v.sent).toEqual([]);
  });
  it('★ 단체코드가 없으면 부르지 않고 실패로 알린다', async () => {
    const v = via();
    expect(await pushLegalOrg(session, null, FULL, v.via)).toEqual({
      kind: 'failed',
      reason: '단체코드가 없어 삐용에 보내지 못했습니다',
    });
    expect(v.sent).toEqual([]);
  });
  it('삐용이 거부하면 그 문구가 사유 · 던져도 던지지 않고 실패로', async () => {
    const rejected = via({ kind: 'rejected', message: '권한이 없습니다', retryable: false });
    expect(await pushLegalOrg(session, 'Z01', FULL, rejected.via)).toEqual({ kind: 'failed', reason: '권한이 없습니다' });
    const thrown = via(new Error('connect ECONNREFUSED'));
    expect(await pushLegalOrg(session, 'Z01', FULL, thrown.via)).toEqual({
      kind: 'failed',
      reason: '삐용 회사 수정이 끝나지 않았습니다. 잠시 후 다시 저장해 주세요',
    });
  });
});
