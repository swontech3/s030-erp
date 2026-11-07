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
  taxYearOptions,
  taxMonthOptions,
  pickTaxMonth,
  parseVendorEdit,
  parseVendorClose,
  parseVendorQuery,
  parseVendorType,
  filterVendors,
  vendorSearch,
  vendorsExportFileName,
  type TaxVendorView,
  summarizeAlreadyWhere,
  type InvoiceImportMap,
  TAX_UPLOAD_EXPECTED_FILES,
  isUploadCardKind,
  uploadCountLabel,
  uploadSummary,
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

describe('달 고르기 — 연도 · 월 선택 상자(11-06)', () => {
  it('연도 — 올해 포함 최근 3년, 작업할 달이 더 앞이면 그 해부터', () => {
    expect(taxYearOptions('2026-09', '2026-11')).toEqual(['2024', '2025', '2026']);
    expect(taxYearOptions('2022-05', '2026-11')).toEqual(['2022', '2023', '2024', '2025', '2026']);
  });
  it('월 — 올해는 이번 달까지, 지난해는 1~12월', () => {
    expect(taxMonthOptions('2026', '2026-03')).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(taxMonthOptions('2025', '2026-03')).toHaveLength(12);
  });
  it('연도를 바꾸면 같은 달 — 이번 달보다 뒤면 이번 달', () => {
    expect(pickTaxMonth('2025', '09', '2026-03')).toBe('2025-09');
    expect(pickTaxMonth('2026', '09', '2026-03')).toBe('2026-03');
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

describe('★ 거래처 종료 여부 — 수정 팝업의 거래 중 / 거래 종료(2026-11-07)', () => {
  it('closed 를 보내면 담고, 안 보내면 그대로(undefined)', () => {
    const on = parseVendorEdit({ name: '가', closed: true });
    expect(on.ok && on.value.closed).toBe(true);
    const off = parseVendorEdit({ name: '가', closed: false });
    expect(off.ok && off.value.closed).toBe(false);
    const none = parseVendorEdit({ name: '가' });
    expect(none.ok && 'closed' in none.value).toBe(false);
  });
  it('참/거짓이 아니면 400', () => {
    expect(parseVendorEdit({ name: '가', closed: 'Y' })).toMatchObject({ ok: false, errors: [{ field: 'closed' }] });
  });
});

describe('★ parseVendorClose — [거래종료] 본문', () => {
  it('하나 이상, 겹친 id 는 하나로', () => {
    expect(parseVendorClose({ ids: ['a', 'a', 'b'] })).toEqual({ ok: true, value: ['a', 'b'] });
    expect(parseVendorClose({ ids: [] })).toEqual({ ok: false, errors: [{ field: 'ids', message: '거래를 종료할 거래처를 고르세요' }] });
    expect(parseVendorClose(null)).toMatchObject({ ok: false });
  });
});

describe('★ 거래처 검색 조건 — 검색어 · 구분 · 종료여부(처음 값 거래 중)', () => {
  it('처음 값 — 검색어 없음 · 구분 전체 · 거래 중', () => {
    expect(parseVendorQuery({})).toEqual({ q: '', tp: null, closed: 'open' });
  });
  it('값을 읽는다 — 모르는 종료여부는 거래 중으로', () => {
    expect(parseVendorQuery({ q: ' 한빛 ', tp: 'M', closed: 'closed' })).toEqual({ q: '한빛', tp: 'M', closed: 'closed' });
    expect(parseVendorQuery({ closed: 'all' }).closed).toBe('all');
    expect(parseVendorQuery({ closed: 'x' }).closed).toBe('open');
    expect(parseVendorQuery({ tp: '' }).tp).toBeNull();
  });
  it('주소 글자 — 처음 값은 싣지 않는다', () => {
    expect(vendorSearch({ q: '', tp: null, closed: 'open' })).toBe('');
    expect(vendorSearch({ q: '한빛', tp: 'G', closed: 'all' })).toBe('?q=%ED%95%9C%EB%B9%9B&tp=G&closed=all');
  });
});

describe('★ filterVendors — 화면 목록과 엑셀이 같은 거르기', () => {
  const v = (id: string, name: string, bizNo: string | null, vendorTp: string, closed: boolean): TaxVendorView => ({
    id, name, bizNo, vendorTp, tpSetByUser: false, closed, firstMonth: null,
  });
  const list = [v('1', '한빛상사', '1234567890', 'M', false), v('2', '두리식당', null, 'G', false), v('3', '한빛문구', '9990001111', 'G', true)];
  const ids = (q: Parameters<typeof filterVendors>[1]) => filterVendors(list, q).map((x) => x.id).join();

  it('처음 값은 거래 중만', () => expect(ids({ q: '', tp: null, closed: 'open' })).toBe('1,2'));
  it('종료 · 전체', () => {
    expect(ids({ q: '', tp: null, closed: 'closed' })).toBe('3');
    expect(ids({ q: '', tp: null, closed: 'all' })).toBe('1,2,3');
  });
  it('검색어 — 거래처명 일부 또는 사업자번호 숫자 일부(하이픈 무시)', () => {
    expect(ids({ q: '한빛', tp: null, closed: 'all' })).toBe('1,3');
    expect(ids({ q: '123-45', tp: null, closed: 'all' })).toBe('1');
  });
  it('구분', () => expect(ids({ q: '', tp: 'G', closed: 'all' })).toBe('2,3'));
});

describe('엑셀 파일 이름', () => {
  it('거래처_YYYY-MM-DD.xlsx', () => expect(vendorsExportFileName('2026-11-07')).toBe('거래처_2026-11-07.xlsx'));
});

describe('summarizeAlreadyWhere — 이미 올린 줄이 어디 있는지(그 줄 날짜의 달 · 이미 올린 파일)', () => {
  it('달 · 파일마다 한 줄로 세고, 달 순서 → 처음 나온 파일 순서', () => {
    expect(
      summarizeAlreadyWhere([
        { date: '2026-10-03', fileName: '현금경비_양식.xlsx' },
        { date: '2026-09-30', fileName: '9월.xlsx' },
        { date: '2026-10-05', fileName: '현금경비_양식.xlsx' },
        { date: '2026-10-07', fileName: '추가.xlsx' },
      ]),
    ).toEqual([
      { month: '2026-09', fileName: '9월.xlsx', count: 1 },
      { month: '2026-10', fileName: '현금경비_양식.xlsx', count: 2 },
      { month: '2026-10', fileName: '추가.xlsx', count: 1 },
    ]);
  });

  it('건너뛴 줄이 없으면 빈 목록', () => {
    expect(summarizeAlreadyWhere([])).toEqual([]);
  });
});

describe('★ 자료 올리기 카드 — 4대보험 뺌 · 등록현황(2026-11-07 ④)', () => {
  it('4대보험(SOCIAL)은 카드에서 빠진다 — 나머지는 남는다', () => {
    expect(isUploadCardKind('SOCIAL')).toBe(false);
    for (const k of ['INVOICE', 'CARD', 'CASH', 'BANK', 'NTAX', 'LTAX', 'LOAN']) expect(isUploadCardKind(k)).toBe(true);
  });
  it('정해진 파일 수 — 매출 · 매입 2, 카드 · 현금 · 국세 · 지방세 1, 은행 · 대출은 없음(가변)', () => {
    expect(TAX_UPLOAD_EXPECTED_FILES).toEqual({ INVOICE: 2, CARD: 1, CASH: 1, NTAX: 1, LTAX: 1 });
  });
  it('정해진 파일 — 「등록현황 : 등록 / 올려야 할」', () => {
    expect(uploadCountLabel('INVOICE', 0)).toBe('등록현황 : 0 / 2');
    expect(uploadCountLabel('INVOICE', 1)).toBe('등록현황 : 1 / 2');
    expect(uploadCountLabel('CARD', 1)).toBe('등록현황 : 1 / 1');
    expect(uploadCountLabel('LTAX', 0)).toBe('등록현황 : 0 / 1');
  });
  it('가변 파일(은행 · 대출) — 「등록현황 : N건」', () => {
    expect(uploadCountLabel('BANK', 3)).toBe('등록현황 : 3건');
    expect(uploadCountLabel('LOAN', 0)).toBe('등록현황 : 0건');
  });
  it('위 섹션 — 파일이 하나라도 있는 자료 수 / 올릴 수 있는 자료 수(준비 중 빼고)', () => {
    const cards = [
      { enabled: true, fileCount: 2 },
      { enabled: true, fileCount: 0 },
      { enabled: true, fileCount: 1 },
      { enabled: false, fileCount: 0 },
    ];
    expect(uploadSummary(cards)).toEqual({ done: 2, total: 3 });
    expect(uploadSummary([])).toEqual({ done: 0, total: 0 });
  });
});
