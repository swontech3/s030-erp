/**
 * 엑셀 바이트 → 시트 행. 시험 파일은 SheetJS 로 **지어낸 값**을 써서 만든다(원본 샘플을 쓰지 않는다).
 */
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { readSheetRows, readSocialRows } from './readSheet.ts';

function workbookBytes(rows: unknown[][], bookType: 'xls' | 'xlsx'): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '세금계산서');
  return new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType }) as Buffer);
}

const ROWS: unknown[][] = [
  ['사업자 등록번호', '123-45-67891', '상호', '지어낸 회사'],
  [],
  ['총 합계금액', 110000],
  [],
  ['안내'],
  ['작성일자', '승인번호', '상호', '상호'],
  ['2026-09-05', 'A-1', '공급자 이름', '공급받는자 이름'],
];

describe('readSheetRows', () => {
  it.each(['xls', 'xlsx'] as const)('%s — 첫 시트를 행으로, 빈 줄 자리를 지킨다(1줄 = 0번)', (bookType) => {
    const r = readSheetRows(workbookBytes(ROWS, bookType));
    if (!r.ok) throw new Error(r.message);
    expect(r.format).toBe(bookType);
    expect(r.rows[0]?.[0]).toBe('사업자 등록번호');
    expect(r.rows[5]).toEqual(['작성일자', '승인번호', '상호', '상호']);
    expect(r.rows[6]?.[3]).toBe('공급받는자 이름');
    expect(r.rows[2]?.[1]).toBe(110000);
  });

  it('★ 엑셀 날짜 값 칸은 서버 시간대와 상관없이 적은 날짜 그대로(하루 밀리지 않는다) — 시각이 붙어도 그 날', () => {
    // 일련값 46270 = 2026-09-05 (지어낸 날짜). 46270.979 = 같은 날 23:29 쯤
    const ws = XLSX.utils.aoa_to_sheet([['날짜'], [46270], [46270.979]]);
    ws['A2']!.z = 'yyyy-mm-dd';
    ws['A3']!.z = 'yyyy-mm-dd hh:mm';
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '현금 경비');
    const r = readSheetRows(new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer));
    if (!r.ok) throw new Error(r.message);
    const [d1, d2] = [r.rows[1]?.[0], r.rows[2]?.[0]];
    expect(d1).toBeInstanceOf(Date);
    expect((d1 as Date).toISOString().slice(0, 10)).toBe('2026-09-05');
    expect((d2 as Date).toISOString().slice(0, 10)).toBe('2026-09-05');
  });

  it('엑셀이 아닌 바이트(앞 바이트)는 거절', () => {
    const r = readSheetRows(new TextEncoder().encode('작성일자,승인번호\n2026-09-05,A-1'));
    expect(r).toMatchObject({ ok: false, code: 'not_spreadsheet' });
  });

  it('5MB 를 넘으면 거절', () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(readSheetRows(big)).toMatchObject({ ok: false, code: 'too_large' });
  });

  it('앞 바이트는 맞지만 깨진 파일은 「읽을 수 없는 파일」', () => {
    const broken = new Uint8Array(64);
    broken.set([0x50, 0x4b, 0x03, 0x04]);
    expect(readSheetRows(broken)).toMatchObject({ ok: false, code: 'unreadable' });
  });
});

/**
 * 4대보험 CSV(1-6) — 통합징수포털 파일은 옛 한글 부호(cp949)다. 시험 바이트는 지어낸 값이다.
 * cp949 바이트: 「가」 B0 A1 · 「나」 B3 AA (글자 둘만 손으로 적는다 — Node 에 cp949 로 쓰는 기능이 없다).
 */
describe('readSocialRows — CSV(cp949 · UTF-8) 또는 엑셀', () => {
  const cp949 = (parts: (string | number[])[]) =>
    new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...new TextEncoder().encode(p)] : p)));

  it('★ cp949 CSV — 빈 줄 자리를 지키고(7줄 = 6번) 값은 모두 글자 그대로', () => {
    const r = readSocialRows(cp949(['\r\n\r\n', [0xb0, 0xa1], ',001,', [0xb3, 0xaa], ',1200\r\n']));
    if (!r.ok) throw new Error(r.message);
    expect(r.format).toBe('csv');
    expect(r.rows[0]).toEqual([]);
    expect(r.rows[2]).toEqual(['가', '001', '나', '1200']);
  });

  it('UTF-8(앞 표시 BOM 포함) CSV 도 읽는다', () => {
    const r = readSocialRows(cp949([[0xef, 0xbb, 0xbf], '순번,가입자명\r\n1,시험\r\n']));
    if (!r.ok) throw new Error(r.message);
    expect(r.rows[0]).toEqual(['순번', '가입자명']);
    expect(r.rows[1]).toEqual(['1', '시험']);
  });

  it('엑셀 바이트면 엑셀로 읽는다', () => {
    const r = readSocialRows(workbookBytes([['순번'], ['1']], 'xlsx'));
    if (!r.ok) throw new Error(r.message);
    expect(r.format).toBe('xlsx');
  });

  it('글자 파일이 아닌 바이트(NUL)는 거절 · 5MB 를 넘으면 거절', () => {
    expect(readSocialRows(new Uint8Array([0x61, 0x00, 0x62]))).toMatchObject({ ok: false, code: 'not_spreadsheet' });
    expect(readSocialRows(new Uint8Array(5 * 1024 * 1024 + 1).fill(0x61))).toMatchObject({ ok: false, code: 'too_large' });
  });
});
