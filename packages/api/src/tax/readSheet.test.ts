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
