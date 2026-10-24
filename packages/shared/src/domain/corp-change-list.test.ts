import { describe, expect, it } from 'vitest';
import {
  CORP_CHANGE_FILTER_STATUSES,
  corpChangeCompanyLabel,
  corpChangeListSearch,
  parseCorpChangeListQuery,
  pickCorpChangeOptions,
} from './corp-change-list.ts';

describe('상태 필터 — P · E · C', () => {
  it('취소(X) · 준비중(S) · 제출(A)이 없다', () => {
    expect([...CORP_CHANGE_FILTER_STATUSES]).toEqual(['P', 'E', 'C']);
  });
});

describe('parseCorpChangeListQuery', () => {
  it('빈 조건 — 취소 제외가 기본', () => {
    expect(parseCorpChangeListQuery({})).toEqual({
      ok: true,
      filter: { from: null, to: null, changeType: null, status: null, tenancy: null, includeCancelled: false },
    });
  });

  it('앞뒤 공백은 뗀다 · 같은 날 범위는 된다', () => {
    const r = parseCorpChangeListQuery({ from: ' 2026-10-10 ', to: '2026-10-10', includeCancelled: '0' });
    expect(r.ok && r.filter).toMatchObject({ from: '2026-10-10', to: '2026-10-10', includeCancelled: false });
  });

  it('글자가 아닌 값은 비운 것으로 본다', () => {
    const r = parseCorpChangeListQuery({ status: ['P', 'E'], changeType: 5 });
    expect(r.ok && r.filter.status).toBeNull();
  });

  it.each([
    [{ from: '2026-02-30' }],
    [{ to: '2026-10' }],
    [{ from: '2026-10-02', to: '2026-10-01' }],
    [{ changeType: 'CEO_CHG' }],
    [{ changeType: 'name' }],
    [{ status: 'S' }],
    [{ status: 'X' }],
    [{ tenancy: 'all' }],
    [{ includeCancelled: 'true' }],
  ])('틀린 조건은 거절 %o', (query) => {
    expect(parseCorpChangeListQuery(query).ok).toBe(false);
  });

  it('주소로 되돌리면 같은 조건이 된다', () => {
    const query = { from: '2026-10-01', to: '2026-10-31', changeType: 'NAME', status: 'C', tenancy: 'tenant', includeCancelled: '1' };
    const r = parseCorpChangeListQuery(query);
    if (!r.ok) throw new Error('parse');
    expect(Object.fromEntries(corpChangeListSearch(r.filter))).toEqual(query);
    expect(corpChangeListSearch({ ...r.filter, from: null, includeCancelled: false }).has('includeCancelled')).toBe(false);
  });
});

describe('pickCorpChangeOptions', () => {
  it('★ 앱이 모르는 코드는 버리고 코드표 순서 · 이름을 지킨다', () => {
    const o = pickCorpChangeOptions(
      [
        { code: 'PURPOSE', name: '목적' },
        { code: 'CEO_CHG', name: '대표이사변경' },
        { code: 'NAME', name: '상호' },
      ],
      [
        { code: 'S', name: '준비중' },
        { code: 'A', name: '서류제출' },
        { code: 'X', name: '취소' },
        { code: 'P', name: '작성중' },
      ],
    );
    expect(o.changeTypes).toEqual([
      { code: 'PURPOSE', name: '목적' },
      { code: 'NAME', name: '상호' },
    ]);
    expect(o.statuses).toEqual([{ code: 'P', name: '작성중' }]);
    // 코드표에 없는 상태는 코드값을 이름으로 — 상태 열이 비지 않는다
    expect(o.statusNames).toEqual({ P: '작성중', E: 'E', C: 'C', X: '취소' });
    expect(o.statusNames).not.toHaveProperty('S');
    expect(o.statusNames).not.toHaveProperty('A'); // ★ 코드표의 A 는 지우지 않고 앱이 거른다
  });
});

describe('corpChangeCompanyLabel — 회사명 → 단체코드 → 「단체 {ID}」', () => {
  it.each([
    [{ companyName: '주식회사 비앤케이넷', orgCode: 'Z97', orgId: 9001 }, '주식회사 비앤케이넷'],
    [{ companyName: null, orgCode: 'Z99', orgId: 9003 }, 'Z99'],
    [{ companyName: '  ', orgCode: 'Z99', orgId: 9003 }, 'Z99'],
    [{ companyName: null, orgCode: null, orgId: 9003 }, '단체 9003'],
    [{ companyName: null, orgCode: ' ', orgId: 12 }, '단체 12'],
  ])('%o → %s', (item, label) => {
    expect(corpChangeCompanyLabel(item)).toBe(label);
  });
});
