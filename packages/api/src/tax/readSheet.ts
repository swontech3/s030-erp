/**
 * 엑셀 바이트 → 첫 시트의 행(셀 배열) — SheetJS(0.20.3, 공식 배포 주소판)로 읽는다.
 *
 * ★ 행 번호를 지킨다 — 0번 = 엑셀 1줄. 빈 줄도 빈 배열로 남긴다(대응표가 「6줄째가 제목」처럼 줄 번호로 가리킨다).
 * ★ 형식은 **파일 앞 바이트**로 본다(xls · xlsx) — 본문 형식(content-type) · 확장자는 믿지 않는다.
 * ★ 크기(5MB)는 Fastify 본문 해석이 먼저 막고 여기서 한 번 더 본다. 줄 수는 상한 + 여유까지만 읽는다 —
 *   나머지는 읽지 않고, 넘친 것은 표준 양식 변환(`convertInvoiceSheet`)이 「10,000줄까지」로 막는다.
 * ★ 수식 · 서식 · 매크로는 읽지 않는다. 값만.
 */
import * as XLSX from 'xlsx';
import {
  TAX_UPLOAD_MAX_BYTES,
  TAX_UPLOAD_MAX_ROWS,
  detectSpreadsheetFormat,
} from '@swonbiz/shared/domain/tax-uploads';

/** 제목 줄 위의 머리 줄 여유 — 이만큼 더 읽어야 「상한을 넘었다」를 알 수 있다. */
const HEAD_ROOM_ROWS = 100;

export type SheetRead =
  | { ok: true; format: 'xls' | 'xlsx'; rows: unknown[][] }
  | { ok: false; code: 'not_spreadsheet' | 'too_large' | 'unreadable'; message: string };

export function readSheetRows(bytes: Uint8Array): SheetRead {
  if (bytes.length > TAX_UPLOAD_MAX_BYTES) {
    return { ok: false, code: 'too_large', message: '파일은 5MB 까지 올릴 수 있습니다' };
  }
  const format = detectSpreadsheetFormat(bytes);
  if (!format) return { ok: false, code: 'not_spreadsheet', message: '엑셀 파일(.xls · .xlsx)만 올릴 수 있습니다' };

  try {
    const wb = XLSX.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), {
      type: 'buffer',
      sheetRows: TAX_UPLOAD_MAX_ROWS + HEAD_ROOM_ROWS,
      cellDates: true,
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      bookVBA: false,
    });
    const first = wb.SheetNames[0];
    const ws = first ? wb.Sheets[first] : undefined;
    if (!ws) return { ok: false, code: 'unreadable', message: '읽을 수 없는 파일입니다' };
    const ref = ws['!ref'];
    if (!ref) return { ok: true, format, rows: [] };
    // ★ 시트가 A1 이 아닌 곳에서 시작해도 0번 = 1줄이 되도록 A1 부터 읽는다
    const range = XLSX.utils.decode_range(ref);
    range.s.r = 0;
    range.s.c = 0;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: true, range });
    return { ok: true, format, rows };
  } catch {
    return { ok: false, code: 'unreadable', message: '읽을 수 없는 파일입니다' };
  }
}
