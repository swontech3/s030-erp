import { describe, expect, it } from 'vitest';
import {
  ORG_QUERY_MAX,
  markTenants,
  normalizeOrgQuery,
  parseOrgKey,
  tenantLabel,
  toOrgPick,
  type OrgInfo,
} from './org-lookup';

const org = (orgId: number, orgCode: string, orgName = `회사${orgId}`): OrgInfo => ({
  orgId,
  orgCode,
  orgName,
  repName: '대표',
  status: '정상',
});

describe('markTenants — 입주사 딱지', () => {
  it('★ ERP 입주사에 연결된 단체만 입주사다', () => {
    const out = markTenants([org(9001, 'Z97'), org(9003, 'Z99')], [9001, 507]);
    expect(out.map((o) => [o.orgId, o.isTenant])).toEqual([
      [9001, true],
      [9003, false],
    ]);
  });

  it('연결 목록이 비어 있으면 전부 비입주사', () => {
    expect(markTenants([org(1, 'Z01')], []).every((o) => !o.isTenant)).toBe(true);
  });

  it('딱지 글자', () => {
    expect(tenantLabel(true)).toBe('입주사');
    expect(tenantLabel(false)).toBe('비입주사');
  });
});

describe('toOrgPick — 돌려주는 것은 셋뿐', () => {
  it('★★ 대표자명·상태·딱지를 싣지 않는다', () => {
    const [item] = markTenants([org(9003, 'Z99', '주식회사 한빛법인')], []);
    expect(toOrgPick(item!)).toEqual({ orgId: 9003, orgCode: 'Z99', orgName: '주식회사 한빛법인' });
  });
});

describe('normalizeOrgQuery', () => {
  it('앞뒤 공백을 떼고 상한으로 자른다', () => {
    expect(normalizeOrgQuery('  한빛 ')).toBe('한빛');
    expect(normalizeOrgQuery('가'.repeat(ORG_QUERY_MAX + 10))).toHaveLength(ORG_QUERY_MAX);
  });

  it('글자가 아니면 빈 검색어', () => {
    expect(normalizeOrgQuery(undefined)).toBe('');
    expect(normalizeOrgQuery(['a'])).toBe('');
  });
});

describe('parseOrgKey — 단건 키', () => {
  it('단체 ID', () => {
    expect(parseOrgKey({ orgId: '9003' })).toEqual({ orgId: 9003 });
  });

  it('단체코드 — 대문자로 맞춘다', () => {
    expect(parseOrgKey({ orgCode: ' z99 ' })).toEqual({ orgCode: 'Z99' });
  });

  it('★ 둘 다 오거나 둘 다 없으면 null — 어느 쪽으로 찾는지 모호하다', () => {
    expect(parseOrgKey({ orgId: '1', orgCode: 'Z01' })).toBeNull();
    expect(parseOrgKey({})).toBeNull();
    expect(parseOrgKey({ orgId: '', orgCode: '' })).toBeNull();
  });

  it('형식이 틀리면 null', () => {
    for (const bad of ['0', '-1', '1.5', 'abc', '99999999999', '1e3']) {
      expect(parseOrgKey({ orgId: bad })).toBeNull();
    }
    for (const bad of ['Z1', 'Z001', 'Z-1', '가나다']) {
      expect(parseOrgKey({ orgCode: bad })).toBeNull();
    }
  });
});
