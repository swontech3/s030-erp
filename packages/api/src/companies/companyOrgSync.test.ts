/**
 * 입주사 회사 정보 → 삐용 보내기 — 칸 고르기(`companyOrgPatchOf`) · 결과(`pushCompanyOrg`).
 * ★ DB · 삐용에 붙지 않는다. 어댑터와 토큰 문은 대역이다.
 */
import { describe, expect, it } from 'vitest';
import type { ErpSession } from '@swonbiz/shared';
import type { BbiyongOrg, BbiyongOrgPatch, OrgOpOutcome } from '../bbiyong/types.ts';
import { companyOrgPatchOf, pushCompanyOrg, type CompanyOrgValues } from './companyOrgSync.ts';

const FULL: CompanyOrgValues = {
  companyName: '한성무역',
  bizNumber: '105-87-68687',
  corpNumber: '111000-2313123',
  businessType: '도매',
  businessItem: '무역',
};
const EMPTY: CompanyOrgValues = { companyName: '', bizNumber: null, corpNumber: null, businessType: ' ', businessItem: null };

const session = { erpSid: 'sid-hash', s020MemberId: 1, s020OrgId: 1, role: 'operator' } as ErpSession;

function via(outcome: OrgOpOutcome | Error = { kind: 'ok' }) {
  const sent: { patch: BbiyongOrgPatch; token: string }[] = [];
  const org = {
    patchOrg: async (patch: BbiyongOrgPatch, token: string) => {
      sent.push({ patch, token });
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  } as unknown as BbiyongOrg;
  const call = async <T,>(_sid: string, fn: (token: string) => Promise<T>) => fn('tok');
  return { sent, via: { org, call } };
}

describe('companyOrgPatchOf', () => {
  it('★★ 다섯 칸 — 번호는 숫자만 · 주소 칸은 없다', () => {
    expect(companyOrgPatchOf('Z01', FULL)).toEqual({
      orgCode: 'Z01',
      orgName: '한성무역',
      bizNumber: '1058768687',
      corpNumber: '1110002313123',
      businessType: '도매',
      businessItem: '무역',
    });
  });
  it('★★ 빈 칸(빈 문자열 · 공백 · null)은 칸째 뺀다 — 보낼 칸이 없으면 null', () => {
    expect(companyOrgPatchOf('Z01', { ...EMPTY, businessItem: '무역' })).toEqual({ orgCode: 'Z01', businessItem: '무역' });
    expect(companyOrgPatchOf('Z01', EMPTY)).toBeNull();
  });
});

describe('pushCompanyOrg', () => {
  it('보낸다 — 운영사 토큰으로, 결과 ok', async () => {
    const v = via();
    expect(await pushCompanyOrg(session, 'Z01', FULL, v.via)).toEqual({ kind: 'ok' });
    expect(v.sent.map((s) => [s.patch.orgCode, s.token])).toEqual([['Z01', 'tok']]);
  });
  it('★ 연결되지 않은 입주사(단체코드 없음) · 보낼 값이 없으면 부르지 않는다(null)', async () => {
    const v = via();
    expect(await pushCompanyOrg(session, null, FULL, v.via)).toBeNull();
    expect(await pushCompanyOrg(session, 'Z01', EMPTY, v.via)).toBeNull();
    expect(v.sent).toEqual([]);
  });
  it('삐용이 거부하면 그 문구가 사유 · 던져도 던지지 않고 실패로', async () => {
    const rejected = via({ kind: 'rejected', message: '권한이 없습니다', retryable: false });
    expect(await pushCompanyOrg(session, 'Z01', FULL, rejected.via)).toEqual({ kind: 'failed', reason: '권한이 없습니다' });
    const thrown = via(new Error('connect ECONNREFUSED'));
    expect(await pushCompanyOrg(session, 'Z01', FULL, thrown.via)).toEqual({
      kind: 'failed',
      reason: '삐용 회사 수정이 끝나지 않았습니다. 잠시 후 다시 저장해 주세요',
    });
  });
});
