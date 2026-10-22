import { describe, expect, it } from 'vitest';
import {
  BIZ_RECOMMEND_LIMIT,
  BIZ_RECOMMEND_QUERY_MAX,
  aliasWords,
  articleFirstLine,
  articleLabel,
  parseBizCodeParam,
  parseBizRecommendQuery,
  purposeTextFor,
  rankBizCandidates,
  splitBizWords,
  type BizAliasRow,
  type BizDictEntry,
} from './biz-purpose-recommend.ts';

/** 개발 DB 047 에서 옮긴 몇 줄(2026-10-22). */
const e = (bizCode: string, bizType: string, itemName: string, ksic: [string, string][]): BizDictEntry => ({
  bizCode,
  bizType,
  itemName,
  ksic: ksic.map(([code, name]) => ({ code, name })),
});
const DICT: BizDictEntry[] = [
  e('525101', '도매 및 소매업', '전자상거래 소매업', [['47912', '전자상거래 소매업']]),
  e('525103', '도매 및 소매업', '전자상거래 소매 중개업', [['47911', '전자상거래 소매 중개업']]),
  e('552303', '숙박 및 음식점업', '커피 전문점', [['56221', '커피 전문점']]),
  e('552307', '숙박 및 음식점업', '기타 비알코올 음료점업', [['56229', '기타 비알코올 음료점업']]),
  e('552310', '숙박 및 음식점업', '동물카페', [['56221', '커피 전문점'], ['56229', '기타 비알코올 음료점업']]),
  e('930203', '협회 및 단체, 수리 및 기타 개인서비스업', '두발 미용업', [['96112', '두발 미용업']]),
  e('722000', '정보통신업', '응용 소프트웨어 개발 및 공급업', [['58222', '응용 소프트웨어 개발 및 공급업']]),
  e('722005', '정보통신업', '컴퓨터 프로그래밍 서비스업', [['62010', '컴퓨터 프로그래밍 서비스업']]),
  e('515050', '도매 및 소매업', '컴퓨터 및 주변장치, 소프트웨어 도매업', [['46510', '컴퓨터 및 주변장치, 소프트웨어 도매업']]),
];
const ALIASES: BizAliasRow[] = [
  { bizCode: '525101', names: '쇼핑몰, 온라인몰, 스마트스토어, 인터넷 판매' },
  { bizCode: '525103', names: '쇼핑몰, 오픈마켓' },
  { bizCode: '552303', names: '카페, 커피숍' },
  { bizCode: '552307', names: '카페, 주스' },
  { bizCode: '930203', names: '미용실, 헤어샵' },
  { bizCode: '722000', names: '앱 개발, 소프트웨어 개발, SaaS' },
];
const codes = (q: string) => rankBizCandidates(q, DICT, ALIASES).items.map((c) => c.bizCode);

describe('splitBizWords', () => {
  it('공백 · 쉼표로 나누고 끝 조사 하나를 뗀다', () => {
    // 「옷을」은 떼면 1글자라 그대로 둔다
    expect(splitBizWords('온라인 쇼핑몰에서 옷을 판다')).toEqual(['온라인', '쇼핑몰', '옷을', '판다']);
    expect(splitBizWords('카페를, 미용실')).toEqual(['카페', '미용실']);
  });
  it('뗀 뒤 2글자 미만이면 떼지 않는다 · 2글자 미만 낱말은 버린다', () => {
    expect(splitBizWords('회의 옷 가')).toEqual(['회의']);
  });
  it('같은 낱말은 한 번', () => {
    expect(splitBizWords('카페 카페를')).toEqual(['카페']);
  });
});

describe('aliasWords', () => {
  it('「, 」로 나누고 빈 말은 버린다', () => {
    expect(aliasWords('카페, 커피숍,, ')).toEqual(['카페', '커피숍']);
  });
});

describe('rankBizCandidates', () => {
  it('쇼핑몰 — 바꿔 부르는 말로만 맞는다(047 이름에는 없다)', () => {
    expect(codes('쇼핑몰')).toEqual(['525101', '525103']);
    expect(rankBizCandidates('쇼핑몰', DICT, []).items).toEqual([]);
  });
  it('조사가 붙어도 바꿔 부르는 말은 맞는다(입력 전체에서 찾는다)', () => {
    expect(codes('온라인 쇼핑몰에서 옷을 판다')).toEqual(['525101', '525103']);
  });
  it('카페 — 바꿔 부르는 말(3)이 종목 일치(2)보다 앞', () => {
    const r = rankBizCandidates('카페', DICT, ALIASES).items;
    expect(r.map((c) => c.bizCode)).toEqual(['552303', '552307', '552310']);
    expect(r[0].matchedBy).toEqual([{ kind: 'alias', word: '카페' }]);
    expect(r[2].matchedBy).toEqual([{ kind: 'item' }]);
  });
  it('미용실 — 바꿔 부르는 말', () => {
    expect(codes('미용실')).toEqual(['930203']);
  });
  it('소프트웨어 — 종목 · KSIC 가 같이 맞으면 4점, 업종코드 순', () => {
    const r = rankBizCandidates('소프트웨어', DICT, ALIASES).items;
    expect(r.map((c) => c.bizCode)).toEqual(['515050', '722000']);
    expect(r[1].matchedBy).toEqual([{ kind: 'item' }, { kind: 'ksic' }]);
  });
  it('「소프트웨어 개발」이면 바꿔 부르는 말이 더해져 722000 이 위로', () => {
    expect(codes('소프트웨어 개발')[0]).toBe('722000');
  });
  it('공백을 무시하고 맞춘다(앱개발 = 앱 개발)', () => {
    expect(codes('앱개발')).toEqual(['722000']);
  });
  it('업태만 맞으면 1점 — 맨 뒤', () => {
    const r = rankBizCandidates('정보통신', DICT, ALIASES).items;
    expect(r.map((c) => c.bizCode)).toEqual(['722000', '722005']);
    expect(r.every((c) => c.matchedBy.length === 1 && c.matchedBy[0].kind === 'type')).toBe(true);
  });
  it(`${BIZ_RECOMMEND_LIMIT}개에서 자르고 truncated`, () => {
    const many = Array.from({ length: BIZ_RECOMMEND_LIMIT + 3 }, (_, i) =>
      e(String(100000 + i), '제조업', `식품 ${i}`, []),
    );
    const r = rankBizCandidates('식품', many, []);
    expect(r.items).toHaveLength(BIZ_RECOMMEND_LIMIT);
    expect(r.truncated).toBe(true);
    expect(r.items[0].bizCode).toBe('100000');
  });
  it('빈 입력은 후보 없음', () => {
    expect(rankBizCandidates('  ', DICT, ALIASES)).toEqual({ items: [], truncated: false });
  });
});

describe('purposeTextFor', () => {
  const CAT = [
    { bizCode: '525101', text: '전자상거래 소매업(통신판매업)' },
    { bizCode: null, text: '남성 이발소' },
  ];
  it('카탈로그에 그 업종코드 문구가 있으면 그것', () => {
    expect(purposeTextFor('525101', '전자상거래 소매업', CAT)).toEqual({ text: '전자상거래 소매업(통신판매업)', source: 'catalog' });
  });
  it('없으면 종목 이름', () => {
    expect(purposeTextFor('930203', '두발 미용업', CAT)).toEqual({ text: '두발 미용업', source: 'item' });
  });
});

describe('articleLabel · articleFirstLine', () => {
  it('조문 표기', () => {
    expect(articleLabel(12, 0, '제1항')).toBe('제12조 제1항');
    expect(articleLabel(26, 2, '제1항제1호')).toBe('제26조의2 제1항제1호');
    expect(articleLabel(4, 0, null)).toBe('제4조');
  });
  it('첫 줄 — 「제N조(제목)」을 뗀다. 같은 줄에 글이 없으면 다음 줄', () => {
    expect(articleFirstLine('제4조(숙박업의 세분) 법 제2조제2항에 따라 숙박업을 다음과 같이 세분한다.\n1. …')).toBe(
      '법 제2조제2항에 따라 숙박업을 다음과 같이 세분한다.',
    );
    expect(articleFirstLine('제12조(통신판매업자의 신고 등)\n① 통신판매업자는 …')).toBe('① 통신판매업자는 …');
    expect(articleFirstLine('제26조의2(등록하여야 하는 영업)\n① 법 …')).toBe('① 법 …');
  });
});

describe('parseBizRecommendQuery · parseBizCodeParam', () => {
  it('설명은 앞뒤 공백을 걷고, 비면 거절', () => {
    expect(parseBizRecommendQuery({ q: ' 카페 ' })).toEqual({ ok: true, value: { q: '카페' } });
    expect(parseBizRecommendQuery({}).ok).toBe(false);
    expect(parseBizRecommendQuery({ q: ['a'] }).ok).toBe(false);
  });
  it(`${BIZ_RECOMMEND_QUERY_MAX}자까지`, () => {
    expect(parseBizRecommendQuery({ q: '가'.repeat(BIZ_RECOMMEND_QUERY_MAX) }).ok).toBe(true);
    expect(parseBizRecommendQuery({ q: '가'.repeat(BIZ_RECOMMEND_QUERY_MAX + 1) }).ok).toBe(false);
  });
  it('업종코드는 6자리 숫자', () => {
    expect(parseBizCodeParam('525101')).toEqual({ ok: true, value: '525101' });
    for (const v of ['52510', '52510a', undefined]) expect(parseBizCodeParam(v).ok).toBe(false);
  });
});
