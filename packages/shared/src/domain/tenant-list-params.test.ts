/**
 * 목록 상태 ↔ 주소.
 *
 * ★ 이 시험의 본체는 **「칩 없음」과 「칩 전부 해제」의 구분**이다. 나머지는 그 구분이
 *   왕복(주소 → 상태 → 주소)에서 살아남는지를 본다 — 고치려던 증상이 바로 거기서 났다.
 */
import { describe, expect, it } from 'vitest';
import {
  ALL_CHIPS,
  parseTenantListParams,
  sortChips,
  tenantListSearch,
  type TenantListState,
} from './tenant-list-params';
import type { TenantFilterKey } from './tenant-status';

const DEFAULTS: TenantFilterKey[] = ['soon', 'expired'];
const parse = (search: string) => parseTenantListParams(new URLSearchParams(search), DEFAULTS);

describe('parseTenantListParams', () => {
  it('주소가 비면 기본 칩이다 — 첫 방문', () => {
    expect(parse('')).toEqual({ chips: ['soon', 'expired'], keyword: '', companyId: null });
  });

  it('★ chips=all 은 기본 칩이 아니라 «전부 해제» 다', () => {
    expect(parse(`chips=${ALL_CHIPS}`).chips).toEqual([]);
  });

  it('★ 파라미터 없음과 chips=all 은 다른 상태다', () => {
    expect(parse('').chips).not.toEqual(parse(`chips=${ALL_CHIPS}`).chips);
  });

  it('칩 목록을 읽는다', () => {
    expect(parse('chips=active').chips).toEqual(['active']);
    expect(parse('chips=ended,active').chips).toEqual(['active', 'ended']);
  });

  it('모르는 값은 버린다 — 주소는 손으로 고칠 수 있는 자리다', () => {
    expect(parse('chips=active,고양이').chips).toEqual(['active']);
    // 남는 것이 하나도 없으면 «전부 해제» 다. 기본 칩으로 되돌아가지 않는다.
    expect(parse('chips=고양이').chips).toEqual([]);
  });

  it('중복과 순서를 정본 순서로 고른다', () => {
    expect(parse('chips=ended,active,active').chips).toEqual(['active', 'ended']);
  });

  it('검색어와 입주사를 읽는다', () => {
    const s = parse('chips=all&q=%EC%97%90%EC%8A%A4&companyId=abc');
    expect(s).toEqual({ chips: [], keyword: '에스', companyId: 'abc' });
  });

  it('★★ companyId 만 있고 chips 가 없으면 거르지 않는다 — 짚어 준 입주사가 걸러지면 안 된다', () => {
    expect(parse('companyId=abc')).toEqual({ chips: [], keyword: '', companyId: 'abc' });
  });

  it('companyId 가 있어도 chips 가 적혀 있으면 그대로 따른다', () => {
    expect(parse('companyId=abc&chips=active').chips).toEqual(['active']);
  });
});

describe('tenantListSearch', () => {
  const state = (over: Partial<TenantListState> = {}): TenantListState => ({
    chips: [],
    keyword: '',
    companyId: null,
    ...over,
  });

  it('★ 칩이 비면 all 이라고 적는다 — 생략하면 다음에 기본 칩으로 읽힌다', () => {
    expect(tenantListSearch(state())).toBe(`?chips=${ALL_CHIPS}`);
  });

  it('★ 기본값과 같아도 생략하지 않는다', () => {
    expect(tenantListSearch(state({ chips: DEFAULTS }))).toBe('?chips=soon%2Cexpired');
  });

  it('빈 검색어·없는 입주사는 적지 않는다', () => {
    expect(tenantListSearch(state({ chips: ['active'] }))).toBe('?chips=active');
  });

  it('검색어와 입주사를 적는다', () => {
    expect(tenantListSearch(state({ chips: ['active'], keyword: '에스', companyId: 'abc' }))).toBe(
      '?chips=active&q=%EC%97%90%EC%8A%A4&companyId=abc',
    );
  });

  it('칩 순서가 누른 순서에 흔들리지 않는다', () => {
    expect(tenantListSearch(state({ chips: ['ended', 'active'] }))).toBe(
      tenantListSearch(state({ chips: ['active', 'ended'] })),
    );
  });
});

describe('왕복', () => {
  const cases: TenantListState[] = [
    { chips: [], keyword: '', companyId: null },
    { chips: ['soon', 'expired'], keyword: '', companyId: null },
    { chips: ['active'], keyword: '에스원', companyId: 'c-1' },
    { chips: [], keyword: '주식 회사', companyId: 'c-2' },
    { chips: ['active', 'soon', 'expired', 'review', 'ended'], keyword: '', companyId: null },
  ];

  for (const c of cases) {
    it(`주소로 적고 다시 읽으면 같다 — ${JSON.stringify(c)}`, () => {
      expect(parse(tenantListSearch(c))).toEqual({ ...c, chips: sortChips(c.chips) });
    });
  }

  it('★★ [전체] 로 비운 상태가 왕복에서 기본 칩으로 되살아나지 않는다', () => {
    const emptied: TenantListState = { chips: [], keyword: '', companyId: null };
    expect(parse(tenantListSearch(emptied)).chips).toEqual([]);
  });
});
