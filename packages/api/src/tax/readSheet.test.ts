/**
 * 엑셀 바이트 → 시트 행. 시험 파일은 SheetJS 로 **지어낸 값**을 써서 만든다(원본 샘플을 쓰지 않는다).
 */
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { readSheetRows } from './readSheet.ts';

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
