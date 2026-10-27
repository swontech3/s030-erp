/**
 * 세무 자료 올리기 · 거래처 — 표준 양식 변환 · 본문 검사.
 *
 * ★ 값은 모두 지어낸 것이다. 원본 샘플(doc/data-src/)의 값은 쓰지 않는다 — 제목 줄 33칸 이름과
 *   칸 위치만 204 대응표 그대로다.
 */
import { describe, expect, it } from 'vitest';
import {
  addMonths,
  convertInvoiceSheet,
  detectSpreadsheetFormat,
  parseMonth,
  previousMonthOf,
  thisMonthOf,
  withRo,
  workMonthOf,
  parseVendorEdit,
  parseVendorIds,
  parseVendorMerge,
  parseVendorType,
  type InvoiceImportMap,
} from './tax-uploads.ts';

const HEADER = [
  '작성일자', '승인번호', '발급일자', '전송일자',
  '공급자사업자등록번호', '종사업장번호', '상호', '대표자명', '주소',
  '공급받는자사업자등록번호', '종사업장번호', '상호', '대표자명', '주소',
  '합계금액', '공급가액', '세액',
  '전자세금계산서분류', '전자세금계산서종류', '발급유형', '비고', '영수/청구 구분',
  '공급자 이메일', '공급받는자 이메일1', '공급받는자 이메일2',
  '품목일자', '품목명', '품목규격', '품목수량', '품목단가', '품목공급가액', '품목세액', '품목비고',
];

const MAP: InvoiceImportMap = {
  id: 'HOMETAX_TAX_INVOICE',
  kind: 'INVOICE',
  headerRow: 6,
  headerSignature: HEADER,
  columns: {
    ownBizNo: { row: 1, label: '사업자 등록번호' },
    writeDate: 1,
    approvalNo: 2,
    supplier: { bizNo: 5, name: 7 },
    buyer: { bizNo: 10, name: 12 },
    totalAmount: 15,
    supplyAmount: 16,
    taxAmount: 17,
    invClass: { col: 18, values: { 세금계산서: 'TAX' } },
    invType: { col: 19, values: { 일반: 'GEN' } },
  },
};

/** 지어낸 번호 — OWN 은 끝자리 검증이 맞고, 상대 둘도 맞다. BAD_CHECK 은 끝자리가 틀린다. */
const OWN = '1234567891';
const PARTNER_A = '2208162517';
const PARTNER_B = '1018600345';
const BAD_CHECK = '1234567890';
const dash = (d: string) => `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;

interface LineOpt {
  date?: unknown;
  approval?: unknown;
  supplier?: string;
  supplierName?: string;
  buyer?: string;
  buyerName?: string;
  total?: unknown;
  supply?: unknown;
  tax?: unknown;
  cls?: string;
  type?: string;
}
function line(o: LineOpt = {}): unknown[] {
  const r: unknown[] = new Array(33).fill(null);
  r[0] = o.date ?? '2026-09-05';
  r[1] = o.approval ?? '20260905-10000000-00000001';
  r[4] = o.supplier ?? dash(OWN);
  r[6] = o.supplierName ?? '지어낸 우리 회사';
  r[9] = o.buyer ?? dash(PARTNER_A);
  r[11] = o.buyerName ?? '지어낸 거래처 가';
  r[14] = o.total ?? 110000;
  r[15] = o.supply ?? 100000;
  r[16] = o.tax ?? 10000;
  r[17] = o.cls ?? '세금계산서';
  r[18] = o.type ?? '일반';
  return r;
}
function sheet(lines: unknown[][], opts: { own?: string; header?: unknown[] } = {}): unknown[][] {
  return [
    ['사업자 등록번호', dash(opts.own ?? OWN), '상호', '지어낸 우리 회사', '대표자 명', '지어낸 대표'],
    [],
    ['총 합계금액', 1, '총 공급가액', 1, '총 세액', 1],
    [],
    ['안내 문구', null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, '대표 품목'],
    opts.header ?? HEADER,
    ...lines,
  ];
}

describe('detectSpreadsheetFormat — 파일 앞 바이트', () => {
  it('xls(D0 CF 11 E0) · xlsx(PK) · 그 밖', () => {
    expect(detectSpreadsheetFormat(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toBe('xls');
    expect(detectSpreadsheetFormat(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]))).toBe('xlsx');
    expect(detectSpreadsheetFormat(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBeNull();
    expect(detectSpreadsheetFormat(new Uint8Array([0xd0]))).toBeNull();
  });
});

describe('convertInvoiceSheet — 양식', () => {
  it('제목 줄이 대응표와 다르면 「양식이 맞지 않습니다」', () => {
    const header = [...HEADER];
    header[15] = '공급가';
    const r = convertInvoiceSheet(sheet([line()], { header }), MAP, null);
    expect(r).toMatchObject({ ok: false, error: { code: 'format_mismatch', message: '양식이 맞지 않습니다' } });
  });

  it('칸이 하나 더 있어도 맞지 않는다', () => {
    const r = convertInvoiceSheet(sheet([line()], { header: [...HEADER, '추가 칸'] }), MAP, null);
    expect(r).toMatchObject({ ok: false, error: { code: 'format_mismatch' } });
  });

  it('제목 칸 앞뒤 공백은 걷고 비교한다', () => {
    const r = convertInvoiceSheet(sheet([line()], { header: HEADER.map((h) => ` ${h} `) }), MAP, null);
    expect(r.ok).toBe(true);
  });

  it('제목 줄 아래 자료가 10,000줄을 넘으면 막는다', () => {
    const many = Array.from({ length: 10_001 }, (_, i) => line({ approval: `A-${i}` }));
    const r = convertInvoiceSheet(sheet(many), MAP, null);
    expect(r).toMatchObject({ ok: false, error: { code: 'too_many_rows' } });
  });

  it('자료 줄이 없으면 막는다', () => {
    const r = convertInvoiceSheet(sheet([[], [null, '']]), MAP, null);
    expect(r).toMatchObject({ ok: false, error: { code: 'no_rows' } });
  });
});

describe('convertInvoiceSheet — 매입 · 매출 판정(1줄 「사업자 등록번호」)', () => {
  it('우리 번호가 공급자 칸이면 매출(S) — 상대방은 공급받는자 쪽', () => {
    const r = convertInvoiceSheet(sheet([line()]), MAP, null);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.direction).toBe('S');
    expect(r.ownBizNo).toBe(OWN);
    expect(r.rows[0]).toMatchObject({ partnerBizNo: PARTNER_A, partnerName: '지어낸 거래처 가' });
  });

  it('우리 번호가 공급받는자 칸이면 매입(P) — 같은 이름 「상호」를 위치(7번)로 읽는다', () => {
    const r = convertInvoiceSheet(
      sheet([line({ supplier: dash(PARTNER_B), supplierName: '지어낸 공급자', buyer: dash(OWN), buyerName: '지어낸 우리 회사' })]),
      MAP,
      null,
    );
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.direction).toBe('P');
    expect(r.rows[0]).toMatchObject({ partnerBizNo: PARTNER_B, partnerName: '지어낸 공급자' });
  });

  it('우리 번호가 어느 쪽에도 없으면 막는다', () => {
    const r = convertInvoiceSheet(sheet([line({ supplier: dash(PARTNER_B) })]), MAP, null);
    expect(r).toMatchObject({ ok: false, error: { code: 'direction_unknown' } });
  });

  it('매출 줄과 매입 줄이 섞여 있으면 막는다', () => {
    const r = convertInvoiceSheet(
      sheet([line(), line({ approval: 'X-2', supplier: dash(PARTNER_B), buyer: dash(OWN) })]),
      MAP,
      null,
    );
    expect(r).toMatchObject({ ok: false, error: { code: 'direction_unknown' } });
  });

  it('1줄에 「사업자 등록번호」가 없으면 막는다', () => {
    const rows = sheet([line()]);
    rows[0] = ['상호', '지어낸 우리 회사'];
    const r = convertInvoiceSheet(rows, MAP, null);
    expect(r).toMatchObject({ ok: false, error: { code: 'own_biz_no_missing' } });
  });

  it('DB 의 우리 번호와 다르면 막는다', () => {
    const r = convertInvoiceSheet(sheet([line()]), MAP, PARTNER_B);
    expect(r).toMatchObject({ ok: false, error: { code: 'own_biz_no_mismatch' } });
  });

  it('DB 의 우리 번호와 같으면 경고 없음', () => {
    const r = convertInvoiceSheet(sheet([line()]), MAP, OWN);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.warnings.map((w) => w.code)).not.toContain('own_biz_no_unchecked');
  });

  it('DB 에 우리 번호가 없으면 경고만 하고 진행한다', () => {
    const r = convertInvoiceSheet(sheet([line()]), MAP, null);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.warnings.map((w) => w.code)).toContain('own_biz_no_unchecked');
  });
});

describe('convertInvoiceSheet — 줄 거르기', () => {
  it('일반이 아닌 줄 · 번호 빈 줄 · 금액이 숫자가 아닌 줄 · 승인번호 빈 줄 · 겹친 승인번호를 세고 넣지 않는다', () => {
    const r = convertInvoiceSheet(
      sheet([
        line({ approval: 'OK-1' }),
        line({ approval: 'MOD-1', type: '수정' }),
        line({ approval: 'NOBIZ-1', buyer: '' }),
        line({ approval: 'NOBIZ-2', buyer: '123-45' }),
        line({ approval: 'AMT-1', supply: '십만원' }),
        line({ approval: '  ' }),
        line({ approval: 'OK-1' }),
        line({ approval: 'CLS-1', cls: '계산서' }),
        line({ approval: 'DATE-1', date: '9월 5일' }),
        line({ approval: 'OK-2', buyer: dash(PARTNER_B), total: '1,100', supply: '1,000', tax: 100 }),
      ]),
      MAP,
      null,
    );
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.totalRows).toBe(10);
    expect(r.rows.map((x) => x.approvalNo)).toEqual(['OK-1', 'OK-2']);
    expect(r.excluded).toEqual({
      nonGeneral: 1,
      noBizNo: 2,
      badAmount: 1,
      noApproval: 1,
      dupInFile: 1,
      otherClass: 1,
      badDate: 1,
    });
    expect(r.rows[1]).toMatchObject({ totalAmount: 1100, supplyAmount: 1000, taxAmount: 100 });
  });

  it('코드값은 대응표의 바꾸기표로 — 종류 TAX · 세부 종류 GEN', () => {
    const r = convertInvoiceSheet(sheet([line()]), MAP, null);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.rows[0]).toMatchObject({ invClass: 'TAX', invType: 'GEN', writeDate: '2026-09-05' });
  });

  it('바꾸기표에 다른 글자가 있으면 그 글자도 받는다(소스에 박지 않음)', () => {
    const map = { ...MAP, columns: { ...MAP.columns, invType: { col: 19, values: { 일반: 'GEN', 영세율: 'ZERO' } } } };
    const r = convertInvoiceSheet(sheet([line({ type: '영세율' })]), map, null);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.rows[0]!.invType).toBe('ZERO');
  });

  it('작성일은 YYYYMMDD · 날짜 값도 받는다', () => {
    const r = convertInvoiceSheet(
      sheet([line({ approval: 'D-1', date: '20260930' }), line({ approval: 'D-2', date: new Date(Date.UTC(2026, 9, 1)) })]),
      MAP,
      null,
    );
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.rows.map((x) => x.writeDate)).toEqual(['2026-09-30', '2026-10-01']);
  });

  it('상대 사업자번호 끝자리가 틀리면 넣되 경고한다', () => {
    const r = convertInvoiceSheet(sheet([line({ buyer: dash(BAD_CHECK) }), line({ approval: 'X-2' })]), MAP, null);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.rows).toHaveLength(2);
    expect(r.warnings.find((w) => w.code === 'partner_biz_no_checksum')).toMatchObject({ count: 1 });
  });
});

describe('작업할 달 — 주소 ?month= (처음 값 지난달 · 끝 이번 달)', () => {
  const today = new Date(2026, 9, 26); // 2026-10-26(그 기기 시각)
  it('thisMonthOf · previousMonthOf · addMonths', () => {
    expect(thisMonthOf(today)).toBe('2026-10');
    expect(previousMonthOf(today)).toBe('2026-09');
    expect(previousMonthOf(new Date(2026, 0, 5))).toBe('2025-12');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });
  it('workMonthOf — 없거나 틀리거나 이번 달보다 뒤면 지난달', () => {
    expect(workMonthOf(undefined, today)).toBe('2026-09');
    expect(workMonthOf('2026-13', today)).toBe('2026-09');
    expect(workMonthOf('2026-11', today)).toBe('2026-09');
    expect(workMonthOf('2026-10', today)).toBe('2026-10');
    expect(workMonthOf('2025-03', today)).toBe('2025-03');
  });
});

describe('withRo — 이름 뒤 「로 / 으로」(받침에 따라)', () => {
  it('받침 없거나 ㄹ 받침이면 「로」, 그 밖의 받침이면 「으로」', () => {
    expect(withRo('주거래처')).toBe('주거래처로');
    expect(withRo('일반')).toBe('일반으로');
    expect(withRo('서울')).toBe('서울로');
    expect(withRo('ABC')).toBe('ABC(으)로');
  });
});

describe('parseMonth', () => {
  it('YYYY-MM 만 받는다', () => {
    expect(parseMonth('2026-09')).toBe('2026-09');
    expect(parseMonth('2026-13')).toBeNull();
    expect(parseMonth('2026-9')).toBeNull();
    expect(parseMonth(undefined)).toBeNull();
  });
});

describe('parseVendorEdit — 거래처 고치기 본문', () => {
  it('이름 · 번호(숫자만) — 끝자리 틀림은 경고만', () => {
    const r = parseVendorEdit({ name: ' 새 이름 ', bizNo: dash(BAD_CHECK) });
    expect(r).toEqual({ ok: true, value: { name: '새 이름', bizNo: BAD_CHECK }, warnings: [{ field: 'bizNo', code: 'checksum', message: expect.any(String) }] });
  });

  it('이름을 비우면 원래 이름 유지(null) · 번호를 비우면 번호 없음', () => {
    expect(parseVendorEdit({ name: '  ', bizNo: '' })).toEqual({ ok: true, value: { name: null, bizNo: null }, warnings: [] });
  });

  it('칸을 안 보내면 그 칸은 그대로(undefined) — 번호를 지우지 않는다', () => {
    const r = parseVendorEdit({ name: '가' });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.value.bizNo).toBeUndefined();
    expect('bizNo' in r.value).toBe(false);
  });

  it('번호 자리수가 틀리면 400 errors', () => {
    const r = parseVendorEdit({ name: '가', bizNo: '123-45-678' });
    expect(r).toMatchObject({ ok: false, errors: [{ field: 'bizNo' }] });
  });

  it('본문 모양이 틀리면 400 errors — 이름이 100자를 넘어도', () => {
    expect(parseVendorEdit(null)).toMatchObject({ ok: false });
    expect(parseVendorEdit({ name: 3, bizNo: '' })).toMatchObject({ ok: false, errors: [{ field: 'name' }] });
    expect(parseVendorEdit({ name: 'a'.repeat(101), bizNo: '' })).toMatchObject({ ok: false, errors: [{ field: 'name' }] });
  });
});

describe('parseVendorType — 주거래처 / 일반', () => {
  it('ids 와 코드 표에 있는 구분만', () => {
    expect(parseVendorType({ ids: ['a', 'b', 'a'], tp: 'M' }, ['M', 'G'])).toEqual({ ok: true, value: { ids: ['a', 'b'], tp: 'M' } });
    expect(parseVendorType({ ids: [], tp: 'M' }, ['M', 'G'])).toMatchObject({ ok: false, errors: [{ field: 'ids' }] });
    expect(parseVendorType({ ids: ['a'], tp: 'X' }, ['M', 'G'])).toMatchObject({ ok: false, errors: [{ field: 'tp' }] });
    expect(parseVendorType({ ids: [1], tp: 'M' }, ['M', 'G'])).toMatchObject({ ok: false, errors: [{ field: 'ids' }] });
  });
});

describe('parseVendorMerge — 합치기', () => {
  it('남길 곳 하나 + 합칠 곳 하나 이상, 남길 곳은 합칠 곳에 없어야 한다', () => {
    expect(parseVendorMerge({ keepId: 'k', ids: ['a', 'b'] })).toEqual({ ok: true, value: { keepId: 'k', ids: ['a', 'b'] } });
    expect(parseVendorMerge({ keepId: 'k', ids: [] })).toMatchObject({ ok: false, errors: [{ field: 'ids' }] });
    expect(parseVendorMerge({ keepId: 'k', ids: ['k'] })).toMatchObject({ ok: false, errors: [{ field: 'ids' }] });
    expect(parseVendorMerge({ keepId: '', ids: ['a'] })).toMatchObject({ ok: false, errors: [{ field: 'keepId' }] });
  });
});

describe('parseVendorIds — 거래처 지우기', () => {
  it('하나 이상, 겹친 id 는 하나로', () => {
    expect(parseVendorIds({ ids: ['a', 'a', 'b'] })).toEqual({ ok: true, value: ['a', 'b'] });
    expect(parseVendorIds({ ids: [] })).toMatchObject({ ok: false, errors: [{ field: 'ids' }] });
    expect(parseVendorIds({ ids: [1] })).toMatchObject({ ok: false, errors: [{ field: 'ids' }] });
    expect(parseVendorIds(null)).toMatchObject({ ok: false, errors: [{ field: 'ids' }] });
  });
});
