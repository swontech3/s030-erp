/**
 * 세무 카드 사용 내역 · 현금 경비 — 표준 양식 변환 · 개수 맞추기 · 양식 안내 (1-4, 2026-10-30).
 *
 * ★ 값은 모두 지어낸 것이다. 원본 샘플(doc/data-src/)의 값은 쓰지 않는다 — 제목 줄 이름과 칸 위치만 209 대응표 그대로다.
 */
import { describe, expect, it } from 'vitest';
import { PINNED_CODES } from './code-usage.ts';
import {
  CASH_TEMPLATE_GUIDE,
  cardDedupKey,
  cashDedupKey,
  convertCardSheet,
  convertCashSheet,
  countByUseMonth,
  pickNewByCount,
  type CardImportMap,
  type CashImportMap,
  type CardStdRow,
} from './tax-card-cash.ts';

const CARD_HEADER = ['승인일자', '카드사', '카드번호', '가맹점사업자번호', '가맹점명', '공급가액', '세액', '비과세', '합계',
  '가맹점유형', '업태', '업종', '공제여부결정', '비고'];
const CARD_MAP: CardImportMap = {
  id: 'HOMETAX_BIZ_CARD',
  kind: 'CARD',
  headerRow: 2,
  headerSignature: CARD_HEADER,
  columns: {
    useDate: 1, cardNo: 3, merchantBizNo: 4, merchantName: 5,
    supplyAmount: 6, taxAmount: 7, nontaxAmount: 8, totalAmount: 9,
    vatDeduct: { col: 13, values: { 공제: 'Y', 불공제: 'N' } },
    deductNote: 14,
  },
};

/** 210 대응표 — 1줄 제목 · 구분 + 금액 한 칸(2026-10-31). */
const CASH_HEADER = ['날짜', '구분', '품명', '거래처', '항목', '금액', '결제방법', '증빙'];
const CASH_MAP: CashImportMap = {
  id: 'TAX_CASH_STD',
  kind: 'CASH',
  headerRow: 1,
  headerSignature: CASH_HEADER,
  columns: { useDate: 1, direction: 2, description: 3, vendorName: 4, item: 5, amount: 6, payMethod: 7, proof: 8 },
};
const CASH_NAMES = {
  directions: [{ code: 'P', name: '매입' }, { code: 'S', name: '매출' }],
  items: [{ code: 'MEAL', name: '식대·회의비' }, { code: 'SUPPLY', name: '소모품비' }],
  payMethods: [{ code: 'CASH', name: '현금' }, { code: 'TRANSFER', name: '계좌이체' }, { code: 'OWNER', name: '대표 개인 돈' }],
  proofs: [{ code: 'RECEIPT', name: '영수증' }, { code: 'NONE', name: '없음' }],
};

/** 지어낸 카드 줄 — 칸 14개. */
function cardLine(o: Partial<Record<'date' | 'card' | 'biz' | 'name' | 'deduct' | 'note', string>> & { sup?: unknown; tax?: unknown; non?: unknown; tot?: unknown } = {}): unknown[] {
  return [
    o.date ?? '2026-09-03', '(지어낸)카드', o.card ?? '1111-2222-3333-4821', o.biz ?? '220-81-62517', o.name ?? '지어낸 가게',
    o.sup ?? 10000, o.tax ?? 1000, o.non ?? 0, o.tot ?? 11000, '일반과세자', '음식', '한식', o.deduct ?? '공제', o.note ?? '',
  ];
}
const cardSheet = (...lines: unknown[][]) => [['', '', '', '', '', '', '', '', '', '', '', '', '총 사용금액 : 0(원)'], CARD_HEADER, ...lines];

function cashLine(o: Partial<Record<'dir' | 'desc' | 'vendor' | 'item' | 'pay' | 'proof', string>> & { date?: unknown; amount?: unknown } = {}): unknown[] {
  return [o.date ?? '2026-09-05', o.dir ?? '매입', o.desc ?? '지어낸 품명', o.vendor ?? '', o.item ?? '', o.amount ?? 5000, o.pay ?? '현금', o.proof ?? ''];
}
const cashSheet = (...lines: unknown[][]) => [CASH_HEADER, ...lines];

describe('convertCardSheet — 홈택스 사업용 신용카드', () => {
  it('2줄째 제목 줄 · 14칸이 맞으면 표준 양식으로 바꾼다 — 카드번호는 끝 4자리만', () => {
    const r = convertCardSheet(cardSheet(cardLine()), CARD_MAP, ['4821']);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.totalRows).toBe(1);
    expect(r.rows).toEqual([{
      useDate: '2026-09-03', cardLast4: '4821', merchantName: '지어낸 가게', merchantBizNo: '2208162517',
      supplyAmount: 10000, taxAmount: 1000, nontaxAmount: 0, totalAmount: 11000, vatDeduct: 'Y', deductNote: null,
    }]);
    expect(r.warnings).toEqual([]);
  });

  it('★ 결과 어디에도 카드번호 전체가 남지 않는다', () => {
    const r = convertCardSheet(cardSheet(cardLine({ card: '9876-5432-1098-7654' })), CARD_MAP, []);
    expect(JSON.stringify(r)).not.toMatch(/9876|5432|1098/);
    expect(r.ok && r.rows[0]!.cardLast4).toBe('7654');
  });

  it('제목 줄이 다르면 양식이 맞지 않는다 · 자료 줄이 없으면 막는다', () => {
    const bad = convertCardSheet([[], [...CARD_HEADER.slice(0, 13)], cardLine()], CARD_MAP, []);
    expect(bad).toEqual({ ok: false, error: { code: 'format_mismatch', message: '양식이 맞지 않습니다' } });
    expect(convertCardSheet(cardSheet(), CARD_MAP, [])).toMatchObject({ ok: false, error: { code: 'no_rows' } });
  });

  it('취소(음수) 줄은 그대로 넣는다', () => {
    const r = convertCardSheet(cardSheet(cardLine({ sup: -5000, tax: 0, tot: -5000, deduct: '불공제', note: '당연불공제' })), CARD_MAP, ['4821']);
    expect(r.ok && r.rows[0]).toMatchObject({ supplyAmount: -5000, totalAmount: -5000, vatDeduct: 'N', deductNote: '당연불공제' });
  });

  it('카드번호 없음 · 날짜 틀림 · 금액 틀림은 빼고 센다', () => {
    const r = convertCardSheet(cardSheet(
      cardLine({ card: '' }), cardLine({ date: '2026-13-01' }), cardLine({ tot: '만원' }), cardLine(),
    ), CARD_MAP, ['4821']);
    expect(r.ok && r.excluded).toEqual({ noCardNo: 1, badDate: 1, badAmount: 1 });
    expect(r.ok && r.rows.length).toBe(1);
    expect(r.ok && r.totalRows).toBe(4);
  });

  it('가맹점 사업자번호가 10자리가 아니면 비운다(줄은 넣는다)', () => {
    const r = convertCardSheet(cardSheet(cardLine({ biz: '' }), cardLine({ biz: '123-45' })), CARD_MAP, ['4821']);
    expect(r.ok && r.rows.map((x) => x.merchantBizNo)).toEqual([null, null]);
  });

  it('★ 공제 여부가 「공제 · 불공제」가 아니면 비워서 넣고 경고한다(판단 3)', () => {
    const r = convertCardSheet(cardSheet(cardLine({ deduct: '면세' }), cardLine()), CARD_MAP, ['4821']);
    expect(r.ok && r.rows.map((x) => x.vatDeduct)).toEqual([null, 'Y']);
    expect(r.ok && r.warnings).toEqual([{ code: 'card_deduct_unknown', message: '공제 여부를 알 수 없는 줄 1줄 — 공제 여부를 비워 넣습니다', count: 1 }]);
  });

  it('★ 세무 설정에 없는 카드 줄은 넣고 경고한다(판단 3) — 끝 4자리만 보인다', () => {
    const r = convertCardSheet(cardSheet(cardLine(), cardLine({ card: '1111-2222-3333-0001' }), cardLine({ card: '1111-2222-3333-0001' })), CARD_MAP, ['4821']);
    expect(r.ok && r.rows.length).toBe(3);
    expect(r.ok && r.warnings).toEqual([{
      code: 'card_unregistered', message: '세무 설정에 없는 카드(끝 0001) 2줄 — 그대로 넣습니다', count: 2,
    }]);
  });
});

describe('convertCashSheet — 현금 경비 표준 양식(210 — 구분 + 금액 한 칸)', () => {
  it('구분 「매입」 = P · 「매출」 = S, 구분 · 항목 · 결제방법 · 증빙은 코드 표 이름으로 코드값을 찾는다', () => {
    const r = convertCashSheet(cashSheet(
      cashLine({ vendor: ' 지어낸 식당 ', item: '식대·회의비', proof: '영수증' }),
      cashLine({ dir: '매출', amount: 30000, pay: '계좌이체' }),
    ), CASH_MAP, CASH_NAMES);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toEqual([
      { useDate: '2026-09-05', description: '지어낸 품명', vendorName: '지어낸 식당', direction: 'P', amount: 5000, payMethod: 'CASH', proof: 'RECEIPT', itemCode: 'MEAL' },
      { useDate: '2026-09-05', description: '지어낸 품명', vendorName: null, direction: 'S', amount: 30000, payMethod: 'TRANSFER', proof: null, itemCode: null },
    ]);
    expect(r.warnings).toEqual([]);
    expect(r.totalRows).toBe(2);
  });

  it('★ 1줄이 제목 줄 — 옛 양식(1줄 안내 · 매출액 · 매입액 두 칸) · 대표 옛 파일 모양은 양식이 맞지 않는다', () => {
    const oldStd = [['지어낸 안내'], ['날짜', '품명', '거래처', '항목', '매출액', '매입액', '지급방법', '증빙'], ['2026-09-05', '가', '', '', '', 5000, '현금', '']];
    const oldOwner = [['사용일시', '품   명', '거래처', '항목', '매출액', '매입액', '지급방법', '증빙'], ['2026-09-05', '가', '', '', '', 5000, '현금', '']];
    for (const sheet of [oldStd, oldOwner]) {
      expect(convertCashSheet(sheet, CASH_MAP, CASH_NAMES)).toEqual({ ok: false, error: { code: 'format_mismatch', message: '양식이 맞지 않습니다' } });
    }
  });

  it('필수 = 날짜 · 구분 · 품명 · 금액 · 결제방법 — 틀리면 빼고 센다', () => {
    const r = convertCashSheet(cashSheet(
      cashLine({ date: '어제' }),
      cashLine({ dir: '' }),
      cashLine({ dir: '환불' }),
      cashLine({ desc: '  ' }),
      cashLine({ amount: '' }),
      cashLine({ amount: -100 }),
      cashLine({ amount: 0 }),
      cashLine({ amount: '만원' }),
      cashLine({ amount: 1500.5 }),
      cashLine({ pay: '' }),
      cashLine({ pay: '카드' }),
      cashLine({ pay: '계좌이체(직원 정산)' }),
      cashLine({ amount: '12,000' }),
    ), CASH_MAP, CASH_NAMES);
    expect(r.ok && r.excluded).toEqual({ badDate: 1, badDirection: 2, noDescription: 1, noAmount: 1, badAmount: 4, badPayMethod: 3 });
    expect(r.ok && r.rows.map((x) => x.amount)).toEqual([12000]);
  });

  it('★ 날짜에 시각이 붙어도 받는다 — 날짜 부분만(현금만, 210 판단 2)', () => {
    const r = convertCashSheet(cashSheet(
      cashLine({ date: '2026-09-05 14:30' }),
      cashLine({ date: '2026-09-06 09:05:59' }),
      cashLine({ date: '2026.09.07 23:59' }),
      cashLine({ date: '2026-09-08T08:00:00' }),
      cashLine({ date: new Date(Date.UTC(2026, 8, 9, 23, 30)) }),
      cashLine({ date: '2026-09-10 25:00' }),
      cashLine({ date: '2026-02-30 10:00' }),
    ), CASH_MAP, CASH_NAMES);
    expect(r.ok && r.rows.map((x) => x.useDate)).toEqual(['2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09']);
    expect(r.ok && r.excluded.badDate).toBe(2);
  });

  it('★ 목록에 없는 항목 · 증빙은 비워서 넣고 경고, 매출 줄의 항목은 무시하고 경고(판단 9 · 10)', () => {
    const r = convertCashSheet(cashSheet(
      cashLine({ item: '복리후생비' }),
      cashLine({ proof: '카드전표' }),
      cashLine({ dir: '매출', amount: 1000, item: '식대·회의비' }),
    ), CASH_MAP, CASH_NAMES);
    expect(r.ok && r.rows.map((x) => [x.itemCode, x.proof])).toEqual([[null, null], [null, null], [null, null]]);
    expect(r.ok && r.warnings.map((w) => [w.code, w.count])).toEqual([
      ['cash_item_unknown', 1], ['cash_proof_unknown', 1], ['cash_sales_item_ignored', 1],
    ]);
  });

  it('항목 목록이 비었으면(세무 설정 전) 적힌 항목은 모두 비워서 넣고 경고', () => {
    const r = convertCashSheet(cashSheet(cashLine({ item: '식대·회의비' })), CASH_MAP, { ...CASH_NAMES, items: [] });
    expect(r.ok && r.rows[0]!.itemCode).toBeNull();
    expect(r.ok && r.warnings[0]!.code).toBe('cash_item_unknown');
  });
});

describe('★ 고정 코드(code-usage PINNED_CODES) — 카드 · 현금 뺀 줄 종류 = 응답 키', () => {
  it('CardExcluded · CashExcluded 키(205 의 badDate · badAmount 는 205 몫)와 빠짐없이 · 더하지 않고 같다', () => {
    const card = convertCardSheet(cardSheet(cardLine()), CARD_MAP, ['4821']);
    const cash = convertCashSheet(cashSheet(cashLine()), CASH_MAP, CASH_NAMES);
    if (!card.ok || !cash.ok) throw new Error('변환 실패');
    const keys = [...new Set([...Object.keys(card.excluded), ...Object.keys(cash.excluded)])]
      .filter((k) => k !== 'badDate' && k !== 'badAmount').sort();
    const pinned = PINNED_CODES.find((p) => p.category === 'TAX_SKIP_REASON' && p.label === '세무 카드 · 현금 뺀 줄 종류');
    expect([...(pinned?.codes ?? [])].sort()).toEqual(keys);
  });
});

describe('pickNewByCount — 개수 맞추기(승인번호가 없는 자료의 중복 막기)', () => {
  const card = (total: number, last4 = '4821'): CardStdRow => ({
    useDate: '2026-09-03', cardLast4: last4, merchantName: '가', merchantBizNo: '2208162517',
    supplyAmount: total, taxAmount: 0, nontaxAmount: 0, totalAmount: total, vatDeduct: 'Y', deductNote: null,
  });

  it('같은 열쇠가 파일에 n개 · DB 에 m개면 뒤쪽 n−m개만 넣는다', () => {
    const rows = [card(100), card(100), card(100), card(200)];
    const existing = new Map([[cardDedupKey(card(100)), ['가.xlsx', '가.xlsx']]]);
    const r = pickNewByCount(rows, cardDedupKey, existing);
    expect(r.newRows).toEqual([card(100), card(200)]);
    expect(r.already).toBe(2);
  });

  it('DB 에 더 많으면 하나도 넣지 않는다 · 끝 4자리가 다르면 다른 열쇠', () => {
    const r = pickNewByCount([card(100), card(100, '0001')], cardDedupKey, new Map([[cardDedupKey(card(100)), ['가.xlsx', '가.xlsx', '가.xlsx', '가.xlsx', '가.xlsx']]]));
    expect(r.newRows).toEqual([card(100, '0001')]);
    expect(r.already).toBe(1);
  });

  it('건너뛴 줄마다 그 줄이 이미 들어 있는 파일 이름 — DB 줄 순서(먼저 올린 것부터)대로 짝짓는다', () => {
    const rows = [card(100), card(100), card(100), card(200)];
    const existing = new Map([
      [cardDedupKey(card(100)), ['9월_카드.xlsx', '10월_카드.xlsx']],
      [cardDedupKey(card(200)), ['9월_카드.xlsx']],
    ]);
    const r = pickNewByCount(rows, cardDedupKey, existing);
    expect(r.skipped).toEqual([
      { row: card(100), fileName: '9월_카드.xlsx' },
      { row: card(100), fileName: '10월_카드.xlsx' },
      { row: card(200), fileName: '9월_카드.xlsx' },
    ]);
    expect(r.newRows).toEqual([card(100)]);
  });

  it('현금 열쇠 — 날짜 · 품명 · 거래처 · 매출/매입 · 금액 · 지급방법(항목 · 증빙은 열쇠가 아니다)', () => {
    const a = { useDate: '2026-09-05', description: '가', vendorName: null, direction: 'P' as const, amount: 1, payMethod: 'CASH', proof: null, itemCode: null };
    expect(cashDedupKey({ ...a, itemCode: 'MEAL', proof: 'NONE' })).toBe(cashDedupKey(a));
    expect(cashDedupKey({ ...a, vendorName: '나' })).not.toBe(cashDedupKey(a));
  });
});

describe('countByUseMonth', () => {
  it('사용일의 달별 줄 수 — 달 순서', () => {
    expect(countByUseMonth([{ useDate: '2026-10-01' }, { useDate: '2026-09-30' }, { useDate: '2026-09-01' }])).toEqual([
      { month: '2026-09', count: 2 }, { month: '2026-10', count: 1 },
    ]);
  });
});

describe('CASH_TEMPLATE_GUIDE — 양식 「안내」 시트(판단 15 · 210)', () => {
  it('회사 사업용 카드로 낸 것은 적지 않는다 · 목록에 있는 이름 그대로 적는다', () => {
    const all = CASH_TEMPLATE_GUIDE.join('\n');
    expect(all).toContain('회사 사업용 카드로 낸 것은 적지 않습니다');
    expect(all).toContain('목록에 있는 이름 그대로 적으세요');
  });

  it('★ 새 칸 이름(구분 · 금액 · 결제방법)을 쓰고 옛 칸 이름(매출액 · 매입액 · 지급방법)은 없다', () => {
    const all = CASH_TEMPLATE_GUIDE.join('\n');
    for (const w of ['구분', '금액', '결제방법', '구분 목록', '결제방법 목록']) expect(all).toContain(w);
    for (const w of ['매출액', '매입액', '지급방법']) expect(all).not.toContain(w);
  });
});
